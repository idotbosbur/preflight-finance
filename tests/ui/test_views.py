"""UI view tests: rendering, escaping, CSP-compatibility, actions and structure."""

from __future__ import annotations

import os
import re
import unittest
from html.parser import HTMLParser

from preflight import contracts
from preflight.contracts import BatchSummary, FindingView, ReviewEventView
from preflight.views import (
    render_batch,
    render_command_center,
    render_error,
    render_finding,
    render_report,
)

XSS = '<script>alert(1)</script>"q\''
XSS_ESCAPED = "&lt;script&gt;alert(1)&lt;/script&gt;&quot;q&#x27;"
CSRF = "tok-abc_123"
STATIC_DIR = os.path.join(
    os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
    "src", "preflight", "static",
)

VOID = {"area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr"}


class BalanceChecker(HTMLParser):
    """Strict-enough structure check: every non-void tag must close in order."""

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.stack = []
        self.errors = []
        self.doctype = False
        self.ids = []

    def handle_decl(self, decl):
        if decl.lower() == "doctype html":
            self.doctype = True

    def handle_starttag(self, tag, attrs):
        for name, value in attrs:
            if name == "id":
                self.ids.append(value)
        if tag not in VOID:
            self.stack.append(tag)

    def handle_startendtag(self, tag, attrs):
        if tag not in VOID:
            self.errors.append(f"self-closing non-void <{tag}/>")

    def handle_endtag(self, tag):
        if tag in VOID:
            self.errors.append(f"end tag for void </{tag}>")
            return
        if not self.stack or self.stack[-1] != tag:
            self.errors.append(f"unexpected </{tag}>, open: {self.stack[-3:]}")
            return
        self.stack.pop()


def make_batch(**overrides):
    values = dict(
        batch_id="b-0001",
        display_name="invoices-oct.csv",
        sha256="a" * 64,
        imported_at_utc="2026-10-21T12:00:00Z",
        ruleset=contracts.RULESET_VERSION,
        row_count=120,
        finding_count=3,
        duplicate_count=1,
        mismatch_count=2,
        open_count=1,
        confirmed_count=1,
        dismissed_count=1,
    )
    values.update(overrides)
    return BatchSummary(**values)


def dup_finding(state="open", seq=0, raw_vendor="v-001", raw_invoice=" inv-9", **kw):
    ev = {
        "key": {"vendor": "V-001", "invoice": "INV-9", "currency": "USD"},
        "members": [
            {"record_id": "R-001", "row": 1, "raw_vendor": raw_vendor, "raw_invoice": raw_invoice,
             "invoice_date": "2026-01-05", "total": "110.25"},
            {"record_id": "R-007", "row": 7, "raw_vendor": "V-001", "raw_invoice": "INV-9",
             "invoice_date": "2026-01-09", "total": "110.25"},
            {"record_id": "R-012", "row": 12, "raw_vendor": "V-001", "raw_invoice": "INV-9",
             "invoice_date": "2026-01-05", "total": "120.00"},
        ],
    }
    return FindingView(
        batch_id=kw.get("batch_id", "b-0001"), finding_id=kw.get("finding_id", "f00dfeedbeef0001"),
        rule_id=contracts.RULE_DUPLICATE, rule_version="invoice-v1",
        member_ids=("R-001", "R-007", "R-012"), state=state, seq=seq, evidence=ev,
    )


def mis_finding(state="open", seq=0, delta="+0.01", declared="110.26", **kw):
    ev = {"record_id": "R-003", "row": 3, "subtotal": "100.00", "tax": "8.25", "shipping": "5.00",
          "discount": "3.00", "expected": "110.25", "declared": declared, "delta": delta}
    return FindingView(
        batch_id="b-0001", finding_id=kw.get("finding_id", "0123456789abcdef"),
        rule_id=contracts.RULE_MISMATCH, rule_version="invoice-v1",
        member_ids=("R-003",), state=state, seq=seq, evidence=ev,
    )


