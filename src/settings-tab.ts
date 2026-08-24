import { App, Notice, PluginSettingTab, Setting } from "obsidian";
import type DelvePlugin from "./plugin";
import { MODEL_PRESETS } from "./settings";
import { ENCRYPTION_CHECK_VALUE, encryptString, decryptString } from "./crypto";
import { promptForPassword } from "./modals/password-prompt-modal";

export class DelveSettingTab extends PluginSettingTab {
	constructor(app: App, private plugin: DelvePlugin) {
		super(app, plugin);
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();
		const settings = this.plugin.settings;

		containerEl.createEl("h2", { text: "Gemini API" });

		new Setting(containerEl)
			.setName("Enter model ID manually")
			.setDesc("Off: pick from a short list of current models. On: type any model ID yourself.")
			.addToggle((toggle) =>
				toggle.setValue(settings.modelInputMode === "manual").onChange(async (value) => {
					settings.modelInputMode = value ? "manual" : "preset";
					await this.plugin.saveSettings();
					this.display();
				})
			);

		if (settings.modelInputMode === "manual") {
			new Setting(containerEl)
				.setName("Model")
				.setDesc("Any valid Gemini Interactions API model ID, e.g. gemini-3.7-flash.")
				.addText((text) =>
					text.setValue(settings.model).onChange(async (value) => {
						settings.model = value.trim();
						await this.plugin.saveSettings();
					})
				);
		} else {
			new Setting(containerEl).setName("Model").addDropdown((dropdown) => {
				for (const preset of MODEL_PRESETS) dropdown.addOption(preset.value, preset.label);
				dropdown.setValue(settings.model).onChange(async (value) => {
					settings.model = value;
					await this.plugin.saveSettings();
				});
			});
		}

		this.renderApiKeySection(containerEl);

		containerEl.createEl("h2", { text: "Built-in tools" });
		containerEl.createEl("p", {
			text: "Google Search, Code Execution and URL Context run on Google's servers alongside Delve's own read-only vault tools, in the same request.",
			cls: "setting-item-description",
		});

		new Setting(containerEl)
			.setName("Google Search")
			.setDesc("Lets the agent fill gaps the vault genuinely doesn't answer. Vault evidence always takes priority.")
			.addToggle((toggle) =>
				toggle.setValue(settings.enableGoogleSearch).onChange(async (value) => {
					settings.enableGoogleSearch = value;
					await this.plugin.saveSettings();
				})
			);

		new Setting(containerEl)
			.setName("Code Execution")
			.setDesc("Lets the agent run Python in Google's sandbox, e.g. to analyze something downloaded into its sandbox.")
			.addToggle((toggle) =>
				toggle.setValue(settings.enableCodeExecution).onChange(async (value) => {
					settings.enableCodeExecution = value;
					await this.plugin.saveSettings();
				})
			);

		new Setting(containerEl)
			.setName("URL Context")
			.setDesc("Lets the agent read the content of a URL it encounters.")
			.addToggle((toggle) =>
				toggle.setValue(settings.enableUrlContext).onChange(async (value) => {
					settings.enableUrlContext = value;
					await this.plugin.saveSettings();
				})
			);

		containerEl.createEl("h2", { text: "Safety limits" });
		containerEl.createEl("p", {
			text: "Bound a single investigation's cost and runtime. These are starting defaults, not tuned - adjust them once you've seen a few real runs.",
			cls: "setting-item-description",
		});

		this.numberSetting(containerEl, "Max tool calls per run", settings.maxToolCalls, async (v) => {
			settings.maxToolCalls = v;
			await this.plugin.saveSettings();
		});
		this.numberSetting(containerEl, "Max execution time (minutes)", settings.maxExecutionTimeMinutes, async (v) => {
			settings.maxExecutionTimeMinutes = v;
			await this.plugin.saveSettings();
		});
		this.numberSetting(containerEl, "Max total bytes read from the vault (MB)", settings.maxBytesReadMb, async (v) => {
			settings.maxBytesReadMb = v;
			await this.plugin.saveSettings();
		});
		this.numberSetting(containerEl, "Max files read per run", settings.maxFilesRead, async (v) => {
			settings.maxFilesRead = v;
			await this.plugin.saveSettings();
		});
		this.numberSetting(containerEl, "Max single attachment size (MB)", settings.maxAttachmentBytesMb, async (v) => {
			settings.maxAttachmentBytesMb = v;
			await this.plugin.saveSettings();
		});
		this.numberSetting(containerEl, "Request timeout (seconds)", settings.requestTimeoutSeconds, async (v) => {
			settings.requestTimeoutSeconds = v;
			await this.plugin.saveSettings();
		});

		containerEl.createEl("h2", { text: "Export" });
		new Setting(containerEl)
			.setName("Report export folder")
			.setDesc("Vault folder reports are saved into (created if it doesn't exist yet).")
			.addText((text) =>
				text.setValue(settings.defaultExportFolder).onChange(async (value) => {
					settings.defaultExportFolder = value.trim() || "Delve Reports";
					await this.plugin.saveSettings();
				})
			);
	}

