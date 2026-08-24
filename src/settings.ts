import { EncryptedBlob } from "./crypto";

export type ModelInputMode = "preset" | "manual";

export interface DelveSettings {
	model: string;
	modelInputMode: ModelInputMode;
	requestTimeoutSeconds: number;

	encryptKey: boolean;
	apiKey: string;
	encryptedApiKey: EncryptedBlob | null;
	encryptionCheck: EncryptedBlob | null;

	enableGoogleSearch: boolean;
	enableCodeExecution: boolean;
	enableUrlContext: boolean;

	// Safety/loop limits - defaults match the values placeholder-fixed in the
	// original tool spec; deliberately settings, not constants, since the
	// spec itself notes these need empirical tuning.
	maxToolCalls: number;
	maxExecutionTimeMinutes: number;
	maxBytesReadMb: number;
	maxFilesRead: number;
	maxAttachmentBytesMb: number;

	defaultExportFolder: string;
}

export const DEFAULT_SETTINGS: DelveSettings = {
	model: "gemini-3.7-flash",
	modelInputMode: "preset",
	requestTimeoutSeconds: 60,

	encryptKey: false,
	apiKey: "",
	encryptedApiKey: null,
	encryptionCheck: null,

	enableGoogleSearch: true,
	enableCodeExecution: true,
	enableUrlContext: true,

	maxToolCalls: 200,
	maxExecutionTimeMinutes: 10,
	maxBytesReadMb: 1000,
	maxFilesRead: 500,
	maxAttachmentBytesMb: 15,

	defaultExportFolder: "Delve Reports",
};

export interface ModelPreset {
	id: string;
	label: string;
	value: string;
}

// gemini-3.7-flash is the current stable flagship (1M context, tuned for
// agentic/tool-use workloads) - not a "-preview" or "-latest" rolling alias,
// so it doesn't carry the silent-behavior-change risk a rolling alias would.
export const MODEL_PRESETS: ModelPreset[] = [
	{ id: "flash", label: "Gemini 3.7 Flash (recommended - balanced, agentic)", value: "gemini-3.7-flash" },
	{ id: "flash-lite", label: "Gemini 3.5 Flash Lite (fastest, cheapest)", value: "gemini-3.5-flash-lite" },
	{ id: "pro", label: "Gemini 3.1 Pro (preview - hardest reasoning tasks)", value: "gemini-3.1-pro-preview" },
];