def events():
    return [
        ReviewEventView(1, "open", "confirmed", "confirm", "Same PDF attached twice", "AB", "2026-10-21T12:05:00Z"),
        ReviewEventView(2, "confirmed", "open", "reopen", "Vendor says reissue", "CD", "2026-10-21T12:09:00Z"),
    ]


def all_pages():
    batch = make_batch()
    findings = sorted([dup_finding(), mis_finding(state="confirmed", seq=1)], key=contracts.case_sort_key)
    return {
        "command_center": render_command_center([batch], CSRF),
        "command_center_empty": render_command_center([], CSRF),
        "batch": render_batch(batch, findings, None),
        "batch_filtered": render_batch(batch, findings, "open"),
        "finding_dup": render_finding(batch, dup_finding(), [], CSRF),
        "finding_mis": render_finding(batch, mis_finding(state="confirmed", seq=2), events(), CSRF),
        "report": render_report(batch, findings),
        "error": render_error(404, "Not found", "No such batch."),
    }


def form_actions(html_text):
    return re.findall(r'<button type="submit" name="action" value="([a-z]+)"', html_text)


class CommonPageTests(unittest.TestCase):
    def test_every_page_renders_with_banner_and_parses(self):
        for name, doc in all_pages().items():
            with self.subTest(page=name):
                self.assertTrue(doc.startswith("<!doctype html>"))
                self.assertIn(contracts.SYNTHETIC_LABEL, doc)
                self.assertIn('href="/static/style.css"', doc)
                # same-origin (not no-referrer): no-referrer makes Chromium send
                # "Origin: null" on form POSTs, which the server's allowlist rejects.
                self.assertIn('<meta name="referrer" content="same-origin">', doc)
                self.assertNotIn("no-referrer", doc)
                self.assertIn('<a class="skip-link" href="#main">', doc)
                self.assertIn('<main id="main"', doc)
                checker = BalanceChecker()
                checker.feed(doc)
                checker.close()
                self.assertTrue(checker.doctype)
                self.assertEqual(checker.errors, [])
                self.assertEqual(checker.stack, [], "unclosed tags")
                dupes = {i for i in checker.ids if checker.ids.count(i) > 1}
                self.assertEqual(dupes, set(), "duplicate ids")

    def test_csp_compatible_no_inline_script_or_style(self):
        for name, doc in all_pages().items():
            with self.subTest(page=name):
                self.assertIsNone(re.search(r"\sstyle\s*=", doc, re.I))
                self.assertNotIn("<style", doc.lower())
                self.assertIsNone(re.search(r"\son[a-z]+\s*=", doc, re.I), "inline handler")
                self.assertNotIn("javascript:", doc.lower())
                scripts = re.findall(r"<script\b[^>]*>", doc, re.I)
                if name.startswith("command_center"):
                    self.assertEqual(scripts, ['<script src="/static/upload.js" defer>'])
                    self.assertEqual(doc.count("</script>"), 1)
                else:
                    self.assertEqual(scripts, [])

    def test_tables_use_scoped_headers(self):
        for name, doc in all_pages().items():
            with self.subTest(page=name):
                for th in re.findall(r"<th\b[^>]*>", doc):
                    self.assertIn("scope=", th)


