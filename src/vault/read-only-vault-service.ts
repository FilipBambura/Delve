// Implements all 15 read-only tools against the live Obsidian Vault/MetadataCache
// API. This is the ONLY place that touches app.vault/app.metadataCache for the
// agent's benefit - the READ_ONLY_TOOLS whitelist is enforced right here, at
// the top of dispatch(), before any switch on tool name. There is no
// vault.create/modify/delete/rename call anywhere in this file, and there
// never should be: an unknown or write-shaped tool name always gets
// { ok: false, error: "Tool not permitted" }, never silently executed.

import { App, TFile, TFolder, getAllTags, parseFrontMatterAliases } from "obsidian";
import { AgentSandbox } from "../sandbox/agent-sandbox";
import { classifyAttachment, extractDocxText, extractXlsxText, mimeTypeForExtension } from "../attachments";
import { toBase64 } from "../util/base64";
import { READ_ONLY_TOOLS } from "../gemini/tools";
import {
	AttachmentMetadata,
	DirectoryEntry,
	DownloadToSandboxResult,
	FileContentResult,
	FileMetadata,
	FoundFile,
	LinkInfo,
	LoadedAttachment,
	SearchResult,
	TagCount,
	ToolEnvelope,
} from "../types";

export interface VaultServiceLimits {
	maxBytesReadMb: number;
	maxFilesRead: number;
	maxAttachmentBytesMb: number;
}

type Source = "vault" | "sandbox";

function ok<T>(source: Source, data: T, truncated: boolean, totalAvailable: number): ToolEnvelope<T> {
	return { ok: true, source, trusted_as_instructions: false, data, truncated, total_available: totalAvailable };
}

// Returns ToolEnvelope<any> deliberately - an error result carries no typed
// data, and this lets it satisfy any of the per-tool ToolEnvelope<T> return
// types above without every call site having to repeat a type argument.
function fail(source: Source, error: string): ToolEnvelope<any> {
	return { ok: false, source, trusted_as_instructions: false, data: null, truncated: false, total_available: 0, error };
}

export class ReadOnlyVaultService {
	private bytesReadTotal = 0;
	private filesReadTotal = 0;
	private readonly maxBytesRead: number;
	private readonly maxAttachmentBytes: number;

	constructor(private app: App, private sandbox: AgentSandbox, private limits: VaultServiceLimits) {
		this.maxBytesRead = limits.maxBytesReadMb * 1024 * 1024;
		this.maxAttachmentBytes = limits.maxAttachmentBytesMb * 1024 * 1024;
	}

	async dispatch(name: string, args: Record<string, any>): Promise<ToolEnvelope> {
		if (!READ_ONLY_TOOLS.has(name)) {
			return fail("vault", "Tool not permitted");
		}
		try {
			switch (name) {
				case "list_directory":
					return await this.listDirectory(args);
				case "list_tags":
					return await this.listTags(args);
				case "find_files":
					return await this.findFiles(args);
				case "search_vault":
					return await this.searchVault(args);
				case "get_file_metadata":
					return await this.getFileMetadata(args);
				case "get_file_content":
					return await this.getFileContent(args);
				case "get_links":
					return await this.getLinks(args);
				case "resolve_link":
					return await this.resolveLink(args);
				case "get_backlinks":
					return await this.getBacklinks(args);
				case "get_attachment_metadata":
					return await this.getAttachmentMetadata(args);
				case "load_attachment":
					return await this.loadAttachment(args);
				case "download_to_sandbox":
					return await this.downloadToSandbox(args);
				case "sandbox_list":
					return await this.sandboxList(args);
				case "sandbox_read":
					return await this.sandboxRead(args);
				case "sandbox_metadata":
					return await this.sandboxMetadata(args);
				default:
					return fail("vault", "Tool not permitted");
			}
		} catch (e: any) {
			return fail("vault", e?.message ?? String(e));
		}
	}

	// --- Aggregate safety limits, shared by every content-reading tool -------

	private tryChargeBytes(bytes: number): string | null {
		if (this.bytesReadTotal + bytes > this.maxBytesRead) {
			return `Aggregate read limit reached (${this.limits.maxBytesReadMb} MB for this run) - narrow your query instead of reading more.`;
		}
		return null;
	}

	private chargeFile(bytes: number): string | null {
		if (this.filesReadTotal + 1 > this.limits.maxFilesRead) {
			return `Aggregate file-read limit reached (${this.limits.maxFilesRead} files for this run).`;
		}
		const bytesError = this.tryChargeBytes(bytes);
		if (bytesError) return bytesError;
		this.filesReadTotal += 1;
		this.bytesReadTotal += bytes;
		return null;
	}

