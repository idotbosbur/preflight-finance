"""Request routing and request-level security, independent of the socket layer.

``App.handle`` takes an already size-bounded :class:`Request` and returns a
:class:`Response`. The HTTP adapter lives in ``app.py``. Keeping this layer
transport-free makes it reusable behind a later framework (e.g. FastAPI) and
directly testable.
"""

from __future__ import annotations

import datetime as _dt
import hmac
import json
import re
import urllib.parse
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable, Dict, Mapping, Optional, Sequence

from . import contracts as c
from . import rules, views
from .imports import validate_bytes
from .review import parse_review_form
from .storage import Store

STATIC_DIR = Path(__file__).with_name("static")
STATIC_NAME = re.compile(r"[a-z0-9-]+\.(css|js|svg)", re.ASCII)
STATIC_TYPES = {"css": "text/css; charset=utf-8", "js": "text/javascript; charset=utf-8",
                "svg": "image/svg+xml"}
HEX16 = r"[0-9a-f]{16}"
FORM_MAX_BYTES = 16 * 1024

SECURITY_HEADERS = {
    "Content-Security-Policy": ("default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; "
                                "connect-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'"),
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    # same-origin (not no-referrer): under no-referrer browsers send ``Origin: null``
    # on navigation-mode form POSTs (Fetch spec §3.2), which the exact Origin
    # allowlist must reject. Referrers still never leave this origin.
    "Referrer-Policy": "same-origin",
    "Cache-Control": "no-store",
    "Cross-Origin-Opener-Policy": "same-origin",
    "Cross-Origin-Resource-Policy": "same-origin",
}


