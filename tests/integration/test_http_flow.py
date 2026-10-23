"""End-to-end tests over a real loopback socket (ephemeral port)."""

import http.client
import json
import os
import re
import tempfile
import threading
import unittest
import urllib.parse
from html.parser import HTMLParser

from preflight import contracts as c
from preflight.app import create_server

TOKEN = "test-csrf-token"
HEADER = ",".join(c.CSV_HEADER)
SAMPLE = ("\n".join([
    HEADER,
    "R-1,V-001,INV-01,2026-01-15,USD,100.00,8.25,5.00,3.00,110.26",
    "R-2,v-001, inv-01 ,2026-02-15,USD,100.00,8.25,5.00,3.00,110.25",
    "R-3,V-002,INV-01,2026-01-15,USD,0.10,0.20,0.00,0.00,0.30",
    "R-4,V-001,INV01,2026-01-15,USD,100.00,8.25,5.00,3.00,110.25",
]) + "\n").encode()
FIXTURE_MAIN = os.path.join(os.path.dirname(__file__), "..", "..", "fixtures", "out", "main-120.csv")


class ServerCase(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.db = os.path.join(self.tmp.name, "flow.sqlite")
        self.start()

    def tearDown(self):
        self.stop()
        self.tmp.cleanup()

    def start(self):
        self.server = create_server(self.db, 0, quiet=True, csrf_token=TOKEN,
                                    clock=lambda: "2026-10-21T12:00:00Z", request_timeout=2.0)
        self.port = self.server.server_address[1]
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()

    def stop(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join()

    def request(self, method, path, body=None, headers=None, host=None):
        conn = http.client.HTTPConnection("127.0.0.1", self.port, timeout=10)
        try:
            conn.putrequest(method, path, skip_host=True, skip_accept_encoding=True)
            conn.putheader("Host", host or f"127.0.0.1:{self.port}")
            for k, v in (headers or {}).items():
                conn.putheader(k, v)
            if body is not None and "Content-Length" not in (headers or {}):
                conn.putheader("Content-Length", str(len(body)))
            conn.endheaders(body)
            resp = conn.getresponse()
            return resp.status, dict((k.lower(), v) for k, v in resp.getheaders()), resp.read()
        finally:
            conn.close()

    def upload(self, data, name="sample.csv", token=TOKEN, **extra):
        headers = {"Content-Type": "application/octet-stream", "X-CSRF-Token": token,
                   "X-Filename": urllib.parse.quote(name), "Origin": f"http://127.0.0.1:{self.port}"}
        headers.update(extra)
        status, h, body = self.request("POST", "/import", data, headers)
        return status, json.loads(body)

    def review(self, batch_id, finding_id, action, seq, reason="checked source", reviewer="AB", token=TOKEN):
        form = urllib.parse.urlencode({"action": action, "reason": reason, "reviewer": reviewer,
                                       "expected_seq": str(seq), "csrf": token}).encode()
        return self.request("POST", f"/batches/{batch_id}/findings/{finding_id}/review", form,
                            {"Content-Type": "application/x-www-form-urlencoded",
                             "Origin": f"http://127.0.0.1:{self.port}"})

    def page(self, path):
        status, _, body = self.request("GET", path)
        self.assertEqual(status, 200, path)
        return body.decode("utf-8")

    def finding_ids(self, batch_id):
        return re.findall(rf"/batches/{batch_id}/findings/([0-9a-f]{{16}})", self.page(f"/batches/{batch_id}"))


class FlowTest(ServerCase):
    def test_import_evidence_decide_reopen_restart(self):
        home = self.page("/")
        self.assertIn(c.SYNTHETIC_LABEL, home)
        self.assertIn(f'content="{TOKEN}"', home)

        status, data = self.upload(SAMPLE)
        self.assertEqual(status, 201, data)
        self.assertEqual((data["row_count"], data["finding_count"], data["existing"]), (4, 2, False))
        batch_id = data["batch_id"]
        ids = sorted(set(self.finding_ids(batch_id)))
        self.assertEqual(len(ids), 2)

        dup_id = c.make_finding_id(c.RULE_DUPLICATE, c.RULESET_VERSION, ("R-1", "R-2"))
        mis_id = c.make_finding_id(c.RULE_MISMATCH, c.RULESET_VERSION, ("R-1",))
        self.assertEqual(set(ids), {dup_id, mis_id})
        mismatch_page = self.page(f"/batches/{batch_id}/findings/{mis_id}")
        for text in ("100.00", "8.25", "5.00", "3.00", "110.25", "110.26", "+0.01"):
            self.assertIn(text, mismatch_page)

        status, headers, _ = self.review(batch_id, dup_id, "confirm", 0, reason="same obligation billed twice")
        self.assertEqual(status, 303)
        self.assertEqual(headers["location"], f"/batches/{batch_id}/findings/{dup_id}?saved=1")
        self.assertEqual(self.review(batch_id, dup_id, "reopen", 1, reason="vendor says reissue")[0], 303)
        self.assertEqual(self.review(batch_id, dup_id, "dismiss", 2, reason="legitimate reissue")[0], 303)

        self.stop()
        self.start()  # restart on the same database file
        after = self.page(f"/batches/{batch_id}/findings/{dup_id}")
        for reason in ("same obligation billed twice", "vendor says reissue", "legitimate reissue"):
            self.assertIn(reason, after)

        status, again = self.upload(SAMPLE)
        self.assertEqual((status, again["existing"], again["batch_id"]), (200, True, batch_id))
        batch_page = self.page(f"/batches/{batch_id}?state=dismissed")
        self.assertIn(dup_id, batch_page)
        self.assertNotIn(mis_id, batch_page)
        self.assertIn(mis_id, self.page(f"/batches/{batch_id}/report") + self.page(f"/batches/{batch_id}"))

    def test_stale_tab_conflict(self):
        batch_id = self.upload(SAMPLE)[1]["batch_id"]
        fid = c.make_finding_id(c.RULE_MISMATCH, c.RULESET_VERSION, ("R-1",))
        self.assertEqual(self.review(batch_id, fid, "confirm", 0, reason="tab one")[0], 303)
        status, _, body = self.review(batch_id, fid, "dismiss", 0, reason="tab two")
        self.assertEqual(status, 409)
        page = body.decode()
        self.assertIn("confirmed", page)
        self.assertIn("tab one", page)  # latest history shown
        self.assertEqual(page.count("tab two"), 1)  # only refilled into the form, never recorded

    def test_byte_different_file_is_new_batch(self):
        a = self.upload(SAMPLE)[1]["batch_id"]
        status, data = self.upload(b"\xef\xbb\xbf" + SAMPLE.replace(b"\n", b"\r\n"))
        self.assertEqual(status, 201, data)
        self.assertNotEqual(a, data["batch_id"])

    def test_rejected_file_persists_nothing(self):
        bad = SAMPLE + b"R-5,V-9,INV-9,2026-01-15,EUR,1.00,0.00,0.00,0.00,1.00\n"
        status, data = self.upload(bad)
        self.assertEqual(status, 400)
        self.assertEqual([(i["code"], i["row"]) for i in data["issues"]], [("CURRENCY_UNSUPPORTED", 5)])
        self.assertEqual(self.server.app.store.count_rows("batch"), 0)
        self.assertEqual(self.server.app.store.count_rows("invoice"), 0)

    def test_validation_error_refills_form(self):
        batch_id = self.upload(SAMPLE)[1]["batch_id"]
        fid = c.make_finding_id(c.RULE_MISMATCH, c.RULESET_VERSION, ("R-1",))
        status, _, body = self.review(batch_id, fid, "confirm", 0, reason="", reviewer="Kim")
        self.assertEqual(status, 400)
        self.assertIn("Kim", body.decode())
        self.assertEqual(self.server.app.store.count_rows("review_event"), 0)

    def test_untrusted_text_is_escaped(self):
        evil = '<script>alert(1)</script>"'
        status, data = self.upload(SAMPLE, name=evil + ".csv")
        batch_id = data["batch_id"]
        fid = c.make_finding_id(c.RULE_MISMATCH, c.RULESET_VERSION, ("R-1",))
        self.review(batch_id, fid, "confirm", 0, reason=evil, reviewer=evil)
        for path in ("/", f"/batches/{batch_id}", f"/batches/{batch_id}/findings/{fid}", f"/batches/{batch_id}/report"):
            with self.subTest(path=path):
                body = self.page(path)
                self.assertNotIn("<script>alert", body)

    @unittest.skipUnless(os.path.exists(FIXTURE_MAIN), "fixture not generated")
    def test_main_fixture_counts_via_http(self):
        with open(FIXTURE_MAIN, "rb") as fh:
            status, data = self.upload(fh.read(), name="main-120.csv")
        self.assertEqual(status, 201, data)
        self.assertEqual((data["row_count"], data["finding_count"]), (120, 32))


class _FormParser(HTMLParser):
    """Collect the review form exactly as a browser would serialize it."""

    def __init__(self):
        super().__init__()
        self.action, self.fields, self.buttons, self._in_form, self._textarea = None, {}, [], False, None
        self.meta_referrer = None

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if tag == "meta" and a.get("name") == "referrer":
            self.meta_referrer = a.get("content")
        if tag == "form" and (a.get("action") or "").endswith("/review"):
            self.action, self._in_form = a["action"], True
        elif self._in_form and tag == "input" and a.get("name"):
            self.fields[a["name"]] = a.get("value", "")
        elif self._in_form and tag == "textarea":
            self._textarea = a["name"]
            self.fields[self._textarea] = ""
        elif self._in_form and tag == "button" and a.get("name") == "action":
            self.buttons.append(a.get("value"))

    def handle_data(self, data):
        if self._textarea:
            self.fields[self._textarea] += data

    def handle_endtag(self, tag):
        if tag == "textarea":
            self._textarea = None
        elif tag == "form":
            self._in_form = False


class BrowserFormTest(ServerCase):
    """Regression for browser QA 403: navigation-mode form POST from the rendered page."""

    NAV_HEADERS = {"Content-Type": "application/x-www-form-urlencoded", "Sec-Fetch-Site": "same-origin",
                   "Sec-Fetch-Mode": "navigate", "Sec-Fetch-Dest": "document", "Sec-Fetch-User": "?1"}

    def submit_rendered_form(self, page_path, origin, action="confirm"):
        status, headers, body = self.request("GET", page_path)
        self.assertEqual(status, 200)
        self.assertEqual(headers["referrer-policy"], "same-origin")
        form = _FormParser()
        form.feed(body.decode())
        self.assertEqual(form.meta_referrer, "same-origin")
        self.assertIn(action, form.buttons)
        fields = dict(form.fields, reviewer="QA demo",
                      reason="Synthetic browser check: declared total is one cent higher.", action=action)
        data = urllib.parse.urlencode(fields).encode()  # token/seq come from the page itself
        return self.request("POST", form.action, data, dict(self.NAV_HEADERS, Origin=origin))

    def test_rendered_form_post_succeeds_with_same_origin_headers(self):
        batch_id = self.upload(SAMPLE)[1]["batch_id"]
        fid = c.make_finding_id(c.RULE_MISMATCH, c.RULESET_VERSION, ("R-1",))
        path = f"/batches/{batch_id}/findings/{fid}"
        for origin in (f"http://127.0.0.1:{self.port}",):
            status, headers, _ = self.submit_rendered_form(path, origin)
            self.assertEqual(status, 303)
        self.assertIn("QA demo", self.page(path))
        status, _, _ = self.submit_rendered_form(path, f"http://127.0.0.1:{self.port}", action="reopen")
        self.assertEqual(status, 303)

    def test_null_and_foreign_origins_still_rejected(self):
        batch_id = self.upload(SAMPLE)[1]["batch_id"]
        fid = c.make_finding_id(c.RULE_MISMATCH, c.RULESET_VERSION, ("R-1",))
        path = f"/batches/{batch_id}/findings/{fid}"
        for origin in ("null", "http://evil.example", f"http://127.0.0.1:{self.port + 1}"):
            with self.subTest(origin=origin):
                self.assertEqual(self.submit_rendered_form(path, origin)[0], 403)
        self.assertEqual(self.server.app.store.count_rows("review_event"), 0)


class SecurityTest(ServerCase):
    def test_bad_host_rejected(self):
        for host in ("evil.example", f"127.0.0.1:{self.port}.evil", "localhost"):
            with self.subTest(host=host):
                self.assertEqual(self.request("GET", "/", host=host)[0], 400)
        self.assertEqual(self.request("GET", "/", host=f"localhost:{self.port}")[0], 200)

    def test_security_headers(self):
        _, headers, _ = self.request("GET", "/")
        self.assertIn("script-src 'self'", headers["content-security-policy"])
        self.assertEqual(headers["x-content-type-options"], "nosniff")
        self.assertNotIn("access-control-allow-origin", headers)

    def test_csrf_origin_and_fetch_site(self):
        self.assertEqual(self.upload(SAMPLE, token="wrong")[0], 403)
        self.assertEqual(self.upload(SAMPLE, Origin="http://evil.example")[0], 403)
        self.assertEqual(self.upload(SAMPLE, **{"Sec-Fetch-Site": "cross-site"})[0], 403)
        batch_id = self.upload(SAMPLE)[1]["batch_id"]
        fid = c.make_finding_id(c.RULE_MISMATCH, c.RULESET_VERSION, ("R-1",))
        self.assertEqual(self.review(batch_id, fid, "confirm", 0, token="")[0], 403)
        self.assertEqual(self.server.app.store.count_rows("review_event"), 0)

    def test_media_type_and_size_limits(self):
        status, data = self.upload(SAMPLE, **{"Content-Type": "text/csv"})
        self.assertEqual(status, 415)
        status, headers, body = self.request(
            "POST", "/import", None,
            {"Content-Type": "application/octet-stream", "X-CSRF-Token": TOKEN,
             "Content-Length": str(c.MAX_BYTES + 1)})
        self.assertEqual(status, 413)
        self.assertEqual(json.loads(body)["issues"][0]["code"], "FILE_TOO_LARGE")
        self.assertEqual(self.request("POST", "/import", None, {"X-CSRF-Token": TOKEN})[0], 411)

    def test_malformed_framing_gets_bounded_response(self):
        many = "/?" + "&".join(f"k{i}=v" for i in range(50))
        self.assertEqual(self.request("GET", many)[0], 400)
        for length in ("9" * 5000, "0" * 4000 + "2000000", "0" * 5000 + "2000000", "-1", "1e3", "12 34"):
            with self.subTest(length=length[:12]):
                status, _, body = self.request(
                    "POST", "/import", None,
                    {"Content-Type": "application/octet-stream", "X-CSRF-Token": TOKEN, "Content-Length": length})
                self.assertIn(status, (400, 413))
                self.assertIn(b'"ok": false', body)
        # leading zeros within the limit are still a well-formed length, even beyond
        # Python's 4,300-digit int() conversion limit
        status, data = self.upload(SAMPLE, **{"Content-Length": "0" * 5000 + str(len(SAMPLE))})
        self.assertEqual(status, 201, data)
        self.assertEqual(self.request("GET", "/")[0], 200)  # server still healthy

    def test_stalled_body_times_out_without_import(self):
        conn = http.client.HTTPConnection("127.0.0.1", self.port, timeout=10)
        try:
            conn.putrequest("POST", "/import", skip_host=True, skip_accept_encoding=True)
            conn.putheader("Host", f"127.0.0.1:{self.port}")
            conn.putheader("Content-Type", "application/octet-stream")
            conn.putheader("X-CSRF-Token", TOKEN)
            conn.putheader("Content-Length", str(len(SAMPLE)))
            conn.endheaders(SAMPLE[:10])  # send only part of the body, then stall
            with self.assertRaises((http.client.RemoteDisconnected, ConnectionError)):
                conn.getresponse()  # server times out (2 s in tests) and closes
        finally:
            conn.close()
        self.assertEqual(self.server.app.store.count_rows("batch"), 0)
        self.assertEqual(self.request("GET", "/")[0], 200)

    def test_other_methods_and_stray_bodies(self):
        for method in ("HEAD", "PUT", "DELETE", "OPTIONS", "PATCH"):
            with self.subTest(method=method):
                status, headers, _ = self.request(method, "/")
                self.assertEqual(status, 405)
                self.assertIn("content-security-policy", headers)
        self.assertEqual(self.request("PUT", "/", host="evil.example")[0], 400)
        self.assertEqual(self.request("GET", "/", b"GET /x HTTP/1.1\r\n\r\n")[0], 400)
        conn = http.client.HTTPConnection("127.0.0.1", self.port, timeout=10)
        try:
            conn.putrequest("POST", "/import", skip_host=True, skip_accept_encoding=True)
            conn.putheader("Host", f"127.0.0.1:{self.port}")
            conn.putheader("Content-Length", "3")
            conn.putheader("Content-Length", "3")
            conn.endheaders(b"abc")
            self.assertEqual(conn.getresponse().status, 400)
        finally:
            conn.close()

    def test_stdlib_error_pages_carry_security_headers(self):
        import socket
        with socket.create_connection(("127.0.0.1", self.port), timeout=10) as sock:
            # Four words ending in HTTP/1.1: the stdlib sets request_version, then rejects the
            # syntax with 400 via send_error. (Lines it rejects before setting the version get a
            # header-less HTTP/0.9 reply; browsers never send those.)
            sock.sendall(b"GET / extra HTTP/1.1\r\nHost: x\r\n\r\n")
            reply = sock.recv(65536).decode("latin-1").lower()
        self.assertTrue(reply.startswith("http/1.1 400"), reply[:40])
        self.assertIn("content-security-policy:", reply)

    def test_internal_error_reports_uncertain_outcome(self):
        def boom(req):
            raise RuntimeError("simulated failure after commit")
        self.server.app.handle = boom
        status, _, body = self.request("GET", "/")
        self.assertEqual(status, 500)
        self.assertIn(b"uncertain", body)
        self.assertNotIn(b"nothing was changed", body)

    def test_static_allowlist(self):
        self.assertEqual(self.request("GET", "/static/style.css")[0], 200)
        for path in ("/static/../app.py", "/static/..%2Fapp.py", "/static/Style.CSS", "/static/x.py"):
            with self.subTest(path=path):
                self.assertEqual(self.request("GET", path)[0], 404)

    def test_unknown_ids_404(self):
        self.assertEqual(self.request("GET", "/batches/0000000000000000")[0], 404)
        self.assertEqual(self.request("GET", "/batches/xyz")[0], 404)


if __name__ == "__main__":
    unittest.main()
