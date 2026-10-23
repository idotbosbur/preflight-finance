/**
 * Deterministic invoice rules (`invoice-v1`) — parity with Python `src/preflight/rules/`.
 * Pure and synchronous. Output sorted by (ruleId, memberIds) with Python tuple ordering.
 */
import type { CandidateFinding, Invoice, RunInvoiceRules } from "./contracts.ts";
import { RULE_DUPLICATE, RULE_MISMATCH, RULESET_VERSION, assertSafeCents, compareStrings, compareTuples } from "./contracts.ts";
import { compareMembers, duplicateEvidence, mismatchEvidence } from "./evidence.ts";
import { expectedTotalCents } from "./money.ts";

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

function evidenceRow(f: CandidateFinding): number {
  return f.evidence.kind === RULE_MISMATCH ? f.evidence.row : (f.evidence.members[0]?.row ?? 0);
}

/** Python `sorted(key=lambda f: (f.rule_id, f.member_ids))`; row tie-break only for invalid duplicate IDs. */
export function compareFindings(a: CandidateFinding, b: CandidateFinding): number {
  return compareStrings(a.ruleId, b.ruleId) || compareTuples(a.memberIds, b.memberIds) || evidenceRow(a) - evidenceRow(b);
}

export const runInvoiceRules: RunInvoiceRules = (invoices) =>
  [...duplicateCandidates(invoices), ...totalMismatches(invoices)].sort(compareFindings);
