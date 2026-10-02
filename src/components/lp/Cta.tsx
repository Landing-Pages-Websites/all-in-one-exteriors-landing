"use client";

import type { ReactElement } from "react";
import { useTracking } from "@/hooks/useTracking";
import { Icon } from "./Icon";
import { FORM_ANCHOR, PHONE_DISPLAY, PHONE_HREF, PRIMARY_CTA } from "./content";

const base =
  "inline-flex min-h-12 items-center whitespace-nowrap justify-center gap-2 rounded-[2px] px-6 py-3.5 text-[0.875rem] font-bold uppercase tracking-[0.08em] transition duration-150 ease-brand focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold";

export const buttonStyles = {
  primary: `${base} bg-brand text-white shadow-[0_8px_24px_-12px_rgba(201,26,11,0.9)] hover:-translate-y-0.5 hover:bg-brand-hover active:translate-y-0 active:bg-brand-active disabled:translate-y-0 disabled:bg-disabled disabled:text-white/80 disabled:shadow-none`,
  phone: `${base} border-2 border-white/80 text-white hover:-translate-y-0.5 hover:border-gold hover:text-gold active:translate-y-0`,
  secondary: `${base} border-2 border-line bg-surface text-white hover:-translate-y-0.5 hover:border-gold active:translate-y-0`,
} as const;

export function EstimateLink({
  location,
  label = PRIMARY_CTA,
  target = FORM_ANCHOR,
  className = "",
}: {
  location: string;
  label?: string;
  target?: string;
  className?: string;
}): ReactElement {
  const { trackCtaClick } = useTracking();
  return (
    <a
      href={`#${target}`}
      onClick={() => trackCtaClick(label, location)}
      className={`${buttonStyles.primary} ${className}`}
    >
      {label}
      <Icon name="arrowRight" size={18} />
    </a>
  );
}

export function PhoneLink({
  location,
  className = "",
  compact = false,
}: {
  location: string;
  className?: string;
  /** Header use: number only on small screens to keep the bar on one line. */
  compact?: boolean;
}): ReactElement {
  const { trackPhoneClick } = useTracking();
  return (
    <a
      href={PHONE_HREF}
      onClick={() => trackPhoneClick(location)}
      className={`${buttonStyles.phone} ${className}`}
    >
      <Icon name="phone" size={18} />
      {compact ? (
        <>
          <span className="sr-only sm:not-sr-only">Call&nbsp;</span>
          {PHONE_DISPLAY}
        </>
      ) : (
        <>Call {PHONE_DISPLAY}</>
      )}
    </a>
  );
}

/** Every section closes on the same centered pair: form path plus phone path. */
export function DualCta({
  location,
  label = PRIMARY_CTA,
  target = FORM_ANCHOR,
}: {
  location: string;
  label?: string;
  target?: string;
}): ReactElement {
  return (
    <div className="mt-12 flex flex-wrap items-center justify-center gap-3">
      <EstimateLink location={location} label={label} target={target} />
      <PhoneLink location={location} />
    </div>
  );
}
