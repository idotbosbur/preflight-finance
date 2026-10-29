/**
 * "Coming later" ideas that would need a paid version (servers, paid AI). Visitors tick what they would
 * use; the ticks go to the feedback form's wish field, so no form change is needed.
 */
import { useState } from "react";
import { sendFeedback } from "../state/feedback.ts";
import type { FeedbackAnswers } from "../state/feedback.ts";

export const PAID_IDEAS: readonly (readonly [string, string])[] = [
  ["connect", "Connect QuickBooks, Xero or your bank, so nothing needs exporting and checks run every month"],
  ["pdf", "Read PDF invoices and receipts, not just CSV files"],
  ["ai", "A stronger AI that matches names and items better and explains each problem in plain English"],
  ["recover", "We email the supplier and track the refund until the money is back"],
  ["bookkeeper", "Bookkeeper mode: many clients, with shared review"],
];

export function InterestVote({ send = sendFeedback }: { readonly send?: (a: FeedbackAnswers) => Promise<boolean> }) {
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());
  const [email, setEmail] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent" | "failed">("idle");
  const toggle = (id: string) => setPicked((p) => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  async function submit() {
    setState("sending");
    const chosen = PAID_IDEAS.filter(([id]) => picked.has(id)).map(([, text]) => text);
    const ok = await send({ wish: `Would use (paid ideas): ${chosen.join(" | ")}`, email });
    setState(ok ? "sent" : "failed");
  }

  if (state === "sent") return <p className="notice notice-ok" role="status">Thank you. That helps decide what to build next.</p>;
  return (
    <form className="vote" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
      <fieldset>
        <legend className="field-label">Which would you use?</legend>
        {PAID_IDEAS.map(([id, text]) => (
          <label key={id} className="vote-option">
            <input type="checkbox" checked={picked.has(id)} onChange={() => toggle(id)} /> {text}
          </label>
        ))}
      </fieldset>
      <label className="field-label" htmlFor="vote-email">Email, if you'd like to hear when it's ready (optional)</label>
      <input id="vote-email" className="text-input" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
      <p>
        <button type="submit" className="btn btn-primary" disabled={picked.size === 0 || state === "sending"}>
          {state === "sending" ? "Sending…" : "Send my picks"}
        </button>
      </p>
      {state === "failed" ? <p className="notice notice-error" role="alert">That didn't send. Check your connection and try again.</p> : null}
    </form>
  );
}