class CommandCenterTests(unittest.TestCase):
    def test_lists_batches_and_counts(self):
        doc = render_command_center([make_batch()], CSRF)
        self.assertIn("Financial Risk Command Center", doc)
        self.assertIn('<meta name="csrf-token" content="tok-abc_123">', doc)
        self.assertIn('href="/batches/b-0001"', doc)
        self.assertIn("Duplicates", doc)
        self.assertIn("Mismatches", doc)

    def test_all_twelve_modules_listed(self):
        doc = render_command_center([], CSRF)
        self.assertEqual(len(contracts.MODULES), 12)
        for m in contracts.MODULES:
            self.assertIn(m.name, doc)
        self.assertGreaterEqual(doc.count("Not in Stage 1"), 5)

    def test_empty_state(self):
        doc = render_command_center([], CSRF)
        self.assertIn("No batches imported yet", doc)
        self.assertNotIn("<table", doc)

    def test_upload_form_shape(self):
        doc = render_command_center([], CSRF)
        self.assertIn('<input type="file" id="csv-file" accept=".csv,text/csv"', doc)
        self.assertIn('<label for="csv-file">', doc)
        self.assertIn('aria-describedby="csv-file-hint"', doc)
        self.assertIn('id="import-status" class="import-status" role="status" aria-live="polite"', doc)
        form_tag = re.search(r'<form id="import-form"[^>]*>', doc).group(0)
        self.assertNotIn("action=", form_tag)

    def test_escapes_display_name_and_csrf(self):
        doc = render_command_center([make_batch(display_name=XSS, batch_id='x"y')], '"><b>')
        self.assertNotIn("<script>alert(1)", doc)
        self.assertIn(XSS_ESCAPED, doc)
        self.assertIn('content="&quot;&gt;&lt;b&gt;"', doc)
        self.assertIn('href="/batches/x%22y"', doc)


class BatchPageTests(unittest.TestCase):
    def setUp(self):
        self.batch = make_batch()
        self.findings = sorted(
            [mis_finding(state="dismissed", seq=1), dup_finding(), mis_finding(finding_id="1111111111111111")],
            key=contracts.case_sort_key,
        )

    def test_cases_metadata_and_links(self):
        doc = render_batch(self.batch, self.findings, None)
        self.assertIn("open first, then rule, then record ID", doc)
        self.assertIn("no risk score", doc)
        self.assertIn("3 records share vendor V-001 / invoice INV-9", doc)
        self.assertIn("Declared 110.26 vs expected 110.25 (+0.01)", doc)
        self.assertIn('href="/batches/b-0001/findings/f00dfeedbeef0001"', doc)
        self.assertIn('href="/batches/b-0001/report"', doc)
        self.assertIn("a" * 64, doc)
        self.assertIn("2026-10-21T12:00:00Z", doc)
        self.assertIn("invoice-v1", doc)
        for q in ("?state=open", "?state=confirmed", "?state=dismissed"):
            self.assertIn('href="/batches/b-0001' + q + '"', doc)

    def test_order_preserved(self):
        doc = render_batch(self.batch, self.findings, None)
        positions = [doc.index(f'findings/{f.finding_id}"') for f in self.findings]
        self.assertEqual(positions, sorted(positions))

    def test_filter(self):
        doc = render_batch(self.batch, self.findings, "dismissed")
        self.assertEqual(doc.count('class="case case--'), 1)
        self.assertIn('href="/batches/b-0001?state=dismissed" aria-current="page"', doc)
        doc = render_batch(self.batch, self.findings, "confirmed")
        self.assertIn("No confirmed cases", doc)
        doc = render_batch(self.batch, self.findings, "bogus")
        self.assertEqual(doc.count('class="case case--'), 3)

    def test_empty_batch(self):
        doc = render_batch(make_batch(finding_count=0), [], None)
        self.assertIn("No findings in this batch", doc)

    def test_state_badges_have_text(self):
        doc = render_batch(self.batch, self.findings, None)
        self.assertIn("State: </span>Open", doc)
        self.assertIn("State: </span>Dismissed", doc)

    def test_escaping(self):
        f = dup_finding(raw_vendor=XSS)
        ev = dict(f.evidence)
        ev["key"] = {"vendor": XSS, "invoice": XSS, "currency": "USD"}
        f = FindingView(f.batch_id, f.finding_id, f.rule_id, f.rule_version, (XSS,), f.state, f.seq, ev)
        doc = render_batch(make_batch(display_name=XSS), [f], None)
        self.assertNotIn("<script>alert", doc)
        self.assertIn(XSS_ESCAPED, doc)


