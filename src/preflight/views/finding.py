"""Investigation page for one finding: evidence, provenance, guidance, review, history."""

from __future__ import annotations

from typing import Any, List, Mapping, Optional, Sequence

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


def _get(mapping: Any, key: str, default: str = "—") -> str:
    if isinstance(mapping, Mapping) and mapping.get(key) is not None:
        return str(mapping.get(key))
    return default


def _members(evidence: Mapping[str, Any]) -> List[Mapping[str, Any]]:
    members = evidence.get("members") if isinstance(evidence, Mapping) else None
    if isinstance(members, (list, tuple)):
        return [m for m in members if isinstance(m, Mapping)]
    return []


def source_rows(finding: contracts.FindingView) -> List[str]:
    ev = finding.evidence if isinstance(finding.evidence, Mapping) else {}
    if finding.rule_id == contracts.RULE_DUPLICATE:
        return [_get(m, "row") for m in _members(ev)]
    if "row" in ev:
        return [_get(ev, "row")]
    return []


# ---- evidence ----


def _duplicate_evidence(ev: Mapping[str, Any]) -> str:
    key = ev.get("key") if isinstance(ev.get("key"), Mapping) else {}
    members = _members(ev)
    key_html = dl(
        [
            ("Normalized vendor ID", code(_get(key, "vendor"))),
            ("Normalized invoice number", code(_get(key, "invoice"))),
            ("Currency", code(_get(key, "currency"))),
        ],
        "keybox",
    )
    rows = "".join(
        "<tr>"
        f'<th scope="row">{code(_get(m, "record_id"))}</th>'
        f'<td class="num">{e(_get(m, "row"))}</td>'
        f'<td>{code(_get(m, "raw_vendor", ""), "raw")}</td>'
        f'<td>{code(_get(m, "raw_invoice", ""), "raw")}</td>'
        f'<td class="num">{e(_get(m, "invoice_date"))}</td>'
        f'<td class="num amount">{e(_get(m, "total"))}</td>'
        "</tr>"
        for m in members
    )
    observations = []
    totals = sorted({_get(m, "total") for m in members})
    dates = sorted({_get(m, "invoice_date") for m in members})
    raws = {(_get(m, "raw_vendor", ""), _get(m, "raw_invoice", "")) for m in members}
    if members:
        observations.append(
            f"Declared totals are identical ({totals[0]})."
            if len(totals) == 1
            else f"Declared totals differ: {', '.join(totals)}."
        )
        observations.append(
            f"Invoice dates are identical ({dates[0]})."
            if len(dates) == 1
            else f"Invoice dates differ: {', '.join(dates)}."
        )
        if len(raws) > 1:
            observations.append(
                "Raw vendor or invoice text differs only by case or outer whitespace; "
                "normalization made the keys equal."
            )
    obs_html = "".join(f"<li>{e(o)}</li>" for o in observations)
    return (
        "<h3>Matching key</h3>"
        '<p class="hint">Outer ASCII whitespace trimmed and ASCII letters uppercased. '
        "Punctuation and leading zeros are preserved; no fuzzy matching.</p>"
        f"{key_html}"
        f"<h3>Member records ({e(len(members))})</h3>"
        '<div class="table-wrap" role="region" aria-labelledby="members-caption" tabindex="0">'
        '<table class="data-table">'
        '<caption id="members-caption">Raw source values for each record sharing the key</caption>'
        "<thead><tr>"
        '<th scope="col">Record ID</th><th scope="col" class="num">Source row</th>'
        '<th scope="col">Raw vendor</th><th scope="col">Raw invoice number</th>'
        '<th scope="col" class="num">Invoice date</th><th scope="col" class="num">Total (USD)</th>'
        f"</tr></thead><tbody>{rows}</tbody></table></div>"
        + (f'<h3>Observations</h3><ul class="plain-list">{obs_html}</ul>' if obs_html else "")
    )


