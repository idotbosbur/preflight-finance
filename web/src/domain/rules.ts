/**
 * Deterministic invoice rules (`invoice-v1`), parity with Python `src/preflight/rules/`.
 * Pure and synchronous. Output sorted by (ruleId, memberIds) with Python tuple ordering.
 */
import type { CandidateFinding, Invoice, RunInvoiceRules } from "./contracts.ts";
import { NEAR_DUP_WINDOW_DAYS, RULE_DUPLICATE, RULE_MISMATCH, RULE_NEAR_DUPLICATE, RULESET_VERSION, assertSafeCents, compareStrings, compareTuples } from "./contracts.ts";
import { compareMembers, duplicateEvidence, mismatchEvidence, nearDuplicateEvidence } from "./evidence.ts";
import { expectedTotalCents } from "./money.ts";
import type { OwnInvoice } from "./own/rows.ts";

/** DUPLICATE_CANDIDATE: one finding per (vendorNorm, invoiceNorm, currency) group of 2+ rows. */
export function duplicateCandidates(invoices: readonly Invoice[]): CandidateFinding[] {
  const groups = new Map<string, Invoice[]>();
  for (const inv of invoices) {
    // JSON array encoding keeps the composite key unambiguous.
    const key = JSON.stringify([inv.vendorNorm, inv.invoiceNorm, inv.currency]);
    const group = groups.get(key);
    if (group) group.push(inv);
    else groups.set(key, [inv]);
  }
  const findings: CandidateFinding[] = [];
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    const members = group.slice().sort(compareMembers);
    findings.push({
      ruleId: RULE_DUPLICATE,
      ruleVersion: RULESET_VERSION,
      memberIds: members.map((m) => m.recordId),
      evidence: duplicateEvidence(members),
    });
  }
  return findings;
}

/** TOTAL_MISMATCH: one finding per row whose declared total differs from the expected total at all. */
export function totalMismatches(invoices: readonly Invoice[]): CandidateFinding[] {
  const findings: CandidateFinding[] = [];
  for (const inv of invoices) {
    const delta = assertSafeCents(inv.total - expectedTotalCents(inv), "delta");
    if (delta === 0) continue;
    findings.push({
      ruleId: RULE_MISMATCH,
      ruleVersion: RULESET_VERSION,
      memberIds: [inv.recordId],
      evidence: mismatchEvidence(inv),
    });
  }
  return findings;
}

/** Whole days since 1970-01-01 for an ISO YYYY-MM-DD date, in UTC (no local-time drift). */
function isoDay(iso: string): number {
  const [y, m, d] = iso.split("-").map(Number) as [number, number, number];
  return Date.UTC(y, m - 1, d) / 86_400_000;
}

/**
 * NEAR_DUPLICATE (lower confidence): one finding per unordered pair with the same vendorNorm,
 * currency and total, both dates present, at most `windowDays` apart, and different invoiceNorm.
 * Different invoiceNorm means a pair is never inside one exact-key duplicate group.
 */
export function nearDuplicates(invoices: readonly Invoice[], windowDays: number): CandidateFinding[] {
  const groups = new Map<string, { inv: Invoice; day: number }[]>();
  for (const inv of invoices) {
    if (inv.invoiceDate === "") continue;
    const key = JSON.stringify([inv.vendorNorm, inv.currency, inv.total]);
    const entry = { inv, day: isoDay(inv.invoiceDate) };
    const group = groups.get(key);
    if (group) group.push(entry);
    else groups.set(key, [entry]);
  }
  const findings: CandidateFinding[] = [];
  for (const group of groups.values()) {
    group.sort((a, b) => a.day - b.day);
    // ponytail: O(pairs within the window) per group; fine for 20k rows unless one vendor bills one amount daily.
    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length && group[j]!.day - group[i]!.day <= windowDays; j++) {
        const a = group[i]!.inv;
        const b = group[j]!.inv;
        if (a.invoiceNorm === b.invoiceNorm) continue;
        const evidence = nearDuplicateEvidence(a, b, group[j]!.day - group[i]!.day);
        findings.push({ ruleId: RULE_NEAR_DUPLICATE, ruleVersion: RULESET_VERSION, memberIds: evidence.members.map((m) => m.recordId), evidence });
      }
    }
  }
  return findings;
}

function evidenceRow(f: CandidateFinding): number {
  return f.evidence.kind === RULE_MISMATCH ? f.evidence.row : (f.evidence.members[0]?.row ?? 0);
}

/** Python `sorted(key=lambda f: (f.rule_id, f.member_ids))`; row tie-break only for invalid duplicate IDs. */
export function compareFindings(a: CandidateFinding, b: CandidateFinding): number {
  return compareStrings(a.ruleId, b.ruleId) || compareTuples(a.memberIds, b.memberIds) || evidenceRow(a) - evidenceRow(b);
}

export const runInvoiceRules: RunInvoiceRules = (invoices) =>
  [...duplicateCandidates(invoices), ...totalMismatches(invoices)].sort(compareFindings);

/** Own-data rules: exact duplicates, near duplicates, and totals for rows that carry components. */
export function runOwnRules(invoices: readonly OwnInvoice[]): CandidateFinding[] {
  return [
    ...duplicateCandidates(invoices),
    ...nearDuplicates(invoices, NEAR_DUP_WINDOW_DAYS),
    ...totalMismatches(invoices.filter((inv) => inv.hasComponents)),
  ].sort(compareFindings);
}
