/** Bank statement pieces used by the drop zone: the column form and the match result. */
import type { BankField, BankMapping } from "../domain/own/bank.ts";
import type { DateOrder } from "../domain/own/values.ts";
import type { OwnMergeOutcome } from "../state/store.ts";
import type { BankParseError, MatchReport } from "../state/ownImporter.ts";
import { plural } from "../components/labels.ts";

const BANK_LABEL: Readonly<Record<BankField, string>> = {
  date: "Date", description: "Description", amount: "Amount", moneyOut: "Money out (debit)",
};
const BANK_HINT: Readonly<Record<BankField, string>> = {
  date: "", description: "", amount: "Use this if one column holds both money in and out.",
  moneyOut: "Use this instead of Amount if money out has its own column.",
};

export type BankImport = (
  bytes: Uint8Array, mapping: BankMapping, opts: { displayName: string; dateOrder: DateOrder | null }, onProgress: (percent: number) => void,
) => Promise<(OwnMergeOutcome & { report?: MatchReport | null }) | BankParseError>;

export function BankMapForm({ headers, mapping, onChange }: { readonly headers: readonly string[]; readonly mapping: BankMapping; readonly onChange: (m: BankMapping) => void }) {
  return (
    <div className="mapping">
      {(Object.keys(BANK_LABEL) as BankField[]).map((f) => (
        <div className="field" key={f}>
          <label className="field-label" htmlFor={`bank-map-${f}`}>{BANK_LABEL[f]}{f === "date" || f === "description" ? " (required)" : ""}</label>
          <select id={`bank-map-${f}`} value={mapping[f] ?? ""} onChange={(e) => {
            const next = { ...mapping };
            if (e.target.value === "") delete next[f];
            else next[f] = Number(e.target.value);
            onChange(next);
          }}>
            <option value="">Not in my file</option>
            {headers.map((h, i) => <option key={i} value={i}>{h || `(column ${i + 1})`}</option>)}
          </select>
          {BANK_HINT[f] ? <p className="hint">{BANK_HINT[f]}</p> : null}
        </div>
      ))}
    </div>
  );
}

/** What the match found, in plain words. */
export function MatchResult({ report }: { readonly report: MatchReport }) {
  return (
    <div className="notice notice-ok" role="status">
      <p>
        Matched {report.matched} of {plural(report.payments, "payment")} to your bills.{" "}
        {report.paidTwice + report.noBill === 0 ? "Nothing looks paid twice." : (
          <>Found {plural(report.paidTwice, "bill")} paid more than once and {plural(report.noBill, "payment")} to your suppliers with no matching bill.</>
        )}
      </p>
      {report.unpaidBills > 0 ? <p>{plural(report.unpaidBills, "bill")} dated within this statement {report.unpaidBills === 1 ? "has" : "have"} no payment on it yet.</p> : null}
      <p className="hint">
        {report.ai
          ? "Payee names were matched by an AI model running in this browser. Amounts and dates are checked exactly."
          : "The AI model could not load, so payee names were matched by their words only. Amounts and dates are checked exactly."}
      </p>
    </div>
  );
}
