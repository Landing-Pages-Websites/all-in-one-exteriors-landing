import Image from "next/image";
import type { ReactElement } from "react";
import { DualCta } from "./DualCta";
import { Icon, type IconName } from "./Icon";
import { Reveal } from "./Reveal";
import { SectionHeading } from "./SectionHeading";

interface Service {
  tag: string;
  icon: IconName;
  title: string;
  body: string;
  image: { src: string; alt: string };
  layout: string;
  imageAspect: string;
  sizes: string;
}

const SERVICES: readonly Service[] = [
  {
    tag: "Primary service",
    icon: "home",
    title: "Residential roof replacement",
    body: "Roof replacement for homeowners from a GAF and CertainTeed certified contractor, with manufacturer-backed coverage. Leaking, damaged, or a planned replacement: your roof qualifies.",
    image: {
      src: "/images/service-residential.webp",
      alt: "Large brick and stone home with a newly installed roof as the crew wraps up the job",
    },
    layout: "lg:col-span-7 lg:row-span-2",
    imageAspect: "aspect-[16/10] lg:aspect-auto lg:min-h-[340px] lg:flex-1",
    // Cover-cropped into a tall tile, so it needs more width than it occupies.
    sizes: "(min-width: 1024px) 1000px, 100vw",
  },
  {
    tag: "Also welcome",
    icon: "building",
    title: "Light commercial roofing",
    body: "Low-slope and steep-slope work from an NRCA certified team. Tell us about the building when you request an estimate.",
    image: {
      src: "/images/service-low-slope.webp",
      alt: "Low-slope metal panel roof section installed beside a shingled roof",
    },
    layout: "lg:col-span-5",
    imageAspect: "aspect-[16/9]",
    sizes: "(min-width: 1240px) 480px, (min-width: 1024px) 40vw, 100vw",
  },
  {
    tag: "Paid program",
    icon: "calendar",
    title: "Twice-yearly roof maintenance",
    body: "A paid maintenance program that brings us out twice a year to look after your roof. Ask about it with your estimate.",
    image: {
      src: "/images/service-maintenance-detail.webp",
      alt: "New shingles and flashing around two brick dormers",
    },
    layout: "lg:col-span-5",
    imageAspect: "aspect-[16/9]",
    sizes: "(min-width: 1240px) 480px, (min-width: 1024px) 40vw, 100vw",
  },
];

export function Services(): ReactElement {
  return (
    <section
      id="services"
      aria-labelledby="services-heading"
      className="bg-ink py-20 lg:py-28"
    >
      <div className="mx-auto max-w-[1240px] px-4 sm:px-6">
        <SectionHeading
          id="services-heading"
          eyebrow="What we replace"
          title="Built for homeowners. Open to light commercial."
        />
        <div className="mt-12 grid gap-5 lg:grid-cols-12">
          {SERVICES.map((service, index) => (
            <Reveal
              as="article"
              key={service.title}
              delay={index * 90}
              className={`group flex flex-col overflow-hidden rounded-[2px] border border-line border-l-4 border-l-brand bg-surface transition duration-150 ease-brand hover:-translate-y-1 hover:border-l-gold focus-within:ring-2 focus-within:ring-gold ${service.layout}`}
            >
              <div
                className={`relative overflow-hidden ${service.imageAspect}`}
              >
                <Image
                  src={service.image.src}
                  alt={service.image.alt}
                  fill
                  sizes={service.sizes}
                  className="object-cover transition-transform duration-500 ease-brand group-hover:scale-[1.03]"
                />
                <span className="absolute left-4 top-4 rounded-[2px] bg-brand px-2.5 py-1 text-small font-bold uppercase tracking-[0.12em] text-white">
                  {service.tag}
                </span>
              </div>
              <div className="flex flex-col gap-3 p-6 sm:p-7">
                <div className="flex items-center gap-3">
                  <Icon name={service.icon} size={32} className="text-gold" />
                  <h3 className="text-h3 font-bold text-white">
                    {service.title}
                  </h3>
                </div>
                <p className="leading-relaxed text-muted">{service.body}</p>
              </div>
            </Reveal>
          ))}
        </div>
        <DualCta location="services" />
      </div>
    </section>
  );
}
