import type { ReactElement } from "react";
import { DualCta } from "./Cta";
import { Icon } from "./Icon";
import { Reveal } from "./Reveal";
import { SectionHeading } from "./SectionHeading";
import { CITIES } from "./content";

/**
 * Rough relative placement of each city (north up), so the list reads as a
 * map without linking out to one. Rome sits far west; Dunwoody southeast.
 */
const PLACEMENT: Record<(typeof CITIES)[number], string> = {
  Rome: "lg:col-start-1 lg:row-start-2",
  Woodstock: "lg:col-start-3 lg:row-start-1",
  Milton: "lg:col-start-4 lg:row-start-1",
  Alpharetta: "lg:col-start-5 lg:row-start-2",
  "Johns Creek": "lg:col-start-6 lg:row-start-2",
  Marietta: "lg:col-start-2 lg:row-start-3",
  Roswell: "lg:col-start-4 lg:row-start-3",
  Dunwoody: "lg:col-start-5 lg:row-start-4",
};

export function ServiceArea(): ReactElement {
  return (
    <section
      id="service-area"
      aria-labelledby="service-area-heading"
      className="relative overflow-hidden border-y border-line bg-surface py-20 lg:py-28"
    >
      <span
        aria-hidden="true"
        className="pointer-events-none absolute -right-8 bottom-0 select-none text-[clamp(10rem,28vw,24rem)] font-extrabold leading-[0.8] text-transparent opacity-40 [-webkit-text-stroke:2px_var(--color-line)]"
      >
        GA
      </span>
      <div className="relative mx-auto max-w-[1240px] px-4 sm:px-6">
        <SectionHeading
          id="service-area-heading"
          eyebrow="Service area"
          title="Eight Georgia cities, starting from Alpharetta."
          intro="If your home is in one of these cities, you are in our roof-replacement footprint. Light commercial inquiries are welcome."
        />
        <ul className="mt-12 grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6 lg:grid-rows-4 lg:gap-4">
          {CITIES.map((city, index) => (
            <Reveal
              as="li"
              key={city}
              delay={index * 50}
              className={`group flex items-center gap-2 rounded-[2px] border border-line bg-ink px-4 py-3.5 transition-colors duration-150 hover:border-gold ${PLACEMENT[city]}`}
            >
              <Icon name="mapPin" size={20} className="shrink-0 text-gold" />
              <span className="font-bold text-white">
                {city}
                <span className="text-muted">, GA</span>
              </span>
            </Reveal>
          ))}
        </ul>
        <DualCta location="service-area" />
      </div>
    </section>
  );
}
