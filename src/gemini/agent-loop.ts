// Orchestrates one full investigation: repeatedly calls Gemini, dispatches
// any function_call it returns against the read-only vault service, and
// feeds the result back - until the model stops asking for tools, at which
// point one extra formatting-only call turns its answer into a structured
// AgentReport. Also owns the two things the original design left open:
// enforcing the safety/loop limits, and the combined-tool-failure fallback.

import { DelveSettings } from "../settings";
import { ReadOnlyVaultService } from "../vault/read-only-vault-service";
import { SYSTEM_PROMPT, REPORT_JSON_SCHEMA } from "../system-prompt";
import { TOOL_DECLARATIONS } from "./tools";
import {
	GeminiApiError,
	InteractionResponse,
	callInteraction,
	extractBuiltInToolSteps,
	extractFunctionCalls,
	extractModelOutputText,
} from "./client";
import { AgentReport, AgentRunResult, TraceEntry } from "../types";

export interface AgentLoopDeps {
	apiKey: string;
	settings: DelveSettings;
	vaultService: ReadOnlyVaultService;
	onTrace?: (entry: TraceEntry) => void;
}

// 0 = google_search + code_execution + url_context (whichever are enabled)
// 1 = google_search only (if enabled)
// 2 = no built-in tools, function calling only
type ToolLevel = 0 | 1 | 2;

function builtInToolsForLevel(settings: DelveSettings, level: ToolLevel): unknown[] {
	if (level === 2) return [];
	const tools: unknown[] = [];
	if (settings.enableGoogleSearch) tools.push({ type: "google_search" });
	if (level === 0) {
		if (settings.enableCodeExecution) tools.push({ type: "code_execution" });
		if (settings.enableUrlContext) tools.push({ type: "url_context" });
	}
	return tools;
}

function truncateForTrace(text: string, max = 1000): string {
	return text.length > max ? `${text.slice(0, max)}…(truncated in trace)` : text;
}

export async function runAgent(task: string, deps: AgentLoopDeps): Promise<AgentRunResult> {
	const { apiKey, settings, vaultService } = deps;
	const trace: TraceEntry[] = [];
	const pushTrace = (entry: Omit<TraceEntry, "timestamp">) => {
		const full: TraceEntry = { ...entry, timestamp: new Date().toISOString() };
		trace.push(full);
		deps.onTrace?.(full);
	};

	pushTrace({ turn: 0, type: "user_task", detail: task });

	const timeoutMs = Math.max(1, settings.requestTimeoutSeconds) * 1000;
	const deadline = Date.now() + settings.maxExecutionTimeMinutes * 60 * 1000;

	let previousInteractionId: string | undefined;
	let toolCallCount = 0;
	let turn = 0;
	let toolLevel: ToolLevel = 0;
	let input: unknown = task;

	while (true) {
		turn++;
		if (Date.now() > deadline) {
			return { report: null, rawFinalText: "", trace, stoppedReason: "max_execution_time" };
		}
		if (toolCallCount >= settings.maxToolCalls) {
			return { report: null, rawFinalText: "", trace, stoppedReason: "max_tool_calls" };
		}

		let response: InteractionResponse;
		let attemptLevel: ToolLevel = toolLevel;
		for (;;) {
			const builtIns = builtInToolsForLevel(settings, attemptLevel);
			const tools = [...builtIns, ...TOOL_DECLARATIONS];
			const isCombined = builtIns.length > 0;
			try {
				response = await callInteraction({
					apiKey,
					model: settings.model,
					input,
					systemInstruction: SYSTEM_PROMPT,
					tools,
					toolChoice: isCombined ? { allowed_tools: { mode: "validated" } } : undefined,
					previousInteractionId,
					timeoutMs,
				});
				toolLevel = attemptLevel;
				break;
			} catch (e: any) {
				if (e instanceof GeminiApiError && isCombined && attemptLevel < 2) {
					const nextLevel = (attemptLevel + 1) as ToolLevel;
					pushTrace({
						turn,
						type: "fallback",
						detail: `Combined built-in + custom tool request failed (HTTP ${e.status}: ${e.message}) - retrying with a reduced tool set.`,
					});
					attemptLevel = nextLevel;
					continue;
				}
				pushTrace({ turn, type: "error", detail: e?.message ?? String(e) });
				return { report: null, rawFinalText: "", trace, stoppedReason: "error", error: e?.message ?? String(e) };
			}
		}

		for (const step of extractBuiltInToolSteps(response)) {
			pushTrace({ turn, type: "built_in_tool_call", name: step.type, detail: truncateForTrace(JSON.stringify(step)) });
		}

		const functionCalls = extractFunctionCalls(response);
		if (functionCalls.length === 0) {
			const finalText = extractModelOutputText(response);
			pushTrace({ turn, type: "model_output", detail: truncateForTrace(finalText, 2000) });
			return await finalizeReport(deps, response.id, timeoutMs, trace, pushTrace, finalText);
		}

		toolCallCount += functionCalls.length;
		const functionResults: unknown[] = [];
		for (const call of functionCalls) {
			const args = call.arguments ?? {};
			pushTrace({ turn, type: "function_call", name: call.name, detail: truncateForTrace(JSON.stringify(args)) });
			const result = await vaultService.dispatch(call.name ?? "", args);
			pushTrace({ turn, type: "function_result", name: call.name, detail: truncateForTrace(JSON.stringify(result)) });
			functionResults.push({
				type: "function_result",
				name: call.name,
				call_id: call.call_id,
				result: [{ type: "text", text: JSON.stringify(result) }],
			});
		}

		previousInteractionId = response.id;
		input = functionResults;
	}
}

// One extra call, deliberately with no tools at all - once the investigation
// is done, this call's only job is to reshape the already-produced answer
// into the AgentReport schema via response_format, so the plugin never has
// to re-parse free text out of the middle of an agentic run.
async function finalizeReport(
	deps: AgentLoopDeps,
	previousInteractionId: string,
	timeoutMs: number,
	trace: TraceEntry[],
	pushTrace: (entry: Omit<TraceEntry, "timestamp">) => void,
	investigationFinalText: string
): Promise<AgentRunResult> {
	try {
		const response = await callInteraction({
			apiKey: deps.apiKey,
			model: deps.settings.model,
			input: "Provide your final report now, as JSON matching the schema you were given, based on everything you found above.",
			systemInstruction: SYSTEM_PROMPT,
			previousInteractionId,
			responseFormat: { type: "text", mime_type: "application/json", schema: REPORT_JSON_SCHEMA },
			timeoutMs,
		});
		const rawText = extractModelOutputText(response);
		let report: AgentReport | null = null;
		try {
			report = JSON.parse(rawText);
		} catch (e) {
			report = null;
		}
		pushTrace({ turn: -1, type: "model_output", detail: truncateForTrace(rawText || investigationFinalText, 2000) });
		return { report, rawFinalText: rawText || investigationFinalText, trace, stoppedReason: "completed" };
	} catch (e: any) {
		pushTrace({ turn: -1, type: "error", detail: e?.message ?? String(e) });
		return { report: null, rawFinalText: investigationFinalText, trace, stoppedReason: "error", error: e?.message ?? String(e) };
	}
}
