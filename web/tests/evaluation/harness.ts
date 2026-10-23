/**
 * Independent evaluator harness for the browser port (Preflight-Web-Fixture-Evaluator).
 *
 * System under test: `parseInvoiceCsv` (src/domain/csv.ts) and `runInvoiceRules` (src/domain/rules.ts),
 * loaded dynamically so this harness reports "system under test unavailable" instead of crashing.
 *
 * Two separate sources of expectations, never mixed:
 *  - TRUTH: fixtures/manifest/invoice-fixtures-v1.json (independent synthetic labels).
 *  - PARITY: tests/fixtures/reference-parity/expected.json ("python-reference-parity"), the
 *    observed output of the Python reference, captured by capture_reference.py.
 * Detector output is never used to create or adjust either.
 *
 * Every comparison takes the detector as a parameter so a deliberately broken detector can be
 * injected (see defective-detector.test.ts).
 */
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type {
  CandidateFinding,
  Invoice,
  ParseInvoiceCsv,
  RunInvoiceRules,
  ValidationResult,
} from "../../src/domain/contracts.ts";
import { RULESET_VERSION, RULE_DUPLICATE, RULE_MISMATCH } from "../../src/domain/contracts.ts";
import { finalizeBatch } from "../../src/domain/ids.ts";

// ---------------------------------------------------------------------------
// Paths and loading
// ---------------------------------------------------------------------------

export const WEB_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const PROJECT_ROOT = resolve(WEB_ROOT, "..");
export const MANIFEST_REL = "fixtures/manifest/invoice-fixtures-v1.json";
export const PARITY_DIR = join(WEB_ROOT, "tests", "fixtures", "reference-parity");

