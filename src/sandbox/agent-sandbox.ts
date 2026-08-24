// The agent's ephemeral working memory: a plain in-memory map, never a real
// filesystem. This is what makes the agent behave identically on desktop and
// mobile - no dependency on Capacitor's Filesystem plugin or Node's fs, and
// nothing here ever touches the vault directly (download_to_sandbox copies
// FROM the vault INTO this map; nothing copies back).

import { SandboxListEntry, SandboxReadResult } from "../types";
import { toBase64 } from "../util/base64";

interface SandboxObject {
	data: Uint8Array;
	mimeType: string;
	sourcePath: string;
}

const TEXT_EXTENSIONS = new Set(["md", "txt", "csv", "json", "xml", "html", "css", "js", "ts", "yaml", "yml", "log"]);

export class AgentSandbox {
	private store = new Map<string, SandboxObject>();

	write(sandboxPath: string, data: Uint8Array, mimeType: string, sourcePath: string): void {
		this.store.set(sandboxPath, { data, mimeType, sourcePath });
	}

	list(prefix?: string): SandboxListEntry[] {
		const entries: SandboxListEntry[] = [];
		for (const [path, obj] of this.store) {
			if (prefix && !path.startsWith(prefix)) continue;
			entries.push({ sandbox_path: path, size_bytes: obj.data.byteLength, mime_type: obj.mimeType, source_path: obj.sourcePath });
		}
		return entries;
	}

	metadata(sandboxPath: string): SandboxListEntry | null {
		const obj = this.store.get(sandboxPath);
		if (!obj) return null;
		return { sandbox_path: sandboxPath, size_bytes: obj.data.byteLength, mime_type: obj.mimeType, source_path: obj.sourcePath };
	}

	read(sandboxPath: string, maxBytes?: number): SandboxReadResult | null {
		const obj = this.store.get(sandboxPath);
		if (!obj) return null;
		const data = maxBytes && obj.data.byteLength > maxBytes ? obj.data.slice(0, maxBytes) : obj.data;
		const extension = sandboxPath.split(".").pop()?.toLowerCase() ?? "";
		if (TEXT_EXTENSIONS.has(extension)) {
			return { sandbox_path: sandboxPath, encoding: "text", content: new TextDecoder().decode(data) };
		}
		return { sandbox_path: sandboxPath, encoding: "base64", content: toBase64(data) };
	}

	totalBytes(): number {
		let total = 0;
		for (const obj of this.store.values()) total += obj.data.byteLength;
		return total;
	}

	clear(): void {
		this.store.clear();
	}
}
