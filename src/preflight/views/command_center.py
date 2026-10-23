"""Financial Risk Command Center (home page)."""

from __future__ import annotations

from typing import Sequence

from preflight import contracts
from preflight.views.layout import UPLOAD_SCRIPT, batch_url, e, page, utc_time


def _import_panel() -> str:
    max_kib = contracts.MAX_BYTES // 1024
    header = ",".join(contracts.CSV_HEADER)
    return (
        '<section class="panel panel--import" aria-labelledby="import-heading">'
        '<h2 id="import-heading">Import a synthetic invoice CSV</h2>'
        '<p class="panel__lede">The file is sent byte-for-byte so its SHA-256 matches the file on '
        "disk. If any row is invalid the whole file is rejected and nothing is imported. "
        "Re-importing an identical file opens the existing batch.</p>"
        # No action: the form is handled by /static/upload.js (progressive enhancement).
        '<form id="import-form" class="import-form" novalidate>'
        '<div class="field">'
        '<label for="csv-file">CSV file</label>'
        '<input type="file" id="csv-file" accept=".csv,text/csv" required '
        'aria-describedby="csv-file-hint">'
        f'<p id="csv-file-hint" class="hint">UTF-8, at most {e(max_kib)} KiB and '
        f"{e(contracts.MAX_ROWS)} data rows, USD only. Header must be exactly: "
        f'<code class="wrap">{e(header)}</code></p>'
        "</div>"
        '<div class="actions">'
        '<button type="submit" id="import-button" class="button button--primary">Import</button>'
        "</div>"
        '<noscript><p class="callout callout--warn">Import needs JavaScript (a local script '
        "reads the file as raw bytes). Batches and reviews work without it.</p></noscript>"
        '<p id="import-status" class="import-status" role="status" aria-live="polite"></p>'
        '<div id="import-errors" class="import-errors" tabindex="-1" hidden></div>'
        "</form>"
        "</section>"
    )


def _batches_panel(batches: Sequence[contracts.BatchSummary]) -> str:
    if not batches:
        return (
            '<section class="panel" aria-labelledby="batches-heading">'
            '<h2 id="batches-heading">Recent batches</h2>'
            '<div class="empty-state">'
            '<p class="empty-state__title">No batches imported yet.</p>'
            "<p>Import a synthetic CSV above to run the duplicate-candidate and total-mismatch "
            "checks. Findings will appear here for review.</p>"
            "</div></section>"
        )
    rows = []
    for b in batches:
        rows.append(
            "<tr>"
            f'<th scope="row"><a href="{e(batch_url(b.batch_id))}">{e(b.display_name)}</a>'
            f'<span class="cell-sub mono">{e(b.sha256[:12])}…</span></th>'
            f"<td>{utc_time(b.imported_at_utc)}</td>"
            f'<td class="num">{e(b.row_count)}</td>'
            f'<td class="num">{e(b.finding_count)}</td>'
            f'<td class="num">{e(b.duplicate_count)}</td>'
            f'<td class="num">{e(b.mismatch_count)}</td>'
            f'<td class="num">{e(b.open_count)}</td>'
            f'<td class="num">{e(b.confirmed_count)}</td>'
            f'<td class="num">{e(b.dismissed_count)}</td>'
            "</tr>"
        )
    total_open = sum(b.open_count for b in batches)
    total_findings = sum(b.finding_count for b in batches)
    return (
        '<section class="panel" aria-labelledby="batches-heading">'
        '<h2 id="batches-heading">Recent batches</h2>'
        '<ul class="stat-row" aria-label="Totals across listed batches">'
        f'<li class="stat"><span class="stat__value num">{e(len(batches))}</span>'
        '<span class="stat__label">batches</span></li>'
        f'<li class="stat"><span class="stat__value num">{e(total_findings)}</span>'
        '<span class="stat__label">synthetic findings</span></li>'
        f'<li class="stat stat--attention"><span class="stat__value num">{e(total_open)}</span>'
        '<span class="stat__label">open for review</span></li>'
        "</ul>"
        '<div class="table-wrap" role="region" aria-labelledby="batches-caption" tabindex="0">'
        '<table class="data-table">'
        '<caption id="batches-caption">Imported synthetic batches with finding and review counts</caption>'
        "<thead><tr>"
        '<th scope="col">Batch</th><th scope="col">Imported (UTC)</th>'
        '<th scope="col" class="num">Rows</th><th scope="col" class="num">Findings</th>'
        '<th scope="col" class="num">Duplicates</th><th scope="col" class="num">Mismatches</th>'
        '<th scope="col" class="num">Open</th><th scope="col" class="num">Confirmed</th>'
        '<th scope="col" class="num">Dismissed</th>'
        "</tr></thead>"
        f"<tbody>{''.join(rows)}</tbody>"
        "</table></div></section>"
    )


def _roadmap_panel() -> str:
    items = []
    for m in contracts.MODULES:
        planned = m.stage1.startswith("Not in Stage 1")
        badge = (
            '<span class="badge badge--planned">Not in Stage 1</span>'
            if planned
            else '<span class="badge badge--partial">Stage 1 foundation</span>'
        )
        items.append(
            f'<li class="module{" module--planned" if planned else ""}">'
            f'<div class="module__head"><span class="module__num num">{e(m.number)}</span>'
            f'<h3 class="module__name">{e(m.name)}</h3>{badge}</div>'
            f'<p class="module__status"><span class="label">Stage 1:</span> {e(m.stage1)}</p>'
            f'<p class="module__limit"><span class="label">Limit:</span> {e(m.limit)}</p>'
            "</li>"
        )
    return (
        '<section class="panel" aria-labelledby="roadmap-heading">'
        '<h2 id="roadmap-heading">Roadmap: all twelve modules</h2>'
        '<p class="panel__lede">Stage 1 is the first slice of the full roadmap, not a reduction of it. '
        "Each module states honestly what exists today and its guardrail.</p>"
        f'<ol class="module-grid">{"".join(items)}</ol>'
        "</section>"
    )


def render_command_center(batches: Sequence[contracts.BatchSummary], csrf_token: str) -> str:
    body = (
        '<div class="page-head">'
        '<p class="eyebrow">Synthetic invoice review</p>'
        "<h1>Financial Risk Command Center</h1>"
        '<p class="page-head__lede">Deterministic duplicate-candidate and total-mismatch checks '
        "over synthetic USD invoices, with human decisions and history. Ordering is transparent: "
        "open cases first, then rule, then record ID — no risk scores or savings claims.</p>"
        "</div>"
        f'<div class="layout-split">{_import_panel()}{_batches_panel(batches)}</div>'
        f"{_roadmap_panel()}"
    )
    return page(
        "Financial Risk Command Center",
        body,
        csrf_token=csrf_token,
        scripts=(UPLOAD_SCRIPT,),
        current="home",
    )
