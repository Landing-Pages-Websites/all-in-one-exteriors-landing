import Image from "next/image";
import type { ReactElement } from "react";
import { managedSiteFieldAttributesV1 } from "@landing-pages-websites/managed-site-contract";

import { managedHome } from "@/content/managed-site";

export function ManagedHero(): ReactElement {
  const { eyebrow, title, description, image } = managedHome.hero;
  return (
    <section className="mx-auto flex w-full max-w-3xl flex-col items-center gap-4 px-6 py-24 text-center">
      <p
        className="rounded-full border border-dashed border-amber-500 px-4 py-1 text-xs font-medium uppercase tracking-wide text-amber-600"
        {...managedSiteFieldAttributesV1(eyebrow.fieldId)}
      >
        {eyebrow.value}
      </p>
      <Image
        src={image.src}
        alt={image.alt}
        width={image.width}
        height={image.height}
        className="h-24 w-24 rounded-2xl object-cover"
        loading="eager"
        unoptimized
        {...managedSiteFieldAttributesV1(image.fieldId)}
      />
      <h1
        className="text-4xl font-bold"
        {...managedSiteFieldAttributesV1(title.fieldId)}
      >
        {title.value}
      </h1>
      <p
        className="max-w-xl text-lg text-neutral-600 dark:text-neutral-400"
        {...managedSiteFieldAttributesV1(description.fieldId)}
      >
        {description.value}
      </p>
    </section>
  );
}
