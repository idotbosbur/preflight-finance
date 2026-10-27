/**
 * Integer-cent money handling, parity with Python `src/preflight/money.py`.
 *
 * Amounts enter as strings with exactly two fractional ASCII digits and are held as safe-integer
 * cents. No float arithmetic or rounding is ever applied: the whole and fraction digit strings are
 * parsed separately (never `Number(text) * 100`). The pattern uses an explicit `[0-9]` class with
 * no `u`/`i` flags so Unicode digits (Arabic-Indic, full-width, ...) are rejected.
 */
import type { Cents, CentsString, Invoice } from "./contracts.ts";
import { assertSafeCents } from "./contracts.ts";

const AMOUNT_PATTERN = /^[0-9]{1,9}\.[0-9]{2}$/;
const CENTS_STRING_PATTERN = /^-?[0-9]+$/;

export class AmountError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AmountError";
  }
}

/** Parse ASCII decimal digits (already validated) into a safe integer. */
function digitsToInt(digits: string): number {
  let n = 0;
  for (let i = 0; i < digits.length; i++) {
    n = n * 10 + (digits.charCodeAt(i) - 0x30);
  }
  return assertSafeCents(n, "digits");
}

/** Parse `"123.45"` into `12345`. Throws {@link AmountError}. */
export function parseCents(text: string): Cents {
  if (typeof text !== "string" || !AMOUNT_PATTERN.test(text)) {
    throw new AmountError(`not a nonnegative amount with exactly two decimals: ${JSON.stringify(text)}`);
  }
  const dot = text.indexOf(".");
  const whole = digitsToInt(text.slice(0, dot));
  const frac = digitsToInt(text.slice(dot + 1));
  return assertSafeCents(whole * 100 + frac, "amount");
}

/** Python `format_cents`: `-5` -> `"-0.05"`, `11025` -> `"110.25"`. */
export function formatCents(cents: Cents): string {
  assertSafeCents(cents);
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  const frac = abs % 100;
  const whole = (abs - frac) / 100;
  return `${sign}${whole}.${frac < 10 ? "0" : ""}${frac}`;
}

/** Python `format_delta`: `1` -> `"+0.01"`, `-1` -> `"-0.01"`, `0` -> `"0.00"`. */
export function formatDelta(cents: Cents): string {
  assertSafeCents(cents);
  return cents > 0 ? `+${formatCents(cents)}` : formatCents(cents);
}

/** Serialize cents as a strict base-10 integer string (`11025` -> `"11025"`). */
export function toCentsString(cents: Cents): CentsString {
  assertSafeCents(cents);
  return Object.is(cents, -0) ? "0" : String(cents);
}

/** Strict inverse of {@link toCentsString}: optional `-`, ASCII digits only, safe-integer guarded. */
export function fromCentsString(text: CentsString): Cents {
  if (typeof text !== "string" || !CENTS_STRING_PATTERN.test(text)) {
    throw new AmountError(`not a base-10 integer cents string: ${JSON.stringify(text)}`);
  }
  const negative = text.charCodeAt(0) === 0x2d;
  const digits = negative ? text.slice(1) : text;
  if (digits.length > 16) throw new AmountError(`cents string out of safe range: ${JSON.stringify(text)}`);
  let n = 0;
  for (let i = 0; i < digits.length; i++) n = n * 10 + (digits.charCodeAt(i) - 0x30);
  if (!Number.isSafeInteger(n)) throw new AmountError(`cents string out of safe range: ${JSON.stringify(text)}`);
  return negative ? (n === 0 ? 0 : -n) : n;
}

/** Python `Invoice.expected_total_c`: subtotal + tax + shipping - discount (guarded). */
export function expectedTotalCents(
  inv: Pick<Invoice, "subtotal" | "tax" | "shipping" | "discount">,
): Cents {
  const charges = assertSafeCents(
    assertSafeCents(assertSafeCents(inv.subtotal, "subtotal") + assertSafeCents(inv.tax, "tax"), "sum")
      + assertSafeCents(inv.shipping, "shipping"),
    "charges",
  );
  return assertSafeCents(charges - assertSafeCents(inv.discount, "discount"), "expected total");
}
