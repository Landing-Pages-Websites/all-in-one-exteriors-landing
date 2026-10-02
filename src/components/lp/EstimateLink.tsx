"use client";

import type { ReactElement } from "react";
import { useTracking } from "@/hooks/useTracking";
import { buttonStyles } from "./buttonStyles";
import { Icon } from "./Icon";
import { FORM_ANCHOR, PRIMARY_CTA } from "./content";

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
