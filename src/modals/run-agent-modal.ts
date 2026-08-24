import { App, Modal, Notice } from "obsidian";
import type DelvePlugin from "../plugin";
import { runAgent } from "../gemini/agent-loop";
import { ReadOnlyVaultService } from "../vault/read-only-vault-service";
import { AgentSandbox } from "../sandbox/agent-sandbox";
import { exportReportToVault } from "../report/report-builder";
import { AgentRunResult, TraceEntry } from "../types";
import { autosizeClamped, bindScrollableHeight } from "../views/textarea-autosize";

const STOPPED_REASON_LABEL: Record<AgentRunResult["stoppedReason"], string> = {
	completed: "Done",
	max_tool_calls: "Stopped - hit the max tool calls limit",
	max_execution_time: "Stopped - hit the max execution time limit",
	error: "Stopped - an error occurred",
};

export class RunAgentModal extends Modal {
	private taskInput!: HTMLTextAreaElement;
	private traceEl!: HTMLElement;
	private statusEl!: HTMLElement;
	private runButton!: HTMLButtonElement;
	private exportButton!: HTMLButtonElement;
	private result: AgentRunResult | null = null;
	private task = "";
	private running = false;
	private cleanupFns: (() => void)[] = [];

	constructor(app: App, private plugin: DelvePlugin) {
		super(app);
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass("delve-run-modal");
		contentEl.createEl("h2", { text: "Investigate vault" });
		contentEl.createEl("p", {
			text: "Describe what you want Delve to find out. It reads your vault - it has no ability to write to it.",
			cls: "setting-item-description",
		});

		this.taskInput = contentEl.createEl("textarea", {
			attr: {
				placeholder:
					"e.g. Which notes talk about the Delve release process, and are they consistent with each other?",
			},
		});
		this.taskInput.addEventListener("input", () => {
			this.task = this.taskInput.value;
		});
		this.cleanupFns.push(autosizeClamped(this.taskInput, 3, 8));

		const buttonRow = contentEl.createDiv({ cls: "modal-button-container" });
		this.runButton = buttonRow.createEl("button", { text: "Investigate", cls: "mod-cta" });
		this.runButton.addEventListener("click", () => this.startRun());
		this.exportButton = buttonRow.createEl("button", { text: "Export report" });
		this.exportButton.disabled = true;
		this.exportButton.addEventListener("click", () => this.doExport());

		this.statusEl = contentEl.createDiv({ cls: "delve-status" });

		contentEl.createEl("h3", { text: "Trace" });
		this.traceEl = contentEl.createDiv({ cls: "delve-trace-log" });
		this.cleanupFns.push(bindScrollableHeight(this.traceEl));

		window.setTimeout(() => this.taskInput.focus(), 0);
	}

	private appendTrace(entry: TraceEntry) {
		const line = this.traceEl.createDiv({ cls: `delve-trace-entry delve-trace-${entry.type}` });
		line.createEl("strong", { text: entry.name ? `${entry.type}: ${entry.name}` : entry.type });
		line.createDiv({ text: entry.detail, cls: "delve-trace-detail" });
		this.traceEl.scrollTop = this.traceEl.scrollHeight;
	}

	private async startRun() {
		if (this.running) return;
		const task = this.task.trim();
		if (!task) {
			new Notice("Enter a task first.");
			return;
		}

		const apiKey = await this.plugin.getDecryptedApiKey();
		if (!apiKey) {
			new Notice("Configure a Gemini API key in Delve's settings first.");
			return;
		}

		this.running = true;
		this.result = null;
		this.runButton.disabled = true;
		this.exportButton.disabled = true;
		this.traceEl.empty();
		this.statusEl.setText("Investigating…");

		const sandbox = new AgentSandbox();
		const vaultService = new ReadOnlyVaultService(this.app, sandbox, {
			maxBytesReadMb: this.plugin.settings.maxBytesReadMb,
			maxFilesRead: this.plugin.settings.maxFilesRead,
			maxAttachmentBytesMb: this.plugin.settings.maxAttachmentBytesMb,
		});

		try {
			this.result = await runAgent(task, {
				apiKey,
				settings: this.plugin.settings,
				vaultService,
				onTrace: (entry) => this.appendTrace(entry),
			});
			this.statusEl.setText(STOPPED_REASON_LABEL[this.result.stoppedReason]);
			this.exportButton.disabled = false;
		} catch (e: any) {
			this.statusEl.setText(`Stopped - ${e?.message ?? e}`);
			new Notice(`Delve: ${e?.message ?? e}`);
		} finally {
			this.running = false;
			this.runButton.disabled = false;
		}
	}

	private async doExport() {
		if (!this.result) return;
		try {
			const path = await exportReportToVault(this.app, this.result, this.task, this.plugin.settings.defaultExportFolder);
			new Notice(`Delve report exported to ${path}`);
		} catch (e: any) {
			new Notice(`Export failed: ${e?.message ?? e}`);
		}
	}

	onClose() {
		this.contentEl.empty();
		for (const fn of this.cleanupFns) fn();
	}
}