def _mismatch_evidence(ev: Mapping[str, Any]) -> str:
    sub, tax, ship, disc = (_get(ev, k) for k in ("subtotal", "tax", "shipping", "discount"))
    expected, declared, delta = _get(ev, "expected"), _get(ev, "declared"), _get(ev, "delta")
    formula = f"{sub} + {tax} + {ship} − {disc} = {expected}"
    delta_css = "pos" if delta.startswith("+") else "neg" if delta.startswith("-") else "zero"
    return (
        dl(
            [
                ("Record ID", code(_get(ev, "record_id"))),
                ("Source row", f'<span class="num">{e(_get(ev, "row"))}</span>'),
            ]
        )
        + '<p class="formula" aria-label="Expected total calculation">'
        f'<code class="num">{e(formula)}</code></p>'
        '<div class="table-wrap" role="region" aria-labelledby="calc-caption" tabindex="0">'
        '<table class="data-table calc-table">'
        '<caption id="calc-caption">Expected total, computed exactly in integer cents (USD)</caption>'
        '<thead><tr><th scope="col">Operation</th><th scope="col">Component</th>'
        '<th scope="col" class="num">Amount</th></tr></thead><tbody>'
        f'<tr><td class="op"></td><th scope="row">Subtotal</th><td class="num amount">{e(sub)}</td></tr>'
        f'<tr><td class="op">+</td><th scope="row">Tax</th><td class="num amount">{e(tax)}</td></tr>'
        f'<tr><td class="op">+</td><th scope="row">Shipping</th><td class="num amount">{e(ship)}</td></tr>'
        f'<tr><td class="op">−</td><th scope="row">Discount</th><td class="num amount">{e(disc)}</td></tr>'
        f'<tr class="calc-total"><td class="op">=</td><th scope="row">Expected total</th>'
        f'<td class="num amount">{e(expected)}</td></tr>'
        f'<tr><td class="op"></td><th scope="row">Declared total</th><td class="num amount">{e(declared)}</td></tr>'
        f'<tr class="calc-delta calc-delta--{delta_css}"><td class="op">Δ</td>'
        f'<th scope="row">Delta (declared − expected)</th>'
        f'<td class="num amount">{e(delta)}</td></tr>'
        "</tbody></table></div>"
        f'<p class="hint">{e(text.delta_explanation(delta))}</p>'
        '<p class="hint">These are the supplied amount components; the tool does not judge '
        "whether a tax rate or discount is contractually or legally correct.</p>"
    )


def _evidence(finding: contracts.FindingView) -> str:
    ev = finding.evidence if isinstance(finding.evidence, Mapping) else {}
    if finding.rule_id == contracts.RULE_DUPLICATE:
        inner = _duplicate_evidence(ev)
    elif finding.rule_id == contracts.RULE_MISMATCH:
        inner = _mismatch_evidence(ev)
    else:
        items = "".join(
            f'<div class="meta__row"><dt>{e(k)}</dt><dd>{code(v)}</dd></div>' for k, v in ev.items()
        )
        inner = f'<dl class="meta">{items}</dl>'
    return (
        '<section class="panel" aria-labelledby="evidence-heading">'
        '<h2 id="evidence-heading">Evidence</h2>'
        f'<p class="panel__lede">{e(text.RULE_DESCRIPTIONS.get(finding.rule_id, ""))}</p>'
        f"{inner}</section>"
    )


def _provenance(batch: contracts.BatchSummary, finding: contracts.FindingView) -> str:
    rows = source_rows(finding)
    return (
        '<section class="panel panel--aside" aria-labelledby="prov-heading">'
        '<h2 id="prov-heading">Provenance</h2>'
        + dl(
            [
                ("Batch", f'<a href="{e(batch_url(batch.batch_id))}">{e(batch.display_name)}</a>'),
                ("File SHA-256", code(batch.sha256, "hash")),
                ("Imported (UTC)", utc_time(batch.imported_at_utc)),
                ("Ruleset", code(batch.ruleset)),
                ("Rule", f"{code(finding.rule_id)} {code(finding.rule_version)}"),
                ("Finding ID", code(finding.finding_id, "hash")),
                ("Source rows", e(", ".join(rows)) if rows else "—"),
            ]
        )
        + '<p class="hint">Source rows are 1-based data rows; the header row is not counted.</p>'
        "</section>"
    )


