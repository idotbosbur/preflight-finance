import { useState } from "react";
import type { FormEvent } from "react";
import { OTHER_OPTION, sendFeedback } from "../state/feedback.ts";
import type { FeedbackAnswers } from "../state/feedback.ts";

const ROLES = ["Small business owner", "Bookkeeper or accountant", "Finance team at a larger company", "Recruiter or just curious"];
const SOFTWARE = ["QuickBooks Online", "Xero", "Sage", "Excel or spreadsheets"];
const TRIED = ["The demo", "My own invoices", "Both"];
const MISSED = ["Yes", "No", "Not sure"];
const EASE = [1, 2, 3, 4, 5];

export const FEEDBACK_NOTE = "Answers are sent to the site owner's Google Form. No invoice data is included.";

type Status = "idle" | "sending" | "sent" | "failed";

function Radios({ name, options, value, onChange }: { name: string; options: readonly string[]; value: string | undefined; onChange: (v: string) => void }) {
  return (
    <>
      {options.map((o) => (
        <label key={o} className="radio">
          <input type="radio" name={name} value={o} checked={value === o} onChange={() => onChange(o)} /> {o}
        </label>
      ))}
    </>
  );
}

export function FeedbackPage({ demoHref, send = sendFeedback }: { demoHref: string; send?: (a: FeedbackAnswers) => Promise<boolean> }) {
  const [a, setA] = useState<FeedbackAnswers>({});
  const [status, setStatus] = useState<Status>("idle");
  const set = (patch: FeedbackAnswers) => setA((p) => ({ ...p, ...patch }));

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!a.role || status === "sending") return;
    setStatus("sending");
    setStatus((await send(a)) ? "sent" : "failed");
  }

  if (status === "sent") {
    return (
      <div className="workspace feedback">
        <header className="page-head">
          <p className="eyebrow">Feedback</p>
          <h1 className="page-title" tabIndex={-1}>Thank you</h1>
          <p className="lede" role="status">Thanks — your answers were sent.</p>
          <p><a href={demoHref}>Back to the demo</a></p>
        </header>
      </div>
    );
  }

  return (
    <div className="workspace feedback">
      <header className="page-head">
        <p className="eyebrow">Feedback</p>
        <h1 className="page-title" tabIndex={-1}>Tell us how it went</h1>
        <p className="lede">Two minutes. Please don't paste invoice data.</p>
      </header>

      <form className="feedback-form" onSubmit={(e) => void onSubmit(e)}>
        <fieldset className="fb-q">
          <legend className="field-label">What best describes you? <span className="hint-inline">(required)</span></legend>
          <Radios name="role" options={ROLES} value={a.role} onChange={(role) => set({ role })} />
        </fieldset>

        <fieldset className="fb-q">
          <legend className="field-label">Which accounting software do you use?</legend>
          <Radios name="software" options={SOFTWARE} value={a.software} onChange={(software) => set({ software })} />
          <label className="radio">
            <input type="radio" name="software" value={OTHER_OPTION} checked={a.software === OTHER_OPTION} onChange={() => set({ software: OTHER_OPTION })} /> Other
          </label>
          <label className="field-label fb-sub" htmlFor="fb-software-other">Other software</label>
          <input id="fb-software-other" className="text-input" type="text" maxLength={200} value={a.softwareOther ?? ""}
            onChange={(e) => set({ software: OTHER_OPTION, softwareOther: e.target.value })} />
        </fieldset>

        <fieldset className="fb-q">
          <legend className="field-label">What did you try?</legend>
          <Radios name="tried" options={TRIED} value={a.tried} onChange={(tried) => set({ tried })} />
        </fieldset>

        <fieldset className="fb-q">
          <legend className="field-label">Did it find anything you would have missed?</legend>
          <Radios name="missed" options={MISSED} value={a.missed} onChange={(missed) => set({ missed })} />
          <label className="field-label fb-sub" htmlFor="fb-missed-detail">Anything specific?</label>
          <textarea id="fb-missed-detail" className="text-input" rows={2} maxLength={1000} value={a.missedDetail ?? ""}
            onChange={(e) => set({ missedDetail: e.target.value })} />
        </fieldset>

        <fieldset className="fb-q">
          <legend className="field-label">How easy was it to get your file in? <span className="hint-inline">(1 = hard, 5 = easy)</span></legend>
          <div className="fb-scale">
            {EASE.map((n) => (
              <label key={n} className="fb-scale-opt">
                <input type="radio" name="ease" value={n} checked={a.ease === n} onChange={() => set({ ease: n })} />
                <span>{n}</span>
              </label>
            ))}
          </div>
        </fieldset>

        <div className="fb-q">
          <label className="field-label" htmlFor="fb-confusion">What confused you or got in the way?</label>
          <textarea id="fb-confusion" className="text-input" rows={3} maxLength={1000} value={a.confusion ?? ""}
            onChange={(e) => set({ confusion: e.target.value })} />
        </div>

        <div className="fb-q">
          <label className="field-label" htmlFor="fb-wish">What one thing would make you use it regularly?</label>
          <textarea id="fb-wish" className="text-input" rows={3} maxLength={1000} value={a.wish ?? ""}
            onChange={(e) => set({ wish: e.target.value })} />
        </div>

        <div className="fb-q">
          <label className="field-label" htmlFor="fb-email">Up for a 15-minute follow-up chat? Leave an email <span className="hint-inline">(optional)</span></label>
          <input id="fb-email" className="text-input" type="email" autoComplete="email" maxLength={200} value={a.email ?? ""}
            onChange={(e) => set({ email: e.target.value })} />
        </div>

        {status === "failed" ? <p className="fb-error" role="alert">Couldn't send. Check your connection and try again.</p> : null}
        <p>
          <button type="submit" className="btn btn-primary" disabled={status === "sending" || !a.role}>
            {status === "sending" ? "Sending…" : "Send"}
          </button>
        </p>
        <p className="hint">{FEEDBACK_NOTE}</p>
      </form>
    </div>
  );
}
