import { useEffect, useRef } from "react";
import { darknessAt } from "../art/ChromeField.tsx";

const LIGHT = [255, 255, 255];
const DARK = [17, 18, 20];
const mix = (a: readonly number[], b: readonly number[], t: number) => a.map((v, i) => Math.round(v + (b[i]! - v) * t)).join(", ");

/**
 * Fades the page from white to near-black around `data-chrome="dark"` sections, following scroll position.
 * Sets --ov-bg on the element, plus --ov-fg / --ov-fg-soft / --ov-rule, which flip a little faster than the
 * background so text stays readable through the fade.
 */
export function useDarkScroll<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
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
      el.style.setProperty("--ov-bg", `rgb(${mix(LIGHT, DARK, dark)})`);
      el.style.setProperty("--ov-fg", `rgb(${mix([24, 24, 24], [243, 243, 241], ink)})`);
      el.style.setProperty("--ov-fg-soft", `rgb(${mix([92, 92, 92], [176, 179, 184], ink)})`);
      el.style.setProperty("--ov-rule", `rgba(${mix([24, 24, 24], [255, 255, 255], ink)}, ${0.12 + 0.02 * ink})`);
    };
    update();
    window.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    return () => {
      window.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, []);
  return ref;
}