def _meaning(finding: contracts.FindingView) -> str:
    means = "".join(f"<li>{e(s)}</li>" for s in text.MEANS)
    not_means = "".join(f"<li>{e(s)}</li>" for s in text.DOES_NOT_MEAN)
    steps = "".join(f"<li>{e(s)}</li>" for s in text.STEPS.get(finding.rule_id, text.GENERIC_STEPS))
    return (
        '<section class="panel" aria-labelledby="meaning-heading">'
        '<h2 id="meaning-heading">How to read this finding</h2>'
        '<div class="two-col">'
        '<div><h3>What this means</h3>'
        f'<ul class="plain-list">{means}</ul></div>'
        '<div><h3>What this does not mean</h3>'
        f'<ul class="plain-list plain-list--caution">{not_means}</ul></div>'
        "</div>"
        "<h3>Recommended review steps</h3>"
        f'<ol class="steps">{steps}</ol>'
        '<p class="hint">Deterministic guidance templates for this rule; no AI model is used.</p>'
        "</section>"
    )


def _banners(
    finding: contracts.FindingView, notice: Optional[str], error: Optional[str], conflict: bool
) -> str:
    out = []
    if notice:
        out.append(
            f'<div class="callout callout--ok" role="status"><p>{e(notice)}</p></div>'
        )
    if conflict:
        out.append(
            '<div class="callout callout--warn" role="alert">'
            "<p><strong>This finding changed in another tab or window.</strong> "
            "Your decision was not saved. The latest state is "
            f"{state_badge(finding.state)}. Re-read the evidence and history below, "
            "then submit again if your decision still applies.</p></div>"
        )
    if error:
        out.append(
            '<div class="callout callout--error" role="alert" id="review-error">'
            f"<p><strong>Decision not saved.</strong> {e(error)}</p></div>"
        )
    return "".join(out)


def _review_form(
    finding: contracts.FindingView,
    csrf_token: str,
    error: Optional[str],
    form_values: Optional[Mapping[str, str]],
) -> str:
    values = form_values or {}
    reviewer = values.get("reviewer", "")
    reason = values.get("reason", "")
    actions = text.allowed_actions(finding.state)
    action_url = finding_url(finding.batch_id, finding.finding_id) + "/review"
    invalid = ' aria-invalid="true"' if error else ""
    err_ref = " review-error" if error else ""
    buttons = "".join(
        f'<button type="submit" name="action" value="{e(a)}" '
        f'class="button button--{e(a)}">{e(text.ACTION_LABELS.get(a, a))}</button>'
        for a in actions
    )
    if not buttons:
        buttons = '<p class="hint">No review actions are available from this state.</p>'
    return (
        '<section class="panel panel--review" aria-labelledby="review-heading">'
        '<h2 id="review-heading">Record a decision</h2>'
        f'<p>Current state: {state_badge(finding.state)} '
        f'<span class="muted">· {e(finding.seq)} decision(s) recorded</span></p>'
        f'<form method="post" action="{e(action_url)}" class="review-form">'
        f'<input type="hidden" name="csrf" value="{e(csrf_token)}">'
        f'<input type="hidden" name="expected_seq" value="{e(finding.seq)}">'
        '<div class="field">'
        '<label for="reviewer">Your name or initials (self-declared)</label>'
        f'<input type="text" id="reviewer" name="reviewer" required maxlength="{e(contracts.REVIEWER_MAX)}" '
        f'autocomplete="name" aria-describedby="reviewer-hint{err_ref}"{invalid} value="{e(reviewer)}">'
        f'<p id="reviewer-hint" class="hint">1–{e(contracts.REVIEWER_MAX)} characters. '
        "Attribution only; not a verified identity.</p>"
        "</div>"
        '<div class="field">'
        '<label for="reason">Reason</label>'
        f'<textarea id="reason" name="reason" required maxlength="{e(contracts.REASON_MAX)}" rows="4" '
        f'aria-describedby="reason-hint{err_ref}"{invalid}>{e(reason)}</textarea>'
        f'<p id="reason-hint" class="hint">1–{e(contracts.REASON_MAX)} characters. '
        "State what you checked and what you concluded.</p>"
        "</div>"
        f'<div class="actions">{buttons}</div>'
        '<p class="hint">Confirming means you judge the finding to be a real issue that needs '
        "follow-up. It never approves, blocks or releases a payment.</p>"
        "</form></section>"
    )


