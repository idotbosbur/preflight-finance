"""Synthetic batch summary (module 12 seed) and error page."""

from __future__ import annotations

from typing import Sequence

from preflight import contracts
from preflight.views import text
from preflight.views.batch import batch_meta
from preflight.views.layout import batch_url, breadcrumbs, e, page

LIMITATIONS = (
    "All figures are counts of findings on synthetic data. They are not savings, losses "
    "avoided, accuracy, precision or probability estimates.",
    "Only two deterministic rules run (duplicate candidate, total mismatch). Other kinds of "
    "error or fraud are not checked.",
    "Duplicate detection is within this batch only; a duplicate split across separate imports "
    "is not detected.",
    "Matching is exact after trimming and ASCII uppercasing. Near-miss invoice numbers "
    "(e.g. INV-01 vs INV-1) are deliberately treated as different.",
    "A confirmed finding is a reviewer judgement, not a verified fact; reviewer names are "
    "self-declared.",
    "Review history is application-level and can be altered by the local database owner.",
    "No accounting, bank or purchase-order system is connected, and no payment is approved, "
    "blocked or released.",
    "No AI model produced any part of this summary.",
)


def render_report(batch: contracts.BatchSummary, findings: Sequence[contracts.FindingView]) -> str:
    rules = [contracts.RULE_DUPLICATE, contracts.RULE_MISMATCH]
    for f in findings:
        if f.rule_id not in rules:
            rules.append(f.rule_id)
    counts = {(r, s): 0 for r in rules for s in contracts.STATES}
    affected = set()
    for f in findings:
        if (f.rule_id, f.state) in counts:
            counts[(f.rule_id, f.state)] += 1
        affected.update(f.member_ids)

    def row(label: str, values: Sequence[int], css: str = "") -> str:
        cells = "".join(f'<td class="num">{e(v)}</td>' for v in values)
        cls = f' class="{css}"' if css else ""
        return f'<tr{cls}><th scope="row">{e(label)}</th>{cells}<td class="num">{e(sum(values))}</td></tr>'

    body_rows = "".join(row(text.rule_label(r), [counts[(r, s)] for s in contracts.STATES]) for r in rules)
    totals = [sum(counts[(r, s)] for r in rules) for s in contracts.STATES]
    state_heads = "".join(
        f'<th scope="col" class="num">{e(s.capitalize())}</th>' for s in contracts.STATES
    )
    limits = "".join(f"<li>{e(item)}</li>" for item in LIMITATIONS)
    body = (
        breadcrumbs(
            [("Command Center", "/"), (batch.display_name, batch_url(batch.batch_id)), ("Summary", None)]
        )
        + '<div class="page-head">'
        '<p class="eyebrow">Module 12 seed · synthetic reporting</p>'
        "<h1>Synthetic batch summary</h1>"
        f'<p class="page-head__lede break">Counts of synthetic findings for {e(batch.display_name)}. '
        "Every number on this page describes invented data.</p>"
        "</div>"
        '<div class="layout-aside">'
        '<div class="stack">'
        '<section class="panel" aria-labelledby="counts-heading">'
        '<h2 id="counts-heading">Findings by rule and review state (synthetic)</h2>'
        '<div class="table-wrap" role="region" aria-labelledby="counts-caption" tabindex="0">'
        '<table class="data-table">'
        '<caption id="counts-caption">Synthetic finding counts by rule (rows) and review state (columns)</caption>'
        f'<thead><tr><th scope="col">Rule</th>{state_heads}<th scope="col" class="num">All</th></tr></thead>'
        f"<tbody>{body_rows}</tbody>"
        f"<tfoot>{row('All rules', totals, 'total-row')}</tfoot>"
        "</table></div>"
        '<ul class="stat-row" aria-label="Synthetic record counts">'
        f'<li class="stat"><span class="stat__value num">{e(batch.row_count)}</span>'
        '<span class="stat__label">synthetic data rows</span></li>'
        f'<li class="stat"><span class="stat__value num">{e(len(affected))}</span>'
        '<span class="stat__label">records in at least one finding</span></li>'
        "</ul>"
        "</section>"
        '<section class="panel" aria-labelledby="limits-heading">'
        '<h2 id="limits-heading">Limitations</h2>'
        f'<ul class="plain-list plain-list--caution">{limits}</ul>'
        "</section>"
        "</div>"
        '<aside class="panel panel--aside" aria-labelledby="report-meta-heading">'
        '<h2 id="report-meta-heading">Provenance</h2>'
        f"{batch_meta(batch)}"
        f'<p><a href="{e(batch_url(batch.batch_id))}">Back to cases</a></p>'
        "</aside>"
        "</div>"
    )
    return page(f"Synthetic batch summary {batch.display_name}", body)


def render_error(status: int, title: str, detail: str) -> str:
    body = (
        '<div class="page-head page-head--error">'
        f'<p class="eyebrow">Error {e(status)}</p>'
        f'<h1 class="break">{e(title)}</h1>'
        f'<p class="page-head__lede break">{e(detail)}</p>'
        '<p><a class="button" href="/">Return to the Command Center</a></p>'
        "</div>"
    )
    return page(f"{status} {title}", body)
