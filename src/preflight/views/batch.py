"""Batch page: metadata plus prioritized cases."""

from __future__ import annotations

from typing import Optional, Sequence

from preflight import contracts
from preflight.views import text
from preflight.views.layout import (
    batch_url,
    breadcrumbs,
    code,
    dl,
    e,
    finding_url,
    page,
    state_badge,
    utc_time,
)


def batch_meta(batch: contracts.BatchSummary) -> str:
    return dl(
        [
            ("Display name", e(batch.display_name)),
            ("File SHA-256", code(batch.sha256, "hash")),
            ("Imported (UTC)", utc_time(batch.imported_at_utc)),
            ("Ruleset", code(batch.ruleset)),
            ("Data rows", f'<span class="num">{e(batch.row_count)}</span>'),
            ("Batch ID", code(batch.batch_id, "hash")),
        ]
    )


def _filter_nav(batch: contracts.BatchSummary, active: Optional[str]) -> str:
    base = batch_url(batch.batch_id)
    options = [
        (None, "All", batch.finding_count),
        (contracts.STATE_OPEN, "Open", batch.open_count),
        (contracts.STATE_CONFIRMED, "Confirmed", batch.confirmed_count),
        (contracts.STATE_DISMISSED, "Dismissed", batch.dismissed_count),
    ]
    links = []
    for state, label, count in options:
        href = base if state is None else f"{base}?state={state}"
        current = ' aria-current="page"' if state == active else ""
        links.append(
            f'<li><a class="filter{" filter--active" if state == active else ""}" '
            f'href="{e(href)}"{current}>{e(label)} '
            f'<span class="filter__count num">{e(count)}</span></a></li>'
        )
    return f'<nav class="filters" aria-label="Filter cases by state"><ul>{"".join(links)}</ul></nav>'


def _case(f: contracts.FindingView, position: int) -> str:
    rule_css = "dup" if f.rule_id == contracts.RULE_DUPLICATE else "mis"
    members = "".join(f"<li>{code(m)}</li>" for m in f.member_ids)
    return (
        f'<li class="case case--{e(f.state)}">'
        f'<div class="case__rank num" aria-hidden="true">{e(position)}</div>'
        '<div class="case__body">'
        '<div class="case__head">'
        f'<span class="rule-tag rule-tag--{rule_css}">{e(text.rule_label(f.rule_id))}</span>'
        f"{state_badge(f.state)}"
        "</div>"
        f'<h3 class="case__title"><a href="{e(finding_url(f.batch_id, f.finding_id))}">'
        f"{e(text.summary(f.rule_id, f.evidence, f.member_ids))}</a></h3>"
        '<div class="case__members"><span class="label">Records:</span>'
        f'<ul class="inline-list">{members}</ul></div>'
        "</div>"
        "</li>"
    )


def render_batch(
    batch: contracts.BatchSummary,
    findings: Sequence[contracts.FindingView],
    state_filter: Optional[str],
) -> str:
    active = state_filter if state_filter in contracts.STATES else None
    shown = [f for f in findings if active is None or f.state == active]
    if shown:
        cases = f'<ol class="case-list">{"".join(_case(f, i) for i, f in enumerate(shown, 1))}</ol>'
    elif active is None:
        cases = (
            '<div class="empty-state"><p class="empty-state__title">No findings in this batch.</p>'
            "<p>No duplicate candidates or total mismatches were found by ruleset "
            f"{code(batch.ruleset)}. This is not a guarantee the source invoices are correct.</p></div>"
        )
    else:
        cases = (
            '<div class="empty-state">'
            f'<p class="empty-state__title">No {e(text.text_state(active))} cases.</p>'
            f'<p><a href="{e(batch_url(batch.batch_id))}">Show all cases</a></p></div>'
        )
    heading_suffix = "" if active is None else f" — {text.text_state(active)}"
    body = (
        breadcrumbs([("Command Center", "/"), (batch.display_name, None)])
        + '<div class="page-head">'
        '<p class="eyebrow">Synthetic batch</p>'
        f'<h1 class="break">{e(batch.display_name)}</h1>'
        '<ul class="stat-row" aria-label="Batch counts">'
        f'<li class="stat"><span class="stat__value num">{e(batch.finding_count)}</span>'
        '<span class="stat__label">findings</span></li>'
        f'<li class="stat"><span class="stat__value num">{e(batch.duplicate_count)}</span>'
        '<span class="stat__label">duplicate candidates</span></li>'
        f'<li class="stat"><span class="stat__value num">{e(batch.mismatch_count)}</span>'
        '<span class="stat__label">total mismatches</span></li>'
        f'<li class="stat stat--attention"><span class="stat__value num">{e(batch.open_count)}</span>'
        '<span class="stat__label">open</span></li>'
        "</ul></div>"
        '<div class="layout-aside">'
        '<section class="panel" aria-labelledby="cases-heading">'
        f'<h2 id="cases-heading">Prioritized cases{e(heading_suffix)}</h2>'
        f'<p class="panel__lede">{e(text.ORDERING_NOTE)}</p>'
        f"{_filter_nav(batch, active)}"
        f"{cases}"
        "</section>"
        '<aside class="panel panel--aside" aria-labelledby="batch-meta-heading">'
        '<h2 id="batch-meta-heading">Batch provenance</h2>'
        f"{batch_meta(batch)}"
        f'<p><a class="button" href="{e(batch_url(batch.batch_id))}/report">'
        "View synthetic batch summary</a></p>"
        "</aside>"
        "</div>"
    )
    return page(f"Batch {batch.display_name}", body)