class FindingPageTests(unittest.TestCase):
    def setUp(self):
        self.batch = make_batch()

    def test_allowed_actions_per_state(self):
        expected = {"open": ["confirm", "dismiss"], "confirmed": ["reopen"], "dismissed": ["reopen"]}
        for state, actions in expected.items():
            with self.subTest(state=state):
                doc = render_finding(self.batch, dup_finding(state=state, seq=3), [], CSRF)
                self.assertEqual(form_actions(doc), actions)

    def test_form_fields(self):
        doc = render_finding(self.batch, dup_finding(seq=4), [], CSRF)
        self.assertIn('method="post" action="/batches/b-0001/findings/f00dfeedbeef0001/review"', doc)
        self.assertIn('<input type="hidden" name="csrf" value="tok-abc_123">', doc)
        self.assertIn('<input type="hidden" name="expected_seq" value="4">', doc)
        self.assertIn('<label for="reviewer">Your name or initials (self-declared)</label>', doc)
        self.assertRegex(doc, r'<input type="text" id="reviewer" name="reviewer" required maxlength="80"')
        self.assertRegex(doc, r'<textarea id="reason" name="reason" required maxlength="500"')
        self.assertIn('aria-describedby="reviewer-hint"', doc)
        self.assertIn('aria-describedby="reason-hint"', doc)

    def test_duplicate_evidence(self):
        doc = render_finding(self.batch, dup_finding(), [], CSRF)
        for needle in ("V-001", "INV-9", "USD", "R-001", "R-007", "R-012", "2026-01-09", "120.00",
                       "Raw vendor", "Raw invoice number", "Source row"):
            self.assertIn(needle, doc)
        self.assertIn("<code class=\"raw\"> inv-9</code>", doc)
        self.assertIn("Declared totals differ: 110.25, 120.00.", doc)
        self.assertIn("1, 7, 12", doc)  # provenance source rows
        self.assertIn("independently known contact", doc)
        self.assertIn("different period", doc)
        self.assertIn("not proof of a duplicate payment", doc)
        self.assertIn("never approves, blocks or releases a payment", doc)
        self.assertIn("No review decisions yet", doc)

    def test_mismatch_arithmetic(self):
        doc = render_finding(self.batch, mis_finding(), [], CSRF)
        self.assertIn("100.00 + 8.25 + 5.00 − 3.00 = 110.25", doc)
        for needle in ("Subtotal", "Tax", "Shipping", "Discount", "Expected total", "Declared total",
                       "110.26", "+0.01", "positive means declared total is higher",
                       "higher than expected by 0.01", "request a corrected invoice", "Recompute"):
            self.assertIn(needle, doc)
        neg = render_finding(self.batch, mis_finding(delta="-1.50", declared="108.75"), [], CSRF)
        self.assertIn("-1.50", neg)
        self.assertIn("lower than expected by 1.50", neg)

    def test_provenance(self):
        doc = render_finding(self.batch, mis_finding(), [], CSRF)
        self.assertIn("a" * 64, doc)
        self.assertIn("invoice-v1", doc)
        self.assertIn("0123456789abcdef", doc)

    def test_history_timeline(self):
        doc = render_finding(self.batch, mis_finding(state="open", seq=2), events(), CSRF)
        for needle in ("#1", "#2", "Confirmed", "Reopened", "AB", "CD", "2026-10-21T12:05:00Z",
                       "Same PDF attached twice", "Vendor says reissue",
                       "the local database owner can alter it", "not a tamper-proof audit log"):
            self.assertIn(needle, doc)
        self.assertLess(doc.index("#1"), doc.index("#2"))

    def test_notice_error_conflict(self):
        doc = render_finding(self.batch, mis_finding(), [], CSRF, notice="Decision recorded.")
        self.assertIn('class="callout callout--ok" role="status"', doc)
        self.assertIn("Decision recorded.", doc)
        doc = render_finding(self.batch, mis_finding(), [], CSRF, error="Reason is required.",
                             form_values={"reviewer": XSS, "reason": XSS})
        self.assertIn('role="alert"', doc)
        self.assertIn("Reason is required.", doc)
        self.assertIn(f'value="{XSS_ESCAPED}"', doc)
        self.assertIn(f">{XSS_ESCAPED}</textarea>", doc)
        self.assertIn('aria-invalid="true"', doc)
        self.assertIn('aria-describedby="reviewer-hint review-error"', doc)
        self.assertNotIn("<script>alert", doc)
        doc = render_finding(self.batch, mis_finding(state="confirmed", seq=5), [], CSRF, conflict=True)
        self.assertIn("changed in another tab", doc)
        self.assertIn('name="expected_seq" value="5"', doc)
        self.assertEqual(form_actions(doc), ["reopen"])

    def test_escaping_evidence_reason_reviewer(self):
        f = dup_finding(raw_vendor=XSS, raw_invoice=XSS)
        ev_events = [ReviewEventView(1, "open", "dismissed", "dismiss", XSS, XSS, "2026-10-21T12:00:00Z")]
        doc = render_finding(make_batch(display_name=XSS), f, ev_events, '"csrf<')
        self.assertNotIn("<script>alert", doc)
        self.assertIn(XSS_ESCAPED, doc)
        self.assertIn('name="csrf" value="&quot;csrf&lt;"', doc)
        m = mis_finding(delta=XSS, declared=XSS)
        doc = render_finding(self.batch, m, [], CSRF)
        self.assertNotIn("<script>alert", doc)

    def test_unknown_or_malformed_evidence_does_not_crash(self):
        f = FindingView("b", "f", "OTHER_RULE", "v9", ("R",), "open", 0, {"x": XSS})
        doc = render_finding(self.batch, f, [], CSRF)
        self.assertIn(XSS_ESCAPED, doc)
        f = FindingView("b", "f", contracts.RULE_DUPLICATE, "v", ("R",), "open", 0, {})
        render_finding(self.batch, f, [], CSRF)
        f = FindingView("b", "f", contracts.RULE_MISMATCH, "v", ("R",), "open", 0, {})
        render_finding(self.batch, f, [], CSRF)


