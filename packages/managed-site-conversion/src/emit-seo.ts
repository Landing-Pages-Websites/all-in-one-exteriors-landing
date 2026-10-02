import type {
  JsonValue,
  ManagedInternalValueType,
  ManagedSiteContentValue,
  ManagedSiteSeoDescriptor,
  StableId,
} from "@landing-pages-websites/managed-site-contract";

import type { PageBinding } from "./bindings.js";
import type { ConversionConfig, PageSeoInput } from "./config.js";
import type { IdLedger } from "./id-ledger.js";
import { UNDECLARED_METADATA, type NextMetadata } from "./next-metadata.js";
import type { Finding } from "./report.js";
import { indexableRouteFinding } from "./route-serving.js";
import { resolverFor } from "./source-address.js";

/**
 * Internal SEO is where the proposer refuses most loudly. Titles, descriptions
 * and robots directives are migratable because Next.js declares them. Legal
 * name, telephone, canonical origin, sitemap policy and performance budgets are
 * not in the source at all — they are operator inputs, and a missing one is a
 * reported blocker rather than a default.
 */

export interface SeoField {
  readonly id: StableId<"field">;
  readonly semantic: string;
  readonly valueType: ManagedInternalValueType;
  readonly scope: "site" | "page";
  readonly sourcePath: string;
  readonly pointer: string;
  readonly value: JsonValue;
  readonly name: string;
}

export interface SeoEmission {
  readonly descriptor: ManagedSiteSeoDescriptor | null;
  readonly fields: readonly SeoField[];
  readonly contentValues: readonly ManagedSiteContentValue[];
  readonly findings: readonly Finding[];
}

export interface HeadingOutlineEntry {
  readonly fieldId: StableId<"field">;
  readonly semanticLevel: number;
}

export interface SeoInput {
  readonly config: ConversionConfig;
  readonly ledger: IdLedger;
  readonly pages: readonly PageBinding[];
  /** One entry per route, resolved from that route's own module and its layouts. */
  readonly metadataByRoute: ReadonlyMap<string, NextMetadata>;
  readonly headingOutline: ReadonlyMap<string, readonly HeadingOutlineEntry[]>;
  readonly primaryImageByRoute: ReadonlyMap<string, StableId<"asset">>;
  /** The pages this run proposed at least one editable value for. */
  readonly pagesWithContent: ReadonlySet<StableId<"page">>;
  /** Every route the scan found and this run excluded, already reported. */
  readonly excludedRoutes: ReadonlySet<string>;
}

function missing(semantic: string, why: string): Finding {
  return {
    code: "SEO_INPUT_REQUIRED",
    anchor: `seo:${semantic}`,
    location: null,
    evidence: `No source in the repository supplies '${semantic}'.`,
    decision: why,
  };
}

function undeclaredRouteFinding(route: string): Finding {
  return {
    code: "SEO_INPUT_REQUIRED",
    anchor: `config:${route}`,
    location: null,
    evidence: `The conversion config declares the route '${route}'.`,
    decision:
      `This repository serves no such route, so nothing reads that declaration. ` +
      "Correct the route, or remove it from the config.",
  };
}

class SeoBuilder {
  readonly #input: SeoInput;
  readonly #fields: SeoField[] = [];
  readonly #findings: Finding[] = [];

  constructor(input: SeoInput) {
    this.#input = input;
  }