	private numberSetting(containerEl: HTMLElement, name: string, value: number, onChange: (value: number) => Promise<void>) {
		new Setting(containerEl).setName(name).addText((text) => {
			text.inputEl.type = "number";
			text.setValue(String(value)).onChange(async (raw) => {
				const parsed = Number(raw);
				if (Number.isFinite(parsed) && parsed > 0) await onChange(parsed);
			});
		});
	}

	private renderApiKeySection(containerEl: HTMLElement) {
		const settings = this.plugin.settings;

		if (!settings.encryptKey) {
			new Setting(containerEl)
				.setName("Gemini API key")
				.setDesc("Stored in plain text in this vault's plugin data. Enable encryption below to protect it with a password instead.")
				.addText((text) => {
					text.inputEl.type = "password";
					text.setValue(settings.apiKey).onChange(async (value) => {
						settings.apiKey = value.trim();
						await this.plugin.saveSettings();
					});
				});
		} else {
			containerEl.createEl("p", {
				text: "Gemini API key is encrypted at rest. You'll be asked for your password the first time you run an investigation each session.",
				cls: "setting-item-description",
			});
		}

		new Setting(containerEl)
			.setName("Encrypt API key at rest")
			.setDesc("Protects the key with a password you choose. The password itself is never saved - only kept in memory for the current session.")
			.addToggle((toggle) =>
				toggle.setValue(settings.encryptKey).onChange(async (value) => {
					if (value) {
						await this.enableEncryption();
					} else {
						await this.disableEncryption();
					}
					this.display();
				})
			);
	}

	private async enableEncryption() {
		const settings = this.plugin.settings;
		const password = await promptForPassword(this.app, "Choose a password to encrypt your Gemini API key");
		if (!password) return;

		settings.encryptedApiKey = await encryptString(settings.apiKey, password);
		settings.encryptionCheck = await encryptString(ENCRYPTION_CHECK_VALUE, password);
		settings.apiKey = "";
		settings.encryptKey = true;
		this.plugin.sessionPassword = password;
		this.plugin.clearDecryptedApiKeyCache();
		await this.plugin.saveSettings();
		new Notice("Delve: API key encrypted.");
	}

	private async disableEncryption() {
		const settings = this.plugin.settings;
		if (!settings.encryptedApiKey || !settings.encryptionCheck) {
			settings.encryptKey = false;
			await this.plugin.saveSettings();
			return;
		}

		const password = this.plugin.sessionPassword ?? (await promptForPassword(this.app, "Enter your Delve encryption password"));
		if (!password) return;

		try {
			const check = await decryptString(settings.encryptionCheck, password);
			if (check !== ENCRYPTION_CHECK_VALUE) {
				new Notice("Delve: incorrect password - encryption left unchanged.");
				return;
			}
			settings.apiKey = await decryptString(settings.encryptedApiKey, password);
		} catch (e) {
			new Notice("Delve: failed to decrypt - encryption left unchanged.");
			return;
		}

		settings.encryptedApiKey = null;
		settings.encryptionCheck = null;
		settings.encryptKey = false;
		this.plugin.sessionPassword = null;
		this.plugin.clearDecryptedApiKeyCache();
		await this.plugin.saveSettings();
		new Notice("Delve: API key decrypted back to plain text.");
	}
}
