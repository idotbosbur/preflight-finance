import { LensMark } from "../art/LensMark.tsx";
import { LensChrome } from "../art/LensChrome.tsx";
import { useEffect, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent, RefObject } from "react";
import type { AppShellProps, GuideView, Route } from "../ui-contracts.ts";
import type { Durability } from "../domain/contracts.ts";
import { FEEDBACK_URL, SYNTHETIC_LABEL } from "../domain/contracts.ts";
import { DEMO_BADGE, OWN_BADGE } from "./labels.ts";

const OWN_LABEL = "Your data stays in this browser. Nothing is uploaded.";

interface NavItem {
  readonly href: string;
  readonly label: string;
  readonly match: readonly Route["name"][];
}

export const NAV_ITEMS: readonly NavItem[] = [
  { href: "#/demo", label: "Demo", match: ["demo", "queue", "case"] },
  { href: "#/mine", label: "Your files", match: ["mine", "mine-summary"] },
  { href: "#/results", label: "Results", match: ["results"] },
  { href: "#/how", label: "How it works", match: ["how"] },
  { href: "#/roadmap", label: "Roadmap", match: ["roadmap"] },
];

/** The footer's single "what next" step, chosen for the page the visitor is on. */
export function nextStep(route: Route, own = false): { readonly kicker: string; readonly label: string; readonly href: string } {
  if (own && (route.name === "queue" || route.name === "case")) {
    return { kicker: "Next", label: "Add files or delete your data", href: "#/mine" };
  }
  switch (route.name) {
    case "demo":
    case "queue":
    case "case":
      return { kicker: "Next", label: "See how the checks scored", href: "#/results" };
    case "mine":
    case "mine-summary":
      return { kicker: "Next", label: "See how the checks work", href: "#/how" };
    case "results":
      return { kicker: "Next", label: "Try it yourself", href: "#/demo" };
    default:
      return { kicker: "See it work", label: "Try the synthetic demo", href: "#/demo" };
  }
}

export const MEMORY_BANNER =
  "Not saved: browser storage is unavailable, so decisions in this tab will be lost on reload";

export const ATTRIBUTION =
  "Concept and product decisions: the project owner. Code and tests: written by Claude. Coordination and browser QA: Codex.";

const MAIN_ID = "main-content";
const MENU_ID = "mobile-menu";

const PAGE_NAME: Readonly<Record<Route["name"], string>> = {
  overview: "Overview",
  demo: "Guided demo",
  queue: "Review queue",
  case: "Investigation",
  results: "Results",
  how: "How it works",
  roadmap: "Roadmap",
  feedback: "Feedback",
  mine: "Your files",
  "mine-summary": "Your data summary",
  not_found: "Page not found",
};

/** document.title for a route: "<page name> | Preflight (synthetic demo)", or no suffix in own mode. */
export function pageTitle(route: Route, own = false): string {
  return own ? `${PAGE_NAME[route.name]} | Preflight` : `${PAGE_NAME[route.name]} | Preflight (synthetic demo)`;
}

/** Move focus only on a real route change after the first render (never on initial load). */
export function shouldFocusOnRouteChange(previousKey: string | null, nextKey: string): boolean {
  return previousKey !== null && previousKey !== nextKey;
}

interface FocusableLike {
  focus(): void;
  hasAttribute(name: string): boolean;
  setAttribute(name: string, value: string): void;
}
interface MainLike extends FocusableLike {
  querySelector(selectors: string): FocusableLike | null;
}

/** The destination page's first h1 inside main (made programmatically focusable), else main itself. */
export function routeFocusTarget(main: MainLike): FocusableLike {
  const heading = main.querySelector("h1");
  const target = heading ?? main;
  if (!target.hasAttribute("tabindex")) target.setAttribute("tabindex", "-1");
  return target;
}

export function guideCompleteCopy(durability: Durability): string {
  return durability === "memory"
    ? "Guide complete. Browser storage is unavailable, so your decisions are kept only in this tab and will be lost on reload."
    : "Guide complete. Your decisions stay in this browser until you reset the demo data.";
}

function focusMain(event: ReactMouseEvent<HTMLAnchorElement>) {
  // Hash routing owns location.hash, so the skip link moves focus without changing the URL.
  event.preventDefault();
  const main = document.getElementById(MAIN_ID);
  main?.focus();
}

function NavLinks({ route, own, onNavigate, className }: { readonly route: Route; readonly own: boolean; readonly onNavigate?: (href: string) => void; readonly className: string }) {
  return (
    <ul className={className}>
      {NAV_ITEMS.map((item) => {
        const current = own ? item.href === "#/mine" : item.match.includes(route.name);
        return (
          <li key={item.href}>
            <a href={item.href} aria-current={current ? "page" : undefined} className={current ? "nav-link is-current" : "nav-link"} onClick={onNavigate ? () => onNavigate(item.href) : undefined}>
              {item.label}
            </a>
          </li>
        );
      })}
    </ul>
  );
}

