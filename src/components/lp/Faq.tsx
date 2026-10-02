import type { ReactElement } from "react";
import { DualCta } from "./Cta";
import { Icon } from "./Icon";
import { SectionHeading } from "./SectionHeading";
import { FAQ_ITEMS } from "./content";

/** Native <details> accordion: keyboard and screen-reader support for free. */
export function Faq(): ReactElement {
  return (
    <section id="faq" aria-labelledby="faq-heading" className="bg-ink py-20 lg:py-28">
      <div className="mx-auto grid max-w-[1240px] gap-12 px-4 sm:px-6 lg:grid-cols-12">
        <div className="lg:col-span-4">
          <SectionHeading
            id="faq-heading"
            eyebrow="Questions"
            title="Straight answers before you call."
          />
        </div>
        <div className="border-t-4 border-brand lg:col-span-8">
          {FAQ_ITEMS.map((item) => (
            <details key={item.question} className="group border-b border-line">
              <summary className="flex min-h-16 cursor-pointer list-none items-center justify-between gap-6 py-5 text-left text-h4 font-bold text-white transition-colors duration-150 hover:text-gold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold group-open:text-gold [&::-webkit-details-marker]:hidden">
                {item.question}
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-[2px] border border-line text-gold transition-transform duration-150 ease-brand group-open:rotate-45 group-open:border-gold">
                  <Icon name="plus" size={20} />
                </span>
              </summary>
              <p className="max-w-2xl pb-6 pr-12 leading-relaxed text-muted">{item.answer}</p>
            </details>
          ))}
        </div>
      </div>
      <div className="mx-auto max-w-[1240px] px-4 sm:px-6">
        <DualCta location="faq" label="Talk With a Roofing Specialist" />
      </div>
    </section>
  );
}
