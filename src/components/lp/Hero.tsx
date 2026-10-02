import Image from "next/image";
import type { ReactElement } from "react";
import { managedSiteFieldAttributesV1 } from "@landing-pages-websites/managed-site-contract";

import { managedHome } from "@/content/managed-site";
import { PhoneLink } from "./PhoneLink";
import { Icon } from "./Icon";
import { RoofEstimateForm } from "./RoofEstimateForm";
import { CITY_LIST_TEXT, FORM_ANCHOR } from "./content";

const CREDENTIALS = [
  "GAF certified",
  "CertainTeed certified",
  "NRCA certified",
] as const;

/** Trailing words of the managed title that carry the gold accent. */
const ACCENT_WORD_COUNT = 2;

/** Splits the managed title so its closing words take the gold treatment. */
function splitTitle(title: string): { lead: string; accent: string } {
  const words = title.trim().split(/\s+/);
  const leadCount = Math.max(words.length - ACCENT_WORD_COUNT, 0);
  return {
    lead: words.slice(0, leadCount).join(" "),
    accent: words.slice(leadCount).join(" "),
  };
}

export function Hero(): ReactElement {
  const { eyebrow, title, description, image } = managedHome.hero;
  const { lead, accent } = splitTitle(title.value);
  return (
    <section
      id="hero"
      aria-labelledby="hero-heading"
      className="relative overflow-hidden bg-ink"
    >
      {/* Faint roofline grid behind the copy: pitch lines, not a gradient blob. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 opacity-[0.07] [background-image:repeating-linear-gradient(135deg,#ffffff_0_1px,transparent_1px_44px)]"
      />
      {/* Mobile reads head, form, proof, photo, so real fields sit high on a
          390px screen. Desktop: copy and photo left, form spanning the right. */}
      <div className="relative mx-auto grid max-w-[1240px] grid-cols-1 gap-x-12 px-4 pb-16 pt-6 sm:px-6 lg:grid-cols-12 lg:pb-24 lg:pt-10">
        <div className="lg:col-span-7 lg:row-start-1">
          <p className="flex items-center gap-3 text-small font-bold uppercase tracking-[0.1em] sm:tracking-[0.18em] text-gold">
            <span aria-hidden="true" className="h-[3px] w-8 bg-brand" />
            <span {...managedSiteFieldAttributesV1(eyebrow.fieldId)}>
              {eyebrow.value}
            </span>
          </p>
          <h1
            id="hero-heading"
            className="mt-4 text-h1 font-extrabold tracking-[-0.02em] text-balance text-white"
            {...managedSiteFieldAttributesV1(title.fieldId)}
          >
            {lead ? `${lead} ` : null}
            <span className="relative whitespace-nowrap text-gold">
              {accent}
            </span>
          </h1>
          <p
            className="mt-3 max-w-xl text-base leading-relaxed text-white sm:mt-4 sm:text-lg lg:mt-5"
            {...managedSiteFieldAttributesV1(description.fieldId)}
          >
            {description.value}
          </p>
        </div>

        <div
          id={FORM_ANCHOR}
          className="mt-5 sm:mt-6 lg:col-span-5 lg:col-start-8 lg:row-span-3 lg:row-start-1 lg:mt-0 lg:self-start"
        >
          <RoofEstimateForm
            placement="hero"
            heading="Request a Roof Estimate"
          />
        </div>

        <div className="mt-10 lg:col-span-7 lg:row-start-2 lg:mt-5">
          <p className="max-w-xl leading-relaxed text-muted">
            Serving {CITY_LIST_TEXT} with manufacturer-backed warranties. If
            something isn&apos;t right, we come back until it is. Light
            commercial welcome.
          </p>
          <ul
            className="mt-6 flex flex-wrap gap-2 lg:mt-5"
            aria-label="Certifications"
          >
            {CREDENTIALS.map((credential) => (
              <li
                key={credential}
                className="inline-flex items-center gap-1.5 rounded-[2px] border border-gold/70 px-3 py-1.5 text-small font-semibold text-white"
              >
                <Icon name="award" size={16} className="text-gold" />
                {credential}
              </li>
            ))}
          </ul>
          <div className="mt-8 flex flex-wrap gap-3 lg:mt-6">
            <PhoneLink location="hero" />
          </div>
        </div>

        {/* Photo: a full-bleed band on mobile, a gable-clipped frame under the copy on desktop. */}
        <figure className="relative -mx-4 mt-10 sm:mx-0 lg:col-span-7 lg:col-start-1 lg:row-start-3 lg:mt-8">
          <div className="relative aspect-[3/2] overflow-hidden lg:[clip-path:polygon(0_10%,50%_0,100%_10%,100%_100%,0_100%)]">
            {/* The managed source is square (asset slot policy); object-cover
                centers it, showing the same 3:2 frame as the original photo. */}
            <Image
              src={image.src}
              alt={image.alt}
              width={image.width}
              height={image.height}
              preload
              sizes="(min-width: 1240px) 700px, (min-width: 1024px) 58vw, 100vw"
              className="h-full w-full object-cover object-center transition-transform duration-200 ease-brand hover:scale-[1.02]"
              {...managedSiteFieldAttributesV1(image.fieldId)}
            />
          </div>
          <figcaption className="absolute bottom-3 left-4 flex items-center gap-2 rounded-[2px] bg-ink/90 px-3 py-2 text-small font-semibold text-white sm:left-3 lg:bottom-5 lg:left-5">
            <Icon name="mapPin" size={16} className="text-gold" />
            Completed home exterior, Alpharetta, GA
          </figcaption>
        </figure>
      </div>
    </section>
  );
}
