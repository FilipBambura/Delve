import * as mammoth from "mammoth";

// DOCX gets parsed locally rather than sent natively to Gemini - preserves
// clean structured text extraction that a generic multimodal read would lose
// for a text-heavy office format.
export async function extractDocxText(data: ArrayBuffer): Promise<string> {
	const result = await mammoth.extractRawText({ arrayBuffer: data });
	return result.value;
}