const STATUS_WORD = { done: "Done", current: "Current step", upcoming: "Upcoming" } as const;

export function GuideBar({ guide, onExit, durability }: { readonly guide: GuideView; readonly onExit: () => void; readonly durability: Durability }) {
  const total = guide.steps.length;
  const position = guide.complete ? total : Math.min(guide.currentIndex + 1, total);
  return (
    <section className="guide" aria-labelledby="guide-heading">
      <div className="guide-head">
        <h2 id="guide-heading" className="guide-title">
          Guided demo{" "}
          <span className="muted">
            {guide.complete ? "· complete" : `· step ${position} of ${total}`}
          </span>
        </h2>
        <button type="button" className="btn btn-quiet" onClick={onExit}>
          Exit guide
        </button>
      </div>
      <ol className="guide-steps">
        {guide.steps.map((step) => (
          <li key={step.id} className={`guide-step is-${step.status}`} aria-current={step.status === "current" ? "step" : undefined}>
            <span className="guide-status">{STATUS_WORD[step.status]}</span>
            <span className="guide-step-title">
              {step.href && step.status !== "upcoming" ? <a href={step.href}>{step.title}</a> : step.title}
            </span>
            {step.status === "current" ? <span className="guide-instruction">{step.instruction}</span> : null}
            {step.note ? <span className="guide-note">{step.note}</span> : null}
          </li>
        ))}
      </ol>
      {guide.complete ? <p className="guide-done">{guideCompleteCopy(durability)}</p> : null}
    </section>
  );
}

interface MobileMenuProps {
  readonly route: Route;
  readonly own: boolean;
  /** restoreFocus=false when the close is caused by navigation (the route-focus effect wins). */
  readonly onClose: (restoreFocus: boolean) => void;
  readonly triggerRef: RefObject<HTMLButtonElement | null>;
  readonly restoreRef: RefObject<boolean>;
}

/** A link to the current hash causes no route change, so the menu must restore focus itself. */
function isCurrentHash(href: string): boolean {
  const hash = window.location.hash || "#/";
  return hash === href;
}

function MobileMenu({ route, own, onClose, triggerRef, restoreRef }: MobileMenuProps) {
  const panelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const first = panelRef.current?.querySelector<HTMLElement>("a, button");
    first?.focus();
    const trigger = triggerRef.current;
    return () => {
      // Restore focus to the Menu button after the background is no longer inert,
      // unless the menu closed because of navigation (then the page heading gets focus).
      if (restoreRef.current) requestAnimationFrame(() => trigger?.focus());
    };
  }, [triggerRef, restoreRef]);

  function onKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      onClose(true);
      return;
    }
    if (event.key !== "Tab" || !panelRef.current) return;
    const focusables = Array.from(panelRef.current.querySelectorAll<HTMLElement>("a[href], button:not([disabled])"));
    if (focusables.length === 0) return;
    const first = focusables[0]!;
    const last = focusables[focusables.length - 1]!;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  return (
    <div className="menu-overlay">
      <div className="menu-scrim" aria-hidden="true" onClick={() => onClose(true)} />
      <div id={MENU_ID} ref={panelRef} className="menu-panel" role="dialog" aria-modal="true" aria-label="Site menu" onKeyDown={onKeyDown}>
        <div className="menu-panel-head">
          <span className="badge badge-synthetic">{own ? OWN_BADGE : DEMO_BADGE}</span>
          <button type="button" className="btn btn-quiet" onClick={() => onClose(true)}>
            Close menu
          </button>
        </div>
        <a href="#/" className="menu-home" onClick={() => onClose(isCurrentHash("#/"))}>Preflight overview</a>
        <NavLinks route={route} own={own} onNavigate={(href) => onClose(isCurrentHash(href))} className="menu-links" />
      </div>
    </div>
  );
}

/** Shown only when a feedback URL is configured. */
export function FeedbackLink({ url }: { url: string }) {
  if (!url) return null;
  return url.startsWith("#") ? <a href={url}>Feedback</a> : <a href={url} target="_blank" rel="noopener noreferrer">Send feedback</a>;
}

/** Big footer rows on the landing page. */
const FOOTER_ROWS: readonly (readonly [string, string])[] = [
  ["#/mine", "Check your bills"],
  ["#/demo", "Try the demo"],
  ["#/how", "How it works"],
  ["#/roadmap", "What's next"],
];

function SiteLinks({ feedbackUrl }: { feedbackUrl: string }) {
  return (
    <nav className="footer-links" aria-label="About">
      <a href="./privacy.html">Privacy</a>
      <a href="./terms.html">Terms</a>
      <a href="./pilot-guide.html">Guide</a>
      <a href="./companies.html">Companies</a>
      <FeedbackLink url={feedbackUrl} />
    </nav>
  );
}

