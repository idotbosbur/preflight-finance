/**
 * Ideas being explored (not built). Visitors tick what they would use; the ticks go to the feedback
 * form's wish field, so no form change is needed.
 */
import { useState } from "react";
import { sendFeedback } from "../state/feedback.ts";
import type { FeedbackAnswers } from "../state/feedback.ts";

// Most important first: people tick the top of a list most.
export const IDEAS: readonly (readonly [string, string])[] = [
  ["report", "A checkup report I can hand to my accountant"],
  ["pdf", "Read PDF invoices, receipts and photos, privately on my device"],
  ["agreed", "Compare what I was billed with what I agreed in a quote or contract"],
  ["recover", "Help chasing refunds until the money is back"],
  ["reminder", "A reminder for a quarterly or year-end checkup"],
  ["bookkeeper", "A version for bookkeepers with many clients"],
];

export function InterestVote({ send = sendFeedback }: { readonly send?: (a: FeedbackAnswers) => Promise<boolean> }) {
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());
  const [email, setEmail] = useState("");
  const [other, setOther] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent" | "failed">("idle");
  const toggle = (id: string) => setPicked((p) => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  async function submit() {
    setState("sending");
    const chosen = IDEAS.filter(([id]) => picked.has(id)).map(([, text]) => text);
    const extra = other.trim() ? `${chosen.length ? " | " : ""}Something else: ${other.trim()}` : "";
    const ok = await send({ wish: `Ideas I'd use: ${chosen.join(" | ")}${extra}`, email });
    setState(ok ? "sent" : "failed");
  }

  if (state === "sent") return <p className="notice notice-ok" role="status">Thank you. That helps decide what to build next.</p>;
  return (
    <form className="vote" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
      <fieldset>
        <legend className="field-label">Which would you use?</legend>
        {IDEAS.map(([id, text]) => (
          <label key={id} className="vote-option">
            <input type="checkbox" checked={picked.has(id)} onChange={() => toggle(id)} /> {text}
          </label>
        ))}
      </fieldset>
      <label className="field-label" htmlFor="vote-other">Something else? (optional)</label>
      <input id="vote-other" className="text-input" type="text" maxLength={300} placeholder="What would make Catchfold worth using every quarter?"
        value={other} onChange={(e) => setOther(e.target.value)} />
      <label className="field-label" htmlFor="vote-email">Email, if you'd like to hear when it's ready (optional)</label>
      <input id="vote-email" className="text-input" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
      <p>
        <button type="submit" className="btn btn-primary" disabled={(picked.size === 0 && other.trim() === "") || state === "sending"}>
          {state === "sending" ? "Sending…" : "Send my picks"}
        </button>
      </p>
      {state === "failed" ? <p className="notice notice-error" role="alert">That didn't send. Check your connection and try again.</p> : null}
    </form>
  );
}
