// Assembles the agent's final report into a zip and writes it into the
// vault. Deliberately not exposed as a tool the agent itself can call - this
// is invoked only from a distinct, explicit "Export report" UI action (see
// modals/run-agent-modal.ts), after the run has already finished. Writing
// into the vault (vault.createBinary) rather than triggering a browser-style
// download is also what makes export reliable on mobile Obsidian.

import JSZip from "jszip";
import { App, normalizePath } from "obsidian";
import { AgentReport, AgentRunResult } from "../types";

function fallbackReport(result: AgentRunResult, task: string): AgentReport {
	return {
		task,
		answer: result.rawFinalText || "(no answer produced)",
		findings: [],
		uncertainties: result.error ? [`Run did not complete cleanly: ${result.error}`] : [],
		investigated: [],
	};
}

function renderReportMd(report: AgentReport, task: string, stoppedReason: string): string {
	const lines: string[] = [`# Delve report`, "", `**Task:** ${report.task || task}`, ""];
	if (stoppedReason !== "completed") {
		lines.push(`> [!warning] Run stopped early: ${stoppedReason}`, "");
	}
	lines.push(`## Answer`, "", report.answer, "");
	if (report.uncertainties.length > 0) {
		lines.push(`## Uncertainties`, "");
		for (const u of report.uncertainties) lines.push(`- ${u}`);
		lines.push("");
	}
	lines.push(`## Investigated`, "");
	for (const i of report.investigated) lines.push(`- ${i}`);
	if (report.investigated.length === 0) lines.push(`(none recorded)`);
	lines.push("", `See sources.md for per-finding citations and trace.json for the full tool-call trace.`);
	return lines.join("\n");
}

function renderSourcesMd(report: AgentReport): string {
	const lines = ["# Sources", ""];
	if (report.findings.length === 0) lines.push("(no findings recorded)");
	for (const f of report.findings) {
		lines.push(`- ${f.claim}`);
		lines.push(`  Source: ${f.source}`);
	}
	return lines.join("\n");
}

export async function buildReportZip(result: AgentRunResult, task: string): Promise<Uint8Array> {
	const report = result.report ?? fallbackReport(result, task);

	const zip = new JSZip();
	zip.file("report.md", renderReportMd(report, task, result.stoppedReason));
	zip.file("sources.md", renderSourcesMd(report));
	zip.file("findings.json", JSON.stringify(report.findings, null, 2));
	zip.file("vault-map.json", JSON.stringify({ investigated: report.investigated }, null, 2));
	zip.file("trace.json", JSON.stringify(result.trace, null, 2));
	return zip.generateAsync({ type: "uint8array" });
}

export async function exportReportToVault(app: App, result: AgentRunResult, task: string, folder: string): Promise<string> {
	const bytes = await buildReportZip(result, task);
	const normalizedFolder = normalizePath(folder);
	if (!(await app.vault.adapter.exists(normalizedFolder))) {
		await app.vault.createFolder(normalizedFolder);
	}
	const stamp = new Date().toISOString().replace(/[:.]/g, "-");
	const path = normalizePath(`${normalizedFolder}/delve-report-${stamp}.zip`);
	const arrayBuffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
	await app.vault.createBinary(path, arrayBuffer);
	return path;
}
