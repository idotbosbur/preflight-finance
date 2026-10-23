/**
 * A replay "detector" built only from the captured Python reference output (expected.json).
 * It is NOT an implementation: it looks bytes up by SHA-256 and replays what Python produced.
 * Used to prove the evaluator passes a known-good detector and fails deliberately broken ones,
 * independently of whether the TS system under test exists yet.
 */
import type { CandidateFinding, Evidence, Invoice, IssueCode, CsvField, ValidationResult } from "../../src/domain/contracts.ts";
import type { Detector, ParityDoc, PyCase } from "./harness.ts";
import { pyEvidenceToTs, pyInvoiceToTs, sha256Node } from "./harness.ts";
import { RULE_MISMATCH } from "../../src/domain/contracts.ts";

export function pythonReplayDetector(doc: ParityDoc): Detector {
  const bySha = new Map<string, PyCase>();
  for (const group of [doc.cases, doc.demo, doc.manifest_fixtures]) for (const c of Object.values(group)) bySha.set(c.sha256, c);
  const byInvoices = new Map<string, PyCase>();
  const key = (inv: readonly Invoice[]) => JSON.stringify(inv.map((i) => [i.recordId, i.rowNumber, i.raw, i.vendorNorm,
    i.invoiceNorm, i.invoiceDate, i.currency, i.subtotal, i.tax, i.shipping, i.discount, i.total]));
  for (const c of bySha.values()) if (c.ok) byInvoices.set(key(c.invoices.map(pyInvoiceToTs)), c);
  return {
    parse(bytes: Uint8Array): ValidationResult {
      const c = bySha.get(sha256Node(bytes));
      if (!c) throw new Error("replay detector: bytes not in the captured Python reference");
      if (c.ok) return { ok: true, invoices: c.invoices.map(pyInvoiceToTs), issues: [], issueCount: 0 };
      return {
        ok: false, invoices: [], issueCount: c.issue_count,
        issues: c.issues.map((i) => ({ code: i.code as IssueCode, row: i.row, field: i.field as CsvField | null, message: "" })),
      };
    },
    rules(invoices: readonly Invoice[]): readonly CandidateFinding[] {
      const c = byInvoices.get(key(invoices));
      if (!c) throw new Error("replay detector: invoice set not in the captured Python reference");
      return c.findings.map((f) => ({
        ruleId: f.rule_id as CandidateFinding["ruleId"], ruleVersion: "invoice-v1", memberIds: [...f.member_ids],
        evidence: pyEvidenceToTs(f.rule_id, f.evidence) as Evidence,
      }));
    },
  };
}

/** Deliberately defective variants wrapping any detector. */
export const BREAKERS: Readonly<Record<string, (d: Detector) => Detector>> = {
  "drops one mismatch finding": (d) => ({
    parse: d.parse,
    rules: (inv) => {
      const out = [...d.rules(inv)];
      const j = out.findIndex((f) => f.ruleId === RULE_MISMATCH);
      if (j >= 0) out.splice(j, 1);
      return out;
    },
  }),
  "one-cent tolerance on totals": (d) => ({
    parse: d.parse,
    rules: (inv) => d.rules(inv).filter((f) => !(f.evidence.kind === RULE_MISMATCH && /^[+-]0\.01$/.test(f.evidence.delta))),
  }),
  "drops a member from a duplicate group": (d) => ({
    parse: d.parse,
    rules: (inv) => d.rules(inv).map((f) => (f.ruleId === RULE_MISMATCH || f.memberIds.length < 2 ? f
      : { ...f, memberIds: f.memberIds.slice(0, 1) })),
  }),
  "flips mismatch delta sign": (d) => ({
    parse: d.parse,
    rules: (inv) => d.rules(inv).map((f) => (f.evidence.kind !== RULE_MISMATCH ? f : {
      ...f, evidence: { ...f.evidence, delta: f.evidence.delta.startsWith("+") ? `-${f.evidence.delta.slice(1)}` : `+${f.evidence.delta.slice(1)}` },
    })),
  }),
  "partially accepts a file with bad rows": (d) => ({
    parse: (bytes) => {
      const r = d.parse(bytes);
      return r.ok || r.issues.every((i) => i.row === null) ? r : { ok: true, invoices: [], issues: [], issueCount: 0 };
    },
    rules: d.rules,
  }),
};
