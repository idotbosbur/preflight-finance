/**
 * Frozen UI contracts (`web-contracts-v1`), owned by Preflight-Lead.
 *
 * Pages/components (interface worker) are presentational: they receive these props, render
 * typed domain results, and call the handlers. They perform NO financial arithmetic, storage,
 * hashing or routing state changes themselves. App.tsx (lead) wires state to props.
 */
import type {
  BatchSummary,
  CaseView,
  Durability,
  DuplicateEvidence,
  FindingView,
  MismatchEvidence,
  ModuleStatus,
  ReviewAction,
  ReviewState,
  RuleId,
} from "./domain/contracts.ts";

// ---- Routing (hash-based; no server rewrites) ----

export type Route =
  | { readonly name: "overview" }
  | { readonly name: "demo" } // starts/resumes the guided demo, then shows the queue
  | { readonly name: "queue"; readonly batchId: string | null }
  | { readonly name: "case"; readonly batchId: string; readonly findingId: string }
  | { readonly name: "results" }
  | { readonly name: "how" }
  | { readonly name: "roadmap" }
  | { readonly name: "mine" } // own-data workspace
  | { readonly name: "mine-summary" }
  | { readonly name: "feedback" }
  | { readonly name: "not_found"; readonly hash: string };

/** Canonical hrefs: "#/", "#/demo", "#/queue", "#/queue/<batchId>", "#/case/<batchId>/<findingId>",
 *  "#/results", "#/how", "#/roadmap", "#/mine", "#/mine/summary". Implemented by state/router.ts (formatRoute/parseRoute). */
export type RouteHref = string;

// ---- Guided demo ----

export type GuideStepId = "load" | "confirm-mismatch" | "dismiss-reuse" | "reopen-history" | "results";
export interface GuideStepView {
  readonly id: GuideStepId;
  readonly title: string;
  readonly instruction: string;
  readonly status: "done" | "current" | "upcoming";
  /** Where the step happens, if it has a place to go. */
  readonly href: RouteHref | null;
  /** e.g. "Already confirmed earlier, reopen to replay this step." */
  readonly note: string | null;
}
export interface GuideView {
  readonly active: boolean;
  readonly steps: readonly GuideStepView[];
  readonly currentIndex: number; // steps.length when complete
  readonly complete: boolean;
}

// ---- Async UI states ----

export type DemoStatus =
  | { readonly kind: "not_loaded" }
  | { readonly kind: "loading" }
  | { readonly kind: "ready"; readonly batchId: string }
  | { readonly kind: "error"; readonly message: string };

export interface DecisionForm {
  readonly reviewer: string;
  readonly reason: string;
}

export type SaveStatus =
  | { readonly kind: "idle" }
  | { readonly kind: "saving"; readonly action: ReviewAction }
  | { readonly kind: "saved"; readonly message: string }
  | { readonly kind: "invalid"; readonly errors: readonly string[] }
  | { readonly kind: "conflict"; readonly message: string }
  | { readonly kind: "error"; readonly message: string };

export interface QueueFilter {
  readonly state: ReviewState | "all";
  readonly rule: RuleId | "all";
}

// ---- Benchmark results (public/results/benchmark.json, produced by the evaluator) ----

export interface BenchmarkRun {
  readonly source: "browser-port" | "python-reference";
  readonly runAt: string; // ISO UTC of the actual run
  readonly command: string;
  readonly checksPassed: number;
  readonly checksTotal: number;
  readonly duplicate: {
    readonly groupsExpected: number;
    readonly groupsFlagged: number;
    readonly groupsExact: number;
    readonly genuineGroups: number;
    readonly legitimateReuseGroups: number;
    readonly pairTP: number;
    readonly pairFP: number;
    readonly pairFN: number;
    readonly pairTN: number;
    readonly pairTotal: number;
  };
  readonly hardNegatives: { readonly pairs: number; readonly falseAlerts: number };
  readonly mismatch: { readonly tp: number; readonly fp: number; readonly fn: number; readonly tn: number; readonly exactDeltas: number };
  readonly findings: number;
  readonly affectedRows: number;
  /** Python-only extra: unit/integration test count of the reference app, if this is the reference run. */
  readonly referenceTests?: number;
}
export interface BenchmarkFile {
  readonly fixtureVersion: string;
  readonly fixtureSeed: number;
  readonly datasetSha256: string;
  readonly manifestSha256: string;
  readonly runs: readonly BenchmarkRun[];
  readonly limitations: readonly string[];
  /** Near-duplicate rule measured on the hand-labelled own-data fixture (raw pair counts). */
  readonly nearDuplicate?: { readonly pairsLabelled: number; readonly tp: number; readonly fp: number; readonly fn: number };
}

// ---- Story data for the landing narrative (real fixture findings, computed in-browser, not stored) ----

export interface StoryData {
  readonly mismatch: MismatchEvidence; // R-0009
  readonly mismatchVendor: string;
  readonly mismatchInvoice: string;
  readonly reuse: DuplicateEvidence; // DG-12: R-0005 / R-0032
  readonly invoiceCount: number; // 120
  readonly findingCount: number; // 32
}

// ---- Page props ----

export interface AppShellProps {
  readonly route: Route;
  readonly guide: GuideView | null;
  readonly onGuideExit: () => void;
  readonly durability: Durability;
  /** Polite live-region text (import/save/navigation announcements). */
  readonly announcement: string;
  /** Own-data mode: shows the "Your data" badge/title instead of the synthetic-demo ones. */
  readonly own?: boolean;
  /** Feedback link target; defaults to FEEDBACK_URL. Empty hides the link. */
  readonly feedbackUrl?: string;
  readonly children: React.ReactNode;
}

export interface OverviewProps {
  readonly story: StoryData | null;
  /** The measured browser-port run, when loaded; the landing page shows its figures. */
  readonly benchmark?: BenchmarkRun | null;
  readonly demo: DemoStatus;
  readonly onStartGuide: () => void;
  readonly onExplore: () => void;
}

export interface QueueProps {
  readonly batch: BatchSummary | null;
  readonly batches: readonly BatchSummary[];
  readonly findings: readonly FindingView[]; // already filtered + in transparent case order
  readonly filter: QueueFilter;
  readonly onFilterChange: (filter: QueueFilter) => void;
  readonly hrefForCase: (findingId: string) => RouteHref;
  readonly hrefForBatch: (batchId: string) => RouteHref;
  readonly demo: DemoStatus;
  readonly onLoadDemo: () => void;
  readonly onResetDemo: () => void; // explicit reset of this visitor's local state (UI must confirm first)
}

export interface CaseProps {
  readonly view: CaseView;
  readonly form: DecisionForm;
  readonly onFormChange: (form: DecisionForm) => void;
  readonly onAction: (action: ReviewAction) => void;
  readonly save: SaveStatus;
  readonly durability: Durability;
  readonly guideHint: string | null;
  readonly queueHref: RouteHref;
  readonly prevHref: RouteHref | null;
  readonly nextHref: RouteHref | null;
  /** Editable suggestions for the reason field (fictional "Demo reviewer" default lives in form). */
  readonly suggestedReasons: readonly string[];
}

export interface ResultsProps {
  readonly benchmark: BenchmarkFile | null;
  readonly benchmarkError: string | null;
  readonly visitor: BatchSummary | null; // current visitor's demo batch counts (separate from benchmark)
}

export interface RoadmapProps {
  readonly modules: readonly ModuleStatus[];
}

export interface NotFoundProps {
  readonly message: string;
  readonly homeHref: RouteHref;
  readonly onLoadDemo: (() => void) | null; // offered when a deep link targets the demo batch on a fresh device
}
