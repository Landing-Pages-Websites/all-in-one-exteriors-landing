import type { StableId } from "@landing-pages-websites/managed-site-contract";

import { anchorToJsonPointer, humaniseAnchorTail, renderAnchor, type AnchorPath } from "./anchors.js";
import type { Candidate } from "./candidates.js";
import type { IdLedger } from "./id-ledger.js";
import type { RouteRender } from "./reachability.js";
import type { Finding } from "./report.js";

/**
 * Turns accepted candidates into addressed proposals: a stable ID (from the
 * ledger, keyed on the anchor), a content address, a section, and a scope.
 * Presentation names are derived here too — they are labels, never identity.
 */

export interface PageBinding {
  readonly routePath: string;
  /**
   * The route's own module.
   *
   * Needed to annotate the page ROOT, which the editor requires: field
   * discovery scopes to `[data-gomega-page-id]` and returns nothing at all
   * when no single element carries it, so a page without this has zero
   * editable fields however many of its values were rewritten.
   */
  readonly file: string;
  readonly pageId: StableId<"page">;
  readonly slug: string;
  /**
   * The declarations this route renders, as `declarationKey` identities.
   *
   * Names, which this carried until a reviewer found the hole, cannot say
   * which route owns a value: two modules may each declare `AdminCard`. See
   * `pagesUsing`.
   */
  readonly componentKeys: ReadonlySet<string>;
  /**
   * What the chain rendering this route renders, from the walk that read it.
   *
   * Scan detail, like `file` beside it, and carried on the binding for the same
   * reason: a parallel map keyed on route path needs a fallback at the far end
   * for a key that cannot be missing, and a fallback that can only fire if the
   * seam is inconsistent is a seam that should not be able to be.
   */
  readonly render: RouteRender;
  /**
   * Whether a customer owns the words on this route, from the conversion
   * config's `managedContent`. False for an internal screen, which keeps its
   * SEO facts and offers none of its own words, so nothing declared here is
   * proposed and the rewriter does not annotate its root either. A component
   * it shares with a content-bearing route is unaffected.
   */
  readonly ownsContent: boolean;
}

export interface FieldBinding {
  readonly candidate: Candidate;
  readonly fieldId: StableId<"field">;
  readonly scope: "site" | "page";
  readonly sourcePath: string;
  readonly pointer: string;
  readonly pageIds: readonly StableId<"page">[];
  readonly sectionKey: string;
  readonly order: number;
  readonly name: string;
  readonly group: string;
}

export interface SectionBinding {
  readonly key: string;
  readonly sectionId: StableId<"section">;
  readonly name: string;
  readonly pageId: StableId<"page">;
  readonly order: number;
  readonly fields: readonly FieldBinding[];
}

export function routeSlug(routePath: string): string {
  if (routePath === "/") return "home";
  return routePath.slice(1).replaceAll("/", "-");
}

/**
 * The part of an anchor that names the section a field sits in.
 *
 * A value anchored on a declaration has neither a component nor a region — it
 * belongs to the binding it is read from, and grouping `ctas.primary.label`
 * with `ctas.rfp.label` is what a person would expect. Falling through to an
 * empty path instead put every such field in one nameless section.
 */
function sectionAnchorOf(anchor: AnchorPath): AnchorPath {
  const regions = anchor.filter((segment) => segment.kind === "region");
  const component = anchor.find((segment) => segment.kind === "component");
  if (component !== undefined) return [component, ...regions];
  if (regions.length > 0) return regions;
  const binding = anchor.find((segment) => segment.kind === "binding");
  return binding === undefined ? [] : [binding];
}

/**
 * A section belongs to exactly one page, so the page is part of its key rather
 * than something the last candidate to arrive gets to decide. Two fields that
 * share a section anchor but render on different routes are two sections.
 */
function sectionKeyOf(anchor: AnchorPath, page: PageBinding): string {
  const rendered = renderAnchor(sectionAnchorOf(anchor));
  if (rendered === "") {
    throw new Error(`Anchor ${renderAnchor(anchor)} names no section`);
  }
  // Joined unambiguously rather than concatenated. An anchor segment can hold
  // any character an `id` attribute can, and a Next.js parallel route is
  // spelled with `@`, so a separator either half may contain cannot be the
  // thing that keeps two keys apart.
  return JSON.stringify([rendered, page.routePath]);
}

function sectionNameOf(anchor: AnchorPath, componentName: string): string {
  const lastRegion = [...anchor].reverse().find((segment) => segment.kind === "region");
  if (lastRegion === undefined) return humanise(componentName);
  return humanise(lastRegion.name);
}

function humanise(raw: string): string {
  const words = raw.split(/[^A-Za-z0-9]+/u).filter((word) => word.length > 0);
  const spaced = words
    .flatMap((word) => word.replace(/([a-z0-9])([A-Z])/gu, "$1 $2").split(" "))
    .join(" ");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1).toLowerCase();
}

/**
 * Every route that renders any of the components this value appears in. A value
 * read from a declared binding can be rendered by several components, and it is
 * on every route any one of them reaches.
 *
 * Matched on `declarationKey` identities, never on names. Two modules may each
 * declare a component called `AdminCard`; asking which routes render "one
 * called AdminCard" answers for both, which decides the wrong scope, writes the
 * value into the wrong content document, and -- once a route may decline
 * content -- lets a candidate from a public page claim an internal screen as an
 * owner and be rewritten there.
 */
function pagesUsing(
  componentKeys: readonly string[],
  pages: readonly PageBinding[],
): readonly PageBinding[] {
  return pages.filter((page) => componentKeys.some((key) => page.componentKeys.has(key)));
}

