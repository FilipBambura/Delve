// Small, deliberately non-exhaustive extension -> MIME map. Good enough for
// the two things Delve needs a MIME type for: labeling get_attachment_metadata
// results, and telling Gemini what kind of base64 blob it's receiving.

const MIME_BY_EXTENSION: Record<string, string> = {
	pdf: "application/pdf",
	png: "image/png",
	jpg: "image/jpeg",
	jpeg: "image/jpeg",
	gif: "image/gif",
	webp: "image/webp",
	svg: "image/svg+xml",
	bmp: "image/bmp",
	mp3: "audio/mpeg",
	wav: "audio/wav",
	m4a: "audio/mp4",
	ogg: "audio/ogg",
	flac: "audio/flac",
	mp4: "video/mp4",
	mov: "video/quicktime",
	webm: "video/webm",
	mkv: "video/x-matroska",
	docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
	xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
	xls: "application/vnd.ms-excel",
	pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
	ppt: "application/vnd.ms-powerpoint",
	zip: "application/zip",
	csv: "text/csv",
	json: "application/json",
	txt: "text/plain",
};

export function mimeTypeForExtension(extension: string): string {
	return MIME_BY_EXTENSION[extension.toLowerCase()] ?? "application/octet-stream";
}
