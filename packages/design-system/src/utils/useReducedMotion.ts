import { useEffect, useState } from "react";

/**
 * Returns true if the user prefers reduced motion.
 * North Star §7.5 — every animation must honor this.
 *
 * Components should branch:
 *   const reduce = useReducedMotion();
 *   <motion.div animate={...} transition={reduce ? { duration: 0 } : springs.smooth} />
 */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState<boolean>(() => {
    if (typeof window === "undefined" || !window.matchMedia) return false;
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  });

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return undefined;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const handler = (e: MediaQueryListEvent): void => setReduced(e.matches);
    // Safari < 14 uses addListener; modern browsers use addEventListener.
    if (mq.addEventListener) {
      mq.addEventListener("change", handler);
      return () => mq.removeEventListener("change", handler);
    }
    mq.addListener(handler);
    return () => mq.removeListener(handler);
  }, []);

  return reduced;
}
