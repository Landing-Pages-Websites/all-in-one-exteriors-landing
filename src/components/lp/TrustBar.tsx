import type { ReactElement, ReactNode } from "react";
import { CountUp } from "./CountUp";
import { DualCta } from "./DualCta";
import { Reveal } from "./Reveal";

interface Credential {
  figure: ReactNode;
  /** Spoken form of the figure; the animated number is hidden from AT. */
  spoken: string;
  label: string;
}

const CREDENTIALS: readonly Credential[] = [
  { figure: "Lifetime", spoken: "Lifetime", label: "Materials warranty" },
  {
    figure: (
      <>
        5–
        <CountUp to={10} />
        <span className="text-[0.55em] font-bold"> yrs</span>
      </>
    ),
    spoken: "5 to 10 years",
    label: "Labor warranty, by manufacturer",
  },
  { figure: "GAF", spoken: "GAF", label: "Certified contractor" },
  {
    figure: "CertainTeed",
    spoken: "CertainTeed",
    label: "Certified contractor",
  },
  {
    figure: "NRCA",
    spoken: "NRCA",
    label: "Low-slope & steep-slope certified",
  },
  {
    figure: <CountUp to={8} />,
    spoken: "8",
    label: "Georgia cities served",
  },
];

const OWNERSHIP = [
  "Insured",
  "Bonded",
  "Family owned",
  "Locally owned",
] as const;

export function TrustBar(): ReactElement {
  return (
    <section
      id="trust-bar"
      aria-label="Credentials and warranty coverage"
      className="border-y border-line bg-charcoal"
    >
      <div className="mx-auto max-w-[1240px] px-4 py-14 sm:px-6 lg:py-16">
        <ul className="grid grid-cols-2 border-l border-t border-line md:grid-cols-3 lg:grid-cols-6">
          {CREDENTIALS.map((item, index) => (
            <Reveal
              as="li"
              key={item.label + item.spoken}
              delay={index * 60}
              className="group relative border-b border-r border-line p-5 transition-colors duration-150 hover:bg-surface sm:p-6"
            >
              <span
                aria-hidden="true"
                className="absolute inset-x-0 top-0 h-[3px] origin-left scale-x-0 bg-gold transition-transform duration-500 ease-brand group-hover:scale-x-100"
              />
              <p className="text-[clamp(1.2rem,1.9vw,1.6rem)] font-extrabold leading-none tracking-tight text-white">
                <span aria-hidden="true">{item.figure}</span>
                <span className="sr-only">{item.spoken}</span>
              </p>
              <p className="mt-3 text-small font-semibold text-muted">
                {item.label}
              </p>
            </Reveal>
          ))}
        </ul>
        <ul className="mt-6 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-small font-bold uppercase tracking-[0.14em] text-white">
          {OWNERSHIP.map((item, index) => (
            <li key={item} className="flex items-center gap-6">
              {index > 0 ? (
                <span
                  aria-hidden="true"
                  className="h-1.5 w-1.5 rotate-45 bg-brand"
                />
              ) : null}
              {item}
            </li>
          ))}
        </ul>
        <DualCta location="trust-bar" />
      </div>
    </section>
  );
}
