// The 15 finalized read-only function declarations, in Gemini Interactions
// API shape (`{ type: "function", name, description, parameters }`,
// `parameters` always a proper JSON Schema object - never a bare type).
// Descriptions are in English since they go directly to the model.
//
// This is the ONLY place tool name/description/parameters are declared -
// never duplicated in the system prompt (see system-prompt.ts). Adding,
// editing, or removing a tool only ever touches this file plus its
// implementation in vault/read-only-vault-service.ts.

export interface FunctionDeclaration {
	type: "function";
	name: string;
	description: string;
	parameters: {
		type: "object";
		properties: Record<string, unknown>;
		required: string[];
	};
}

export const TOOL_DECLARATIONS: FunctionDeclaration[] = [
	// --- Navigation & search ------------------------------------------------
	{
		type: "function",
		name: "list_directory",
		description:
			"Lists the contents of a vault directory. Use include_files=false to see only the folder tree (topology), or true to also see files. Use this before searching to understand vault structure.",
		parameters: {
			type: "object",
			properties: {
				path: { type: "string", description: 'Vault-relative folder path. Use "" for vault root.' },
				recursive: { type: "boolean", description: "Descend into subfolders. Default false." },
				max_depth: { type: "integer", description: "Max recursion depth when recursive=true. Omit for a server-enforced default cap." },
				include_files: { type: "boolean", description: "Include files as well as folders. Default true." },
				extensions: { type: "array", items: { type: "string" }, description: 'Optional filter, e.g. ["md", "pdf"].' },
			},
			required: ["path"],
		},
	},
	{
		type: "function",
		name: "list_tags",
		description:
			"Returns all tags used across the vault (frontmatter + inline #tags) with usage counts. Use this to understand vault taxonomy before searching by tag.",
		parameters: {
			type: "object",
			properties: {
				path_prefix: { type: "string", description: "Restrict to tags used within this folder only." },
				min_count: { type: "integer", description: "Omit tags used fewer than this many times." },
			},
			required: [],
		},
	},
	{
		type: "function",
		name: "find_files",
		description:
			"Deterministically filters vault files by tag, folder, extension, or a frontmatter key/value - cheaper and more precise than search_vault when the criteria are structured, not free text.",
		parameters: {
			type: "object",
			properties: {
				tag: { type: "string" },
				folder: { type: "string" },
				extension: { type: "string" },
				frontmatter_key: { type: "string" },
				frontmatter_value: { type: "string" },
				limit: { type: "integer", description: "Default 50." },
			},
			required: [],
		},
	},
	{
		type: "function",
		name: "search_vault",
		description:
			"Full-text search across vault file contents. Returns short matching snippets, not whole files. Always prefer this over get_file_content when looking for a concept rather than a known file path.",
		parameters: {
			type: "object",
			properties: {
				query: { type: "string" },
				path_prefix: { type: "string" },
				extensions: { type: "array", items: { type: "string" }, description: 'Default ["md"].' },
				case_sensitive: { type: "boolean", description: "Default false." },
				regex: { type: "boolean", description: "Default false." },
				max_results: { type: "integer", description: "Default 50, hard cap enforced server-side." },
			},
			required: ["query"],
		},
	},
	{
		type: "function",
		name: "get_file_metadata",
		description:
			"Returns rich metadata for one file without loading its full content: size, character count, timestamps, frontmatter, tags, aliases, headings, outgoing links and embeds. Use before get_file_content to decide relevance.",
		parameters: {
			type: "object",
			properties: { path: { type: "string" } },
			required: ["path"],
		},
	},
	{
		type: "function",
		name: "get_file_content",
		description:
			"Returns the full raw text of a markdown/text file. Token-expensive for large files - prefer search_vault or get_file_metadata first. Not for binary attachments; use load_attachment for those.",
		parameters: {
			type: "object",
			properties: {
				path: { type: "string" },
				max_characters: { type: "integer", description: "Truncate content to this length; result flags truncated=true if applied." },
			},
			required: ["path"],
		},
	},

	// --- Link graph ----------------------------------------------------------
	{
		type: "function",
		name: "get_links",
		description:
			"Returns the outgoing links of a file, each marked resolved (with target path) or unresolved (target note doesn't exist yet).",
		parameters: {
			type: "object",
			properties: { path: { type: "string" } },
			required: ["path"],
		},
	},
	{
		type: "function",
		name: "resolve_link",
		description:
			"Resolves a single [[link]] target as seen from a given source file to its actual vault file path, if one exists.",
		parameters: {
			type: "object",
			properties: {
				linkpath: { type: "string" },
				source_path: { type: "string" },
			},
			required: ["linkpath", "source_path"],
		},
	},
	{
		type: "function",
		name: "get_backlinks",
		description: "Returns all files in the vault that link to the given file (inbound links / backlinks).",
		parameters: {
			type: "object",
			properties: { path: { type: "string" } },
			required: ["path"],
		},
	},

	// --- Attachments -----------------------------------------------------------
	{
		type: "function",
		name: "get_attachment_metadata",
		description:
			"Returns size, extension and mime type for a non-text attachment without loading its bytes. Use to decide whether and how to load it further.",
		parameters: {
			type: "object",
			properties: { path: { type: "string" } },
			required: ["path"],
		},
	},
	{
		type: "function",
		name: "load_attachment",
		description:
			"Loads a binary attachment of any format (image, PDF, audio, video, office document, archive) for direct multimodal interpretation or local parsing. For large files or bulk loading, use download_to_sandbox instead.",
		parameters: {
			type: "object",
			properties: {
				path: { type: "string" },
				max_bytes: { type: "integer", description: "Safety cap; call fails cleanly if exceeded instead of loading partial data." },
			},
			required: ["path"],
		},
	},
	{
		type: "function",
		name: "download_to_sandbox",
		description:
			"Copies a file or an entire folder's contents from the vault into the agent's ephemeral in-memory sandbox for later inspection or processing (e.g. before code_execution analysis). Never modifies the vault.",
		parameters: {
			type: "object",
			properties: {
				path: { type: "string" },
				recursive: { type: "boolean", description: "For folders: include subfolders. Default false." },
			},
			required: ["path"],
		},
	},

	// --- Sandbox (agent working memory) -----------------------------------------
	{
		type: "function",
		name: "sandbox_list",
		description: "Lists files currently held in the agent's sandbox.",
		parameters: {
			type: "object",
			properties: { prefix: { type: "string" } },
			required: [],
		},
	},
	{
		type: "function",
		name: "sandbox_read",
		description: "Reads a file from the sandbox - as text if parseable, otherwise as base64 bytes.",
		parameters: {
			type: "object",
			properties: {
				sandbox_path: { type: "string" },
				max_bytes: { type: "integer" },
			},
			required: ["sandbox_path"],
		},
	},
	{
		type: "function",
		name: "sandbox_metadata",
		description: "Returns size, mime type and originating vault path for one sandboxed object, without reading its content.",
		parameters: {
			type: "object",
			properties: { sandbox_path: { type: "string" } },
			required: ["sandbox_path"],
		},
	},
];

// The dispatcher recognizes only these names - nothing else, and certainly
// no vault.create/modify/delete. An unknown function_call.name always gets
// { ok: false, error: "Tool not permitted" }, never silently ignored.
export const READ_ONLY_TOOLS: ReadonlySet<string> = new Set(TOOL_DECLARATIONS.map((t) => t.name));
