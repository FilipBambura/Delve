import { Notice, Plugin } from "obsidian";
import { DEFAULT_SETTINGS, DelveSettings } from "./settings";
import { ENCRYPTION_CHECK_VALUE, decryptString } from "./crypto";
import { DelveSettingTab } from "./settings-tab";
import { RunAgentModal } from "./modals/run-agent-modal";
import { promptForPassword } from "./modals/password-prompt-modal";

export default class DelvePlugin extends Plugin {
	settings!: DelveSettings;

	// Session-only state for encryption - NEVER persisted via saveData(). After
	// an Obsidian restart these are always null/"" and the password has to be
	// entered again.
	sessionPassword: string | null = null;
	private decryptedApiKey = "";

	async onload() {
		await this.loadSettings();
		this.addSettingTab(new DelveSettingTab(this.app, this));

		this.addRibbonIcon("search", "Investigate vault with Delve", () => {
			new RunAgentModal(this.app, this).open();
		});

		this.addCommand({
			id: "investigate-vault",
			name: "Investigate vault",
			callback: () => new RunAgentModal(this.app, this).open(),
		});
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	// Resolves the API key regardless of whether it's stored in plaintext or
	// encrypted - prompting for the encryption password at most once per
	// session. Returns null (rather than throwing) whenever the key isn't
	// usable yet, so callers can show a plain Notice instead of an error.
	async getDecryptedApiKey(): Promise<string | null> {
		if (!this.settings.encryptKey) {
			return this.settings.apiKey || null;
		}
		if (this.decryptedApiKey) return this.decryptedApiKey;
		if (!this.settings.encryptedApiKey || !this.settings.encryptionCheck) return null;

		const password = this.sessionPassword ?? (await promptForPassword(this.app, "Enter your Delve encryption password"));
		if (!password) return null;

		try {
			const check = await decryptString(this.settings.encryptionCheck, password);
			if (check !== ENCRYPTION_CHECK_VALUE) {
				new Notice("Delve: incorrect password.");
				return null;
			}
			this.sessionPassword = password;
			this.decryptedApiKey = await decryptString(this.settings.encryptedApiKey, password);
			return this.decryptedApiKey;
		} catch (e) {
			new Notice("Delve: failed to decrypt the API key.");
			return null;
		}
	}

	// Called by the settings tab whenever the encrypted key material changes
	// (password set/changed/removed), so a stale decrypted copy is never used
	// after the underlying ciphertext no longer matches it.
	clearDecryptedApiKeyCache() {
		this.decryptedApiKey = "";
	}
}
