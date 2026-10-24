import { useEffect, useRef } from "react";
import { darknessAt } from "../art/ChromeField.tsx";

const LIGHT = [255, 255, 255];
const DARK = [17, 18, 20];
const mix = (a: readonly number[], b: readonly number[], t: number) => a.map((v, i) => Math.round(v + (b[i]! - v) * t)).join(", ");
const VARS = ["--ov-bg", "--ov-nav-bg", "--ov-fg", "--ov-fg-soft", "--ov-rule", "--ov-card", "--ov-hover"] as const;

/**
 * Fades the whole page (top bar, sections, footer) from white to near-black as the first `data-chrome="dark"` section
 * approaches, following scroll position, and keeps it dark from there to the end. Colours are CSS variables on <html>,
 * so the top bar and footer outside the page element follow too; they are removed when the page unmounts, leaving
 * every other page on its normal light defaults. Text flips a little faster than the background to stay readable.
 */
export function useDarkScroll<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const root = document.documentElement.style;
    let lastDark = -1;
    // Runs on every scroll event: a dozen rect reads, and style writes only when the value changes.
    const update = () => {
      const vh = window.innerHeight;
      const sections = Array.from(el.querySelectorAll<HTMLElement>("[data-chrome]")).map((s) => {
        const r = s.getBoundingClientRect();
        return { top: r.top, bottom: r.bottom, mode: s.dataset.chrome ?? "" };
      });
      const dark = Math.round(darknessAt(sections, vh / 2, vh * 0.6) * 1000) / 1000;
      if (dark === lastDark) return;
      lastDark = dark;
      const ink = Math.min(1, Math.max(0, (dark - 0.3) / 0.4)); // text flips between 30% and 70% darkness
      const bg = mix(LIGHT, DARK, dark);
      root.setProperty("--ov-bg", `rgb(${bg})`);
      root.setProperty("--ov-nav-bg", `rgba(${bg}, 0.72)`);
      root.setProperty("--ov-fg", `rgb(${mix([24, 24, 24], [243, 243, 241], ink)})`);
      root.setProperty("--ov-fg-soft", `rgb(${mix([92, 92, 92], [176, 179, 184], ink)})`);
      root.setProperty("--ov-rule", `rgba(${mix([24, 24, 24], [255, 255, 255], ink)}, ${0.1 + 0.04 * ink})`);
      root.setProperty("--ov-card", `rgba(255, 255, 255, ${0.72 - 0.66 * dark})`);
      root.setProperty("--ov-hover", `rgba(${mix([24, 24, 24], [255, 255, 255], ink)}, 0.07)`);
    };
    update();
    window.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    return () => {
      window.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
      for (const v of VARS) root.removeProperty(v);
    };
  }, []);
  return ref;
}
