import Image from "next/image";
import type { ReactElement } from "react";
import { DualCta } from "./DualCta";
import { Icon, type IconName } from "./Icon";
import { Reveal } from "./Reveal";
import { SectionHeading } from "./SectionHeading";

interface Offer {
  badge: string;
  icon: IconName;
  title: string;
  body: string;
}

const OFFERS: readonly Offer[] = [
  {
    badge: "Discount",
    icon: "shield",
    title: "Military discount",
    body: "Served or serving? Ask about our military discount when you request your roof estimate.",
  },
  {
    badge: "Discount",
    icon: "star",
    title: "Senior-citizen discount",
    body: "Senior homeowners can ask about our senior-citizen discount on a roof replacement.",
  },
  {
    badge: "Paid program",
    icon: "wrench",
    title: "Twice-yearly maintenance",
    body: "A paid program that brings us out twice a year to keep an eye on your roof.",
  },
];

export function Offers(): ReactElement {
  return (
    <section
      id="offers"
      aria-labelledby="offers-heading"
      className="relative overflow-hidden bg-ink py-20 lg:py-28"
    >
      <div className="mx-auto grid max-w-[1240px] gap-12 px-4 sm:px-6 lg:grid-cols-12 lg:items-center">
        <div className="lg:col-span-5">
          <SectionHeading
            id="offers-heading"
            eyebrow="Current offers"
            title="Good reasons to start the conversation."
            intro="No coupons, no countdown clocks. Just discounts and a maintenance program you can ask about when you request your estimate."
          />
          <div className="relative mt-10 hidden aspect-[4/3] overflow-hidden lg:block">
            <Image
              src="/images/offers-property.webp"
              alt="Two-story home with a dark shingle roof and two-car garage, framed by trees"
              fill
              sizes="(min-width: 1240px) 470px, 40vw"
              className="object-cover"
            />
            {/* Red/gold accent ribbon across the corner. */}
            <span
              aria-hidden="true"
              className="absolute -right-12 top-6 w-48 rotate-45 bg-gold py-1.5 text-center text-small font-extrabold uppercase tracking-[0.14em] text-black"
            >
              Ask us
            </span>
          </div>
        </div>
        <ul className="flex flex-col gap-4 lg:col-span-7">
          {OFFERS.map((offer, index) => (
            <Reveal
              as="li"
              key={offer.title}
              delay={index * 90}
              className="group relative grid grid-cols-[auto_1fr] gap-5 overflow-hidden rounded-[2px] border border-line bg-surface p-6 transition duration-150 ease-brand hover:-translate-y-1 hover:border-gold sm:p-8"
            >
              <span
                aria-hidden="true"
                className="absolute inset-y-0 left-0 w-1.5 bg-gradient-to-b from-brand to-gold"
              />
              <span className="grid h-14 w-14 place-items-center rounded-[2px] border border-gold/70 text-gold transition-colors duration-150 group-hover:bg-gold group-hover:text-black">
                <Icon name={offer.icon} size={32} />
              </span>
              <div>
                <span className="inline-block rounded-[2px] bg-brand px-2 py-0.5 text-[0.75rem] font-bold uppercase tracking-[0.12em] text-white">
                  {offer.badge}
                </span>
                <h3 className="mt-2 text-h3 font-bold text-white">
                  {offer.title}
                </h3>
                <p className="mt-2 leading-relaxed text-muted">{offer.body}</p>
              </div>
            </Reveal>
          ))}
        </ul>
      </div>
      <div className="mx-auto max-w-[1240px] px-4 sm:px-6">
        <DualCta location="offers" label="Ask About Current Offers" />
      </div>
    </section>
  );
}
