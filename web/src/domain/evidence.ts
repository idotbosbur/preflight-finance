/**
 * Pure evidence builders for the `invoice-v1` rules, parity with Python
 * `rules/duplicates.py::_member` and the TOTAL_MISMATCH evidence in `rules/totals.py`.
 * Every financial string is produced by money.ts (formatCents / formatDelta).
 */
import type { DuplicateEvidence, DuplicateMemberEvidence, Invoice, MismatchEvidence, NearDuplicateEvidence } from "./contracts.ts";
import { CSV_HEADER, RULE_DUPLICATE, RULE_MISMATCH, RULE_NEAR_DUPLICATE, compareStrings } from "./contracts.ts";
import { expectedTotalCents, formatCents, formatDelta } from "./money.ts";

const VENDOR_INDEX = CSV_HEADER.indexOf("vendor_id");
const INVOICE_INDEX = CSV_HEADER.indexOf("invoice_number");

/** Member order: recordId (compareStrings), then rowNumber so invalid duplicate IDs stay deterministic. */
export function compareMembers(a: Invoice, b: Invoice): number {
  return compareStrings(a.recordId, b.recordId) || a.rowNumber - b.rowNumber;
}

export function duplicateMember(inv: Invoice): DuplicateMemberEvidence {
  return {
    recordId: inv.recordId,
    row: inv.rowNumber,
    rawVendor: inv.raw[VENDOR_INDEX] ?? "",
    rawInvoice: inv.raw[INVOICE_INDEX] ?? "",
    invoiceDate: inv.invoiceDate,
    total: formatCents(inv.total),
  };
}

/** Evidence for one duplicate group (2+ invoices sharing vendorNorm, invoiceNorm, currency). */
export function duplicateEvidence(group: readonly Invoice[]): DuplicateEvidence {
  if (group.length < 2) throw new RangeError("a duplicate group needs at least two invoices");
  const first = group[0]!;
  const members = group.slice().sort(compareMembers);
  return {
    kind: RULE_DUPLICATE,
    key: { vendor: first.vendorNorm, invoice: first.invoiceNorm, currency: first.currency },
    members: members.map(duplicateMember),
  };
}

/** Evidence for one near-duplicate pair (same vendorNorm, currency and total; different invoiceNorm). */
export function nearDuplicateEvidence(a: Invoice, b: Invoice, daysApart: number): NearDuplicateEvidence {
  return {
    kind: RULE_NEAR_DUPLICATE,
    vendor: a.vendorNorm,
    total: formatCents(a.total),
    daysApart,
    members: [a, b].sort(compareMembers).map(duplicateMember),
  };
}

/** Evidence for one invoice; `delta` is declared - expected (signed, Python format_delta). */
export function mismatchEvidence(inv: Invoice): MismatchEvidence {
  const expected = expectedTotalCents(inv);
  return {
    kind: RULE_MISMATCH,
    recordId: inv.recordId,
    row: inv.rowNumber,
    subtotal: formatCents(inv.subtotal),
    tax: formatCents(inv.tax),
    shipping: formatCents(inv.shipping),
    discount: formatCents(inv.discount),
    expected: formatCents(expected),
    declared: formatCents(inv.total),
    delta: formatDelta(inv.total - expected),
  };
}
