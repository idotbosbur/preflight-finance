import { test } from "node:test";
import assert from "node:assert/strict";
import { AppShell, MEMORY_BANNER } from "../../src/components/index.ts";
import { SYNTHETIC_LABEL } from "../../src/domain/contracts.ts";
import { guide } from "./fixtures.ts";
import { renderToStaticMarkup } from "react-dom/server";
import { render } from "./helpers.ts";

const base = {
  route: { name: "results" } as const,
  guide: null,
  onGuideExit: () => {},
  durability: "persistent" as const,
  announcement: "",
};

test("shell: nav, synthetic badge and label, skip link, live region, attribution", () => {
  const html = render(<AppShell {...base}><p>child</p></AppShell>);
  for (const label of ["Demo", "Results", "How it works", "Roadmap"]) assert.ok(html.includes(`>${label}</a>`), label);
  assert.ok(html.includes("Sample data"), "results page shows the sample-data pill");
  assert.ok(html.includes(SYNTHETIC_LABEL));
  assert.ok(html.includes("Skip to main content"));
  assert.match(html, /aria-live="polite"/);
  assert.match(html, /href="#\/results"[^>]*aria-current="page"|aria-current="page"[^>]*>Results/);
  assert.match(html, /aria-expanded="false"/);
  assert.match(html, /aria-controls="mobile-menu"/);
  assert.ok(html.includes("Claude"));
  assert.ok(html.includes("Codex"));
  assert.ok(html.includes("<p>child</p>"));
  assert.ok(!html.includes(MEMORY_BANNER));
  assert.ok(!html.includes("inert"), "background not inert while menu closed");
});

test("shell: memory durability banner", () => {
  const html = render(<AppShell {...base} durability="memory"><p /></AppShell>);
  assert.ok(html.includes("Not saved: browser storage is unavailable, so decisions in this tab will be lost on reload"));
});

test("shell: announcement text is escaped in the live region", () => {
  const html = render(<AppShell {...base} announcement="Imported <script>x</script>"><p /></AppShell>);
  assert.ok(html.includes("Imported &lt;script&gt;x&lt;/script&gt;"));
});

test("shell: guide steps render status words and Exit guide", () => {
  const html = render(<AppShell {...base} guide={guide}><p /></AppShell>);
  assert.ok(html.includes("Done"));
  assert.ok(html.includes("Current step"));
  assert.ok(html.includes("Upcoming"));
  assert.ok(html.includes("step 2 of 5"));
  assert.ok(html.includes("Open R-0009 and confirm it with a reason."));
  assert.ok(html.includes("Already confirmed earlier, reopen to replay this step."));
  assert.ok(html.includes("Exit guide"));
  // Links are direct children of .guide-step-title (styled display:block for a full hit area).
  assert.match(html, /<span class="guide-step-title"><a href="#\/demo">Load the demo<\/a><\/span>/);
  assert.match(html, /<span class="guide-step-title"><a href="#\/case\/b\/f">Confirm the one-cent mismatch<\/a><\/span>/);
});

test("shell: inactive guide is hidden", () => {
  const html = render(<AppShell {...base} guide={{ ...guide, active: false }}><p /></AppShell>);
  assert.ok(!html.includes("Exit guide"));
});

test("shell: footer links to the public pages; feedback link only when a URL is set", () => {
  const html = render(<AppShell {...base} feedbackUrl=""><p /></AppShell>);
  for (const p of ["privacy", "terms", "pilot-guide", "companies"]) assert.ok(html.includes(`href="./${p}.html"`), p);
  assert.ok(!html.includes("Send feedback"));
  const withUrl = renderToStaticMarkup(<AppShell {...base} feedbackUrl="https://example.test/f"><p /></AppShell>);
  assert.ok(withUrl.includes('href="https://example.test/f"') && withUrl.includes("Send feedback"));
  assert.ok(render(<AppShell {...base}><p /></AppShell>).includes('href="#/feedback"'));
});

test("M1: the guided-demo bar is hidden on own pages", () => {
  const html = render(<AppShell {...base} guide={guide} own route={{ name: "mine" }}><p /></AppShell>);
  assert.ok(!html.includes("Exit guide"));
});
