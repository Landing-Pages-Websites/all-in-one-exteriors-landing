import Image from "next/image";
import type { ReactElement } from "react";
import { DualCta } from "./DualCta";
import { Reveal } from "./Reveal";
import { SectionHeading } from "./SectionHeading";

const STEPS = [
  {
    title: "Request your estimate",
    body: "Send the form or call (404) 445-8136. Tell us whether your roof is leaking or damaged so we know how urgent it is.",
  },
  {
    title: "Talk through your property",
    body: "We discuss your home, your roof, and what you need from it. Inspections are a paid service, and we tell you that up front.",
  },
  {
    title: "Choose the right replacement",
    body: "Together we select the replacement approach and system that fit the property, from certified manufacturer lines.",
  },
  {
    title: "Complete the work, with coverage",
    body: "The crew completes the replacement with manufacturer-backed coverage, and comes back until everything is right.",
  },
] as const;

export function Process(): ReactElement {
  return (
    <section
      id="how-it-works"
      aria-labelledby="process-heading"
      className="pitch-top relative bg-surface pb-20 pt-28 lg:pb-28 lg:pt-36"
    >
      <div className="mx-auto grid max-w-[1240px] gap-12 px-4 sm:px-6 lg:grid-cols-12 lg:gap-16">
        <div className="lg:col-span-6">
          <SectionHeading
            id="process-heading"
            eyebrow="How it works"
            title="Four steps from request to finished roof."
          />
          <ol className="mt-10 flex flex-col">
            {STEPS.map((step, index) => (
              <Reveal
                as="li"
                key={step.title}
                delay={index * 80}
                className="group grid grid-cols-[4.5rem_1fr] gap-4 border-t border-line py-6 last:border-b"
              >
                <span
                  aria-hidden="true"
                  className="text-5xl font-extrabold leading-none text-transparent transition-colors duration-150 [-webkit-text-stroke:1.5px_var(--color-gold)] group-hover:text-gold"
                >
                  {String(index + 1).padStart(2, "0")}
                </span>
                <div>
                  <h3 className="text-h4 font-bold text-white">
                    <span className="sr-only">Step {index + 1}: </span>
                    {step.title}
                  </h3>
                  <p className="mt-2 leading-relaxed text-muted">{step.body}</p>
                </div>
              </Reveal>
            ))}
          </ol>
        </div>
        <div className="relative lg:col-span-6">
          <div className="grid grid-cols-6 gap-3 lg:sticky lg:top-28">
            <div className="relative col-span-6 aspect-[4/3] overflow-hidden border-l-4 border-brand">
              <Image
                src="/images/process-underlayment.webp"
                alt="Roofer installing synthetic underlayment and flashing during a roof replacement"
                fill
                sizes="(min-width: 1240px) 580px, (min-width: 1024px) 48vw, 100vw"
                className="object-cover"
              />
            </div>
            <div className="relative col-span-4 col-start-3 -mt-24 aspect-[4/3] overflow-hidden border-4 border-surface sm:-mt-32">
              <Image
                src="/images/process-crew-roof.webp"
                alt="Crew member working on a brick home's roof with ladders set at the eaves"
                fill
                sizes="(min-width: 1240px) 390px, (min-width: 1024px) 32vw, 66vw"
                className="object-cover"
              />
            </div>
          </div>
        </div>
      </div>
      <div className="mx-auto max-w-[1240px] px-4 sm:px-6">
        <DualCta
          location="how-it-works"
          label="Talk With a Roofing Specialist"
        />
      </div>
    </section>
  );
}
