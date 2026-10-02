import Image from "next/image";
import type { ReactElement } from "react";
import { DualCta } from "./DualCta";
import { Icon } from "./Icon";
import { Reveal } from "./Reveal";
import { SectionHeading } from "./SectionHeading";

interface Row {
  kicker: string;
  title: string;
  body: string;
  points: readonly string[];
  image: { src: string; alt: string; width: number; height: number };
}

const ROWS: readonly Row[] = [
  {
    kicker: "Manufacturer-backed",
    title: "Coverage you can read, not a handshake.",
    body: "Your replacement carries manufacturer-backed warranty coverage. Terms vary by manufacturer, so you get the specifics for the exact system going on your home.",
    points: [
      "Lifetime warranty on materials",
      "5 to 10 years on labor, depending on the manufacturer",
      "GAF and CertainTeed certified contractor",
    ],
    image: {
      src: "/images/proof-shingle-detail.webp",
      alt: "Close view of new architectural shingles meeting brick walls and gables on a residential roof",
      width: 1000,
      height: 563,
    },
  },
  {
    kicker: "Our commitment",
    title: "Done right the first time. Back until it is right.",
    body: "That is the standard on every replacement. If something is not right, we return until it is, so the roof you approved is the roof you get.",
    points: [
      "NRCA certified in low-slope and steep-slope roofing",
      "Insured and bonded",
      "Family owned and locally owned in Alpharetta",
    ],
    image: {
      src: "/images/service-brick-stone-home.webp",
      alt: "Brick and stone two-story home with a replaced dark shingle roof",
      width: 1000,
      height: 563,
    },
  },
];

export function Benefits(): ReactElement {
  return (
    <section
      id="benefits"
      aria-labelledby="benefits-heading"
      className="bg-ink py-20 lg:py-28"
    >
      <div className="mx-auto max-w-[1240px] px-4 sm:px-6">
        <SectionHeading
          id="benefits-heading"
          eyebrow="Why replace with us"
          title="Proof first. Then the roof."
          intro="Before you see a number, you should see the credentials and the coverage behind the work."
        />
        <div className="mt-14 flex flex-col gap-16 lg:gap-24">
          {ROWS.map((row, index) => {
            const flipped = index % 2 === 1;
            return (
              <Reveal
                key={row.title}
                className="grid items-center gap-8 lg:grid-cols-12 lg:gap-12"
              >
                <div
                  className={`group relative lg:col-span-7 ${flipped ? "lg:order-2" : ""}`}
                >
                  <span
                    aria-hidden="true"
                    className={`absolute -bottom-3 h-2/3 w-2/3 bg-brand ${flipped ? "-left-3" : "-right-3"}`}
                  />
                  <div className="relative aspect-[16/10] overflow-hidden">
                    <Image
                      src={row.image.src}
                      alt={row.image.alt}
                      fill
                      sizes="(min-width: 1240px) 700px, (min-width: 1024px) 56vw, 100vw"
                      className="object-cover transition-transform duration-500 ease-brand group-hover:scale-[1.03]"
                    />
                  </div>
                </div>
                <div className={`lg:col-span-5 ${flipped ? "lg:order-1" : ""}`}>
                  <p className="text-small font-bold uppercase tracking-[0.18em] text-gold">
                    {row.kicker}
                  </p>
                  <h3 className="mt-3 text-[clamp(1.6rem,2.6vw,2.25rem)] font-extrabold leading-[1.08] tracking-tight text-white">
                    {row.title}
                  </h3>
                  <p className="mt-4 leading-relaxed text-muted">{row.body}</p>
                  <ul className="mt-6 flex flex-col gap-3">
                    {row.points.map((point) => (
                      <li
                        key={point}
                        className="flex items-start gap-3 font-semibold text-white"
                      >
                        <span className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-[2px] bg-gold text-black">
                          <Icon name="check" size={16} />
                        </span>
                        {point}
                      </li>
                    ))}
                  </ul>
                </div>
              </Reveal>
            );
          })}
        </div>
        <DualCta location="benefits" />
      </div>
    </section>
  );
}
