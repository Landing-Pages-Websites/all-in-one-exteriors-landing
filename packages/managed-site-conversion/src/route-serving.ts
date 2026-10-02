import type { PageSeoInput } from "./config.js";
import type { RouteRender } from "./reachability.js";
import type { Finding } from "./report.js";

/**
 * Whether this repository serves the page the contract would describe.
 *
 * A contract page is a promise that a URL answers: it carries a canonical, a
 * robots directive, a title, a sitemap policy and an intent. Nothing checked
 * the promise. All Points Media's `/innovation/network-portal` is `export
 * default function NetworkPortalHidden() { notFound(); }`, and the emitted
 * contract described it as an indexable service page with a canonical URL, for
 * a route the site 404s.
 *
 * Both halves of that were already in the run — the route's own module reported
 * `UNRESOLVED_RENDER_TARGET` quoting the `notFound()` body, and the config
 * declared the route — in different files, which is why nothing joined them.
 * Every finding here carries both, and the README states the three readings and
 * which of them excludes a route.
 */

const CODE = "ROUTE_NOT_SERVED" as const;

/** The declaration the finding must quote, so nobody opens the config to see it. */
function declarationOf(route: string, declared: PageSeoInput | undefined): string {
  if (declared === undefined) {
    return `The conversion config declares nothing for '${route}'`;
  }
  const sitemap =
    declared.sitemap === null
      ? "no sitemap policy"
      : `sitemap.included: ${declared.sitemap.included}`;
  const purpose = declared.purpose === null ? "" : ` and purpose '${declared.purpose}'`;
  return `The conversion config declares '${route}' with ${sitemap}${purpose}`;
}

/**
 * The strongest reading, and the only one that decides anything: this route
 * answers 404, so it is not a page and the contract says nothing about it.
 *
 * It holds whatever the config declares, because the whole page descriptor is
 * the advertisement. Keying the exclusion on `sitemap.included` alone left the
 * canonical URL, the robots directives and a content document behind for a
 * route that 404s — which is the same defect, one field over.
 */
export function routeAnswers404Finding(
  route: string,
  declared: PageSeoInput | undefined,
  render: Extract<RouteRender, { readonly kind: "not_found" }>,
): Finding {
  return {
    code: CODE,
    anchor: `route:${route}`,
    location: render.location,
    evidence:
      `${declarationOf(route, declared)}, and the route answers 404: the ` +
      `module below always reaches Next's \`notFound()\`, written ` +
      `\`${render.evidence}\`.`,
    decision:
      "A route that answers 404 is not a page, so it is excluded from the " +
      "proposal: no contract page, no canonical, no indexing directives and no " +
      "content document are written for it. Remove its declaration from the " +
      "conversion config, or make the route render something.",
  };
}

/**
 * The two weaker readings, which only ever report.
 *
 * Both are facts about this READER rather than about the route — a module it
 * could not follow, a page it found nothing on — and a legitimately sparse page
 * produces the second. They are asked only of a route the config puts IN the
 * sitemap, because that is the claim they bear on: the reading is never taken
 * from the route's `robots` directives, which a layout sets for a whole site at
 * once and which say nothing about an operator having declared this page.
 */
export function indexableRouteFinding(
  route: string,
  declared: PageSeoInput,
  render: RouteRender,
  hasContent: boolean,
): Finding | null {
  if (declared.sitemap === null || !declared.sitemap.included) return null;
  if (render.kind === "unread") {
    return {
      code: CODE,
      anchor: `route:${route}`,
      location: render.location,
      evidence:
        `${declarationOf(route, declared)}, and nothing the route renders ` +
        `could be read, from \`${render.evidence}\`.`,
      decision:
        "The sitemap entry describes a page this tool never saw. Resolve the " +
        "render target named above, or keep the route out of the sitemap.",
    };
  }
  if (hasContent) return null;
  return {
    code: CODE,
    anchor: `route:${route}`,
    location: null,
    evidence:
      `${declarationOf(route, declared)}, and this run proposed no value a ` +
      "customer may edit on it.",
    decision:
      "The contract advertises this URL and carries nothing to serve for it. " +
      "Confirm that is intended, or resolve the refusals reported against this " +
      "route first.",
  };
}
