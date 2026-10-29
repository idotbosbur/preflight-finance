import { useEffect, useRef } from "react";
import { LensChrome } from "../art/LensChrome.tsx";

/** Choreography (ms). Draw → words part → glint → logo flies into the nav while the curtain dissolves. */
const FLY_AT = 1850;
const FLY_MS = 750;
const DONE_AT = FLY_AT + FLY_MS + 50;

const SEEN_KEY = "preflight.introSeen";

/** Plays once per browser session on the landing page; never for reduced-motion visitors. */
export function shouldPlayIntro(): boolean {
  if (typeof window === "undefined") return false;
  if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return false;
  try {
    return !window.sessionStorage.getItem(SEEN_KEY);
  } catch {
    return true; // storage blocked: the short intro simply plays
  }
}

/**
 * Brand intro: the check-P draws itself in chrome, "Pre" and "flight" part around it, a glint runs
 * along the tube, then the mark flies into its place in the top bar while the curtain dissolves.
 * Decorative (aria-hidden). Click or any key skips. html[data-intro] lets the hero time its entrance
 * and keeps the nav mark hidden until the flying mark lands on it.
 */
export function Intro({ onDone }: { readonly onDone: () => void }) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const markRef = useRef<HTMLSpanElement | null>(null);

  useEffect(() => {
    try { window.sessionStorage.setItem(SEEN_KEY, "1"); } catch { /* convenience only */ }
    const html = document.documentElement;
    html.dataset.intro = "playing";
    const timers: number[] = [];
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      onDone();
    };

    const fly = () => {
      const root = rootRef.current;
      const mark = markRef.current;
      const target = document.querySelector<HTMLElement>(".topnav .brand-mark");
      root?.classList.add("is-flying");
      html.dataset.intro = "landing";
      if (mark && target && typeof mark.animate === "function") {
        const from = mark.getBoundingClientRect();
        const to = target.getBoundingClientRect();
        const dx = to.left + to.width / 2 - (from.left + from.width / 2);
        const dy = to.top + to.height / 2 - (from.top + from.height / 2);
        const scale = to.width / from.width;
        mark.animate(
          [{ transform: "none" }, { transform: `translate(${dx}px, ${dy}px) scale(${scale})` }],
          { duration: FLY_MS, easing: "cubic-bezier(0.7, 0, 0.2, 1)", fill: "forwards" },
        );
      }
      timers.push(window.setTimeout(finish, FLY_MS + 50));
    };

    timers.push(window.setTimeout(fly, FLY_AT));
    timers.push(window.setTimeout(finish, DONE_AT + 400)); // safety net
    const skip = () => finish();
    window.addEventListener("keydown", skip, { once: true });
    return () => {
      timers.forEach((t) => window.clearTimeout(t));
      window.removeEventListener("keydown", skip);
      delete html.dataset.intro;
    };
  }, [onDone]);

  return (
    <div ref={rootRef} className="intro" aria-hidden="true" onClick={onDone}>
      <div className="intro-lockup">
        <span className="intro-word intro-word-left"><span>Catch</span></span>
        <span ref={markRef} className="intro-mark-wrap">
          <LensChrome className="intro-mark" assemble />
        </span>
        <span className="intro-word intro-word-right"><span>fold</span></span>
      </div>
      <p className="intro-caption">Free bill checker · nothing uploaded</p>
      <p className="intro-skip">Click or press any key to skip</p>
    </div>
  );
}
