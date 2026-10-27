/**
 * Integration (lead-owned): wires the visitor store, router, guide and importer to the
 * presentational pages. Pages never compute money or touch storage; this file never renders
 * financial figures itself.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { BatchSummary, CaseView, Durability, FindingView, Invoice, ReviewAction } from "./domain/contracts.ts";
import type { ColumnMapping } from "./domain/own/columns.ts";
import type { DateOrder } from "./domain/own/values.ts";
import { MODULES, OWN_BATCH_ID, RULE_DUPLICATE, RULE_MISMATCH, compareTuples } from "./domain/contracts.ts";
import { parseInvoiceCsv } from "./domain/csv.ts";
import { runInvoiceRules } from "./domain/rules.ts";
import { makeBatchId, makeFindingId, sha256Hex } from "./domain/ids.ts";
import type {
  BenchmarkFile, DecisionForm, DemoStatus, GuideView, QueueFilter, Route, SaveStatus, StoryData,
} from "./ui-contracts.ts";
import { AppShell } from "./components/index.ts";
import { Intro, shouldPlayIntro } from "./components/Intro.tsx";
import {
  CasePage, HowPage, MinePage, MineSummaryPage, NotFoundPage, OverviewPage, QueuePage, ResultsPage, RoadmapPage, FeedbackPage,
} from "./pages/index.ts";
import { formatRoute, parseRoute } from "./state/router.ts";
import { openBestStore } from "./state/openStore.ts";
import { importBytes } from "./state/importer.ts";
import { importOwnFile } from "./state/ownImporter.ts";
import { DEMO_TARGETS, SUGGESTED_REASONS, deriveGuide } from "./state/guide.ts";
import type { OwnFileRecord, ReviewStore } from "./state/store.ts";
import { onCaseLoaded, onConflictShown, onSaved, reviewerFor } from "./state/draft.ts";
import type { DraftBinding } from "./state/draft.ts";

const DEMO_CSV = "./demo/main-120.csv";
const BENCHMARK_JSON = "./results/benchmark.json";
const DEMO_NAME = "Synthetic demo batch: 120 invoices";
const GUIDE_KEY = "preflight.guideActive";
const DEFAULT_REVIEWER = "Demo reviewer";

const nowIso = () => new Date().toISOString().replace(/\.\d{3}Z$/, "Z");

function readGuideFlag(): boolean {
  try { return window.localStorage.getItem(GUIDE_KEY) === "1"; } catch { return false; }
}
function writeGuideFlag(active: boolean): void {
  try { window.localStorage.setItem(GUIDE_KEY, active ? "1" : "0"); } catch { /* per-visitor convenience only */ }
}

function navigate(route: Route, replace = false): void {
  const href = formatRoute(route);
  if (replace) window.location.replace(href);
  else window.location.hash = href;
}

interface DemoInfo {
  readonly bytes: Uint8Array;
  readonly batchId: string;
  readonly mismatchId: string;
  readonly reuseId: string;
  readonly story: StoryData | null;
}

