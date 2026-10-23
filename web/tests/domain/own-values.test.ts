import { test } from "node:test";
import assert from "node:assert/strict";
import { MAX_AMOUNT_CENTS } from "../../src/domain/contracts.ts";
import { detectDateOrder, parseLooseAmount, parseLooseDate } from "../../src/domain/own/values.ts";

const ok = (cents: number) => ({ ok: true, cents });
const bad = (reason: string) => ({ ok: false, reason });

test("parseLooseAmount accepts common export formats", () => {
  assert.deepEqual(parseLooseAmount("$1,234.56"), ok(123456));
  assert.deepEqual(parseLooseAmount("1234.56"), ok(123456));
  assert.deepEqual(parseLooseAmount("1,234.56"), ok(123456));
  assert.deepEqual(parseLooseAmount("USD 1234.5"), ok(123450));
  assert.deepEqual(parseLooseAmount("1234"), ok(123400));
  assert.deepEqual(parseLooseAmount("  0.10  "), ok(10));
});

test("parseLooseAmount rejects bad input with a reason", () => {
  assert.deepEqual(parseLooseAmount("   "), bad("blank"));
  assert.deepEqual(parseLooseAmount("(250.00)"), bad("credit or negative amount"));
  assert.deepEqual(parseLooseAmount("-250.00"), bad("credit or negative amount"));
  assert.deepEqual(parseLooseAmount("12.345"), bad("not a number"));
  assert.deepEqual(parseLooseAmount("abc"), bad("not a number"));
  assert.deepEqual(parseLooseAmount("1,23.45"), bad("not a number"));
  assert.deepEqual(parseLooseAmount("1000000000.00"), bad("too large"));
  assert.deepEqual(parseLooseAmount("999999999.99"), ok(MAX_AMOUNT_CENTS));
});

test("detectDateOrder", () => {
  assert.equal(detectDateOrder(["03/04/2026", "05/06/2026"]), "ambiguous");
  assert.equal(detectDateOrder(["03/15/2026"]), "MDY");
  assert.equal(detectDateOrder(["2026-03-15"]), "YMD");
  assert.equal(detectDateOrder(["15/03/2026"]), "DMY");
  assert.equal(detectDateOrder(["03/04/2026", "15/03/2026"]), "DMY");
  assert.equal(detectDateOrder(["03/15/2026", "15/03/2026"]), "ambiguous");
  assert.equal(detectDateOrder(["hello", ""]), "unrecognised");
});

test("parseLooseDate", () => {
  assert.equal(parseLooseDate("02/30/2026", "MDY"), null);
  assert.equal(parseLooseDate("3/5/26", "MDY"), "2026-03-05");
  assert.equal(parseLooseDate("5.3.2026", "DMY"), "2026-03-05");
  assert.equal(parseLooseDate("2026-03-05", "YMD"), "2026-03-05");
  assert.equal(parseLooseDate("29/02/2024", "DMY"), "2024-02-29");
  assert.equal(parseLooseDate("29/02/2026", "DMY"), null);
  assert.equal(parseLooseDate("nope", "MDY"), null);
});

test("R5: credit notations are classified as credit or negative", () => {
  for (const s of ["250.00-", "250.00 CR", "250.00cr", "250.00Cr", "−250.00", "$(250.00)", "USD (250)", "$-5", "5.00 -"]) {
    assert.deepEqual(parseLooseAmount(s), bad("credit or negative amount"), s);
  }
  assert.deepEqual(parseLooseAmount("abc cr"), bad("not a number"));
});

test("R5: trailing time part is stripped from dates", () => {
  assert.equal(parseLooseDate("3/5/2026 00:00", "MDY"), "2026-03-05");
  assert.equal(parseLooseDate("2026-03-05T00:00:00", "YMD"), "2026-03-05");
  assert.equal(parseLooseDate("2026-03-05 13:45:10.123Z", "YMD"), "2026-03-05");
  assert.equal(parseLooseDate("3/5/2026 1:05 PM", "MDY"), "2026-03-05");
  assert.equal(detectDateOrder(["3/15/2026 00:00"]), "MDY");
  assert.equal(detectDateOrder(["2026-03-15T00:00:00"]), "YMD");
});

test("R5: two-digit-year shapes are ambiguous unless definite", () => {
  assert.equal(detectDateOrder(["03-04-05"]), "ambiguous");
  assert.equal(detectDateOrder(["56-03-05"]), "YMD");
  assert.equal(detectDateOrder(["03/15/26"]), "MDY");
  assert.equal(detectDateOrder(["15/03/36"]), "DMY");
  assert.equal(detectDateOrder(["03/15/2026", "03-04-05"]), "MDY");
  assert.equal(parseLooseDate("26-03-05", "YMD"), "2026-03-05");
  assert.equal(parseLooseDate("26-02-30", "YMD"), null);
});
