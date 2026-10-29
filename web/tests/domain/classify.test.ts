import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyHeaders } from "../../src/domain/own/classify.ts";

test("bills exports are bills", () => {
  assert.equal(classifyHeaders(["Vendor", "Date", "Bill No.", "Due Date", "Amount", "Open Balance"]), "bills");
  assert.equal(classifyHeaders(["ContactName", "InvoiceNumber", "InvoiceDate", "DueDate", "Total", "TaxTotal", "Currency"]), "bills");
  assert.equal(classifyHeaders(["*ContactName", "EmailAddress", "*InvoiceNumber", "*InvoiceDate", "*DueDate", "Total", "TaxTotal", "Description", "*Quantity", "*UnitAmount", "LineAmount", "Currency"]), "bills");
});

test("bank and card statements are statements, even with a check-number column", () => {
  assert.equal(classifyHeaders(["Posting Date", "Description", "Amount", "Balance"]), "statement");
  assert.equal(classifyHeaders(["Date", "Details", "Debit", "Credit"]), "statement");
  assert.equal(classifyHeaders(["Date", "Num", "Payee", "Amount", "Balance"]), "statement");
  assert.equal(classifyHeaders(["Transaction Date", "Description", "Amount"]), "statement");
});

test("unknown layouts are left to the person", () => {
  assert.equal(classifyHeaders(["Vendor", "Date", "Amount"]), null);
  assert.equal(classifyHeaders(["a", "b"]), null);
});
