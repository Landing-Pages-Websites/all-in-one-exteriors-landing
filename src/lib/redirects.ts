/**
 * 301 redirect map — filled by the BUILDER during the build (Layer 2, like
 * site.config.ts). For migrations: inventory the old site's URLs while it is
 * still live (crawl it or pull top URLs from GSC) and map each to its new
 * slug BEFORE DNS flips. Leave empty for brand-new sites.
 *
 * Go-live QA verifies every entry 301s to a live 200 destination with no
 * chains or loops — a broken entry is a launch blocker.
 */
export interface RedirectEntry {
  /** Old path, e.g. "/old-services-page" (path only, no domain). */
  source: string;
  /** New path, e.g. "/services". */
  destination: string;
}

export const redirectMap: RedirectEntry[] = [
  // { source: "/old-about-us", destination: "/about" },
];
