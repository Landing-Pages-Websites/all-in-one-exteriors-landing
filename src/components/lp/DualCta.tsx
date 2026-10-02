import type { ReactElement } from "react";
import { EstimateLink } from "./EstimateLink";
import { PhoneLink } from "./PhoneLink";
import { FORM_ANCHOR, PRIMARY_CTA } from "./content";

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
