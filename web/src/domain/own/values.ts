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
  if (/^\(|^-|^(\$|usd)\s*-/i.test(s)) return { ok: false, reason: "credit or negative amount" };
  const body = s.replace(CURRENCY_PREFIX, "");
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

const DATE_SHAPE = /^(\d{1,4})[-/.](\d{1,2})[-/.](\d{1,4})$/;

export function detectDateOrder(samples: readonly string[]): DateOrder | "ambiguous" | "unrecognised" {
  const definite = new Set<DateOrder>();
  let recognised = 0;
  for (const sample of samples) {
    const m = DATE_SHAPE.exec(sample.trim());
    if (!m) continue;
    const [a, b, c] = [m[1]!, m[2]!, m[3]!];
    if (a.length === 4 && c.length <= 2) {
      recognised++;
      definite.add("YMD");
    } else if (a.length <= 2 && (c.length === 2 || c.length === 4) && b.length <= 2) {
      recognised++;
      if (Number(a) > 12) definite.add("DMY");
      else if (Number(b) > 12) definite.add("MDY");
    }
  }
  if (recognised === 0) return "unrecognised";
  if (definite.size === 1) return [...definite][0]!;
  return "ambiguous";
}

export function parseLooseDate(text: string, order: DateOrder): string | null {
  const m = DATE_SHAPE.exec(text.trim());
  if (!m) return null;
  const [p1, p2, p3] = [m[1]!, m[2]!, m[3]!];
  let y: string, mo: string, d: string;
  if (order === "YMD") {
    if (p1.length !== 4 || p3.length > 2) return null;
    [y, mo, d] = [p1, p2, p3];
  } else {
    if (p1.length > 2 || (p3.length !== 2 && p3.length !== 4)) return null;
    y = p3.length === 2 ? "20" + p3 : p3;
    [mo, d] = order === "MDY" ? [p1, p2] : [p2, p1];
  }
  const iso = `${y}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}`;
  return isRealDate(iso) ? iso : null;
}
