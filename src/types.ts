// Shared types for the read-only tool contract, the vault/sandbox data shapes
// each tool returns, and the agent's final report. Kept separate from the
// Gemini wire format (see gemini/client.ts) - these describe *our* domain,
// not Google's request/response schema.

export type EnvelopeSource = "vault" | "sandbox" | "web";

// Every function_result the dispatcher sends back to the model is wrapped in
// this envelope - it's what keeps token growth in check (truncated/total_available)
// and what stops vault content from ever being read as instructions.
export interface ToolEnvelope<T = unknown> {
	ok: boolean;
	source: EnvelopeSource;
	trusted_as_instructions: false;
	data: T | null;
	truncated: boolean;
	total_available: number;
	error?: string;
}

export interface DirectoryEntry {
	path: string;
	type: "file" | "folder";
	extension?: string;
	size_bytes?: number;
}

export interface TagCount {
	tag: string;
	count: number;
}

export interface FoundFile {
	path: string;
	matched_on: string;
}

export interface SearchMatch {
	line: number;
	text: string;
}

export interface SearchResult {
	path: string;
	matches: SearchMatch[];
}

export interface HeadingInfo {
	level: number;
	text: string;
}

export interface FileMetadata {
	path: string;
	extension: string;
	size_bytes: number;
	character_count: number;
	ctime: string;
	mtime: string;
	frontmatter: Record<string, unknown> | null;
	tags: string[];
	aliases: string[];
	headings: HeadingInfo[];
	links: string[];
	embeds: string[];
}

export interface FileContentResult {
	path: string;
	content: string;
}

export interface LinkInfo {
	target: string;
	resolved: boolean;
	path?: string;
}

export interface AttachmentMetadata {
	path: string;
	extension: string;
	size_bytes: number;
	mime_type: string;
}

export interface LoadedAttachment {
	path: string;
	mime_type: string;
	size_bytes: number;
	encoding: "base64" | "reference" | "text";
	data?: string;
	sandbox_path?: string;
}

export interface DownloadToSandboxResult {
	sandbox_paths: string[];
	total_bytes: number;
}

export interface SandboxListEntry {
	sandbox_path: string;
	size_bytes: number;
	mime_type: string;
	source_path: string;
}

export interface SandboxReadResult {
	sandbox_path: string;
	encoding: "text" | "base64";
	content: string;
}

// --- Agent execution trace & final report ---------------------------------

export type TraceStepType =
	| "user_task"
	| "thought"
	| "function_call"
	| "function_result"
	| "built_in_tool_call"
	| "model_output"
	| "fallback"
	| "error";

export interface TraceEntry {
	turn: number;
	type: TraceStepType;
	name?: string;
	detail: string;
	timestamp: string;
}

export interface AgentFinding {
	claim: string;
	source: string;
}

export interface AgentReport {
	task: string;
	answer: string;
	findings: AgentFinding[];
	uncertainties: string[];
	investigated: string[];
}

export interface AgentRunResult {
	report: AgentReport | null;
	rawFinalText: string;
	trace: TraceEntry[];
	stoppedReason: "completed" | "max_tool_calls" | "max_execution_time" | "error";
	error?: string;
}