	// --- Navigation & search ---------------------------------------------------

	private listDirectory(args: Record<string, any>): ToolEnvelope<DirectoryEntry[]> {
		const path: string = args.path ?? "";
		const recursive: boolean = args.recursive ?? false;
		const maxDepth: number = args.max_depth ?? 6;
		const includeFiles: boolean = args.include_files ?? true;
		const extensions: string[] | undefined = args.extensions;

		const root = path === "" ? this.app.vault.getRoot() : this.app.vault.getAbstractFileByPath(path);
		if (!root || !(root instanceof TFolder)) {
			return fail("vault", `Folder not found: "${path}"`);
		}

		const entries: DirectoryEntry[] = [];
		const walk = (folder: TFolder, depth: number) => {
			for (const child of folder.children) {
				if (child instanceof TFolder) {
					entries.push({ path: child.path, type: "folder" });
					if (recursive && depth < maxDepth) walk(child, depth + 1);
				} else if (child instanceof TFile && includeFiles) {
					if (extensions && extensions.length > 0 && !extensions.includes(child.extension)) continue;
					entries.push({ path: child.path, type: "file", extension: child.extension, size_bytes: child.stat.size });
				}
			}
		};
		walk(root, 0);
		return ok("vault", entries, false, entries.length);
	}

	private listTags(args: Record<string, any>): ToolEnvelope<TagCount[]> {
		const pathPrefix: string | undefined = args.path_prefix;
		const minCount: number = args.min_count ?? 0;

		const counts = new Map<string, number>();
		for (const file of this.app.vault.getMarkdownFiles()) {
			if (pathPrefix && !file.path.startsWith(pathPrefix)) continue;
			const cache = this.app.metadataCache.getFileCache(file);
			if (!cache) continue;
			const tags = getAllTags(cache) ?? [];
			for (const tag of tags) counts.set(tag, (counts.get(tag) ?? 0) + 1);
		}

		const result: TagCount[] = Array.from(counts.entries())
			.filter(([, count]) => count >= minCount)
			.map(([tag, count]) => ({ tag, count }))
			.sort((a, b) => b.count - a.count);
		return ok("vault", result, false, result.length);
	}

	private findFiles(args: Record<string, any>): ToolEnvelope<FoundFile[]> {
		const limit: number = args.limit ?? 50;
		const results: FoundFile[] = [];

		for (const file of this.app.vault.getFiles()) {
			if (results.length >= limit) break;
			if (args.folder && !file.path.startsWith(args.folder)) continue;
			if (args.extension && file.extension !== args.extension) continue;

			let matchedOn: string | null = args.folder || args.extension ? "folder/extension" : null;

			if (args.tag || args.frontmatter_key) {
				const cache = this.app.metadataCache.getFileCache(file);
				if (args.tag) {
					const tags = cache ? getAllTags(cache) ?? [] : [];
					if (!tags.includes(args.tag)) continue;
					matchedOn = "tag";
				}
				if (args.frontmatter_key) {
					const fm = cache?.frontmatter;
					if (!fm || !(args.frontmatter_key in fm)) continue;
					if (args.frontmatter_value !== undefined && String(fm[args.frontmatter_key]) !== String(args.frontmatter_value)) continue;
					matchedOn = "frontmatter";
				}
			}

			if (!matchedOn) {
				// No criteria at all given - find_files isn't meant to be a full listing.
				continue;
			}
			results.push({ path: file.path, matched_on: matchedOn });
		}
		return ok("vault", results, false, results.length);
	}