export function projectPath(rel: string): string {
  return join(PROJECT_ROOT, ...rel.split("/"));
}
export function readProjectBytes(rel: string): Uint8Array {
  return new Uint8Array(readFileSync(projectPath(rel)));
}
export function sha256Node(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export interface ManifestIssue {
  readonly check: readonly ("code" | "row" | "field")[];
  readonly code: string;
  readonly row: number | null;
  readonly field: string | null;
}
export interface ManifestExpected {
  readonly accepted: boolean;
  readonly invoice_count: number;
  readonly issue_count: number;
  readonly issues: readonly ManifestIssue[];
  readonly duplicate_groups?: readonly (readonly string[])[];
  readonly mismatches?: readonly { readonly record_id: string; readonly delta: string }[];
  readonly note?: string;
}
export interface ManifestFile {
  readonly bytes: number;
  readonly kind: string;
  readonly sha256: string;
  readonly expected: ManifestExpected;
}
export interface ManifestRow {
  readonly record_id: string;
  readonly row_number: number;
  readonly obligation_id: string;
  readonly intended_key: { readonly vendor: string; readonly invoice: string; readonly currency: string };
  readonly invoice_date: string;
  readonly subtotal: string;
  readonly tax: string;
  readonly shipping: string;
  readonly discount: string;
  readonly expected_total: string;
  readonly declared_total: string;
}
export interface ManifestGroup {
  readonly group_id: string;
  readonly genuine: boolean;
  readonly key: { readonly vendor: string; readonly invoice: string; readonly currency: string };
  readonly members: readonly string[];
}
export interface ManifestPair {
  readonly pair_id: string;
  readonly members: readonly string[];
  readonly type: string;
}
export interface Manifest {
  readonly version: string;
  readonly seed: number;
  readonly files: Readonly<Record<string, ManifestFile>>;
  readonly main: {
    readonly file: string;
    readonly rows: readonly ManifestRow[];
    readonly duplicate_groups: readonly ManifestGroup[];
    readonly designated_negative_pairs: readonly ManifestPair[];
    readonly hard_negative_pairs: readonly ManifestPair[];
    readonly mismatches: readonly { readonly record_id: string; readonly delta: string }[];
    readonly planned_targets: Readonly<Record<string, number | string>>;
  };
}

export function loadManifest(): { manifest: Manifest; sha256: string } {
  const bytes = readProjectBytes(MANIFEST_REL);
  return { manifest: JSON.parse(new TextDecoder().decode(bytes)) as Manifest, sha256: sha256Node(bytes) };
}

export interface PyIssue { readonly code: string; readonly row: number | null; readonly field: string | null }
export interface PyInvoice {
  readonly record_id: string; readonly row_number: number; readonly raw: readonly string[];
  readonly vendor_norm: string; readonly invoice_norm: string; readonly invoice_date: string; readonly currency: string;
  readonly subtotal_c: number; readonly tax_c: number; readonly shipping_c: number; readonly discount_c: number;
  readonly total_c: number;
}
export interface PyFinding {
  readonly rule_id: string; readonly rule_version: string; readonly member_ids: readonly string[];
  readonly finding_id: string; readonly evidence: Readonly<Record<string, unknown>>;
}
export interface PyCase {
  readonly sha256: string; readonly bytes: number; readonly batch_id: string; readonly ok: boolean;
  readonly issue_count: number; readonly issues: readonly PyIssue[]; readonly accepted_invoice_count: number;
  readonly invoices: readonly PyInvoice[]; readonly findings: readonly PyFinding[];
}
export interface ParityDoc {
  readonly source: "python-reference-parity";
  readonly ruleset: string;
  readonly manifest_sha256: string;
  readonly cases: Readonly<Record<string, PyCase>>;
  readonly demo: Readonly<Record<string, PyCase>>;
  readonly manifest_fixtures: Readonly<Record<string, PyCase>>;
}
export function loadParity(): ParityDoc {
  return JSON.parse(readFileSync(join(PARITY_DIR, "expected.json"), "utf-8")) as ParityDoc;
}
export function readParityFile(name: string): Uint8Array {
  return new Uint8Array(readFileSync(join(PARITY_DIR, "files", name)));
}

// ---------------------------------------------------------------------------
// System under test
// ---------------------------------------------------------------------------

export interface Detector {
  readonly parse: ParseInvoiceCsv;
  readonly rules: RunInvoiceRules;
}
export type SutLoad = { readonly ok: true; readonly detector: Detector } | { readonly ok: false; readonly reason: string };

/** Dynamic import by URL so a missing module is reported, not a crash (and not a typecheck error). */
export async function loadSut(): Promise<SutLoad> {
  const problems: string[] = [];
  let parse: unknown;
  let rules: unknown;
  for (const [file, name] of [["csv.ts", "parseInvoiceCsv"], ["rules.ts", "runInvoiceRules"]] as const) {
    const url = pathToFileURL(join(WEB_ROOT, "src", "domain", file)).href;
    try {
      const mod = (await import(url)) as Record<string, unknown>;
      if (typeof mod[name] !== "function") problems.push(`src/domain/${file} does not export function ${name}`);
      else if (name === "parseInvoiceCsv") parse = mod[name];
      else rules = mod[name];
    } catch (err) {
      problems.push(`src/domain/${file}: ${(err as Error).message.split("\n")[0]}`);
    }
  }
  if (problems.length) return { ok: false, reason: `system under test unavailable: ${problems.join("; ")}` };
  return { ok: true, detector: { parse: parse as ParseInvoiceCsv, rules: rules as RunInvoiceRules } };
}

// ---------------------------------------------------------------------------
// Check bookkeeping
// ---------------------------------------------------------------------------

export interface Check { readonly id: string; readonly passed: boolean; readonly detail?: unknown }
export class Checks {
  readonly list: Check[] = [];
  add(id: string, passed: boolean, detail?: unknown): boolean {
    this.list.push(detail === undefined ? { id, passed } : { id, passed, detail });
    return passed;
  }
  get failures(): Check[] { return this.list.filter((c) => !c.passed); }
  get passed(): number { return this.list.length - this.failures.length; }
}

function attempt<T>(fn: () => T): { value: T; error: null } | { value: null; error: string } {
  try {
    return { value: fn(), error: null };
  } catch (err) {
    return { value: null, error: (err as Error)?.stack?.split("\n").slice(0, 4).join(" | ") ?? String(err) };
  }
}

/** Independent decimal-string -> cents (labels only; never used on SUT input). */
function labelCents(text: string): number {
  const m = /^(-?)([0-9]+)\.([0-9]{2})$/.exec(text);
  if (!m) throw new Error(`bad label amount ${text}`);
  return (m[1] === "-" ? -1 : 1) * (Number(m[2]) * 100 + Number(m[3]));
}

function cmpStr(a: string, b: string): number { return a < b ? -1 : a > b ? 1 : 0; }
/** Independent Python-tuple order for (rule_id, member_ids). */
function cmpRuleMembers(a: CandidateFinding, b: CandidateFinding): number {
  const r = cmpStr(a.ruleId, b.ruleId);
  if (r) return r;
  const n = Math.min(a.memberIds.length, b.memberIds.length);
  for (let i = 0; i < n; i++) {
    const c = cmpStr(a.memberIds[i]!, b.memberIds[i]!);
    if (c) return c;
  }
  return a.memberIds.length - b.memberIds.length;
}

const groupKey = (ids: readonly string[]): string => [...ids].sort(cmpStr).join("\u0000");

function deltaOf(f: CandidateFinding): string | null {
  const ev = f.evidence as unknown as Record<string, unknown>;
  return typeof ev?.delta === "string" ? ev.delta : null;
}

// ---------------------------------------------------------------------------
// TRUTH: manifest-based evaluation
// ---------------------------------------------------------------------------

export interface MainMetrics {
  duplicate: {
    groupsExpected: number; groupsFlagged: number; groupsExact: number; genuineGroups: number;
    legitimateReuseGroups: number; pairTP: number; pairFP: number; pairFN: number; pairTN: number; pairTotal: number;
  };
  hardNegatives: { pairs: number; falseAlerts: number; nearDuplicateFalseAlerts: number; alertedPairIds: string[] };
  mismatch: { tp: number; fp: number; fn: number; tn: number; exactDeltas: number };
  findings: number;
  affectedRows: number;
  unmatched: {
    groupsMissing: string[][]; groupsExtra: string[][]; mismatchMissing: string[]; mismatchExtra: string[];
    deltaDiffers: Record<string, { expected: string; got: string | null }>;
  };
}

export interface EvalOptions {
  /** Re-run the detector on the main file with data rows reversed (needs a real parser). */
  readonly rowOrderCheck?: boolean;
}

export function evaluateMain(
  det: Detector, manifest: Manifest, checks: Checks, opts: EvalOptions = {},
): MainMetrics | null {
  const main = manifest.main;
  const rel = main.file;
  const meta = manifest.files[rel]!;
  const labels = main.rows;
  const pt = main.planned_targets as Record<string, number>;
  const bytes = readProjectBytes(rel);
  checks.add(`${rel}: fixture hash matches manifest`, sha256Node(bytes) === meta.sha256);
  const parsed = attempt(() => det.parse(bytes));
  if (!checks.add(`${rel}: parseInvoiceCsv did not throw`, parsed.error === null, parsed.error ?? undefined)) return null;
  const res = parsed.value!;
  if (!checks.add(`${rel}: accepted, ${labels.length} invoices, no issues`,
    res.ok === true && res.invoices.length === labels.length && res.issues.length === 0 && res.issueCount === 0,
    { ok: res.ok, invoices: res.invoices.length, issues: res.issues.slice(0, 20) })) return null;

  const byId = new Map(res.invoices.map((i) => [i.recordId, i] as const));
  const bad: string[] = [];
  for (const lab of labels) {
    const i = byId.get(lab.record_id);
    const k = lab.intended_key;
    const expTotal = i ? i.subtotal + i.tax + i.shipping - i.discount : NaN;
    if (!i || i.rowNumber !== lab.row_number || i.vendorNorm !== k.vendor || i.invoiceNorm !== k.invoice
      || i.currency !== k.currency || i.invoiceDate !== lab.invoice_date
      || i.subtotal !== labelCents(lab.subtotal) || i.tax !== labelCents(lab.tax)
      || i.shipping !== labelCents(lab.shipping) || i.discount !== labelCents(lab.discount)
      || i.total !== labelCents(lab.declared_total) || expTotal !== labelCents(lab.expected_total)) {
      bad.push(lab.record_id);
    }
  }
  checks.add(`${rel}: parsed invoices match labels (row, normalized key, date, every amount in cents)`, bad.length === 0, bad.slice(0, 20));

  const ran = attempt(() => [...det.rules(res.invoices)]);
  if (!checks.add(`${rel}: runInvoiceRules did not throw`, ran.error === null, ran.error ?? undefined)) return null;
  const findings = ran.value!;
  const dupF = findings.filter((f) => f.ruleId === RULE_DUPLICATE);
  const mmF = findings.filter((f) => f.ruleId === RULE_MISMATCH);
  const other = findings.filter((f) => f.ruleId !== RULE_DUPLICATE && f.ruleId !== RULE_MISMATCH).map((f) => f.ruleId);
  checks.add(`${rel}: no unknown rule ids`, other.length === 0, other);
  checks.add(`${rel}: every finding ruleVersion == ${RULESET_VERSION}`, findings.every((f) => f.ruleVersion === RULESET_VERSION));
  checks.add(`${rel}: memberIds sorted ascending (code units)`,
    findings.every((f) => f.memberIds.every((m, j) => j === 0 || cmpStr(f.memberIds[j - 1]!, m) < 0)));
  checks.add(`${rel}: findings sorted by (ruleId, memberIds) tuple order`,
    findings.every((f, j) => j === 0 || cmpRuleMembers(findings[j - 1]!, f) < 0));

  // Duplicate conformance (exact membership).
  const expGroups = new Map(main.duplicate_groups.map((g) => [groupKey(g.members), g] as const));
  const gotCounts = new Map<string, number>();
  for (const f of dupF) gotCounts.set(groupKey(f.memberIds), (gotCounts.get(groupKey(f.memberIds)) ?? 0) + 1);
  const matched = [...gotCounts.keys()].filter((k) => expGroups.has(k));
  const missing = [...expGroups.keys()].filter((k) => !gotCounts.has(k)).map((k) => k.split("\u0000"));
  const extra = [...gotCounts.keys()].filter((k) => !expGroups.has(k)).map((k) => k.split("\u0000"));
  const repeated = [...gotCounts.entries()].filter(([, n]) => n > 1).map(([k]) => k.split("\u0000"));
  checks.add(`${rel}: duplicate groups exact (${expGroups.size} expected, exact membership)`,
    missing.length === 0 && extra.length === 0 && repeated.length === 0 && dupF.length === expGroups.size,
    { missing, extra, repeated });
  const genuineGroups = matched.filter((k) => expGroups.get(k)!.genuine).length;
  const reuseGroups = matched.filter((k) => !expGroups.get(k)!.genuine).length;
  checks.add(`${rel}: flagged groups split ${main.duplicate_groups.filter((g) => g.genuine).length} genuine + `
    + `${main.duplicate_groups.filter((g) => !g.genuine).length} legitimate reuse`,
  genuineGroups === main.duplicate_groups.filter((g) => g.genuine).length
    && reuseGroups === main.duplicate_groups.filter((g) => !g.genuine).length, { genuineGroups, reuseGroups });
  const evBad: string[] = [];
  for (const f of dupF) {
    const g = expGroups.get(groupKey(f.memberIds));
    if (!g) continue;
    const ev = f.evidence;
    if (ev.kind !== RULE_DUPLICATE || ev.key.vendor !== g.key.vendor || ev.key.invoice !== g.key.invoice
      || ev.key.currency !== g.key.currency || ev.members.map((m) => m.recordId).join(",") !== g.members.join(",")) {
      evBad.push(g.group_id);
    }
  }
  checks.add(`${rel}: duplicate evidence key/members match labels`, evBad.length === 0, evBad);

  // Semantic pairs over all unordered pairs.
  const obl = new Map(labels.map((l) => [l.record_id, l.obligation_id] as const));
  const pred = new Set<string>();
  for (const f of dupF) {
    const m = [...f.memberIds].sort(cmpStr);
    for (let a = 0; a < m.length; a++) for (let b = a + 1; b < m.length; b++) pred.add(`${m[a]}|${m[b]}`);
  }
  const ids = [...obl.keys()].sort(cmpStr);
  let tp = 0, fp = 0, fn = 0, tn = 0;
  for (let a = 0; a < ids.length; a++) {
    for (let b = a + 1; b < ids.length; b++) {
      const pos = obl.get(ids[a]!) === obl.get(ids[b]!);
      const p = pred.has(`${ids[a]}|${ids[b]}`);
      if (pos && p) tp++; else if (p) fp++; else if (pos) fn++; else tn++;
    }
  }
  checks.add(`${rel}: semantic pair counts TP/FP/FN/TN == planned ${pt.pair_TP}/${pt.pair_FP}/${pt.pair_FN}/${pt.pair_TN} over ${pt.pairs_total}`,
    tp === pt.pair_TP && fp === pt.pair_FP && fn === pt.pair_FN && tn === pt.pair_TN && tp + fp + fn + tn === pt.pairs_total,
    { measured: [tp, fp, fn, tn] });
  const pairKey = (p: ManifestPair) => [...p.members].sort(cmpStr).join("|");
  const alerted = main.designated_negative_pairs.filter((p) => pred.has(pairKey(p))).map((p) => p.pair_id);
  const nearAlerts = main.hard_negative_pairs.filter((p) => pred.has(pairKey(p))).map((p) => p.pair_id);
  checks.add(`${rel}: hard negatives: ${pt.hard_negative_false_alerts}/${pt.designated_negative_pairs} false alerts, none among the ${main.hard_negative_pairs.length} near-duplicates`,
    main.designated_negative_pairs.length === pt.designated_negative_pairs
      && alerted.length === pt.hard_negative_false_alerts && nearAlerts.length === 0, { alerted, nearAlerts });

  // Mismatches.
  const expMm = new Map(main.mismatches.map((m) => [m.record_id, m.delta] as const));
  const gotMm = new Map<string, string | null>();
  const multi: string[][] = [];
  for (const f of mmF) {
    if (f.memberIds.length !== 1) { multi.push([...f.memberIds]); continue; }
    gotMm.set(f.memberIds[0]!, deltaOf(f));
  }
  const all = labels.map((l) => l.record_id);
  const mtp = all.filter((r) => expMm.has(r) && gotMm.has(r)).length;
  const mfp = all.filter((r) => !expMm.has(r) && gotMm.has(r)).length;
  const mfn = all.filter((r) => expMm.has(r) && !gotMm.has(r)).length;
  const mtn = all.length - mtp - mfp - mfn;
  const deltaDiffers: Record<string, { expected: string; got: string | null }> = {};
  for (const [r, d] of expMm) if (gotMm.has(r) && gotMm.get(r) !== d) deltaDiffers[r] = { expected: d, got: gotMm.get(r) ?? null };
  const unknownMm = [...gotMm.keys()].filter((r) => !obl.has(r));
  checks.add(`${rel}: mismatch confusion TP/FP/FN/TN == planned ${pt.mismatch_TP}/${pt.mismatch_FP}/${pt.mismatch_FN}/${pt.mismatch_TN}`,
    mtp === pt.mismatch_TP && mfp === pt.mismatch_FP && mfn === pt.mismatch_FN && mtn === pt.mismatch_TN
      && multi.length === 0 && unknownMm.length === 0 && mmF.length === gotMm.size,
    { measured: [mtp, mfp, mfn, mtn], multi, unknownMm });
  checks.add(`${rel}: mismatch delta strings exact (${expMm.size})`, Object.keys(deltaDiffers).length === 0, deltaDiffers);
  const labById = new Map(labels.map((l) => [l.record_id, l] as const));
  const mmEvBad: string[] = [];
  for (const f of mmF) {
    const lab = labById.get(f.memberIds[0] ?? "");
    if (!lab) continue;
    const ev = f.evidence;
    if (ev.kind !== RULE_MISMATCH || ev.recordId !== lab.record_id || ev.row !== lab.row_number
      || ev.expected !== lab.expected_total || ev.declared !== lab.declared_total || ev.subtotal !== lab.subtotal
      || ev.tax !== lab.tax || ev.shipping !== lab.shipping || ev.discount !== lab.discount) {
      mmEvBad.push(lab.record_id);
    }
  }
  checks.add(`${rel}: mismatch evidence components/expected/declared match labels`, mmEvBad.length === 0, mmEvBad);

  const affected = new Set(findings.flatMap((f) => [...f.memberIds]));
  checks.add(`${rel}: ${pt.total_findings} findings over ${pt.distinct_affected_rows} distinct rows`,
    findings.length === pt.total_findings && affected.size === pt.distinct_affected_rows,
    { findings: findings.length, affectedRows: affected.size });

  if (opts.rowOrderCheck !== false) {
    const text = new TextDecoder().decode(bytes);
    const lines = text.split("\n");
    const body = lines.slice(1).filter((l) => l !== "");
    const rev = new TextEncoder().encode([lines[0], ...body.reverse()].join("\n") + "\n");
    const r2 = attempt(() => {
      const p = det.parse(rev);
      return p.ok ? [...det.rules(p.invoices)].map((f) => `${f.ruleId}|${f.memberIds.join(",")}`).sort() : null;
    });
    const want = findings.map((f) => `${f.ruleId}|${f.memberIds.join(",")}`).sort();
    checks.add(`${rel}: reversed row order gives identical rule/member sets`,
      r2.error === null && r2.value !== null && JSON.stringify(r2.value) === JSON.stringify(want), r2.error ?? undefined);
  }

  return {
    duplicate: {
      groupsExpected: expGroups.size, groupsFlagged: dupF.length, groupsExact: matched.length, genuineGroups,
      legitimateReuseGroups: reuseGroups, pairTP: tp, pairFP: fp, pairFN: fn, pairTN: tn, pairTotal: tp + fp + fn + tn,
    },
    hardNegatives: { pairs: main.designated_negative_pairs.length, falseAlerts: alerted.length,
      nearDuplicateFalseAlerts: nearAlerts.length, alertedPairIds: alerted },
    mismatch: { tp: mtp, fp: mfp, fn: mfn, tn: mtn, exactDeltas: mtp - Object.keys(deltaDiffers).length },
    findings: findings.length,
    affectedRows: affected.size,
    unmatched: { groupsMissing: missing, groupsExtra: extra, mismatchMissing: [...expMm.keys()].filter((r) => !gotMm.has(r)),
      mismatchExtra: [...gotMm.keys()].filter((r) => !expMm.has(r)), deltaDiffers },
  };
}

/** Manifest "check" semantics: each expected issue matches one actual issue on its listed attributes; no extras. */
export function matchManifestIssues(expected: readonly ManifestIssue[], actual: ValidationResult["issues"]) {
  const remaining = actual.map((i) => ({ code: i.code as string, row: i.row, field: i.field as string | null }));
  const missing: { code: string; row: number | null; field: string | null }[] = [];
  for (const exp of expected) {
    const keys = exp.check.includes("code") ? exp.check : (["code", ...exp.check] as const);
    const hit = remaining.findIndex((a) => keys.every((k) => a[k] === exp[k]));
    if (hit < 0) missing.push({ code: exp.code, row: exp.row, field: exp.field });
    else remaining.splice(hit, 1);
  }
  return { ok: missing.length === 0 && remaining.length === 0, missing, unexpected: remaining };
}

export function evaluateManifestFile(det: Detector, rel: string, meta: ManifestFile, checks: Checks): ValidationResult | null {
  const exp = meta.expected;
  const bytes = readProjectBytes(rel);
  checks.add(`${rel}: fixture hash matches manifest`, sha256Node(bytes) === meta.sha256 && bytes.length === meta.bytes);
  const parsed = attempt(() => det.parse(bytes));
  if (!checks.add(`${rel}: parseInvoiceCsv did not throw`, parsed.error === null, parsed.error ?? undefined)) return null;
  const res = parsed.value!;
  if (!exp.accepted) {
    checks.add(`${rel}: rejected (ok=false)`, res.ok === false);
    checks.add(`${rel}: zero invoices returned`, res.invoices.length === 0, { got: res.invoices.length });
    const m = matchManifestIssues(exp.issues, res.issues);
    checks.add(`${rel}: issues match exactly (${exp.issues.map((i) => i.code).join(", ")})`, m.ok,
      { missing: m.missing, unexpected: m.unexpected.slice(0, 20) });
    checks.add(`${rel}: issueCount == ${exp.issue_count}`, res.issueCount === exp.issue_count, { got: res.issueCount });
    return res;
  }
  checks.add(`${rel}: accepted (ok=true, no issues)`, res.ok === true && res.issues.length === 0, { issues: res.issues.slice(0, 20) });
  checks.add(`${rel}: invoice count == ${exp.invoice_count}`, res.invoices.length === exp.invoice_count, { got: res.invoices.length });
  if (!res.ok) return res;
  const ran = attempt(() => [...det.rules(res.invoices)]);
  if (!checks.add(`${rel}: runInvoiceRules did not throw`, ran.error === null, ran.error ?? undefined)) return res;
  const findings = ran.value!;
  const groups = findings.filter((f) => f.ruleId === RULE_DUPLICATE).map((f) => groupKey(f.memberIds)).sort();
  const expGroups = (exp.duplicate_groups ?? []).map(groupKey).sort();
  checks.add(`${rel}: duplicate groups exact membership`, JSON.stringify(groups) === JSON.stringify(expGroups),
    { expected: expGroups, got: groups });
  const mm: Record<string, string | null> = {};
  for (const f of findings) if (f.ruleId === RULE_MISMATCH) mm[f.memberIds.join(",")] = deltaOf(f);
  const expMm: Record<string, string> = {};
  for (const m of exp.mismatches ?? []) expMm[m.record_id] = m.delta;
  const sortObj = (o: Record<string, unknown>) => JSON.stringify(Object.entries(o).sort(([a], [b]) => cmpStr(a, b)));
  checks.add(`${rel}: mismatch findings + deltas exact`, sortObj(mm) === sortObj(expMm), { expected: expMm, got: mm });
  const other = findings.filter((f) => f.ruleId !== RULE_DUPLICATE && f.ruleId !== RULE_MISMATCH).map((f) => f.ruleId);
  checks.add(`${rel}: no unknown rule ids`, other.length === 0, other);
  return res;
}

export function evaluateBoundaryExtras(det: Detector, checks: Checks): void {
  const proj = (r: ValidationResult) => r.invoices.map((i) => [i.recordId, i.rowNumber, i.raw, i.vendorNorm, i.invoiceNorm,
    i.invoiceDate, i.currency, i.subtotal, i.tax, i.shipping, i.discount, i.total]);
  const lfBytes = readProjectBytes("fixtures/out/boundary/small-lf.csv");
  const bomBytes = readProjectBytes("fixtures/out/boundary/small-bom-crlf.csv");
  const a = attempt(() => det.parse(lfBytes));
  const b = attempt(() => det.parse(bomBytes));
  const okBoth = a.value?.ok === true && b.value?.ok === true;
  checks.add("boundary: BOM+CRLF copy parses identically to LF copy",
    okBoth && JSON.stringify(proj(a.value!)) === JSON.stringify(proj(b.value!)), a.error ?? b.error ?? undefined);
  checks.add("boundary: BOM+CRLF copy has a different file hash", sha256Node(lfBytes) !== sha256Node(bomBytes));

  // KNOWN LIMITATION (documented, asserted as current behaviour): the duplicate rule is batch-scoped.
  const run = (rel: string) => attempt(() => {
    const p = det.parse(readProjectBytes(rel));
    return p.ok ? [...det.rules(p.invoices)].filter((f) => f.ruleId === RULE_DUPLICATE).map((f) => [...f.memberIds]) : null;
  });
  const sa = run("fixtures/out/boundary/split-batch-a.csv");
  const sb = run("fixtures/out/boundary/split-batch-b.csv");
  const sc = run("fixtures/out/boundary/split-combined-control.csv");
  checks.add("boundary: KNOWN LIMITATION split-across-batches duplicate is not detected (each batch alone: no group)",
    JSON.stringify(sa.value) === "[]" && JSON.stringify(sb.value) === "[]", { a: sa.value ?? sa.error, b: sb.value ?? sb.error });
  checks.add("boundary: split control (same two rows in one batch) forms one group",
    JSON.stringify(sc.value) === JSON.stringify([["P-0001", "P-0002"]]), { got: sc.value ?? sc.error });
}

/** All manifest truth checks: main + every other manifest fixture + boundary extras. */
export function evaluateTruth(det: Detector, opts: EvalOptions = {}) {
  const { manifest, sha256 } = loadManifest();
  const checks = new Checks();
  const metrics = evaluateMain(det, manifest, checks, opts);
  for (const [rel, meta] of Object.entries(manifest.files)) {
    if (meta.kind !== "main") evaluateManifestFile(det, rel, meta, checks);
  }
  evaluateBoundaryExtras(det, checks);
  return { manifest, manifestSha256: sha256, checks, metrics };
}

// ---------------------------------------------------------------------------
// PARITY: against the captured Python reference
// ---------------------------------------------------------------------------

const camel = (k: string) => k.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
function camelize(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(camelize);
  if (v && typeof v === "object") {
    return Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, x]) => [camel(k), camelize(x)]));
  }
  return v;
}
/** Python evidence (snake_case, no kind) -> the TS contract shape (camelCase + kind). */
export function pyEvidenceToTs(ruleId: string, evidence: Readonly<Record<string, unknown>>): unknown {
  return { kind: ruleId, ...(camelize(evidence) as Record<string, unknown>) };
}
export function pyInvoiceToTs(i: PyInvoice): Invoice {
  return {
    recordId: i.record_id, rowNumber: i.row_number, raw: [...i.raw], vendorNorm: i.vendor_norm, invoiceNorm: i.invoice_norm,
    invoiceDate: i.invoice_date, currency: i.currency as "USD", subtotal: i.subtotal_c, tax: i.tax_c,
    shipping: i.shipping_c, discount: i.discount_c, total: i.total_c,
  };
}

