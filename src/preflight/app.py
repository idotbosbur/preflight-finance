"""Loopback-only HTTP adapter over :class:`preflight.routes.App`.

``ThreadingHTTPServer`` gives each request its own thread; the store opens a
fresh SQLite connection per operation, so no connection crosses threads.
The body size limit is enforced from ``Content-Length`` before any byte of
the body is read.
"""

from __future__ import annotations

import json
import secrets
import sys
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Callable, Optional

from . import contracts as c
from .routes import SECURITY_HEADERS, App, Request, Response, body_limit, lower_headers, utc_now
from .storage import Store

LOOPBACK = "127.0.0.1"


class PreflightServer(ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = False

    def __init__(self, app: App, port: int, quiet: bool = False, request_timeout: float = 30.0) -> None:
        self.app = app
        self.quiet = quiet
        self.request_timeout = request_timeout  # a stalled client cannot hold a thread indefinitely
        super().__init__((LOOPBACK, port), Handler)
        app.set_port(self.server_address[1])

    @property
    def url(self) -> str:
        return f"http://{LOOPBACK}:{self.server_address[1]}/"


class Handler(BaseHTTPRequestHandler):
    server: PreflightServer
    server_version = "PreflightStage1"
    sys_version = ""
    protocol_version = "HTTP/1.1"

    @property
    def timeout(self) -> float:  # read by StreamRequestHandler.setup -> socket timeout
        return self.server.request_timeout

    def log_message(self, fmt: str, *args) -> None:  # noqa: D401 - stdlib signature
        if not self.server.quiet:
            sys.stderr.write("%s %s\n" % (self.log_date_time_string(), fmt % args))

    def end_headers(self) -> None:
        # Applied here so the stdlib's own send_error pages (400/431/501...) carry them too.
        for key, value in SECURITY_HEADERS.items():
            self.send_header(key, value)
        super().end_headers()

    def _send(self, resp: Response) -> None:
        self.send_response(resp.status)
        for key, value in resp.headers.items():
            self.send_header(key, value)
        self.send_header("Content-Type", resp.content_type)
        self.send_header("Content-Length", str(len(resp.body)))
        if self.close_connection:
            self.send_header("Connection", "close")
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(resp.body)

    def _reject_body(self, status: int, code: str, message: str) -> None:
        self.close_connection = True  # unread body: do not reuse the connection
        if self.path.split("?")[0] == "/import":
            payload = {"ok": False, "sha256": None, "issue_count": 1,
                       "issues": [{"row": None, "field": None, "code": code, "message": message}]}
            self._send(Response(status, json.dumps(payload).encode(), "application/json; charset=utf-8"))
        else:
            self._send(Response(status, message.encode(), "text/plain; charset=utf-8"))

    def _dispatch(self) -> None:
        # Request framing is parsed defensively: malformed input gets a bounded
        # 4xx response before any body byte is read or any state can change.
        parts = urllib.parse.urlsplit(self.path)
        headers = lower_headers(self.headers.items())
        body = b""
        limit = body_limit(self.command, parts.path)
        if len(self.headers.get_all("Content-Length") or []) > 1:
            return self._reject_body(400, "BAD_LENGTH", "Multiple Content-Length headers.")
        if self.command != "POST" and (headers.get("transfer-encoding")
                                       or headers.get("content-length", "0").strip() not in ("", "0")):
            # Never leave unread body bytes on a kept-alive connection.
            return self._reject_body(400, "UNEXPECTED_BODY", "This request must not have a body.")
        if self.command == "POST":
            length_text = headers.get("content-length")
            if headers.get("transfer-encoding"):
                return self._reject_body(411, "LENGTH_REQUIRED", "Chunked uploads are not supported.")
            if length_text is None:
                return self._reject_body(411, "LENGTH_REQUIRED", "Content-Length is required.")
            length_text = length_text.strip()
            if not length_text.isascii() or not length_text.isdigit():
                return self._reject_body(400, "BAD_LENGTH", "Invalid Content-Length.")
            # Strip leading zeros and bound the digit count before int(): Python
            # refuses to convert strings of more than 4,300 digits (leading zeros count).
            significant = length_text.lstrip("0") or "0"
            if len(significant) > len(str(limit)) or int(significant) > limit:
                return self._reject_body(413, "FILE_TOO_LARGE",
                                         f"The upload exceeds {limit} bytes" + (" (1 MiB)." if limit == c.MAX_BYTES else "."))
            expected = int(significant)
            try:
                body = self.rfile.read(expected)
            except OSError:  # includes socket timeout; nothing has been processed
                self.close_connection = True
                return
            if len(body) != expected:
                return self._reject_body(400, "INCOMPLETE_BODY", "The request body was shorter than Content-Length.")
        try:
            query = dict(urllib.parse.parse_qsl(parts.query, keep_blank_values=True, max_num_fields=10))
        except ValueError:
            return self._reject_body(400, "BAD_QUERY", "The address has too many or malformed query parameters.")
        try:
            resp = self.server.app.handle(Request(self.command, parts.path, query, headers, body))
        except Exception as exc:  # never leak a traceback to the browser
            self.log_error("internal error: %r", exc)
            # A storage commit may already have happened before the failure.
            resp = Response(500, b"Internal error: the outcome of this request is uncertain. Reload the page and "
                                 b"check the batch and review history before retrying.", "text/plain; charset=utf-8")
        self._send(resp)

    def do_GET(self) -> None:
        self._dispatch()

    def do_POST(self) -> None:
        self._dispatch()

    # Other methods reach App.handle, which applies the Host check and answers 405.
    do_HEAD = do_PUT = do_DELETE = do_PATCH = do_OPTIONS = do_GET


def create_server(db_path: str, port: int = 8765, *, quiet: bool = False,
                  clock: Callable[[], str] = utc_now, csrf_token: Optional[str] = None,
                  request_timeout: float = 30.0) -> PreflightServer:
    store = Store(db_path)
    store.init_schema()
    app = App(store, csrf_token or secrets.token_urlsafe(32), port, clock)
    return PreflightServer(app, port, quiet=quiet, request_timeout=request_timeout)