/**
 * Every field's content address ends in a leaf naming what it holds, so no
 * emitted pointer can ever be a prefix of another. Without it a link's own
 * value and the text nested inside that link would fight for one address.
 */
const LEAF_TOKENS: Readonly<Record<Candidate["kind"], string>> = {
  plain_text: "text",
  heading_text: "text",
  rich_text: "text",
  link: "link",
  image: "image",
  collection: "collection",
};

function pointerFor(candidate: Candidate): string {
  const base = anchorToJsonPointer(candidate.anchor);
  const leaf = LEAF_TOKENS[candidate.kind];
  return base.endsWith(`/${leaf}`) ? base : `${base}/${leaf}`;
}

/**
 * No two fields may share a content address, and none may be a prefix of
 * another.
 *
 * Equality is the case that loses data rather than merely nesting it. A pointer
 * is a READABLE address derived from the anchor, and that derivation is not
 * injective: `copy["foo-bar"]` and `copy.fooBar` are different properties with
 * different anchors, and both normalise to `fooBar`. The prefix check does not
 * catch equality — `a.startsWith(a + "/")` is false — so emission wrote one
 * value over the other and the site silently lost a field.
 *
 * This fails loudly instead. Making the pointer injective would be the other
 * answer, at the cost of every readable address in every contract.
 */
function assertNoPointerCollisions(fields: readonly FieldBinding[]): void {
  const byPath = new Map<string, FieldBinding[]>();
  for (const field of fields) {
    const bucket = byPath.get(field.sourcePath) ?? [];
    bucket.push(field);
    byPath.set(field.sourcePath, bucket);
  }
  for (const [path, bucket] of byPath) {
    const sorted = [...bucket].sort((a, b) => a.pointer.localeCompare(b.pointer));
    for (const [index, field] of sorted.entries()) {
      const next = sorted[index + 1];
      if (next === undefined) continue;
      if (next.pointer === field.pointer) {
        throw new Error(
          `Proposed pointer ${field.pointer} in ${path} is claimed by two anchors: ` +
            `${renderAnchor(field.candidate.anchor)} and ` +
            `${renderAnchor(next.candidate.anchor)}`,
        );
      }
      if (next.pointer.startsWith(`${field.pointer}/`)) {
        throw new Error(
          `Proposed pointers ${field.pointer} and ${next.pointer} overlap in ${path}`,
        );
      }
    }
  }
}

/**
 * Every field a section holds must be addressed to that section's page. The key
 * makes this true by construction; the check is here so a future change to the
 * key cannot quietly reintroduce a section spanning routes.
 */
function assertSectionsOwnTheirFields(sections: readonly SectionBinding[]): void {
  for (const section of sections) {
    for (const field of section.fields) {
      if (field.scope === "site") continue;
      if (field.pageIds.length === 1 && field.pageIds[0] === section.pageId) continue;
      throw new Error(
        `Section ${section.key} holds a field addressed to another page`,
      );
    }
  }
}

function contentPathFor(
  scope: "site" | "page",
  contentRoot: string,
  page: PageBinding | undefined,
): string {
  if (scope === "site" || page === undefined) return `${contentRoot}/site.json`;
  return `${contentRoot}/pages/${page.slug}.json`;
}

function scopeFinding(candidate: Candidate, pageCount: number): Finding {
  return {
    code: "SCOPE_NOT_OBSERVABLE",
    anchor: renderAnchor(candidate.anchor),
    location: candidate.location,
    evidence: candidate.evidence,
    decision:
      `This value renders on ${pageCount} routes, so it was proposed as ` +
      "site-scoped. Confirm that every route should share one value.",
  };
}

export interface BindingResult {
  readonly sections: readonly SectionBinding[];
  readonly fields: readonly FieldBinding[];
  readonly findings: readonly Finding[];
}

export function bindCandidates(
  candidates: readonly Candidate[],
  pages: readonly PageBinding[],
  ledger: IdLedger,
  contentRoot: string,
): BindingResult {
  const findings: Finding[] = [];
  const bySection = new Map<string, FieldBinding[]>();
  const sectionMeta = new Map<string, { readonly name: string; readonly page: PageBinding }>();

  for (const candidate of candidates) {
    const owners = pagesUsing(candidate.componentKeys, pages);
    const owner = owners[0];
    if (owner === undefined) continue;
    const scope: "site" | "page" = owners.length > 1 ? "site" : "page";
    if (scope === "site") findings.push(scopeFinding(candidate, owners.length));

    const sectionKey = sectionKeyOf(candidate.anchor, owner);
    const name = sectionNameOf(candidate.anchor, candidate.componentNames[0] ?? "");
    sectionMeta.set(sectionKey, { name, page: owner });

    const bucket = bySection.get(sectionKey) ?? [];
    bucket.push({
      candidate,
      fieldId: ledger.resolve("field", renderAnchor(candidate.anchor)),
      scope,
      sourcePath: contentPathFor(scope, contentRoot, owner),
      pointer: pointerFor(candidate),
      pageIds: owners.map((page) => page.pageId),
      sectionKey,
      order: bucket.length + 1,
      name: humaniseAnchorTail(candidate.anchor),
      group: name,
    });
    bySection.set(sectionKey, bucket);
  }

  const sections = [...bySection.entries()].map(([key, fields], index) => {
    const meta = sectionMeta.get(key);
    if (meta === undefined) throw new Error(`Section ${key} lost its metadata`);
    return {
      key,
      sectionId: ledger.resolve("section", key),
      name: meta.name,
      pageId: meta.page.pageId,
      order: index + 1,
      fields,
    } satisfies SectionBinding;
  });

  const fields = sections.flatMap((section) => section.fields);
  assertNoPointerCollisions(fields);
  assertSectionsOwnTheirFields(sections);
  return { sections, fields, findings };
}