class ReportAndErrorTests(unittest.TestCase):
    def test_report_counts_and_limits(self):
        findings = [dup_finding(), mis_finding(state="confirmed"), mis_finding(state="dismissed", finding_id="2")]
        doc = render_report(make_batch(), findings)
        self.assertIn("Synthetic batch summary", doc)
        self.assertIn("Limitations", doc)
        self.assertIn("invoice-v1", doc)
        self.assertIn("a" * 64, doc)
        row = re.search(r'<th scope="row">Total mismatch</th>(.*?)</tr>', doc).group(1)
        self.assertEqual(re.findall(r'<td class="num">(\d+)</td>', row), ["0", "1", "1", "2"])
        total = re.search(r'<th scope="row">All rules</th>(.*?)</tr>', doc).group(1)
        self.assertEqual(re.findall(r'<td class="num">(\d+)</td>', total), ["1", "1", "1", "3"])
        lowered = doc.lower()
        for banned in ("you saved", "% accurate", "probability of", "risk score:"):
            self.assertNotIn(banned, lowered)

    def test_report_escapes(self):
        doc = render_report(make_batch(display_name=XSS), [])
        self.assertNotIn("<script>alert", doc)
        self.assertIn(XSS_ESCAPED, doc)

    def test_error_page(self):
        doc = render_error(409, XSS, XSS)
        self.assertIn("Error 409", doc)
        self.assertNotIn("<script>alert", doc)
        self.assertIn(XSS_ESCAPED, doc)