async function loadDemoInfo(): Promise<DemoInfo> {
  const res = await fetch(DEMO_CSV, { cache: "no-cache" });
  if (!res.ok) throw new Error(`Demo data could not be loaded (HTTP ${res.status}).`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  const batchId = await makeBatchId(await sha256Hex(bytes));
  const mismatchId = await makeFindingId(DEMO_TARGETS.mismatch.ruleId, "invoice-v1", DEMO_TARGETS.mismatch.memberIds);
  const reuseId = await makeFindingId(DEMO_TARGETS.reuse.ruleId, "invoice-v1", DEMO_TARGETS.reuse.memberIds);
  // Landing story: real findings computed in memory (not stored).
  let story: StoryData | null = null;
  const parsed = parseInvoiceCsv(bytes);
  if (parsed.ok) {
    const findings = runInvoiceRules(parsed.invoices);
    const mismatch = findings.find((f) => f.ruleId === RULE_MISMATCH && compareTuples(f.memberIds, DEMO_TARGETS.mismatch.memberIds) === 0);
    const reuse = findings.find((f) => f.ruleId === RULE_DUPLICATE && compareTuples(f.memberIds, DEMO_TARGETS.reuse.memberIds) === 0);
    const inv = parsed.invoices.find((i) => i.recordId === "R-0009");
    if (mismatch?.evidence.kind === RULE_MISMATCH && reuse?.evidence.kind === RULE_DUPLICATE && inv) {
      story = {
        mismatch: mismatch.evidence, mismatchVendor: inv.vendorNorm, mismatchInvoice: inv.invoiceNorm,
        reuse: reuse.evidence, invoiceCount: parsed.invoices.length, findingCount: findings.length,
      };
    }
  }
  return { bytes, batchId, mismatchId, reuseId, story };
}

type LoadDemoResult = { readonly ok: true; readonly batchId: string } | { readonly ok: false; readonly message: string };

const READ_ERROR = "Browser storage changed or failed (for example, another tab upgraded or reset it). Reload the page to continue; nothing was changed by this view.";

/** Stable Previous/Next order that does not jump when a decision changes a case's state. */
function stableOrder(findings: readonly FindingView[]): FindingView[] {
  return [...findings].sort((a, b) => (a.ruleId !== b.ruleId ? (a.ruleId < b.ruleId ? -1 : 1) : compareTuples(a.memberIds, b.memberIds)));
}

export function App() {
  const [route, setRoute] = useState<Route>(() => parseRoute(window.location.hash));
  // Brand intro: only when a visit starts on the landing page.
  const [intro, setIntro] = useState(() => route.name === "overview" && shouldPlayIntro());
  const endIntro = useCallback(() => setIntro(false), []);
  const [store, setStore] = useState<ReviewStore | null>(null);
  const [durability, setDurability] = useState<Durability>("persistent");
  const [storeError, setStoreError] = useState<string | null>(null);
  const [version, setVersion] = useState(0); // bump to reload data
  const bump = useCallback(() => setVersion((v) => v + 1), []);
  const [announcement, setAnnouncement] = useState("");

  const [demo, setDemo] = useState<DemoInfo | null>(null);
  const [demoError, setDemoError] = useState<string | null>(null);
  const [demoLoading, setDemoLoading] = useState(false);
  const [batches, setBatches] = useState<BatchSummary[]>([]);
  const [ownFiles, setOwnFiles] = useState<OwnFileRecord[]>([]);
  const [benchmark, setBenchmark] = useState<BenchmarkFile | null>(null);
  const [benchmarkError, setBenchmarkError] = useState<string | null>(null);

  const [filter, setFilter] = useState<QueueFilter>({ state: "all", rule: "all" });
  const [queueFindings, setQueueFindings] = useState<FindingView[]>([]);
  const [caseView, setCaseView] = useState<CaseView | null | "missing">(null);
  const [caseOrder, setCaseOrder] = useState<FindingView[]>([]);
  const [form, setForm] = useState<DecisionForm>({ reviewer: DEFAULT_REVIEWER, reason: "" });
  const [save, setSave] = useState<SaveStatus>({ kind: "idle" });
  const [readError, setReadError] = useState<string | null>(null);
  const onReadError = useCallback(() => setReadError(READ_ERROR), []);
  const [demoFailure, setDemoFailure] = useState<string | null>(null);
  const demoInFlight = useRef<Promise<LoadDemoResult> | null>(null);
  const demoRouteHandled = useRef(false);
  // Draft bound to the case version it was started on (see state/draft.ts).
  const draftRef = useRef<DraftBinding | null>(null);
  const reasonRef = useRef("");
  reasonRef.current = form.reason;

  const [guideActive, setGuideActive] = useState<boolean>(readGuideFlag);
  const [visitedResults, setVisitedResults] = useState(false);
  const [guideCases, setGuideCases] = useState<{ mismatch: CaseView | null; reuse: CaseView | null }>({ mismatch: null, reuse: null });

  // ---- boot: store, demo info, benchmark ----
  useEffect(() => {
    let cancelled = false;
    openBestStore().then(({ store: s, fallbackReason }) => {
      if (cancelled) { s.close(); return; }
      setStore(s);
      setDurability(s.durability);
      if (fallbackReason) setStoreError(fallbackReason);
    });
    loadDemoInfo().then((d) => !cancelled && setDemo(d), (e: unknown) => !cancelled && setDemoError(e instanceof Error ? e.message : "Demo data unavailable."));
    fetch(BENCHMARK_JSON, { cache: "no-cache" })
      .then((r) => (r.ok ? (r.json() as Promise<BenchmarkFile>) : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((b) => !cancelled && setBenchmark(b), (e: unknown) => !cancelled && setBenchmarkError(`Benchmark results unavailable (${e instanceof Error ? e.message : "error"}).`));
    return () => { cancelled = true; };
  }, []);

  useEffect(() => () => store?.close(), [store]);

  // ---- routing ----
  useEffect(() => {
    // "#main-content" is the skip-link target, not a route: keep the current page.
    const onHash = () => {
      if (window.location.hash === "#main-content") return;
      setRoute(parseRoute(window.location.hash));
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  // ---- other tabs ----
  useEffect(() => {
    if (!store) return;
    return store.subscribe((change) => {
      setAnnouncement(change.type === "reset"
        ? "Demo data was reset in another tab."
        : "Data changed in another tab; showing the latest state.");
      bump();
    });
  }, [store, bump]);

  // ---- data loading ----
  useEffect(() => {
    if (!store) return;
    let cancelled = false;
    store.listBatches().then((b) => !cancelled && setBatches(b), onReadError);
    store.listOwnFiles().then((f) => !cancelled && setOwnFiles(f), onReadError);
    return () => { cancelled = true; };
  }, [store, version, onReadError]);

  const demoLoaded = !!demo && batches.some((b) => b.batchId === demo.batchId);
  const demoStatus: DemoStatus = demoError || demoFailure ? { kind: "error", message: (demoError ?? demoFailure)! }
    : demoLoaded ? { kind: "ready", batchId: demo!.batchId }
    : demoLoading || !demo || !store ? { kind: "loading" }
    : { kind: "not_loaded" };

  const queueBatchId = route.name === "queue"
    // "#/queue" with no id is the demo queue: never fall back to the person's own data.
    ? route.batchId ?? (demoLoaded ? demo!.batchId : batches.find((b) => b.source !== "own")?.batchId ?? null)
    : route.name === "case" ? route.batchId : null;
  const queueBatch = batches.find((b) => b.batchId === queueBatchId) ?? null;
  const ownMode = route.name === "mine" || route.name === "mine-summary"
    || (route.name === "queue" && queueBatch?.source === "own") || (route.name === "case" && route.batchId === OWN_BATCH_ID);

  useEffect(() => {
    if (!store || !queueBatchId) { setQueueFindings([]); return; }
    let cancelled = false;
    store.listFindings(queueBatchId).then((f) => {
      if (cancelled) return;
      setQueueFindings(f);
      setCaseOrder(stableOrder(f));
    }, onReadError);
    return () => { cancelled = true; };
  }, [store, queueBatchId, version, onReadError]);

  // Summary inputs (rows + latest decision reasons) are loaded here so the page stays storage-free.
  const [ownFindings, setOwnFindings] = useState<FindingView[]>([]);
  const [ownRows, setOwnRows] = useState<Invoice[]>([]);
  const [ownReasons, setOwnReasons] = useState<ReadonlyMap<string, string>>(new Map());
  const [ownLoaded, setOwnLoaded] = useState(false);
  useEffect(() => {
    if (!store || route.name !== "mine-summary") return;
    let cancelled = false;
    setOwnLoaded(false);
    (async () => {
      const [f, r] = await Promise.all([store.listFindings(OWN_BATCH_ID), store.listOwnRows()]);
      const decided = f.filter((x) => x.state !== "open");
      const cases = await Promise.all(decided.map((x) => store.getCase(OWN_BATCH_ID, x.findingId)));
      const reasons = new Map<string, string>();
      cases.forEach((c, i) => { const last = c?.history[c.history.length - 1]; if (last) reasons.set(decided[i]!.findingId, last.reason); });
      if (!cancelled) { setOwnFindings(f); setOwnRows(r); setOwnReasons(reasons); setOwnLoaded(true); }
    })().catch(onReadError);
    return () => { cancelled = true; };
  }, [store, route.name, version, onReadError]);

  const caseKey = route.name === "case" ? `${route.batchId}/${route.findingId}` : null;
  const lastCaseKey = useRef<string | null>(null);
  useEffect(() => {
    if (!store || route.name !== "case") {
      setCaseView(null);
      if (route.name !== "case") lastCaseKey.current = null; // revisiting a case starts fresh
      return;
    }
    let cancelled = false;
    const isNewCase = lastCaseKey.current !== caseKey;
    lastCaseKey.current = caseKey;
    if (isNewCase) {
      setSave({ kind: "idle" });
      setForm((f) => ({ reviewer: reviewerFor(route.batchId === OWN_BATCH_ID, f.reviewer, DEFAULT_REVIEWER), reason: "" }));
    }
    store.getCase(route.batchId, route.findingId).then((c) => {
      if (cancelled) return;
      if (c) {
        const prev = draftRef.current;
        const next = onCaseLoaded(prev, c.finding, isNewCase, reasonRef.current.trim() !== "");
        draftRef.current = next;
        if (next.stale && !prev?.stale) {
          setSave({ kind: "conflict", message: "This case changed in another tab. Review the update below before deciding." });
        }
      }
      // When the case is missing (e.g. another tab reset), KEEP the draft binding: if the case
      // reappears under a new reset generation, onCaseLoaded marks a typed draft stale.
      setCaseView(c ?? "missing");
    }, onReadError);
    return () => { cancelled = true; };
  }, [store, caseKey, version]); // eslint-disable-line react-hooks/exhaustive-deps

  // guide facts
  useEffect(() => {
    if (!store || !demo || !demoLoaded) { setGuideCases({ mismatch: null, reuse: null }); return; }
    let cancelled = false;
    Promise.all([store.getCase(demo.batchId, demo.mismatchId), store.getCase(demo.batchId, demo.reuseId)])
      .then(([mismatch, reuse]) => !cancelled && setGuideCases({ mismatch, reuse }), onReadError);
    return () => { cancelled = true; };
  }, [store, demo, demoLoaded, version, onReadError]);

  useEffect(() => {
    if (route.name === "results" && guideActive) setVisitedResults(true);
  }, [route, guideActive]);

  const guide: GuideView | null = useMemo(() => {
    if (!guideActive) return null;
    return deriveGuide({
      active: true, demoLoaded, mismatch: guideCases.mismatch, reuse: guideCases.reuse,
      mismatchHref: demo ? formatRoute({ name: "case", batchId: demo.batchId, findingId: demo.mismatchId }) : null,
      reuseHref: demo ? formatRoute({ name: "case", batchId: demo.batchId, findingId: demo.reuseId }) : null,
      visitedResults,
    });
  }, [guideActive, demoLoaded, guideCases, demo, visitedResults]);

  // ---- actions ----
  /**
   * Loads the demo batch once. Concurrent callers share one in-flight import. Staleness is
   * decided only by the outcome: the import transaction itself rejects a reset that committed
   * after the import started.
   */
  const loadDemo = useCallback((): Promise<LoadDemoResult> => {
    if (!store || !demo) return Promise.resolve({ ok: false, message: demoError ?? "The demo is still starting. Try again in a moment." });
    if (batches.some((b) => b.batchId === demo.batchId)) return Promise.resolve({ ok: true, batchId: demo.batchId });
    if (demoInFlight.current) return demoInFlight.current;
    const run = (async (): Promise<LoadDemoResult> => {
      setDemoLoading(true);
      try {
        const expectedResetGeneration = await store.getResetGeneration();
        const outcome = await importBytes(store, demo.bytes, { displayName: DEMO_NAME, source: "demo", now: nowIso(), expectedResetGeneration });
        if (outcome.status === "created" || outcome.status === "existing") {
          setDemoFailure(null);
          setAnnouncement(outcome.status === "created"
            ? `Loaded the synthetic demo batch: ${outcome.batch.rowCount} invoices, ${outcome.batch.findingCount} findings to review.`
            : "The demo batch is already loaded; your earlier decisions are kept.");
          return { ok: true, batchId: outcome.batch.batchId };
        }
        const message = outcome.status === "storage_error" ? outcome.message : "The demo file failed validation, so nothing was loaded.";
        setDemoFailure(message);
        return { ok: false, message };
      } catch {
        setDemoFailure(READ_ERROR);
        return { ok: false, message: READ_ERROR };
      } finally {
        setDemoLoading(false);
        demoInFlight.current = null;
        bump();
      }
    })();
    demoInFlight.current = run;
    return run;
  }, [store, demo, demoError, batches, bump]);

  // "#/demo" starts (or resumes) the guide without erasing anything, then shows the queue.
  // Handled once per visit to the route (StrictMode/dep changes must not re-run the import).
  const runDemoRoute = useCallback(() => {
    demoRouteHandled.current = true;
    setGuideActive(true);
    writeGuideFlag(true);
    setDemoFailure(null);
    void loadDemo().then((r) => { if (r.ok) navigate({ name: "queue", batchId: r.batchId }, true); });
  }, [loadDemo]);
  useEffect(() => {
    if (route.name !== "demo") { demoRouteHandled.current = false; return; }
    if (!store || !demo || demoRouteHandled.current) return;
    runDemoRoute();
  }, [route, store, demo, runDemoRoute]);

  const startGuide = useCallback(() => navigate({ name: "demo" }), []);
  const explore = useCallback(() => {
    void loadDemo().then((r) => { if (r.ok) navigate({ name: "queue", batchId: r.batchId }); });
  }, [loadDemo]);
  const exitGuide = useCallback(() => { setGuideActive(false); writeGuideFlag(false); }, []);

  const onAction = useCallback(async (action: ReviewAction) => {
    if (!store || !caseView || caseView === "missing") return;
    const f = caseView.finding;
    // Submit with the token of the version the draft was started on, never a silently refreshed one.
    const expected = draftRef.current?.token ?? { resetGeneration: f.resetGeneration, sequence: f.sequence };
    setSave({ kind: "saving", action });
    const result = await store.saveDecision({
      batchId: f.batchId, findingId: f.findingId, action, reason: form.reason, reviewer: form.reviewer, expected,
    }, nowIso());
    if (result.status === "saved") draftRef.current = onSaved(result.finding);
    else if (result.status === "conflict" || result.status === "invalid_transition") {
      draftRef.current = onConflictShown(result.latest, draftRef.current);
    }
    const isOwn = f.batchId === OWN_BATCH_ID;
    switch (result.status) {
      case "saved": {
        const label = result.event.nextState === "open" ? "Reopened" : result.event.nextState === "confirmed" ? "Confirmed" : "Dismissed";
        const where = durability === "memory" ? "in this tab only (browser storage unavailable)" : "in this browser";
        setSave({ kind: "saved", message: `${label}. Saved ${where}. Added to the history below.` });
        setForm((prev) => ({ ...prev, reason: "" }));
        setAnnouncement(`${label}. Decision saved.`);
        // Keep the reviewer oriented on this case (the queue re-orders behind it).
        requestAnimationFrame(() => document.getElementById("case-heading")?.focus());
        break;
      }
      case "invalid":
        setSave({ kind: "invalid", errors: result.errors });
        break;
      case "conflict":
        setSave({ kind: "conflict", message: result.cause === "reset"
          ? (isOwn
            ? "The demo was reset in this browser after this page loaded, so nothing was saved. Your data is kept; reload the case and try again."
            : "The demo data was reset after this page loaded, so nothing was saved. Reload the case.")
          : "Another tab changed this case first, so nothing was saved. The latest state is shown." });
        break;
      case "invalid_transition":
        setSave({ kind: "conflict", message: "That action no longer applies to this case's current state, so nothing was saved." });
        break;
      case "not_found":
        setSave({ kind: "error", message: isOwn
          ? "This case no longer exists in this browser (your data may have been deleted or re-checked). Nothing was saved."
          : "This case no longer exists in this browser (the demo data may have been reset). Nothing was saved." });
        break;
      case "storage_error":
        setSave({ kind: "error", message: `Not saved: ${result.message}` });
        break;
    }
    bump();
  }, [store, caseView, form, durability, bump]);

  const onImportOwn = useCallback(async (bytes: Uint8Array, mapping: ColumnMapping, opts: { displayName: string; dateOrder: DateOrder | null }) => {
    if (!store) return { status: "storage_error" as const, message: "Browser storage is still opening. Try again in a moment." };
    const outcome = await importOwnFile(store, bytes, mapping, { ...opts, now: nowIso(), expectedResetGeneration: await store.getResetGeneration() });
    if ("status" in outcome && outcome.status === "merged") {
      setAnnouncement(`Added ${outcome.added} invoices to your data.`);
      bump();
    }
    return outcome;
  }, [store, bump]);

  const onDeleteOwn = useCallback(async (): Promise<{ ok: boolean; message?: string }> => {
    if (!store) return { ok: false, message: "Browser storage is still opening. Try again in a moment." };
    let out: { ok: boolean; message?: string };
    try { out = await store.deleteOwnData(); } catch { out = { ok: false, message: "Browser storage failed." }; }
    setAnnouncement(out.ok ? "Your data was deleted from this browser." : `Delete failed: ${out.message ?? "storage error"}`);
    bump();
    return out;
  }, [store, bump]);

  const onResetDemo = useCallback(async () => {
    if (!store) return;
    const out = await store.resetAll();
    if (out.ok) {
      draftRef.current = null;
      setAnnouncement("This browser's demo data and decisions were reset.");
      setVisitedResults(false);
      navigate({ name: "queue", batchId: null });
    } else {
      setAnnouncement(`Reset failed: ${out.message}`);
    }
    bump();
  }, [store, bump]);

  // ---- render ----
  const filtered = queueFindings.filter((f) =>
    (filter.state === "all" || f.state === filter.state) && (filter.rule === "all" || f.ruleId === filter.rule));

  let page: React.ReactNode;
  const booting = !store;
  if (readError) {
    page = (
      <div className="app-loading" role="alert">
        <p>{readError}</p>
        <button type="button" className="btn btn-secondary" onClick={() => window.location.reload()}>Reload the page</button>
      </div>
    );
  } else switch (route.name) {
    case "overview":
      page = <OverviewPage story={demo?.story ?? null} demo={demoStatus} onStartGuide={startGuide} onExplore={explore}
        benchmark={benchmark?.runs.find((r) => r.source === "browser-port") ?? null} />;
      break;
    case "demo":
      page = demoError || demoFailure ? (
        <div className="app-loading" role="alert">
          <p>{demoError ?? demoFailure}</p>
          {demoFailure && !demoError ? (
            <button type="button" className="btn btn-secondary" onClick={runDemoRoute}>Try loading the demo again</button>
          ) : null}
        </div>
      ) : <p className="app-loading" role="status">Loading the synthetic demo batch…</p>;
      break;
    case "queue":
      page = booting ? <p className="app-loading" role="status">Opening browser storage…</p> : (
        <QueuePage
          batch={queueBatch} batches={batches} findings={filtered} filter={filter} onFilterChange={setFilter}
          hrefForCase={(id) => formatRoute({ name: "case", batchId: queueBatchId ?? "", findingId: id })}
          hrefForBatch={(id) => formatRoute({ name: "queue", batchId: id })}
          demo={demoStatus} onLoadDemo={explore} onResetDemo={onResetDemo}
        />
      );
      break;
    case "case": {
      if (booting || caseView === null) {
        page = <p className="app-loading" role="status">Loading case…</p>;
      } else if (caseView === "missing") {
        const isDemo = !!demo && route.batchId === demo.batchId && !demoLoaded;
        page = (
          <NotFoundPage
            message={isDemo ? "This link points to the synthetic demo, which isn't loaded in this browser yet." : "This case isn't stored in this browser. Decisions and imports live only on the device where they were made."}
            homeHref="#/"
            onLoadDemo={isDemo ? () => void loadDemo().then(() => bump()) : null}
          />
        );
      } else {
        const i = caseOrder.findIndex((f) => f.findingId === caseView.finding.findingId);
        const href = (f: FindingView | undefined) => (f ? formatRoute({ name: "case", batchId: f.batchId, findingId: f.findingId }) : null);
        const step = guide?.steps[guide.currentIndex];
        const here = formatRoute(route);
        page = (
          <CasePage
            view={caseView} form={form} onFormChange={setForm} onAction={(a) => void onAction(a)} save={save}
            durability={durability}
            guideHint={step && step.href === here ? step.instruction : null}
            queueHref={formatRoute({ name: "queue", batchId: caseView.batch.batchId })}
            prevHref={i > 0 ? href(caseOrder[i - 1]) : null}
            nextHref={i >= 0 ? href(caseOrder[i + 1]) : null}
            suggestedReasons={SUGGESTED_REASONS[caseView.finding.ruleId] ?? []}
          />
        );
      }
      break;
    }
    case "mine":
      page = booting ? <p className="app-loading" role="status">Opening browser storage…</p> : (
        <MinePage
          ownBatch={batches.find((b) => b.batchId === OWN_BATCH_ID) ?? null} files={ownFiles}
          onImport={onImportOwn} onDeleteOwn={onDeleteOwn}
          queueHref={formatRoute({ name: "queue", batchId: OWN_BATCH_ID })} summaryHref={formatRoute({ name: "mine-summary" })}
        />
      );
      break;
    case "mine-summary":
      page = booting ? <p className="app-loading" role="status">Opening browser storage…</p> : (
        <MineSummaryPage batch={batches.find((b) => b.batchId === OWN_BATCH_ID) ?? null} findings={ownFindings} files={ownFiles}
          rows={ownRows} reasons={ownReasons} loading={!ownLoaded} mineHref={formatRoute({ name: "mine" })} />
      );
      break;
    case "results":
      page = <ResultsPage benchmark={benchmark} benchmarkError={benchmarkError} visitor={demoLoaded ? batches.find((b) => b.batchId === demo!.batchId) ?? null : null} />;
      break;
    case "how":
      page = <HowPage />;
      break;
    case "roadmap":
      page = <RoadmapPage modules={MODULES} />;
      break;
    case "feedback":
      page = <FeedbackPage demoHref={formatRoute({ name: "demo" })} />;
      break;
    case "not_found":
      page = <NotFoundPage message="There is no page at this address." homeHref="#/" onLoadDemo={null} />;
      break;
  }

  return (
    <>
    {intro ? <Intro onDone={endIntro} /> : null}
    <AppShell route={route} guide={guide} own={ownMode} onGuideExit={exitGuide} durability={durability}
      announcement={storeError && durability === "memory" ? `${announcement} ${storeError}`.trim() : announcement}>
      {page}
    </AppShell>
    </>
  );
}
