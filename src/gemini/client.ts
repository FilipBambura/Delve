// Pure HTTP layer for the Gemini Interactions API. Knows nothing about the
// vault, the tool dispatcher, or the agent loop - it just sends one
// interaction request and returns a parsed response, or throws a typed
// error. All orchestration (multi-turn looping, tool dispatch, fallback
// strategy) lives in agent-loop.ts.

import { requestUrl } from "obsidian";

const API_ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/interactions";
const API_REVISION = "2026-05-20";

export class RateLimitError extends Error {}
export class TimeoutError extends Error {}
export class GeminiApiError extends Error {
	constructor(public status: number, public code: string, message: string) {
		super(message);
	}
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
	return new Promise((resolve, reject) => {
		const timer = setTimeout(() => {
			reject(new TimeoutError(`Request timed out after ${ms / 1000}s.`));
		}, ms);
		promise.then(
			(value) => {
				clearTimeout(timer);
				resolve(value);
			},
			(err) => {
				clearTimeout(timer);
				reject(err);
			}
		);
	});
}

export interface GeminiStep {
	type: string;
	id?: string;
	name?: string;
	arguments?: Record<string, unknown>;
	call_id?: string;
	content?: { type: string; text?: string }[];
}

export interface InteractionResponse {
	id: string;
	status: "completed" | "in_progress" | "requires_action" | "failed" | "cancelled";
	model: string;
	steps: GeminiStep[];
	usage?: { total_tokens?: number; total_input_tokens?: number; total_output_tokens?: number };
}

export interface InteractionRequestParams {
	apiKey: string;
	model: string;
	input: unknown;
	systemInstruction?: string;
	tools?: unknown[];
	toolChoice?: unknown;
	previousInteractionId?: string;
	responseFormat?: unknown;
	timeoutMs: number;
}

export async function callInteraction(params: InteractionRequestParams): Promise<InteractionResponse> {
	const body: Record<string, unknown> = {
		model: params.model,
		input: params.input,
	};
	if (params.systemInstruction) body.system_instruction = params.systemInstruction;
	if (params.tools && params.tools.length > 0) body.tools = params.tools;
	if (params.previousInteractionId) body.previous_interaction_id = params.previousInteractionId;
	if (params.responseFormat) body.response_format = params.responseFormat;
	if (params.toolChoice) {
		body.generation_config = { tool_choice: params.toolChoice };
	}

	const res = await withTimeout(
		requestUrl({
			url: API_ENDPOINT,
			method: "POST",
			throw: false,
			headers: {
				"Content-Type": "application/json",
				"x-goog-api-key": params.apiKey,
				"Api-Revision": API_REVISION,
			},
			body: JSON.stringify(body),
		}),
		params.timeoutMs
	);

	if (res.status < 200 || res.status >= 300) {
		let code = "unknown";
		let message = `HTTP ${res.status}`;
		try {
			const errBody = res.json;
			if (errBody?.error) {
				code = errBody.error.code ?? errBody.error.status ?? code;
				message = errBody.error.message ?? message;
			}
		} catch (e) {
			// response body wasn't JSON - fall back to the generic HTTP message above
		}
		if (res.status === 429) {
			throw new RateLimitError(`${code}: ${message}`);
		}
		throw new GeminiApiError(res.status, code, message);
	}

	let responseBody: any;
	try {
		responseBody = res.json;
	} catch (e) {
		console.error("Delve: response body wasn't valid JSON", res.text);
		throw new Error("Response wasn't valid JSON (see console for details).");
	}

	return {
		id: responseBody.id,
		status: responseBody.status,
		model: responseBody.model,
		steps: responseBody.steps ?? [],
		usage: responseBody.usage,
	};
}

export function extractFunctionCalls(response: InteractionResponse): GeminiStep[] {
	return response.steps.filter((s) => s.type === "function_call");
}

export function extractModelOutputText(response: InteractionResponse): string {
	const parts: string[] = [];
	for (const step of response.steps) {
		if (step.type !== "model_output") continue;
		for (const block of step.content ?? []) {
			if (block.type === "text" && typeof block.text === "string") parts.push(block.text);
		}
	}
	return parts.join("");
}

const BUILT_IN_STEP_TYPES = new Set([
	"google_search_call",
	"google_search_result",
	"code_execution_call",
	"code_execution_result",
	"url_context_call",
	"url_context_result",
]);

export function extractBuiltInToolSteps(response: InteractionResponse): GeminiStep[] {
	return response.steps.filter((s) => BUILT_IN_STEP_TYPES.has(s.type));
}
