"use client";

import {
  useEffect,
  useRef,
  useState,
  type ElementType,
  type ReactElement,
  type ReactNode,
} from "react";

/**
 * Section reveal. Content renders visible on the server; only after hydration
 * is it armed (hidden) and brought back in on intersection, so no-JS visitors
 * and crawlers never see a blank section. Reduced motion is handled in CSS.
 */
export function Reveal({
  children,
  as: Tag = "div",
  delay = 0,
  className = "",
}: {
  children: ReactNode;
  as?: ElementType;
  delay?: number;
  className?: string;
}): ReactElement {
  const ref = useRef<HTMLElement>(null);
  const [state, setState] = useState<"static" | "armed" | "in">("static");

  useEffect(() => {
    const node = ref.current;
    if (!node || typeof IntersectionObserver === "undefined") return;
    // Already on screen at hydration (e.g. the hero): leave it alone.
    if (node.getBoundingClientRect().top < window.innerHeight * 0.9) return;
    setState("armed");
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setState("in");
          observer.disconnect();
        }
      },
      { rootMargin: "0px 0px -10% 0px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const stateClass =
    state === "static" ? "" : state === "armed" ? "reveal-armed" : "reveal-armed reveal-in";

  return (
    <Tag
      ref={ref}
      className={`${stateClass} ${className}`}
      style={delay ? { ["--reveal-delay" as string]: `${delay}ms` } : undefined}
    >
      {children}
    </Tag>
  );
}