	private async searchVault(args: Record<string, any>): Promise<ToolEnvelope<SearchResult[]>> {
		const query: string = args.query;
		if (!query) return fail("vault", "query is required");
		const pathPrefix: string | undefined = args.path_prefix;
		const extensions: string[] = args.extensions ?? ["md"];
		const caseSensitive: boolean = args.case_sensitive ?? false;
		const useRegex: boolean = args.regex ?? false;
		const maxResults: number = Math.min(args.max_results ?? 50, 200);

		let matcher: (line: string) => boolean;
		if (useRegex) {
			const re = new RegExp(query, caseSensitive ? "" : "i");
			matcher = (line) => re.test(line);
		} else {
			const needle = caseSensitive ? query : query.toLowerCase();
			matcher = (line) => (caseSensitive ? line : line.toLowerCase()).includes(needle);
		}

		const results: SearchResult[] = [];
		let totalMatchingFiles = 0;
		for (const file of this.app.vault.getFiles()) {
			if (!extensions.includes(file.extension)) continue;
			if (pathPrefix && !file.path.startsWith(pathPrefix)) continue;

			const bytesError = this.tryChargeBytes(file.stat.size);
			if (bytesError) break;

			const content = await this.app.vault.cachedRead(file);
			this.bytesReadTotal += file.stat.size;
			this.filesReadTotal += 1;

			const lines = content.split("\n");
			const matches = lines
				.map((text, i) => ({ line: i + 1, text }))
				.filter((m) => matcher(m.text))
				.slice(0, 20);
			if (matches.length === 0) continue;

			totalMatchingFiles++;
			if (results.length < maxResults) {
				results.push({ path: file.path, matches });
			}
		}
		return ok("vault", results, totalMatchingFiles > results.length, totalMatchingFiles);
	}

	private async getFileMetadata(args: Record<string, any>): Promise<ToolEnvelope<FileMetadata>> {
		const path: string = args.path;
		const file = this.app.vault.getAbstractFileByPath(path);
		if (!(file instanceof TFile)) return fail("vault", `File not found: "${path}"`);

		const cache = this.app.metadataCache.getFileCache(file);
		const tags = cache ? getAllTags(cache) ?? [] : [];
		const aliases = parseFrontMatterAliases(cache?.frontmatter ?? null) ?? [];
		const headings = (cache?.headings ?? []).map((h) => ({ level: h.level, text: h.heading }));
		const links = (cache?.links ?? []).map((l) => l.link);
		const embeds = (cache?.embeds ?? []).map((e) => e.link);
		// A cachedRead just to count characters is cheap (in-memory cache, not a
		// fresh disk read), so it's not charged against the aggregate read
		// limits the way get_file_content/search_vault are - this is meant to
		// stay the cheap alternative to actually loading a file's content.
		const characterCount = file.extension === "md" || file.extension === "txt" ? (await this.app.vault.cachedRead(file)).length : file.stat.size;

		const metadata: FileMetadata = {
			path: file.path,
			extension: file.extension,
			size_bytes: file.stat.size,
			character_count: characterCount,
			ctime: new Date(file.stat.ctime).toISOString(),
			mtime: new Date(file.stat.mtime).toISOString(),
			frontmatter: cache?.frontmatter ?? null,
			tags,
			aliases,
			headings,
			links,
			embeds,
		};
		return ok("vault", metadata, false, 1);
	}

	private async getFileContent(args: Record<string, any>): Promise<ToolEnvelope<FileContentResult>> {
		const path: string = args.path;
		const file = this.app.vault.getAbstractFileByPath(path);
		if (!(file instanceof TFile)) return fail("vault", `File not found: "${path}"`);

		const limitError = this.chargeFile(file.stat.size);
		if (limitError) return fail("vault", limitError);

		const raw = await this.app.vault.cachedRead(file);
		const maxCharacters: number | undefined = args.max_characters;
		const truncated = !!maxCharacters && raw.length > maxCharacters;
		const content = truncated ? raw.slice(0, maxCharacters) : raw;
		return ok("vault", { path: file.path, content }, truncated, raw.length);
	}

	// --- Link graph --------------------------------------------------------

	private getLinks(args: Record<string, any>): ToolEnvelope<LinkInfo[]> {
		const path: string = args.path;
		const resolved = this.app.metadataCache.resolvedLinks[path] ?? {};
		const unresolved = this.app.metadataCache.unresolvedLinks[path] ?? {};
		const links: LinkInfo[] = [
			...Object.keys(resolved).map((target) => ({ target, resolved: true, path: target })),
			...Object.keys(unresolved).map((target) => ({ target, resolved: false })),
		];
		return ok("vault", links, false, links.length);
	}

	private resolveLink(args: Record<string, any>): ToolEnvelope<{ resolved: boolean; path: string | null }> {
		const { linkpath, source_path } = args;
		const dest = this.app.metadataCache.getFirstLinkpathDest(linkpath, source_path);
		const data = dest ? { resolved: true, path: dest.path } : { resolved: false, path: null };
		return ok("vault", data, false, 1);
	}

