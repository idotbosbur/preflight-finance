"""Shared page chrome and escaping helpers for the Stage 1 views.

Every interpolated value goes through :func:`e` (``html.escape(str(v), quote=True)``).
No inline scripts, inline styles or ``<style>`` blocks are produced, so the pages
work under ``default-src 'self'; script-src 'self'; style-src 'self'``.
"""

from __future__ import annotations

import html
from typing import Iterable, Optional, Sequence, Tuple
from urllib.parse import quote

from preflight import contracts

APP_NAME = "Preflight"
STYLESHEET = "/static/style.css"
UPLOAD_SCRIPT = "/static/upload.js"

STATE_LABELS = {
    contracts.STATE_OPEN: "Open",
    contracts.STATE_CONFIRMED: "Confirmed",
    contracts.STATE_DISMISSED: "Dismissed",
}
# A glyph accompanies the text so state is never conveyed by colour alone.
STATE_GLYPHS = {
    contracts.STATE_OPEN: "○",  # white circle
    contracts.STATE_CONFIRMED: "✓",  # check mark
    contracts.STATE_DISMISSED: "–",  # en dash
}


def e(value: object) -> str:
    """Escape any value for HTML text or a quoted attribute."""
    return html.escape(str(value), quote=True)


def seg(value: object) -> str:
    """Percent-encode one URL path segment (then escape for the attribute)."""
    return quote(str(value), safe="")


def batch_url(batch_id: str) -> str:
    return "/batches/" + seg(batch_id)


def finding_url(batch_id: str, finding_id: str) -> str:
    return batch_url(batch_id) + "/findings/" + seg(finding_id)


def state_badge(state: str) -> str:
    label = STATE_LABELS.get(state, state)
    glyph = STATE_GLYPHS.get(state, "•")
    css = state if state in STATE_LABELS else "unknown"
    return (
        f'<span class="badge badge--{e(css)}">'
        f'<span class="badge__glyph" aria-hidden="true">{e(glyph)}</span>'
        f'<span class="visually-hidden">State: </span>{e(label)}</span>'
    )


def synthetic_banner() -> str:
    return (
        '<div class="synthetic-banner" role="note" aria-label="Data notice">'
        '<span class="synthetic-banner__tag" aria-hidden="true">SYNTHETIC</span>'
        f'<span class="synthetic-banner__text">{e(contracts.SYNTHETIC_LABEL)}</span>'
        "</div>"
    )


def breadcrumbs(items: Sequence[Tuple[str, Optional[str]]]) -> str:
    """``items`` = [(label, href or None for current page)]."""
    parts = []
    for label, href in items:
        if href is None:
            parts.append(f'<li><span aria-current="page">{e(label)}</span></li>')
        else:
            parts.append(f'<li><a href="{e(href)}">{e(label)}</a></li>')
    return '<nav class="breadcrumbs" aria-label="Breadcrumb"><ol>' + "".join(parts) + "</ol></nav>"


def dl(rows: Iterable[Tuple[str, str]], css: str = "meta") -> str:
    """Definition list. Values are pre-rendered HTML (callers escape)."""
    body = "".join(f'<div class="{css}__row"><dt>{e(k)}</dt><dd>{v}</dd></div>' for k, v in rows)
    return f'<dl class="{css}">{body}</dl>'


def code(value: object, css: str = "") -> str:
    cls = f' class="{e(css)}"' if css else ""
    return f"<code{cls}>{e(value)}</code>"


def utc_time(value: str) -> str:
    return f'<time datetime="{e(value)}">{e(value)}</time>'


def page(
    title: str,
    body: str,
    *,
    csrf_token: Optional[str] = None,
    scripts: Sequence[str] = (),
    current: str = "",
) -> str:
    """Wrap ``body`` (already-escaped HTML) in the full document chrome."""
    meta_csrf = (
        f'<meta name="csrf-token" content="{e(csrf_token)}">' if csrf_token is not None else ""
    )
    script_tags = "".join(f'<script src="{e(src)}" defer></script>' for src in scripts)
    home_current = ' aria-current="page"' if current == "home" else ""
    return (
        "<!doctype html>\n"
        '<html lang="en">'
        "<head>"
        '<meta charset="utf-8">'
        '<meta name="viewport" content="width=device-width, initial-scale=1">'
        '<meta name="color-scheme" content="light dark">'
        '<meta name="referrer" content="same-origin">'
        f"{meta_csrf}"
        f"<title>{e(title)} — {e(APP_NAME)} (synthetic)</title>"
        f'<link rel="stylesheet" href="{e(STYLESHEET)}">'
        f"{script_tags}"
        "</head>"
        "<body>"
        '<a class="skip-link" href="#main">Skip to main content</a>'
        f"{synthetic_banner()}"
        '<header class="site-header">'
        '<div class="site-header__inner">'
        f'<a class="brand" href="/"><span class="brand__mark" aria-hidden="true">P</span>'
        f'<span class="brand__name">{e(APP_NAME)}</span>'
        '<span class="brand__tag">Stage 1 prototype</span></a>'
        '<nav class="site-nav" aria-label="Primary"><ul>'
        f'<li><a href="/"{home_current}>Command Center</a></li>'
        "</ul></nav>"
        "</div>"
        "</header>"
        f'<main id="main" class="container" tabindex="-1">{body}</main>'
        '<footer class="site-footer"><div class="container">'
        f"<p>{e(contracts.SYNTHETIC_LABEL)}.</p>"
        "<p>Local single-operator review aid. Findings are candidates for human review, "
        "not proof of error or fraud. Nothing here approves, blocks or releases a payment.</p>"
        f'<p class="muted">Contracts {e(contracts.CONTRACTS_VERSION)} · ruleset '
        f"{e(contracts.RULESET_VERSION)} · no AI model is used.</p>"
        "</div></footer>"
        "</body></html>\n"
    )
