/**
 * Other everyday file formats, turned into plain comma CSV text so the normal reader takes over.
 * Pure: semicolon/tab-separated text, bank downloads (OFX/QFX/QBO), and spreadsheet rows (from the
 * Excel reader in state/excel.ts). Each returns null when the input is not that format.
 */

const quote = (v: string) => (/[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

/** Rows of cells to CSV text (CRLF, quoted where needed). */
export function rowsToCsv(rows: readonly (readonly string[])[]): string {
  return rows.map((r) => r.map(quote).join(",")).join("\r\n") + "\r\n";
}

/** Split one line on a delimiter, honouring double quotes. */
function splitLine(line: string, d: string): string[] {
  const out: string[] = [];
  let cur = "", q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i]!;
    if (q) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; } else if (c === '"') q = false; else cur += c;
    } else if (c === '"') q = true;
    else if (c === d) { out.push(cur); cur = ""; } else cur += c;
  }
  out.push(cur);
  return out;
}

const count = (s: string, c: string) => s.split(c).length - 1;
// "1.234,56" or "1234,56" (decimal comma) -> "1234.56"
const DECIMAL_COMMA = /^(-?)(\d{1,3}(?:\.\d{3})+|\d+),(\d{1,2})$/;

/** Semicolon- or tab-separated text to comma CSV; null when commas already lead. */
export function delimitedToCsv(text: string): string | null {
  const first = text.replace(/^﻿/, "").split(/\r?\n/, 1)[0] ?? "";
  const counts = { ",": count(first, ","), ";": count(first, ";"), "\t": count(first, "\t") };
  const d = counts[";"] > counts[","] && counts[";"] >= counts["\t"] ? ";" : counts["\t"] > counts[","] ? "\t" : null;
  if (d === null) return null;
  const rows = text.replace(/^﻿/, "").split(/\r?\n/).filter((l) => l.trim() !== "").map((l) => splitLine(l, d).map((c) => c.trim()));
  // Semicolon files usually come from places that write decimal commas.
  const fixed = d === ";" ? rows.map((r) => r.map((c) => c.replace(DECIMAL_COMMA, (_, s: string, w: string, f: string) => `${s}${w.replace(/\./g, "")}.${f}`))) : rows;
  return rowsToCsv(fixed);
}

const tag = (block: string, name: string) => new RegExp(`<${name}>([^<\\r\\n]*)`, "i").exec(block)?.[1]?.trim() ?? "";

/** A bank download (OFX, QFX, QBO; SGML or XML) to "Date,Description,Amount" CSV; null when not one. */
export function ofxToCsv(text: string): string | null {
  if (!/<OFX>/i.test(text)) return null;
  const rows: string[][] = [["Date", "Description", "Amount"]];
  for (const block of text.split(/<STMTTRN>/i).slice(1)) {
    const d = tag(block, "DTPOSTED");
    const amount = tag(block, "TRNAMT");
    if (!/^\d{8}/.test(d) || amount === "") continue;
    const name = tag(block, "NAME"), memo = tag(block, "MEMO");
    const description = name && memo && !name.includes(memo) ? `${name} ${memo}` : name || memo;
    rows.push([`${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`, description, amount]);
  }
  return rowsToCsv(rows);
}

/** One spreadsheet cell as text: dates as YYYY-MM-DD, long float tails rounded to cents. */
export function cellText(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? "" : v.toISOString().slice(0, 10);
  const s = String(v).trim();
  // Spreadsheets store doubles: "1299.0100000000002" is 1299.01.
  return /^-?\d+\.\d{3,}$/.test(s) ? Number(s).toFixed(2) : s;
}
