import * as XLSX from "xlsx";

// XLSX gets parsed locally rather than sent natively to Gemini - a plain
// CSV-per-sheet dump is far cheaper and more reliable for the model to read
// than asking it to interpret a spreadsheet as an image/document blob.
export function extractXlsxText(data: ArrayBuffer): string {
	const workbook = XLSX.read(data, { type: "array" });
	const parts: string[] = [];
	for (const sheetName of workbook.SheetNames) {
		const sheet = workbook.Sheets[sheetName];
		const csv = XLSX.utils.sheet_to_csv(sheet);
		parts.push(`## Sheet: ${sheetName}\n${csv}`);
	}
	return parts.join("\n\n");
}
