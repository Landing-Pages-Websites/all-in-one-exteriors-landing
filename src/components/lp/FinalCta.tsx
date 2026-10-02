import Image from "next/image";
import type { ReactElement } from "react";
import { managedSiteFieldAttributesV1 } from "@landing-pages-websites/managed-site-contract";

import { managedHome } from "@/content/managed-site";
import { PhoneLink } from "./PhoneLink";
import { Icon } from "./Icon";
import { RoofEstimateForm } from "./RoofEstimateForm";
import { FINAL_FORM_ANCHOR, WARRANTY_QUALIFIER } from "./content";

const POINTS = [
  "GAF and CertainTeed certified",
  "NRCA low-slope and steep-slope certified",
  WARRANTY_QUALIFIER,
  "Ask about military and senior-citizen discounts",
] as const;

export function FinalCta(): ReactElement {
  const { heading } = managedHome.contact;
  return (
    <section
      id="form"
      aria-labelledby="final-cta-heading"
      className="relative isolate overflow-hidden bg-ink py-20 lg:py-28"
    >
      {/* Mobile: a photo band that fades into the ink field. Desktop: full
          background, darkened on the copy side so text stays well above AA. */}
      <div className="absolute inset-x-0 top-0 z-0 h-[26rem] bg-ink lg:inset-0 lg:h-auto">
        <Image
          src="/images/final-finished-home.webp"
          alt=""
          fill
          sizes="(min-width: 1024px) 100vw, 190vw"
          className="object-cover object-[50%_35%]"
        />
      </div>
      <div
        aria-hidden="true"
        className="absolute inset-0 z-0 bg-[linear-gradient(180deg,rgba(10,10,10,0.55)_0%,rgba(10,10,10,0.88)_18rem,#0a0a0a_26rem)] lg:bg-[linear-gradient(90deg,rgba(10,10,10,0.96)_0%,rgba(10,10,10,0.84)_45%,rgba(10,10,10,0.42)_100%)]"
      />
      <div
        aria-hidden="true"
        className="absolute inset-x-0 top-0 z-0 h-1.5 bg-brand"
      />
      <div className="relative z-10 mx-auto grid max-w-[1240px] gap-12 px-4 sm:px-6 lg:grid-cols-12 lg:items-center">
        <div className="lg:col-span-6">
          <p className="flex items-center gap-3 text-small font-bold uppercase tracking-[0.18em] text-gold">
            <span aria-hidden="true" className="h-[3px] w-8 bg-brand" />
            Ready when you are
          </p>
          <h2
            id="final-cta-heading"
            className="mt-4 text-h2 font-extrabold tracking-tight text-balance text-white"
            {...managedSiteFieldAttributesV1(heading.fieldId)}
          >
            {heading.value}
          </h2>
          <p className="mt-5 max-w-lg text-lg leading-relaxed text-muted">
            A certified, warranty-backed roof replacement from a local
            Alpharetta contractor that does it right the first time.
          </p>
          <ul className="mt-8 flex flex-col gap-3">
            {POINTS.map((point) => (
              <li
                key={point}
                className="flex items-start gap-3 font-semibold text-white"
              >
                <Icon
                  name="check"
                  size={20}
                  className="mt-0.5 shrink-0 text-gold"
                />
                {point}
              </li>
            ))}
          </ul>
          <div className="mt-10 flex flex-wrap items-center gap-4">
            <PhoneLink location="final-cta" />
            <p className="text-small font-semibold text-muted">
              or use the form to request your estimate
            </p>
          </div>
        </div>
        <div id={FINAL_FORM_ANCHOR} className="lg:col-span-5 lg:col-start-8">
          <RoofEstimateForm
            placement="final"
            heading="Request a Roof Estimate"
            headingLevel="h3"
          />
        </div>
      </div>
    </section>
  );
}
