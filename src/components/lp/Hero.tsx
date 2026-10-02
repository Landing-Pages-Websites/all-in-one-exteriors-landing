import Image from "next/image";
import type { ReactElement } from "react";
import { PhoneLink } from "./Cta";
import { Icon } from "./Icon";
import { RoofEstimateForm } from "./RoofEstimateForm";
import { FORM_ANCHOR } from "./content";

const CREDENTIALS = [
  "GAF certified",
  "CertainTeed certified",
  "NRCA certified",
] as const;

export function Hero(): ReactElement {
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
          <p className="flex items-center gap-3 text-small font-bold uppercase tracking-[0.18em] text-gold">
            <span aria-hidden="true" className="h-[3px] w-8 bg-brand" />
            North Metro Atlanta roof replacement
          </p>
          <h1
            id="hero-heading"
            className="mt-4 text-h1 font-extrabold tracking-[-0.02em] text-balance text-white"
          >
            Your new roof, done right the{" "}
            <span className="relative whitespace-nowrap text-gold">
              first time.
            </span>
          </h1>
          <p className="mt-4 max-w-xl text-lg leading-relaxed text-white lg:mt-5">
            Certified, warranty-backed roof replacement for homeowners across
            eight North Metro Atlanta cities.
          </p>
        </div>

        <div
          id={FORM_ANCHOR}
          className="mt-6 lg:col-span-5 lg:col-start-8 lg:row-span-3 lg:row-start-1 lg:mt-0 lg:self-start"
        >
          <RoofEstimateForm
            placement="hero"
            heading="Request a Roof Estimate"
          />
        </div>

        <div className="mt-10 lg:col-span-7 lg:row-start-2 lg:mt-5">
          <p className="max-w-xl leading-relaxed text-muted">
            Serving Alpharetta, Milton, Johns Creek, Marietta, Woodstock, Rome,
            Roswell, and Dunwoody with manufacturer-backed warranties. If
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
                className="inline-flex items-center gap-1.5 rounded-[2px] border border-gold/70 px-3 py-1.5 text-small font-semibold text-white transition-colors duration-150 hover:bg-gold hover:text-black"
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
            <Image
              src="/images/hero-finished-home.webp"
              alt="Two-story stone and siding home with a finished metal roof in Alpharetta, GA"
              fill
              preload
              sizes="(min-width: 1240px) 700px, (min-width: 1024px) 58vw, 100vw"
              className="object-cover object-[50%_40%] transition-transform duration-500 ease-brand hover:scale-[1.02]"
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
