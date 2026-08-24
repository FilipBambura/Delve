// Attachment handling is hybrid: PDFs, images, audio and video go to Gemini
// natively (a local parser would throw away visual/structural context the
// model can use directly). DOCX and XLSX are parsed locally for cleaner
// structured text extraction. PPTX has no dedicated parser yet - it
// deliberately falls back to the native path, per the original tool spec
// ("what's excluded"), not as a new scope cut.

export type AttachmentHandling = "native" | "docx" | "xlsx";

export function classifyAttachment(extension: string): AttachmentHandling {
	const ext = extension.toLowerCase();
	if (ext === "docx") return "docx";
	if (ext === "xlsx" || ext === "xls") return "xlsx";
	return "native";
}

export { extractDocxText } from "./docx";
export { extractXlsxText } from "./xlsx";
export { mimeTypeForExtension } from "./mime";