def utc_now() -> str:
    return _dt.datetime.now(_dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


@dataclass
class Request:
    method: str
    path: str
    query: Mapping[str, str]
    headers: Mapping[str, str]  # lower-case keys
    body: bytes = b""


@dataclass
class Response:
    status: int
    body: bytes
    content_type: str = "text/html; charset=utf-8"
    headers: Dict[str, str] = field(default_factory=dict)


def html(status: int, page: str, **headers: str) -> Response:
    return Response(status, page.encode("utf-8"), headers=dict(headers))


def as_json(status: int, payload: Mapping) -> Response:
    return Response(status, json.dumps(payload).encode("utf-8"), "application/json; charset=utf-8")


def display_name_from(header_value: Optional[str]) -> str:
    """Turn the client-supplied filename into a safe label (never a filesystem path)."""
    name = urllib.parse.unquote(header_value or "", errors="replace")
    name = re.split(r"[\\/]", name)[-1]
    name = "".join(ch for ch in name if ch.isprintable()).strip()
    return name[:200] or "upload.csv"


class App:
    def __init__(self, store: Store, csrf_token: str, port: int, clock: Callable[[], str] = utc_now) -> None:
        self.store = store
        self.csrf_token = csrf_token
        self.clock = clock
        self.set_port(port)

    def set_port(self, port: int) -> None:
        self.port = port
        self.allowed_hosts = {f"127.0.0.1:{port}", f"localhost:{port}"}
        self.allowed_origins = {f"http://{h}" for h in self.allowed_hosts}

    # ---- security gates ----

    def host_ok(self, headers: Mapping[str, str]) -> bool:
        return headers.get("host", "") in self.allowed_hosts

    def origin_ok(self, headers: Mapping[str, str]) -> bool:
        origin = headers.get("origin")
        if origin is not None and origin not in self.allowed_origins:
            return False
        return headers.get("sec-fetch-site", "same-origin") in ("same-origin", "none")

    def token_ok(self, supplied: Optional[str]) -> bool:
        return bool(supplied) and hmac.compare_digest(supplied.encode("utf-8", "replace"),
                                                      self.csrf_token.encode("utf-8"))

    def error(self, status: int, title: str, detail: str) -> Response:
        return html(status, views.render_error(status, title, detail))

    # ---- dispatch ----

    def handle(self, req: Request) -> Response:
        if not self.host_ok(req.headers):
            return Response(400, b"Bad Host header", "text/plain; charset=utf-8")
        path = req.path
        if req.method == "GET":
            if path == "/":
                return html(200, views.render_command_center(self.store.list_batches(), self.csrf_token))
            if path.startswith("/static/"):
                return self.static(path[len("/static/"):])
            m = re.fullmatch(rf"/batches/({HEX16})", path)
            if m:
                return self.batch_page(m.group(1), req.query.get("state"))
            m = re.fullmatch(rf"/batches/({HEX16})/report", path)
            if m:
                return self.report_page(m.group(1))
            m = re.fullmatch(rf"/batches/({HEX16})/findings/({HEX16})", path)
            if m:
                notice = "Decision recorded and added to the history below." if req.query.get("saved") == "1" else None
                return self.finding_page(m.group(1), m.group(2), notice=notice)
            return self.error(404, "Not found", "No page exists at this address.")
        if req.method == "POST":
            if not self.origin_ok(req.headers):
                return self.forbidden(path)
            if path == "/import":
                return self.import_batch(req)
            m = re.fullmatch(rf"/batches/({HEX16})/findings/({HEX16})/review", path)
            if m:
                return self.review(m.group(1), m.group(2), req)
            return self.error(404, "Not found", "No action exists at this address.")
        return Response(405, b"Method not allowed", "text/plain; charset=utf-8", {"Allow": "GET, POST"})

    def forbidden(self, path: str) -> Response:
        if path == "/import":
            return as_json(403, {"ok": False, "issue_count": 1, "sha256": None, "issues": [
                {"row": None, "field": None, "code": "FORBIDDEN",
                 "message": "Request rejected by the cross-site/CSRF check. Reload the page and try again."}]})
        return self.error(403, "Request rejected",
                          "The request failed the cross-site or CSRF check. Reload the page and try again.")

    # ---- pages ----

    def static(self, name: str) -> Response:
        m = STATIC_NAME.fullmatch(name)
        target = STATIC_DIR / name
        if not m or not target.is_file():
            return self.error(404, "Not found", "No such static file.")
        return Response(200, target.read_bytes(), STATIC_TYPES[m.group(1)])

    def batch_page(self, batch_id: str, state: Optional[str]) -> Response:
        batch = self.store.get_batch(batch_id)
        if batch is None:
            return self.error(404, "Batch not found", "No imported batch has this ID.")
        state = state if state in c.STATES else None
        return html(200, views.render_batch(batch, self.store.list_findings(batch_id, state), state))

    def report_page(self, batch_id: str) -> Response:
        batch = self.store.get_batch(batch_id)
        if batch is None:
            return self.error(404, "Batch not found", "No imported batch has this ID.")
        return html(200, views.render_report(batch, self.store.list_findings(batch_id)))

    def finding_page(self, batch_id: str, finding_id: str, status: int = 200, **kwargs) -> Response:
        batch = self.store.get_batch(batch_id)
        finding = self.store.get_finding(batch_id, finding_id) if batch else None
        if finding is None:
            return self.error(404, "Finding not found", "No finding with this ID exists in this batch.")
        events = self.store.list_events(batch_id, finding_id)
        return html(status, views.render_finding(batch, finding, events, self.csrf_token, **kwargs))

    # ---- actions ----

    def import_batch(self, req: Request) -> Response:
        if not self.token_ok(req.headers.get("x-csrf-token")):
            return self.forbidden("/import")
        if req.headers.get("content-type", "").split(";")[0].strip().lower() != "application/octet-stream":
            return as_json(415, {"ok": False, "issue_count": 1, "sha256": None, "issues": [
                {"row": None, "field": None, "code": "UNSUPPORTED_MEDIA_TYPE",
                 "message": "Upload the file bytes as application/octet-stream."}]})
        result = validate_bytes(req.body)
        if not result.ok:
            status = 413 if any(i.code == "FILE_TOO_LARGE" for i in result.issues) else 400
            return as_json(status, {"ok": False, "sha256": result.sha256, "issue_count": result.issue_count,
                                    "issues": [i.as_dict() for i in result.issues]})
        findings = rules.run_all(result.invoices)
        name = display_name_from(req.headers.get("x-filename"))
        batch_id, existing = self.store.save_import(name, result, findings, self.clock())
        batch = self.store.get_batch(batch_id)
        return as_json(200 if existing else 201, {
            "ok": True, "batch_id": batch_id, "existing": existing, "url": f"/batches/{batch_id}",
            "row_count": batch.row_count, "finding_count": batch.finding_count})

    def review(self, batch_id: str, finding_id: str, req: Request) -> Response:
        if req.headers.get("content-type", "").split(";")[0].strip().lower() != "application/x-www-form-urlencoded":
            return self.error(415, "Unsupported form", "Submit the review form from the investigation page.")
        try:
            pairs = urllib.parse.parse_qsl(req.body.decode("utf-8"), keep_blank_values=True,
                                           strict_parsing=False, max_num_fields=10)
        except (UnicodeDecodeError, ValueError):
            return self.error(400, "Unreadable form", "The submitted form could not be read.")
        form: Dict[str, str] = {}
        for key, value in pairs:
            form.setdefault(key, value)  # first value wins; duplicates ignored
        if not self.token_ok(form.get("csrf")):
            return self.forbidden(req.path)
        values = {k: form.get(k, "") for k in ("reason", "reviewer")}
        parsed, errors = parse_review_form(form)
        if parsed is None:
            return self.finding_page(batch_id, finding_id, 400, error=" ".join(errors), form_values=values)
        outcome = self.store.append_review(batch_id, finding_id, parsed.action, parsed.reason, parsed.reviewer,
                                           parsed.expected_seq, self.clock())
        if outcome.status == "not_found":
            return self.error(404, "Finding not found", "No finding with this ID exists in this batch.")
        if outcome.status in ("conflict", "invalid_transition"):
            return self.finding_page(batch_id, finding_id, 409, conflict=True, form_values=values)
        return Response(303, b"", "text/plain; charset=utf-8",
                        {"Location": f"/batches/{batch_id}/findings/{finding_id}?saved=1"})


def body_limit(method: str, path: str) -> int:
    """Maximum request body accepted for a route (checked before reading)."""
    if method != "POST":
        return 0
    if path == "/import":
        return c.MAX_BYTES
    return FORM_MAX_BYTES


def lower_headers(items: Sequence[tuple]) -> Dict[str, str]:
    out: Dict[str, str] = {}
    for key, value in items:
        out.setdefault(key.lower(), value)
    return out
