/** On-site feedback → published Google Form (fire-and-forget, opaque response). */
const FORM_URL = "https://docs.google.com/forms/d/e/1FAIpQLSfucIYrPkJIgbMVHAs90JxvL_R5945oF4Ez-Rj7MenG7PMdUQ/formResponse";

export const OTHER_OPTION = "__other_option__";

export interface FeedbackAnswers {
  role?: string;
  software?: string; // a listed option, or OTHER_OPTION
  softwareOther?: string;
  tried?: string;
  missed?: string; // "Yes" | "No" | "Not sure"
  missedDetail?: string;
  ease?: number;
  confusion?: string;
  wish?: string;
  email?: string;
}

export function buildFeedbackBody(a: FeedbackAnswers): URLSearchParams {
  const body = new URLSearchParams();
  const put = (k: string, v: string | undefined) => {
    const t = v?.trim();
    if (t) body.set(k, t);
  };
  put("entry.776378412", a.role);
  put("entry.552812709", a.software);
  if (a.software === OTHER_OPTION) put("entry.552812709.other_option_response", a.softwareOther);
  put("entry.772120213", a.tried);
  const detail = a.missedDetail?.trim();
  put("entry.1506806643", a.missed === "Yes" && detail ? `Yes — ${detail}` : a.missed);
  put("entry.766796994", a.ease ? String(a.ease) : undefined);
  put("entry.1467106461", a.confusion);
  put("entry.581263092", a.wish);
  put("entry.23912197", a.email);
  return body;
}

/** no-cors gives an opaque response: a resolved fetch counts as sent, a rejection as failed. */
export async function sendFeedback(a: FeedbackAnswers, fetchImpl: typeof fetch = fetch): Promise<boolean> {
  try {
    await fetchImpl(FORM_URL, { method: "POST", mode: "no-cors", body: buildFeedbackBody(a) });
    return true;
  } catch {
    return false;
  }
}