def _history(events: Sequence[contracts.ReviewEventView]) -> str:
    if events:
        items = "".join(
            '<li class="event">'
            '<div class="event__head">'
            f'<span class="event__seq num">#{e(ev.seq)}</span>'
            f'<span class="event__action">{e(text.ACTION_PAST.get(ev.action, ev.action))}</span>'
            f'<span class="event__transition">{state_badge(ev.prev_state)}'
            '<span class="arrow" aria-hidden="true">→</span>'
            '<span class="visually-hidden"> to </span>'
            f"{state_badge(ev.next_state)}</span>"
            "</div>"
            '<p class="event__meta">'
            f'<span class="label">By</span> <span class="break">{e(ev.reviewer)}</span> '
            f'<span class="label">at</span> {utc_time(ev.at_utc)} UTC</p>'
            f'<blockquote class="event__reason break">{e(ev.reason)}</blockquote>'
            "</li>"
            for ev in events
        )
        body = f'<ol class="timeline">{items}</ol>'
    else:
        body = '<p class="muted">No review decisions yet. This finding is in its initial state.</p>'
    return (
        '<section class="panel" aria-labelledby="history-heading">'
        '<h2 id="history-heading">Review history</h2>'
        f"{body}"
        f'<p class="hint">{e(text.HISTORY_NOTE)}</p>'
        "</section>"
    )


def render_finding(
    batch: contracts.BatchSummary,
    finding: contracts.FindingView,
    events: Sequence[contracts.ReviewEventView],
    csrf_token: str,
    *,
    notice: Optional[str] = None,
    error: Optional[str] = None,
    conflict: bool = False,
    form_values: Optional[Mapping[str, str]] = None,
) -> str:
    label = text.rule_label(finding.rule_id)
    summary = text.summary(finding.rule_id, finding.evidence, finding.member_ids)
    members = "".join(f"<li>{code(m)}</li>" for m in finding.member_ids)
    body = (
        breadcrumbs(
            [
                ("Command Center", "/"),
                (batch.display_name, batch_url(batch.batch_id)),
                (f"{label} {finding.finding_id}", None),
            ]
        )
        + _banners(finding, notice, error, conflict)
        + '<div class="page-head">'
        f'<p class="eyebrow">{e(label)} · synthetic case</p>'
        f'<h1 class="break">{e(summary)}</h1>'
        f'<div class="case__head">{state_badge(finding.state)}'
        '<span class="label">Records:</span>'
        f'<ul class="inline-list">{members}</ul></div>'
        "</div>"
        '<div class="layout-aside">'
        f'<div class="stack">{_evidence(finding)}{_meaning(finding)}</div>'
        f'<div class="stack">{_provenance(batch, finding)}</div>'
        "</div>"
        f'<div class="layout-split layout-split--even">{_review_form(finding, csrf_token, error, form_values)}'
        f"{_history(events)}</div>"
    )
    return page(f"{label} {finding.finding_id}", body, csrf_token=csrf_token)
