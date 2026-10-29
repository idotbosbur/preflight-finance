import { test } from "node:test";
import assert from "node:assert/strict";
import { buildGlance, formatMoney, supplierEmail } from "../../src/domain/glance.ts";
import type { FindingView, Invoice } from "../../src/domain/contracts.ts";
import { dupEvidence, finding } from "../ui/fixtures.ts";

const inv = (id: string, vendor: string, num: string, currency = "USD"): Invoice => ({
  recordId: id, rowNumber: 1, raw: [id, vendor, num, "2026-01-01", currency, "", "", "", "", "0.00"], vendorNorm: vendor.toUpperCase(),
  invoiceNorm: num, invoiceDate: "2026-01-01", currency, subtotal: 0, tax: 0, shipping: 0, discount: 0, total: 0,
});
const rows = [inv("R-0005", " v-acme", "inv-7781"), inv("R-0032", "V-ACME", "INV-7781"), inv("R-0009", "City Electric", "88213"), inv("R-0100", "Euro Co", "E-1", "EUR")];
const dup = finding({ state: "open", ruleId: "DUPLICATE_CANDIDATE", memberIds: ["R-0005", "R-0032"], evidence: dupEvidence, findingId: "d1" });
const mm = finding({ state: "open", findingId: "m1" });
const near: FindingView = finding({
  state: "confirmed", ruleId: "NEAR_DUPLICATE", findingId: "n1", memberIds: ["R-0100", "R-0101"],
  evidence: { kind: "NEAR_DUPLICATE", vendor: "EURO CO", total: "99.00", daysApart: 3, members: [] },
});

test("duplicates count the extra copy only (the smaller amounts), mismatches count the difference", () => {
  const g = buildGlance([dup, mm], rows);
  // 410.00 + 512.40 - max(512.40) = 410.00, plus |+0.01|
  assert.equal(g.cents, 41001);
  assert.equal(g.currency, "USD");
  assert.deepEqual(g.otherCurrencies, []);
  assert.equal(g.bills, 3);
  assert.deepEqual(g.items.map((i) => i.finding.findingId), ["d1", "m1"]);
  assert.equal(g.items[0]!.vendor, "v-acme");
  assert.equal(g.items[0]!.reason, "#inv-7781 and #INV-7781 look like the same bill");
  assert.equal(g.items[1]!.vendor, "City Electric");
  assert.match(g.items[1]!.reason, /88213/);
});

test("dismissed findings are left out; other currencies are named, not added", () => {
  const g = buildGlance([dup, { ...mm, state: "dismissed" }, near], rows);
  assert.equal(g.cents, 41000);
  assert.deepEqual(g.otherCurrencies, ["EUR"]);
  assert.equal(g.items.length, 2);
  assert.equal(g.bills, 4);
});

test("nothing to look at gives zero, no currency", () => {
  const g = buildGlance([{ ...mm, state: "dismissed" }], rows);
  assert.deepEqual([g.cents, g.currency, g.bills, g.items.length], [0, null, 0, 0]);
});

test("money formatting groups thousands without floats", () => {
  assert.equal(formatMoney(421250, "USD"), "$4,212.50");
  assert.equal(formatMoney(123456789, "EUR"), "1,234,567.89 EUR");
  assert.equal(formatMoney(5, "USD"), "$0.05");
});

test("supplier email names the invoices and asks, never accuses", () => {
  const g = buildGlance([dup, mm], rows);
  const e = supplierEmail(g.items[0]!);
  assert.match(e.subject, /inv-7781/);
  assert.match(e.body, /inv-7781/);
  assert.match(e.body, /credit or refund/);
  const m = supplierEmail(g.items[1]!);
  assert.match(m.body, /1348\.27/);
  assert.match(m.body, /1348\.26/);
  assert.match(m.subject, /88213/);
});
