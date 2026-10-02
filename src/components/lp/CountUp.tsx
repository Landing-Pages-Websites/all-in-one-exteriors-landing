"use client";

import { useEffect, useRef, useState, type ReactElement } from "react";

/**
 * Counts an integer up from zero once it scrolls into view. Server markup and
 * reduced-motion visitors get the final number immediately.
 */
export function CountUp({ to, durationMs = 900 }: { to: number; durationMs?: number }): ReactElement {
  const ref = useRef<HTMLSpanElement>(null);
  const [value, setValue] = useState(to);

  useEffect(() => {
    const node = ref.current;
    if (!node || typeof IntersectionObserver === "undefined") return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let frame = 0;
    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      observer.disconnect();
      const start = performance.now();
      const tick = (now: number): void => {
        const t = Math.min(1, (now - start) / durationMs);
        // easeOutExpo, matching the brand reveal curve's feel.
        const eased = t === 1 ? 1 : 1 - 2 ** (-10 * t);
        setValue(Math.round(eased * to));
        if (t < 1) frame = requestAnimationFrame(tick);
      };
      setValue(0);
      frame = requestAnimationFrame(tick);
    });
    observer.observe(node);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [to, durationMs]);

  return <span ref={ref}>{value}</span>;
}
