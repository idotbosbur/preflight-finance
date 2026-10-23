import { test } from "node:test";
import assert from "node:assert/strict";
import { MAX_AMOUNT_CENTS } from "../../src/domain/contracts.ts";
import {
  AmountError,
  expectedTotalCents,
  formatCents,
  formatDelta,
  fromCentsString,
  parseCents,
  toCentsString,
} from "../../src/domain/money.ts";

test("parseCents accepts exactly two ASCII decimals", () => {
  assert.equal(parseCents("0.00"), 0);
  assert.equal(parseCents("0.10"), 10);
  assert.equal(parseCents("0.20"), 20);
  assert.equal(parseCents("110.25"), 11025);
  assert.equal(parseCents("000000001.05"), 105);
  assert.equal(parseCents("999999999.99"), MAX_AMOUNT_CENTS);
});

test("0.10 + 0.20 is exactly 0.30 in cents", () => {
  assert.equal(parseCents("0.10") + parseCents("0.20"), parseCents("0.30"));
  assert.equal(formatCents(parseCents("0.10") + parseCents("0.20")), "0.30");
});

test("parseCents rejects signs, spaces, separators, wrong precision, overflow and Unicode digits", () => {
  const bad = [
    "", "-0.00", "+1.00", " 1.00", "1.00 ", "1.00\n", "1.0", "1.000", "1", ".50", "1,000.00", "$1.00",
    "1000000000.00", "1e2.00", "0x1.00", "١.٠٠", "１.００", "1.٠٠", "𝟏.00", "NaN", "Infinity",
  ];
  for (const text of bad) assert.throws(() => parseCents(text), AmountError, JSON.stringify(text));
});

test("formatCents and formatDelta match Python format_cents / format_delta", () => {
  assert.equal(formatCents(0), "0.00");
  assert.equal(formatCents(5), "0.05");
  assert.equal(formatCents(-5), "-0.05");
  assert.equal(formatCents(11025), "110.25");
  assert.equal(formatCents(-10925), "-109.25");
  assert.equal(formatCents(MAX_AMOUNT_CENTS), "999999999.99");
  assert.equal(formatCents(299_999_999_997), "2999999999.97");
  assert.equal(formatDelta(1), "+0.01");
  assert.equal(formatDelta(-1), "-0.01");
  assert.equal(formatDelta(0), "0.00");
  assert.equal(formatDelta(99_999_999_999), "+999999999.99");
  assert.throws(() => formatCents(0.5), RangeError);
  assert.throws(() => formatCents(Number.MAX_SAFE_INTEGER + 1), RangeError);
});

test("CentsString round-trips strictly", () => {
  for (const c of [0, 1, -1, 11025, -10925, MAX_AMOUNT_CENTS, 299_999_999_997_000, -Number.MAX_SAFE_INTEGER]) {
    assert.equal(fromCentsString(toCentsString(c)), c);
  }
  assert.equal(toCentsString(11025), "11025");
  assert.equal(toCentsString(-0), "0");
  assert.equal(fromCentsString("-0"), 0);
  for (const bad of ["", "-", "+1", " 1", "1 ", "1.0", "1e3", "0x10", "١", "9007199254740992", "12345678901234567"]) {
    assert.throws(() => fromCentsString(bad), AmountError, JSON.stringify(bad));
  }
  assert.throws(() => toCentsString(1.5), RangeError);
});

test("expectedTotalCents and large sums stay safe integers", () => {
  assert.equal(expectedTotalCents({ subtotal: 10000, tax: 825, shipping: 500, discount: 300 }), 11025);
  const max = expectedTotalCents({ subtotal: MAX_AMOUNT_CENTS, tax: MAX_AMOUNT_CENTS, shipping: MAX_AMOUNT_CENTS, discount: 0 });
  assert.equal(max, 299_999_999_997);
  let sum = 0;
  for (let i = 0; i < 1000; i++) sum += max;
  assert.equal(sum, 299_999_999_997_000);
  assert.ok(Number.isSafeInteger(sum));
  assert.equal(formatCents(sum), "2999999999970.00");
  assert.throws(() => expectedTotalCents({ subtotal: 0.5, tax: 0, shipping: 0, discount: 0 }), RangeError);
});
