/** Tolerant amount/date parsing for "own data" mode. The strict demo parsers are unchanged. */
import type { Cents } from "../contracts.ts";
import { MAX_AMOUNT_CENTS } from "../contracts.ts";
import { isRealDate } from "../csv.ts";

export type LooseAmount =
  | { ok: true; cents: Cents }
  | { ok: false; reason: "blank" | "not a number" | "credit or negative amount" | "too large" };

const CURRENCY_PREFIX = /^(\$|usd)\s*/i;
const PLAIN = /^(\d+)(?:\.(\d{1,2}))?$/;
const GROUPED = /^(\d{1,3}(?:,\d{3})+)(?:\.(\d{1,2}))?$/;

export function parseLooseAmount(text: string): LooseAmount {
  const s = text.trim();
  if (s === "") return { ok: false, reason: "blank" };
  const body = s.replace(CURRENCY_PREFIX, "");
  if (/^[(\-−]/.test(body) || /\d\s*(?:cr|[-−])$/i.test(body)) return { ok: false, reason: "credit or negative amount" };
  const m = PLAIN.exec(body) ?? GROUPED.exec(body);
  if (!m) return { ok: false, reason: "not a number" };
  const whole = m[1]!.replaceAll(",", "").replace(/^0+(?=\d)/, "");
  if (whole.length > 10) return { ok: false, reason: "too large" };
  // Digit-string concatenation: no float multiplication.
  const cents = Number(whole + (m[2] ?? "").padEnd(2, "0"));
  if (cents > MAX_AMOUNT_CENTS) return { ok: false, reason: "too large" };
  return { ok: true, cents };
}

export type DateOrder = "YMD" | "MDY" | "DMY";

const TIME_PART = /[T\s]+\d{1,2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:\s*[ap]m)?\s*(?:Z|[+-]\d{2}:?\d{2})?$/i;
const DATE_SHAPE = /^(\d{1,4})[-/.](\d{1,2})[-/.](\d{1,4})$/;

const dateParts = (text: string) => DATE_SHAPE.exec(text.trim().replace(TIME_PART, ""));

export function detectDateOrder(samples: readonly string[]): DateOrder | "ambiguous" | "unrecognised" {
  const definite = new Set<DateOrder>();
  const twoDigit: Set<DateOrder>[] = []; // candidate orders for yy-shaped samples
  let recognised = 0;
  for (const sample of samples) {
    const m = dateParts(sample);
    if (!m) continue;
    const [a, b, c] = [m[1]!, m[2]!, m[3]!];
    if (a.length === 4 && c.length <= 2) {
      recognised++;
      definite.add("YMD");
    } else if (a.length <= 2 && b.length <= 2 && c.length === 4) {
      recognised++;
      if (Number(a) > 12) definite.add("DMY");
      else if (Number(b) > 12) definite.add("MDY");
    } else if (a.length <= 2 && b.length <= 2 && c.length === 2) {
      recognised++;
      const [x, y, z] = [Number(a), Number(b), Number(c)];
      const cand = new Set<DateOrder>();
      if (y >= 1 && y <= 12 && z >= 1 && z <= 31) cand.add("YMD");
      if (x >= 1 && x <= 12 && y >= 1 && y <= 31) cand.add("MDY");
      if (x >= 1 && x <= 31 && y >= 1 && y <= 12) cand.add("DMY");
      if (cand.size === 1) definite.add([...cand][0]!);
      else twoDigit.push(cand);
    }
  }
  if (recognised === 0) return "unrecognised";
  if (definite.size !== 1) return "ambiguous";
  const order = [...definite][0]!;
  // An undecided yy sample that cannot be read in the winning order keeps the file ambiguous.
  return twoDigit.every((c) => c.has(order)) ? order : "ambiguous";
}

export function parseLooseDate(text: string, order: DateOrder): string | null {
  const m = dateParts(text);
  if (!m) return null;
  const [p1, p2, p3] = [m[1]!, m[2]!, m[3]!];
  let y: string, mo: string, d: string;
  if (order === "YMD") {
    if ((p1.length !== 4 && p1.length !== 2) || p3.length > 2) return null;
    y = p1.length === 2 ? "20" + p1 : p1;
    [mo, d] = [p2, p3];
  } else {
    if (p1.length > 2 || (p3.length !== 2 && p3.length !== 4)) return null;
    y = p3.length === 2 ? "20" + p3 : p3;
    [mo, d] = order === "MDY" ? [p1, p2] : [p2, p1];
  }
  const iso = `${y}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}`;
  return isRealDate(iso) ? iso : null;
}
