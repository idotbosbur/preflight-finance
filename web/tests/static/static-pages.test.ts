// Reads the REAL built pages in dist/ (run via `npm run test:static`, which builds first).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";

const SITE = "https://preflight-finance-portfolio.vercel.app/";
const PAGES = ["index.html", "privacy.html", "terms.html", "companies.html", "pilot-guide.html", "guide-quickbooks-duplicate-bills.html", "guide-xero-export-bills-csv.html", "guide-excel-duplicate-invoices.html"];
const read = (p: string) => readFileSync(new URL(`../../dist/${p}`, import.meta.url), "utf8");

for (const page of PAGES) {
  test(`${page}: title, description, canonical`, () => {
    assert.ok(existsSync(new URL(`../../dist/${page}`, import.meta.url)), "built");
    const html = read(page);
    assert.match(html, /<title>[^<]+<\/title>/);
    assert.match(html, /<meta name="description" content="[^"]{20,}"/);
    const canonical = page === "index.html" ? SITE : `${SITE}${page}`;
    assert.ok(html.includes(`<link rel="canonical" href="${canonical}"`), "canonical");
  });
}

for (const page of PAGES.slice(1)) {
  test(`${page}: no script tag, no inline handlers, links to app and siblings`, () => {
    const html = read(page);
    assert.doesNotMatch(html, /<script/i);
    assert.doesNotMatch(html, /\son[a-z]+=/i);
    assert.match(html, /<html lang="en"/);
    assert.match(html, /href="\.\/"/);
    for (const other of PAGES.slice(1).filter((p) => p !== page)) assert.ok(html.includes(`href="./${other}"`), other);
  });
}

test("every use of 'guarantee' is negated", () => {
  for (const page of PAGES) {
    for (const m of read(page).replace(/<[^>]+>/g, " ").matchAll(/guarantee/gi)) {
      const before = read(page).replace(/<[^>]+>/g, " ").slice(Math.max(0, m.index - 40), m.index);
      assert.match(before, /\b(no|not|nor|without)\b[^.]*$/i, `${page}: ${before}`);
    }
  }
});

test("sitemap lists all five pages; robots points at it", () => {
  const sm = read("sitemap.xml");
  for (const p of PAGES) assert.ok(sm.includes(`<loc>${p === "index.html" ? SITE : SITE + p}</loc>`), p);
  assert.match(read("robots.txt"), new RegExp(`Sitemap: ${SITE}sitemap.xml`));
});

test("honesty: no claim that roadmap items exist; no private-data uploads claim", () => {
  const companies = read("companies.html").toLowerCase();
  assert.ok(companies.includes("roadmap"));
  assert.doesNotMatch(companies, /soc 2 (certified|compliant)|we are soc|is soc 2/);
  const privacy = read("privacy.html");
  assert.match(privacy, /IndexedDB/);
  assert.match(privacy, /Vercel/);
});
