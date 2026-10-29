import assert from "node:assert/strict";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

export function render(el: ReactElement): string {
  const html = renderToStaticMarkup(el);
  assertNoInlineStyle(html);
  return html;
}

export function assertNoInlineStyle(html: string): void {
  assert.doesNotMatch(html, /\sstyle=/, "no inline style attributes");
  assert.doesNotMatch(html, /\son[a-z]+=/i, "no inline event-handler attributes");
  // The one allowed outside address is a plain link to the project's own source code (navigation, not a loaded resource).
  assert.doesNotMatch(html, /https?:\/\/(?!www\.w3\.org\/2000\/svg|github\.com\/idotbosbur\/preflight-finance")/, "no external URLs");
}

/** Text of all <button> elements. */
export function buttons(html: string): string[] {
  return [...html.matchAll(/<button[^>]*>([\s\S]*?)<\/button>/g)].map((m) => m[1]!.replace(/<[^>]+>/g, "").trim());
}

export function assertEscaped(html: string): void {
  assert.ok(!html.includes("<script>"), "raw <script> must not appear");
  assert.ok(html.includes("&lt;script&gt;"), "escaped script text should appear");
}
