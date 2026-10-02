import Link from "next/link";
import type { ReactElement } from "react";
import { siteRoutes } from "@/lib/routes";
import { siteConfig } from "@/site.config";

export default function NotFound(): ReactElement {
  const keyPages = siteRoutes.filter(
    (route) => !route.hideFromKeyPages && route.path !== "/",
  );

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col items-center justify-center gap-6 px-6 py-24 text-center">
      <p className="text-sm font-medium uppercase tracking-wide text-gold">
        404
      </p>
      <h1 className="text-3xl font-bold">Page not found</h1>
      <p className="text-muted">
        That page does not exist on the {siteConfig.businessName} site. It may
        have moved, or the link may be out of date.
      </p>
      <Link
        href="/"
        className="rounded-[2px] bg-brand px-4 py-2 text-sm font-bold text-white hover:bg-brand-hover"
      >
        Back to home
      </Link>
      {keyPages.length > 0 ? (
        <nav aria-label="Key pages">
          <ul className="flex flex-wrap justify-center gap-4 text-sm">
            {keyPages.map((route) => (
              <li key={route.path}>
                <Link href={route.path} className="underline">
                  {route.title}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      ) : null}
    </div>
  );
}
