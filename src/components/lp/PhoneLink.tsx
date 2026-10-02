"use client";

import type { ReactElement } from "react";
import { useTracking } from "@/hooks/useTracking";
import { buttonStyles } from "./buttonStyles";
import { Icon } from "./Icon";
import { PHONE_DISPLAY, PHONE_HREF } from "./content";

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