export function AppShell({ route, guide, onGuideExit, durability, announcement, own = false, feedbackUrl = FEEDBACK_URL, children }: AppShellProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const restoreRef = useRef(true);
  const prevRouteKey = useRef<string | null>(null);

  function closeMenu(restoreFocus: boolean) {
    restoreRef.current = restoreFocus;
    setMenuOpen(false);
  }

  // On every route change: close the menu without restoring its focus, update the title and,
  // except on the initial load, move focus to the destination page's main heading.
  const routeKey = JSON.stringify(route);
  useEffect(() => {
    restoreRef.current = false;
    setMenuOpen(false);
    document.title = pageTitle(route, own);
    const move = shouldFocusOnRouteChange(prevRouteKey.current, routeKey);
    prevRouteKey.current = routeKey;
    if (!move) return;
    // rAF: runs after the menu's own (queued-earlier) rAF restore, so heading focus wins.
    const id = requestAnimationFrame(() => {
      const main = document.getElementById(MAIN_ID);
      if (main) routeFocusTarget(main).focus();
    });
    return () => cancelAnimationFrame(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- routeKey captures route
  }, [routeKey, own]);

  return (
    <div className="shell">
      <a className="skip-link" href={`#${MAIN_ID}`} onClick={focusMain} inert={menuOpen}>
        Skip to main content
      </a>
      <header className="topbar" inert={menuOpen}>
        <nav className="topnav" aria-label="Main">
          <a href="#/" className="brand" aria-current={route.name === "overview" ? "page" : undefined}>
            <LensMark className="brand-mark" />
            Preflight
          </a>
          <NavLinks route={route} own={own} className="nav-links" />
          <span className={own ? "badge badge-synthetic badge-own" : "badge badge-synthetic"} title={own ? OWN_LABEL : SYNTHETIC_LABEL}>
            {own ? OWN_BADGE : DEMO_BADGE}
          </span>
          <button
            ref={triggerRef}
            type="button"
            className="btn btn-quiet menu-trigger"
            aria-expanded={menuOpen}
            aria-controls={MENU_ID}
            onClick={() => {
              restoreRef.current = true;
              setMenuOpen(true);
            }}
          >
            Menu
          </button>
        </nav>
      </header>
      {menuOpen ? <MobileMenu route={route} own={own} onClose={closeMenu} triggerRef={triggerRef} restoreRef={restoreRef} /> : null}
      <div className="shell-body" inert={menuOpen}>
        {durability === "memory" ? (
          <p className="banner banner-warn" role="alert">
            {MEMORY_BANNER}
          </p>
        ) : null}
        {guide?.active && !own ? <GuideBar guide={guide} onExit={onGuideExit} durability={durability} /> : null}
        <main id={MAIN_ID} tabIndex={-1} className="main">
          {children}
        </main>
        {route.name === "overview" ? (
          <footer className="footer footer-hero">
            <div className="fh-grid">
              <nav className="fh-big" aria-label="Footer">
                {FOOTER_ROWS.map(([href, label]) => (
                  <a key={href} className="fh-row" href={href}>
                    <span>{label}</span>
                    <span className="fh-arrow" aria-hidden="true">→</span>
                  </a>
                ))}
              </nav>
              <div className="fh-side">
                <p className="fh-claim">Your files never leave your browser.</p>
                <SiteLinks feedbackUrl={feedbackUrl} />
              </div>
            </div>
            <p className="fh-fine">
              <span className="footer-label">{own ? OWN_LABEL : SYNTHETIC_LABEL}</span> <span className="footer-attrib">{ATTRIBUTION}</span>
            </p>
            <p className="footer-wordmark" aria-hidden="true">
              <span>Pre</span>
              <LensChrome className="footer-lens" />
              <span>flight</span>
            </p>
          </footer>
        ) : (
          <footer className="footer footer-compact">
            <a className="footer-next" href={nextStep(route, own).href}>
              <span className="footer-next-kicker">{nextStep(route, own).kicker}</span>
              <span className="footer-next-line">
                {nextStep(route, own).label}
                <span className="footer-next-arrow" aria-hidden="true">→</span>
              </span>
            </a>
            <div className="footer-fine">
              <LensMark className="footer-brand-mark" />
              <p className="footer-label">{own ? OWN_LABEL : SYNTHETIC_LABEL}</p>
              <p className="footer-credit">Concept: project owner · Code: Claude · QA: Codex</p>
              <SiteLinks feedbackUrl={feedbackUrl} />
            </div>
          </footer>
        )}
      </div>
      <div className="sr-only" aria-live="polite" role="status">
        {announcement}
      </div>
    </div>
  );
}
