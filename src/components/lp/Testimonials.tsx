import type { ReactElement } from "react";
import { DualCta } from "./DualCta";
import { Icon } from "./Icon";
import { Reveal } from "./Reveal";
import { SectionHeading } from "./SectionHeading";
import { TESTIMONIALS } from "./content";

function initials(name: string): string {
  const parts = name.split(" ").filter((part) => /^[A-Za-z]/.test(part));
  return `${parts[0]?.[0] ?? ""}${parts[parts.length - 1]?.[0] ?? ""}`;
}

export function Testimonials(): ReactElement {
  return (
    <section
      id="testimonials"
      aria-labelledby="testimonials-heading"
      className="border-y border-line bg-charcoal py-20 lg:py-28"
    >
      <div className="mx-auto max-w-[1240px] px-4 sm:px-6">
        <SectionHeading
          id="testimonials-heading"
          eyebrow="From Google reviews"
          title="On time, clean, and true to their word."
          intro="In their own words, from homeowners who hired us."
        />
        <div className="mt-12 columns-1 gap-5 md:columns-2 lg:columns-3 [&>*]:mb-5">
          {TESTIMONIALS.map((testimonial, index) => {
            const feature = index === 0 || index === 2;
            return (
              <Reveal
                as="figure"
                key={testimonial.name}
                delay={index * 80}
                className={`break-inside-avoid rounded-[2px] border border-line p-7 transition duration-150 ease-brand hover:-translate-y-1 hover:border-gold ${feature ? "bg-surface" : "bg-ink"}`}
              >
                <Icon name="quote" size={32} className="text-gold" />
                <blockquote
                  className={`mt-4 font-semibold leading-snug text-white ${feature ? "text-xl" : "text-h4"}`}
                >
                  <p>&ldquo;{testimonial.quote}&rdquo;</p>
                </blockquote>
                <figcaption className="mt-6 flex items-center gap-3 border-t border-line pt-5">
                  <span
                    aria-hidden="true"
                    className="grid h-10 w-10 place-items-center rounded-full bg-brand text-sm font-bold text-white"
                  >
                    {initials(testimonial.name)}
                  </span>
                  <span>
                    <span className="block font-bold text-white">
                      {testimonial.name}
                    </span>
                    <span className="block text-small font-medium text-muted">
                      Google review
                    </span>
                  </span>
                </figcaption>
              </Reveal>
            );
          })}
        </div>
        <DualCta location="testimonials" />
      </div>
    </section>
  );
}
