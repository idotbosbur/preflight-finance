import { useEffect, useRef } from "react";

/**
 * Progressive-enhancement reveal. Content is fully visible by default (no class in markup).
 * Only when IntersectionObserver exists and the visitor has not asked for reduced motion does
 * this add `reveal-pending` (a ≤16px offset + fade) and swap it for `reveal-in` once visible.
 */
export function useReveal<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined" || typeof window === "undefined") return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    const rect = el.getBoundingClientRect();
    if (rect.top < window.innerHeight) return; // already on screen: never hide it
    el.classList.add("reveal-pending");
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            el.classList.remove("reveal-pending");
            el.classList.add("reveal-in");
            io.disconnect();
          }
        }
      },
      { rootMargin: "0px 0px -10% 0px" },
    );
    io.observe(el);
    return () => {
      io.disconnect();
      el.classList.remove("reveal-pending");
    };
  }, []);
  return ref;
}