  #siteField(
    semantic: string,
    valueType: ManagedInternalValueType,
    name: string,
    pointer: string,
    value: JsonValue | null,
    requirement: string,
  ): StableId<"field"> | null {
    if (value === null) {
      this.#findings.push(missing(semantic, requirement));
      return null;
    }
    const id = this.#input.ledger.resolve("field", `seo:${semantic}`);
    this.#fields.push({
      id,
      semantic,
      valueType,
      scope: "site",
      sourcePath: `${this.#input.config.contentRoot}/site.json`,
      pointer,
      value,
      name,
    });
    return id;
  }

  #pageField(
    route: string,
    semantic: string,
    valueType: ManagedInternalValueType,
    name: string,
    pointer: string,
    value: JsonValue | null,
    requirement: string,
  ): StableId<"field"> | null {
    if (value === null) {
      this.#findings.push(missing(`${route}:${semantic}`, requirement));
      return null;
    }
    const page = this.#input.pages.find((candidate) => candidate.routePath === route);
    if (page === undefined) return null;
    const id = this.#input.ledger.resolve("field", `seo:${route}:${semantic}`);
    this.#fields.push({
      id,
      semantic,
      valueType,
      scope: "page",
      sourcePath: `${this.#input.config.contentRoot}/pages/${page.slug}.json`,
      pointer,
      value,
      name,
    });
    return id;
  }

  #businessIdentity(): ManagedSiteSeoDescriptor["businessIdentity"] | null {
    const identity = this.#input.config.businessIdentity;
    const legalName = this.#siteField(
      "business.legal_name",
      "string",
      "Legal name",
      "/identity/legalName",
      identity.legalName,
      "Supply the registered legal name in the conversion config; it is required by the contract and never appears in page source.",
    );
    const displayName = this.#siteField(
      "business.display_name",
      "string",
      "Display name",
      "/identity/displayName",
      identity.displayName,
      "Supply the customer-facing business name in the conversion config.",
    );
    const telephone = this.#siteField(
      "business.telephone",
      "string",
      "Telephone",
      "/identity/telephone",
      identity.telephone,
      "Supply the E.164 business telephone in the conversion config.",
    );
    const email = this.#siteField(
      "business.email",
      "string",
      "Email",
      "/identity/email",
      identity.email,
      "Supply the business email in the conversion config, or confirm the site has none.",
    );
    const sameAs = this.#siteField(
      "business.same_as",
      "string_list",
      "Same-as URLs",
      "/identity/sameAs",
      identity.sameAs === null ? null : [...identity.sameAs],
      "Supply the canonical profile URLs in the conversion config, or confirm there are none.",
    );
    this.#siteField(
      "business.description",
      "string",
      "Business description",
      "/identity/description",
      identity.description,
      "Supply the business description in the conversion config.",
    );
    if (legalName === null || displayName === null || telephone === null) return null;
    return {
      legalName,
      displayName,
      telephone,
      postalAddress: null,
      email,
      geo: null,
      openingHours: null,
      sameAs,
    };
  }

  #pageDescriptor(
    page: PageBinding,
    primaryEntity: StableId<"field">,
  ): ManagedSiteSeoDescriptor["pages"][number] | null {
    const seoInput = this.#input.config.pages.get(page.routePath);
    const metadata = this.#input.metadataByRoute.get(page.routePath) ?? UNDECLARED_METADATA;
    const title = this.#pageField(
      page.routePath,
      "seo.title",
      "string",
      "Metadata title",
      "/seo/title",
      metadata.title,
      "No `metadata.title` string resolved for this route, from its own module or " +
        "the layouts that wrap it. Declare one before converting.",
    );
    const description = this.#pageField(
      page.routePath,
      "seo.description",
      "string",
      "Metadata description",
      "/seo/description",
      metadata.description,
      "No `metadata.description` string resolved for this route, from its own module " +
        "or the layouts that wrap it. Declare one before converting.",
    );
    const canonical = this.#pageField(
      page.routePath,
      "seo.canonical",
      "url",
      "Canonical URL",
      "/seo/canonical",
      seoInput?.canonical ?? null,
      "Supply the production canonical URL for this route in the conversion config; the repository cannot know its own origin.",
    );
    const indexing = this.#pageField(
      page.routePath,
      "seo.indexing",
      "indexing_directives",
      "Indexing directives",
      "/seo/indexing",
      metadata.indexing === null ? null : { ...metadata.indexing },
      "This route declares `robots` directives this reader cannot resolve to literals. " +
        "Write them as `true`/`false` at the route, or supply them in the conversion config.",
    );
    const purpose = seoInput?.purpose ?? null;
    if (purpose === null) {
      this.#findings.push(
        missing(
          `${page.routePath}:intent.purpose`,
          "Classify this route's purpose (home, service, landing, legal, ...) in the conversion config.",
        ),
      );
    }
    const sitemap = seoInput?.sitemap ?? null;
    if (sitemap === null) {
      this.#findings.push(
        missing(
          `${page.routePath}:sitemap`,
          "Decide whether this route belongs in the sitemap, and at what change frequency and priority.",
        ),
      );
    }
    const budget = seoInput?.performanceBudget ?? null;
    if (budget === null) {
      this.#findings.push(
        missing(
          `${page.routePath}:performanceBudget`,
          "Set the Core Web Vitals budget for this route; the repository does not state one.",
        ),
      );
    }
    if (seoInput !== undefined) this.#reportIfUnserved(page, seoInput);
    if (
      title === null ||
      description === null ||
      canonical === null ||
      indexing === null ||
      purpose === null ||
      sitemap === null ||
      budget === null
    ) {
      return null;
    }
    return {
      pageId: page.pageId,
      intent: { purpose, primaryEntity, services: [], locations: [] },
      headingOutline: this.#input.headingOutline.get(page.routePath) ?? [],
      breadcrumbParentPageId: null,
      internalLinks: { requiredPageIds: [], minimumInboundLinks: 0 },
      sitemap,
      performanceBudget: budget,
      metadata: {
        title,
        description,
        canonical,
        indexing,
        social: { title: null, description: null, image: null },
      },
      jsonLd: [],
      primaryImageAssetSlotId: this.#input.primaryImageByRoute.get(page.routePath) ?? null,
    };
  }

  /**
   * A route in the sitemap that this run could read nothing on.
   *
   * Reported, never withheld: both readings are facts about the reader rather
   * than about the route, and a route it can PROVE is unserved never reaches
   * here -- `propose` excludes it before a descriptor is built. A route that
   * declines customer content contributes nothing by design, so the emptiest
   * reading says nothing at all about it.
   */
  #reportIfUnserved(page: PageBinding, declared: PageSeoInput): void {
    const finding = indexableRouteFinding(
      page.routePath,
      declared,
      page.render,
      !page.ownsContent || this.#input.pagesWithContent.has(page.pageId),
    );
    if (finding !== null) this.#findings.push(finding);
  }

  /**
   * A declared route the scan never found is an input nobody reads.
   *
   * The proposer matches config pages to scanned routes by exact path, so a typo
   * or a stale route -- `/about/` for `/about`, a page since deleted -- goes
   * nowhere. What that produces on its own is `SEO_INPUT_REQUIRED` against the
   * real route, which sends a person to add a declaration they already wrote.
   */
  #reportUndeclaredRoutes(): void {
    const scanned = new Set(this.#input.pages.map((page) => page.routePath));
    for (const route of this.#input.config.pages.keys()) {
      if (scanned.has(route)) continue;
      // A route the run found and excluded already carries the finding that
      // excluded it, which says why and what to do. Reporting it a second time
      // as a route that does not exist sends a reader hunting a typo.
      if (this.#input.excludedRoutes.has(route)) continue;
      this.#findings.push(undeclaredRouteFinding(route));
    }
  }

  build(): SeoEmission {
    this.#reportUndeclaredRoutes();
    const businessIdentity = this.#businessIdentity();
    const pages = businessIdentity === null
      ? []
      : this.#input.pages
          .map((page) => this.#pageDescriptor(page, businessIdentity.displayName))
          .filter((page): page is ManagedSiteSeoDescriptor["pages"][number] => page !== null);
    const complete = businessIdentity !== null && pages.length === this.#input.pages.length;
    return {
      descriptor: complete && businessIdentity !== null
        ? {
            protectedFields: this.#fields.map((field) => ({
              id: field.id,
              scope: field.scope,
              type: "internal_protected",
              classification: "internal_protected",
              capabilities: [],
              valueType: field.valueType,
              semantic: field.semantic,
              resolver: resolverFor(field.sourcePath, field.pointer),
              usages: usagesFor(field, this.#input.pages),
              presentation: {
                name: field.name,
                description: null,
                group: "SEO (internal)",
                order: this.#fields.indexOf(field) + 1,
                example: null,
              },
            })) as ManagedSiteSeoDescriptor["protectedFields"],
            businessIdentity,
            pages,
            generatedPages: [],
            redirects: [],
          }
        : null,
      fields: this.#fields,
      contentValues: this.#fields.map(
        (field) =>
          ({
            fieldId: field.id,
            owner: ownerOf(field, this.#input.pages),
            type: "internal_protected",
            valueType: field.valueType,
            value: field.value,
          }) as ManagedSiteContentValue,
      ),
      findings: this.#findings,
    };
  }
}

function pageForField(field: SeoField, pages: readonly PageBinding[]): PageBinding | undefined {
  return pages.find((page) => field.sourcePath.endsWith(`/pages/${page.slug}.json`));
}

function usagesFor(
  field: SeoField,
  pages: readonly PageBinding[],
): readonly { readonly pageId: StableId<"page">; readonly itemId: null }[] {
  if (field.scope === "site") {
    return pages.map((page) => ({ pageId: page.pageId, itemId: null }));
  }
  const page = pageForField(field, pages);
  return page === undefined ? [] : [{ pageId: page.pageId, itemId: null }];
}

function ownerOf(field: SeoField, pages: readonly PageBinding[]): JsonValue {
  if (field.scope === "site") return { kind: "site" };
  const page = pageForField(field, pages);
  return page === undefined ? { kind: "site" } : { kind: "page", pageId: page.pageId };
}

export function emitSeo(input: SeoInput): SeoEmission {
  return new SeoBuilder(input).build();
}
