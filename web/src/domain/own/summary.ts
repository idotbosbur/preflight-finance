/** Pure pilot-summary builder + CSV writer. Counts by default; vendor/invoice/reason only with includeDetails. */
import type { BatchSummary, FindingView, Invoice } from "../contracts.ts";
import { RULE_DUPLICATE, RULE_MISMATCH, RULE_NEAR_DUPLICATE, RULE_PAID_TWICE, RULE_PAYMENT_NO_BILL, RULE_PRICE_INCREASE } from "../contracts.ts";
import { RULE_LABEL, STATE_LABEL } from "../../components/labels.ts";
import type { OwnFileRecord } from "../../state/store.ts";

export interface SummaryDetail { readonly rule: string; readonly state: string; readonly vendor: string; readonly invoice: string; readonly reason: string }
export interface PilotSummary {
  readonly invoices: number;
  readonly files: number;
  readonly dateFrom: string;
  readonly dateTo: string;
  readonly byRule: { readonly duplicate: number; readonly mismatch: number; readonly nearDuplicate: number; readonly paidTwice: number; readonly noBill: number; readonly priceUp: number };
  readonly confirmed: number;
  readonly dismissed: number;
  readonly open: number;
  readonly details: readonly SummaryDetail[];
}

export function buildPilotSummary(
  batch: BatchSummary, findings: readonly FindingView[], files: readonly OwnFileRecord[], rows: readonly Invoice[],
  reasons: ReadonlyMap<string, string>, includeDetails: boolean,
): PilotSummary {
  const dates = rows.map((r) => r.invoiceDate).filter((d) => d !== "").sort();
  const count = (f: (x: FindingView) => boolean) => findings.filter(f).length;
  const byId = new Map(rows.map((r) => [r.recordId, r]));
  return {
    invoices: batch.rowCount,
    files: files.length,
    dateFrom: dates[0] ?? "",
    dateTo: dates[dates.length - 1] ?? "",
    byRule: {
      duplicate: count((f) => f.ruleId === RULE_DUPLICATE),
      mismatch: count((f) => f.ruleId === RULE_MISMATCH),
      nearDuplicate: count((f) => f.ruleId === RULE_NEAR_DUPLICATE),
      paidTwice: count((f) => f.ruleId === RULE_PAID_TWICE),
      noBill: count((f) => f.ruleId === RULE_PAYMENT_NO_BILL),
      priceUp: count((f) => f.ruleId === RULE_PRICE_INCREASE),
    },
    confirmed: count((f) => f.state === "confirmed"),
    dismissed: count((f) => f.state === "dismissed"),
    open: count((f) => f.state === "open"),
    details: includeDetails ? findings.map((f) => {
      const row = byId.get(f.memberIds[0] ?? "");
      return {
        rule: RULE_LABEL[f.ruleId], state: STATE_LABEL[f.state],
        vendor: row?.raw[1] ?? (f.evidence.kind === RULE_PAYMENT_NO_BILL ? f.evidence.vendor : ""), invoice: row?.raw[2] ?? "", reason: reasons.get(f.findingId) ?? "",
      };
    }) : [],
  };
}

/** Quote cells with , " or newline; prefix ' on cells a spreadsheet would read as a formula. */
export function csvCell(value: string | number): string {
  let s = String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function summaryCsv(s: PilotSummary): string {
  const range = s.dateFrom ? `${s.dateFrom} to ${s.dateTo}` : "";
  const lines: (string | number)[][] = [
    ["Section", "Item", "Value", "Vendor", "Invoice", "Reason"],
    ["Summary", "Invoices checked", s.invoices],
    ["Summary", "Files", s.files],
    ["Summary", "Invoice dates", range],
    ["Candidates", RULE_LABEL[RULE_DUPLICATE], s.byRule.duplicate],
    ["Candidates", RULE_LABEL[RULE_MISMATCH], s.byRule.mismatch],
    ["Candidates", RULE_LABEL[RULE_NEAR_DUPLICATE], s.byRule.nearDuplicate],
    ["Candidates", RULE_LABEL[RULE_PAID_TWICE], s.byRule.paidTwice],
    ["Candidates", RULE_LABEL[RULE_PAYMENT_NO_BILL], s.byRule.noBill],
    ["Candidates", RULE_LABEL[RULE_PRICE_INCREASE], s.byRule.priceUp],
    ["Review", "Confirmed", s.confirmed],
    ["Review", "Dismissed", s.dismissed],
    ["Review", "Open", s.open],
    ...s.details.map((d) => ["Finding", d.rule, d.state, d.vendor, d.invoice, d.reason]),
  ];
  return lines.map((l) => l.map(csvCell).join(",")).join("\r\n") + "\r\n";
}