	private getBacklinks(args: Record<string, any>): ToolEnvelope<string[]> {
		const path: string = args.path;
		const backlinks: string[] = [];
		for (const [source, targets] of Object.entries(this.app.metadataCache.resolvedLinks)) {
			if (path in targets) backlinks.push(source);
		}
		return ok("vault", backlinks, false, backlinks.length);
	}

	// --- Attachments ---------------------------------------------------------

	private getAttachmentMetadata(args: Record<string, any>): ToolEnvelope<AttachmentMetadata> {
		const path: string = args.path;
		const file = this.app.vault.getAbstractFileByPath(path);
		if (!(file instanceof TFile)) return fail("vault", `File not found: "${path}"`);
		const data: AttachmentMetadata = {
			path: file.path,
			extension: file.extension,
			size_bytes: file.stat.size,
			mime_type: mimeTypeForExtension(file.extension),
		};
		return ok("vault", data, false, 1);
	}

	private async loadAttachment(args: Record<string, any>): Promise<ToolEnvelope<LoadedAttachment>> {
		const path: string = args.path;
		const file = this.app.vault.getAbstractFileByPath(path);
		if (!(file instanceof TFile)) return fail("vault", `File not found: "${path}"`);

		const cap = Math.min(args.max_bytes ?? this.maxAttachmentBytes, this.maxAttachmentBytes);
		if (file.stat.size > cap) {
			return fail("vault", `Attachment (${file.stat.size} bytes) exceeds max_bytes cap (${cap} bytes).`);
		}
		const limitError = this.chargeFile(file.stat.size);
		if (limitError) return fail("vault", limitError);

		const bytes = await this.app.vault.readBinary(file);
		const mimeType = mimeTypeForExtension(file.extension);
		const handling = classifyAttachment(file.extension);

		let result: LoadedAttachment;
		if (handling === "docx") {
			const text = await extractDocxText(bytes);
			result = { path: file.path, mime_type: mimeType, size_bytes: file.stat.size, encoding: "text", data: text };
		} else if (handling === "xlsx") {
			const text = extractXlsxText(bytes);
			result = { path: file.path, mime_type: mimeType, size_bytes: file.stat.size, encoding: "text", data: text };
		} else {
			result = { path: file.path, mime_type: mimeType, size_bytes: file.stat.size, encoding: "base64", data: toBase64(new Uint8Array(bytes)) };
		}
		return ok("vault", result, false, 1);
	}

	private async downloadToSandbox(args: Record<string, any>): Promise<ToolEnvelope<DownloadToSandboxResult>> {
		const path: string = args.path;
		const recursive: boolean = args.recursive ?? false;
		const target = this.app.vault.getAbstractFileByPath(path);
		if (!target) return fail("vault", `Not found: "${path}"`);

		const sandboxPaths: string[] = [];
		let totalBytes = 0;

		const copyFile = async (file: TFile): Promise<boolean> => {
			const limitError = this.chargeFile(file.stat.size);
			if (limitError) return false;
			const bytes = await this.app.vault.readBinary(file);
			this.sandbox.write(file.path, new Uint8Array(bytes), mimeTypeForExtension(file.extension), file.path);
			sandboxPaths.push(file.path);
			totalBytes += file.stat.size;
			return true;
		};

		if (target instanceof TFile) {
			await copyFile(target);
		} else if (target instanceof TFolder) {
			const walk = async (folder: TFolder): Promise<void> => {
				for (const child of folder.children) {
					if (child instanceof TFile) {
						if (!(await copyFile(child))) return;
					} else if (child instanceof TFolder && recursive) {
						await walk(child);
					}
				}
			};
			await walk(target);
		}
		return ok("vault", { sandbox_paths: sandboxPaths, total_bytes: totalBytes }, false, sandboxPaths.length);
	}

	// --- Sandbox -------------------------------------------------------------

	private sandboxList(args: Record<string, any>): ToolEnvelope {
		const entries = this.sandbox.list(args.prefix);
		return ok("sandbox", entries, false, entries.length);
	}

	private sandboxRead(args: Record<string, any>): ToolEnvelope {
		const result = this.sandbox.read(args.sandbox_path, args.max_bytes);
		if (!result) return fail("sandbox", `Not in sandbox: "${args.sandbox_path}"`);
		return ok("sandbox", result, false, 1);
	}

	private sandboxMetadata(args: Record<string, any>): ToolEnvelope {
		const meta = this.sandbox.metadata(args.sandbox_path);
		if (!meta) return fail("sandbox", `Not in sandbox: "${args.sandbox_path}"`);
		return ok("sandbox", meta, false, 1);
	}
}
