import Image from "next/image";
import type { ReactElement } from "react";
import { EstimateLink, PhoneLink } from "./Cta";

/** Minimal sticky bar: logo, request button, phone button. No nav links. */
export function SiteHeader(): ReactElement {
  return (
    <header className="sticky top-0 z-40 border-b border-line bg-ink/95 backdrop-blur supports-[backdrop-filter]:bg-ink/85">
      <div className="mx-auto flex h-[4.5rem] max-w-[1240px] items-center justify-between gap-3 px-4 sm:px-6">
        {/* Source logo is 160x129; shown at or below native size, never upscaled. */}
        <Image
          src="/logo.png"
          alt="All In One Exteriors"
          width={160}
          height={129}
          preload
          className="h-12 w-auto sm:h-14"
          sizes="70px"
        />
        <div className="flex items-center gap-2">
          <EstimateLink location="header" className="min-h-11! px-4! py-2.5! max-md:hidden!" />
          <PhoneLink location="header" compact className="min-h-11! px-3.5! py-2.5! text-[0.8125rem]! sm:px-4!" />
        </div>
      </div>
    </header>
  );
}
