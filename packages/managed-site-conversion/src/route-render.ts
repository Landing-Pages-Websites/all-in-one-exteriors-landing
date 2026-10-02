import type ts from "typescript";

import type { Finding, SourceLocation } from "./report.js";
import { evidenceOf, locationOf, type ParsedModule } from "./scan.js";

/**
 * What the modules rendering a route render, as much as the resolver read.
 *
 * `not_found` is a proof, not a failure to read: a default export resolves to a
 * function that always reaches Next's `notFound()`, so the route answers 404.
 * `unread` is the failure, and the two are kept apart because only one of them
 * entitles a caller to decide anything.
 */
export type RouteRender =
  | { readonly kind: "renders" }
  | {
      readonly kind: "not_found";
      readonly location: SourceLocation;
      readonly evidence: string;
    }
  | {
      readonly kind: "unread";
      readonly location: SourceLocation;
      readonly evidence: string;
    };

export const RENDERS: RouteRender = { kind: "renders" };

/**
 * One answer for the whole chain: the route's own module, and the layouts
 * wrapping it.
 *
 * A proof ANYWHERE in the chain is the route's answer, because a layout that
 * always reaches `notFound()` takes every route beneath it with it — the
 * ordinary shape of a gated section. Anything else is the route's OWN module's
 * answer: a layout this reader could not follow still renders at runtime, and
 * the page below it still serves.
 */
export function chainRender(rendered: readonly RouteRender[]): RouteRender {
  return (
    rendered.find((render) => render.kind === "not_found") ??
    rendered.at(0) ??
    RENDERS
  );
}

/**
 * A proven 404, located where the call is WRITTEN.
 *
 * Not always the route's own file: a route may re-export a hidden page from
 * anywhere, and the line worth reading is the one that answers 404.
 */
export function notFoundRender(module: ParsedModule, node: ts.Node): RouteRender {
  return {
    kind: "not_found",
    location: locationOf(module.source, module.file, node),
    evidence: evidenceOf(module.source, node),
  };
}

/** An export this reader gave up on, located in the file it was asked about. */
export function unreadRender(
  file: string,
  entry: ParsedModule,
  defaultExport: ts.Statement | null,
): Extract<RouteRender, { readonly kind: "unread" }> {
  return {
    kind: "unread",
    location:
      defaultExport === null
        ? { file, line: 1, offset: 0 }
        : locationOf(entry.source, file, defaultExport),
    evidence:
      defaultExport === null
        ? "no default export"
        : evidenceOf(entry.source, defaultExport),
  };
}

/**
 * The finding an unread entry module produces.
 *
 * Only the unread one. A module that always answers 404 hides nothing, because
 * there is nothing, and the route that reaches it carries the finding that says
 * so with its declaration beside it — one decision for a human, not two.
 */
export function unreadEntryFinding(
  render: Extract<RouteRender, { readonly kind: "unread" }>,
): Finding {
  return {
    code: "UNRESOLVED_RENDER_TARGET",
    anchor: null,
    location: render.location,
    evidence: render.evidence,
    decision:
      "This route or layout does not export a named component, so nothing it " +
      "renders was inspected. Give the default export a name, then re-run.",
  };
}
