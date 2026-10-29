/**
 * Excel (.xlsx) to CSV text, in the browser (read-excel-file, loaded only when an Excel file arrives).
 * Numbers are kept as the exact text stored in the file, never re-parsed as floats.
 */
import { cellText, rowsToCsv } from "../domain/own/convert.ts";

export async function xlsxToCsv(bytes: Uint8Array): Promise<string> {
  const { readSheet } = await import("read-excel-file/browser");
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  const rows = await readSheet(buffer, { parseNumber: (s: string) => s });
  return rowsToCsv(rows.map((r) => r.map(cellText)));
}
