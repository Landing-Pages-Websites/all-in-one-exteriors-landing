"use client";

import { useEffect, useState, type ReactElement } from "react";
import { EstimateLink } from "./Cta";
import { FINAL_FORM_ANCHOR, FORM_ANCHOR } from "./content";

/**
 * Form-only sticky CTA. Appears once the hero form has scrolled away and hides
 * whenever either form is on screen, so it never covers the thing it points to.
 */
export function FloatingCta(): ReactElement {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const targets = [FORM_ANCHOR, FINAL_FORM_ANCHOR, "hero"]
      .map((id) => document.getElementById(id))
      .filter((node): node is HTMLElement => node !== null);
    if (targets.length === 0 || typeof IntersectionObserver === "undefined") return;
    const onScreen = new Set<Element>();
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) onScreen.add(entry.target);
        else onScreen.delete(entry.target);
      }
      setVisible(onScreen.size === 0);
    });
    targets.forEach((node) => observer.observe(node));
    return () => observer.disconnect();
  }, []);

  return (
    <div
      className={`fixed inset-x-0 bottom-0 z-30 border-t border-line bg-ink/95 p-3 backdrop-blur transition duration-500 ease-brand lg:inset-x-auto lg:bottom-6 lg:right-6 lg:border-0 lg:bg-transparent lg:p-0 lg:backdrop-blur-none ${visible ? "translate-y-0 opacity-100" : "pointer-events-none translate-y-full opacity-0 lg:translate-y-8"}`}
      aria-hidden={!visible}
      inert={!visible}
    >
      <EstimateLink
        location="floating-bar"
        target={FINAL_FORM_ANCHOR}
        className="w-full lg:w-auto lg:shadow-[0_18px_40px_-12px_rgba(0,0,0,0.9)]"
      />
    </div>
  );
}