function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  if (v && typeof v === "object") {
    return `{${Object.keys(v as object).sort().map((k) => `${JSON.stringify(k)}:${canonical((v as Record<string, unknown>)[k])}`).join(",")}}`;
  }
  return JSON.stringify(v);
}
const invProj = (i: Invoice) => ({ recordId: i.recordId, rowNumber: i.rowNumber, raw: [...i.raw], vendorNorm: i.vendorNorm,
  invoiceNorm: i.invoiceNorm, invoiceDate: i.invoiceDate, currency: i.currency, subtotal: i.subtotal, tax: i.tax,
  shipping: i.shipping, discount: i.discount, total: i.total });

/** Compare the detector on `bytes` against one captured Python case. */
export async function compareParityCase(det: Detector, label: string, bytes: Uint8Array, py: PyCase, checks: Checks): Promise<void> {
  checks.add(`${label}: input bytes are the captured file (sha256)`, sha256Node(bytes) === py.sha256);
  const parsed = attempt(() => det.parse(bytes));
  if (!checks.add(`${label}: parseInvoiceCsv did not throw`, parsed.error === null, parsed.error ?? undefined)) return;
  const res = parsed.value!;
  checks.add(`${label}: ok == ${py.ok}`, res.ok === py.ok, { got: res.ok });
  const got = res.issues.map((i) => ({ code: i.code, row: i.row, field: i.field }));
  const want = py.issues.map((i) => ({ code: i.code, row: i.row, field: i.field }));
  const firstDiff = want.findIndex((w, j) => canonical(w) !== canonical(got[j]));
  checks.add(`${label}: issues (code,row,field) equal in order (${want.length} listed)`,
    canonical(got) === canonical(want),
    { firstDiffIndex: firstDiff >= 0 ? firstDiff : (got.length !== want.length ? Math.min(got.length, want.length) : -1),
      expected: want.slice(0, 5), got: got.slice(0, 5), gotLength: got.length });
  checks.add(`${label}: issueCount == ${py.issue_count}`, res.issueCount === py.issue_count, { got: res.issueCount });
  checks.add(`${label}: accepted invoice count == ${py.accepted_invoice_count}`, res.invoices.length === py.accepted_invoice_count,
    { got: res.invoices.length });
  const invGot = res.invoices.map(invProj);
  const invWant = py.invoices.map((i) => invProj(pyInvoiceToTs(i)));
  const invDiff = invWant.findIndex((w, j) => canonical(w) !== canonical(invGot[j]));
  checks.add(`${label}: accepted invoices equal (raw cells, normalized keys, date, cents)`, canonical(invGot) === canonical(invWant),
    invDiff >= 0 ? { index: invDiff, expected: invWant[invDiff], got: invGot[invDiff] } : undefined);

  let candidates: CandidateFinding[] = [];
  if (res.ok) {
    const ran = attempt(() => [...det.rules(res.invoices)]);
    if (!checks.add(`${label}: runInvoiceRules did not throw`, ran.error === null, ran.error ?? undefined)) return;
    candidates = ran.value!;
  }
  const prepared = await finalizeBatch(bytes, res.invoices, candidates);
  checks.add(`${label}: fileSha256 == Python sha256`, prepared.fileSha256 === py.sha256, { got: prepared.fileSha256 });
  checks.add(`${label}: batchId (ids.ts) == Python batch_id_for`, prepared.batchId === py.batch_id, { got: prepared.batchId, expected: py.batch_id });
  const fGot = prepared.findings.map((f) => ({ ruleId: f.ruleId, ruleVersion: f.ruleVersion, memberIds: [...f.memberIds], evidence: f.evidence }));
  const fWant = py.findings.map((f) => ({ ruleId: f.rule_id, ruleVersion: f.rule_version, memberIds: [...f.member_ids],
    evidence: pyEvidenceToTs(f.rule_id, f.evidence) }));
  const fDiff = fWant.findIndex((w, j) => canonical(w) !== canonical(fGot[j]));
  checks.add(`${label}: findings equal in order (rule, members, evidence strings) (${fWant.length})`,
    canonical(fGot) === canonical(fWant),
    fDiff >= 0 || fGot.length !== fWant.length
      ? { index: fDiff, expected: fWant[fDiff] ?? null, got: fGot[fDiff] ?? null, gotLength: fGot.length } : undefined);
  const idGot = prepared.findings.map((f) => f.findingId);
  const idWant = py.findings.map((f) => f.finding_id);
  checks.add(`${label}: findingIds (ids.ts finalizeBatch) == Python make_finding_id`, canonical(idGot) === canonical(idWant),
    { expected: idWant.slice(0, 8), got: idGot.slice(0, 8) });
}

export async function evaluateParity(det: Detector): Promise<Checks> {
  const doc = loadParity();
  const checks = new Checks();
  checks.add("parity doc source is python-reference-parity", doc.source === "python-reference-parity");
  for (const [name, py] of Object.entries(doc.cases)) await compareParityCase(det, `parity/${name}`, readParityFile(name), py, checks);
  for (const [name, py] of Object.entries(doc.demo)) {
    await compareParityCase(det, `parity/demo/${name}`, new Uint8Array(readFileSync(join(WEB_ROOT, "public", "demo", name))), py, checks);
  }
  for (const [rel, py] of Object.entries(doc.manifest_fixtures)) await compareParityCase(det, `parity/${rel}`, readProjectBytes(rel), py, checks);
  return checks;
}

export function summarizeFailures(checks: Checks, max = 15): string {
  return checks.failures.slice(0, max).map((c) => `FAIL ${c.id}${c.detail === undefined ? "" : `: ${JSON.stringify(c.detail).slice(0, 400)}`}`)
    .join("\n") + (checks.failures.length > max ? `\n... and ${checks.failures.length - max} more` : "");
}