class StaticAssetTests(unittest.TestCase):
    def _read(self, name):
        with open(os.path.join(STATIC_DIR, name), encoding="utf-8") as fh:
            return fh.read()

    def test_static_file_names_allowed(self):
        for name in os.listdir(STATIC_DIR):
            self.assertRegex(name, r"^[a-z0-9-]+\.(css|js|svg)$")

    def test_upload_js_contract(self):
        js = self._read("upload.js")
        self.assertNotIn("innerHTML", js)
        self.assertNotIn("readAsText", js)
        self.assertNotIn(".text()", js)
        self.assertNotIn("eval(", js)
        for needle in ("arrayBuffer", "'/import'".replace("'", '"'), "application/octet-stream",
                       "X-CSRF-Token", "X-Filename", "encodeURIComponent(file.name)",
                       "same-origin", "1048576", '"/batches/"', "location.assign", "textContent",
                       "issue_count", "nothing was imported"):
            self.assertIn(needle, js)

    def test_upload_js_uncertain_outcome_wording(self):
        js = self._read("upload.js")
        self.assertIn("The import outcome is uncertain. Reload the Command Center", js)
        self.assertIn("Re-importing the identical file is safe", js)
        self.assertIn("HTTP \" + status", js)
        # Definitive rejection requires a parsed JSON object with ok === false.
        self.assertIn("data.ok === false", js)
        self.assertIn("!isDefinitiveRejection(data)", js)
        # The network-error path must report uncertainty, not rejection.
        catch_block = js[js.index(".catch(function () {\n        //"):]
        catch_block = catch_block[: catch_block.index("});")]
        self.assertIn("showUncertain(", catch_block)
        self.assertNotIn("nothing was imported", catch_block.lower())
        uncertain_fn = js[js.index("function showUncertain"):]
        uncertain_fn = uncertain_fn[: uncertain_fn.index("\n  }\n")]
        self.assertNotIn("nothing was imported", uncertain_fn.lower())
        # "nothing was imported" only in: no file chosen, client size limit, definitive rejection.
        lines = [ln.strip() for ln in js.splitlines() if "nothing was imported" in ln.lower()]
        self.assertEqual(len(lines), 3, lines)
        self.assertTrue(any("No file was selected" in ln for ln in lines))
        self.assertTrue(any("File too large" in ln for ln in lines))
        self.assertTrue(any("whole file was rejected" in ln for ln in lines))

    def test_upload_js_read_failure_is_separate_from_network_failure(self):
        js = self._read("upload.js")
        self.assertIn(
            "The selected file could not be read by the browser, so nothing was sent or imported. "
            '" +\n    "Choose the file again.', js)
        # The read step has its own rejection handler using the read-failure text,
        # and it never shows the uncertain-outcome message.
        read_step = js[js.index("return readBuffer(file);"):js.index("var READ_FAILED_TEXT")]
        self.assertIn("READ_FAILED_TEXT", read_step)
        self.assertNotIn("showUncertain", read_step)
        self.assertNotIn("fetch(", read_step)
        # The uncertain wording is used only after the fetch is issued.
        upload_fn = js[js.index("function upload(buffer, file)"):]
        self.assertIn("fetch(\"/import\"", upload_fn)
        self.assertIn("showUncertain(null)", upload_fn)
        self.assertNotIn("READ_FAILED_TEXT", upload_fn)
        self.assertLess(js.index("return readBuffer(file);"), js.index("function upload(buffer, file)"))

    def test_style_css_dark_mode_and_no_remote(self):
        css = self._read("style.css")
        self.assertIn("prefers-color-scheme: dark", css)
        self.assertIn("tabular-nums", css)
        self.assertIn(":focus-visible", css)
        self.assertNotIn("@import", css)
        self.assertNotIn("url(", css)


if __name__ == "__main__":
    unittest.main()
