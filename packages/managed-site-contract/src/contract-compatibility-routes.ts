import { canonicalizeJson } from "./canonical.js";
import type { ManagedSiteContentDocument, ManagedSiteContentValue } from "./content.js";
import type { ManagedPageDescriptor, ManagedSiteContractV1 } from "./contract.js";
import { ManagedSiteContractError } from "./errors.js";

type Redirect = ManagedSiteContractV1["internalSeo"]["redirects"][number];

/**
 * A production redirect the candidate keeps at its path but changes: a new
 * destination, a new status, or both. The policy admits these and lists every
 * one, so Site Guard can show what a code change does to an existing URL.
 */
export interface ManagedSiteRedirectChangeV1 {
  readonly fromPath: string;
  readonly fromDestination: Redirect["destination"];
  readonly toDestination: Redirect["destination"];
  readonly fromStatus: Redirect["status"];
  readonly toStatus: Redirect["status"];
}

/**
 * The statuses that tell a search engine a URL moved for good. Every other
 * status, including any the schema admits later, counts as temporary, so an
 * unrecognised status can never pass as permanent.
 */
const PERMANENT_REDIRECT_STATUSES: ReadonlySet<number> = new Set([301, 308]);

function fail(code: string, message: string): never {
  throw new ManagedSiteContractError(code, message);
}

function isPermanent(redirect: Redirect): boolean {
  return PERMANENT_REDIRECT_STATUSES.has(redirect.status);
}

function pagesById(
  contract: ManagedSiteContractV1,
): ReadonlyMap<string, ManagedPageDescriptor> {
  return new Map(contract.pages.map((page) => [page.id, page]));
}

function redirectsByPath(
  contract: ManagedSiteContractV1,
): ReadonlyMap<string, Redirect> {
  return new Map(
    contract.internalSeo.redirects.map((redirect) => [redirect.fromPath, redirect]),
  );
}

interface Candidate {
  readonly contract: ManagedSiteContractV1;
  readonly content: ManagedSiteContentDocument;
  readonly pages: ReadonlyMap<string, ManagedPageDescriptor>;
  readonly redirects: ReadonlyMap<string, Redirect>;
}

function candidateOf(contract: ManagedSiteContractV1, content: ManagedSiteContentDocument): Candidate {
  return { contract, content, pages: pagesById(contract), redirects: redirectsByPath(contract) };
}

function withoutTrailingSlash(path: string): string {
  return path.length > 1 && path.endsWith("/") ? path.slice(0, -1) : path;
}

/** A canonical's path, or null unless it is an absolute URL with no query. */
function canonicalPath(value: unknown): string | null {
  if (typeof value !== "string" || !URL.canParse(value)) return null;
  const url = new URL(value);
  return url.search === "" ? withoutTrailingSlash(url.pathname) : null;
}

/**
 * Owned by this page alone. A site-owned value is not evidence of what one
 * page serves: every page shares it, so it may name any of them or none.
 */
function ownedBy(value: ManagedSiteContentValue, pageId: string): boolean {
  return value.owner.kind === "page" && value.owner.pageId === pageId;
}

/**
 * The page's own value for a field. Content semantics refuse a second value
 * for the same field and owner (CONTENT_VALUE_DUPLICATE), and the candidate's
 * content passes them before this runs, so there is at most one.
 */
function pageOwnedValue(candidate: Candidate, fieldId: string, pageId: string): unknown {
  const value = candidate.content.values.find((entry) => entry.fieldId === fieldId && ownedBy(entry, pageId));
  return value !== undefined && "value" in value ? value.value : undefined;
}

/**
 * Whether the page's own canonical names `path` on the site's own origin. No
 * value, or one that does not parse, is not proof.
 */
function canonicalNames(candidate: Candidate, pageId: string, path: string): boolean {
  const entry = candidate.contract.internalSeo.pages.find((seo) => seo.pageId === pageId);
  // The page's canonical is among the site's, so one site origin means it names it.
  if (entry === undefined || siteOrigin(candidate) === null) return false;
  return canonicalPath(pageOwnedValue(candidate, entry.metadata.canonical, pageId)) === path;
}

function canonicalOrigin(value: unknown): string | null {
  return typeof value === "string" && URL.canParse(value) ? new URL(value).origin : null;
}

/**
 * The site's own origin: the one origin every canonical the site publishes
 * names, a static page's or a generated item's. None, or more than one, and
 * no canonical can be shown to name this site, so nothing that needs one
 * passes. Content is production's in a code change, so this is the origin the
 * site already declares.
 */
function siteOrigin(candidate: Candidate): string | null {
  const fields = canonicalFieldIds(candidate);
  const origins = new Set(candidate.content.values
    .filter((value) => fields.has(value.fieldId))
    .map((value) => canonicalOrigin("value" in value ? value.value : undefined)));
  const [only] = origins;
  return origins.size === 1 && only !== undefined && only !== null ? only : null;
}

function canonicalFieldIds(candidate: Candidate): ReadonlySet<string> {
  const { pages, generatedPages } = candidate.contract.internalSeo;
  return new Set([...pages, ...generatedPages].map((entry) => entry.metadata.canonical));
}

/**
 * Every production page keeps its route exactly: a static path, or a generated
 * pattern with its collection and route key. Moving a URL changes the route
 * and the page's canonical together, and a code change cannot edit content,
 * so no change is admitted here until Site Guard can check a code change and
 * a content change as one. The ordinary policy and a declared migration both
 * run this rule. Removing a page is already refused as a removed declaration,
 * which runs first.
 */
export function assertProductionRoutesUnmoved(
  production: ManagedSiteContractV1,
  candidate: ManagedSiteContractV1,
): void {
  const routes = new Map(candidate.pages.map((page) => [page.id, canonicalizeJson(page.route)]));
  const moved = production.pages.find((page) => routes.get(page.id) !== canonicalizeJson(page.route));
  if (moved !== undefined) {
    fail("COMPATIBILITY_ROUTE_REMOVED", `Production route moved or removed: ${moved.id}`);
  }
}

/**
 * The redirect fields with a rule of their own: a destination may move to an
 * indexable live static page, and a permanent status stays permanent. Every
 * other field of a production redirect, today's and any the schema gains, is
 * kept exactly.
 */
export const MANAGED_REDIRECT_FIELDS_WITH_THEIR_OWN_RULE = Object.freeze(["destination", "status"] as const);

function withoutOwnRuleFields(redirect: Redirect): unknown {
  const owned = new Set<string>(MANAGED_REDIRECT_FIELDS_WITH_THEIR_OWN_RULE);
  return Object.fromEntries(Object.entries(redirect).filter(([key]) => !owned.has(key)));
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * Whether the page is indexed at its own URL: it has a static path, its own
 * indexing value is `index: true`, and its own canonical names that path. A redirect to a noindex page, or to one that canonicalises
 * elsewhere, hands the old URL to something search engines will not keep.
 */
function isIndexedAtItsUrl(candidate: Candidate, pageId: string): boolean {
  const route = candidate.pages.get(pageId)?.route;
  const entry = candidate.contract.internalSeo.pages.find((seo) => seo.pageId === pageId);
  if (route?.kind !== "static" || entry === undefined) return false;
  const indexing = pageOwnedValue(candidate, entry.metadata.indexing, pageId);
  return isRecord(indexing) && indexing.index === true && canonicalNames(candidate, pageId, route.path);
}

function isIndexableLivePage(redirect: Redirect, candidate: Candidate): boolean {
  return redirect.destination.kind === "page" && isIndexedAtItsUrl(candidate, redirect.destination.pageId);
}

function assertRedirectPreserved(production: Redirect, next: Redirect, candidate: Candidate): void {
  if (canonicalizeJson(withoutOwnRuleFields(production)) !== canonicalizeJson(withoutOwnRuleFields(next))) {
    fail("COMPATIBILITY_REDIRECT_CHANGED", `Production redirect changed: ${production.fromPath}`);
  }
  const sameDestination = canonicalizeJson(production.destination) === canonicalizeJson(next.destination);
  if (!sameDestination && !isIndexableLivePage(next, candidate)) {
    fail(
      "COMPATIBILITY_REDIRECT_CHANGED",
      `Production redirect no longer reaches an indexable live static page: ${production.fromPath}`,
    );
  }
  if (isPermanent(production) && !isPermanent(next)) {
    fail("COMPATIBILITY_REDIRECT_CHANGED", `Production redirect is no longer permanent: ${production.fromPath}`);
  }
}

function redirectChange(production: Redirect, next: Redirect): ManagedSiteRedirectChangeV1 | null {
  if (canonicalizeJson(production) === canonicalizeJson(next)) return null;
  return Object.freeze({
    fromPath: production.fromPath,
    fromDestination: production.destination,
    toDestination: next.destination,
    fromStatus: production.status,
    toStatus: next.status,
  });
}

/**
 * Every production redirect is kept at its path. Its destination may move
 * only to an indexable page the candidate serves at a static path, a
 * permanent status stays permanent, and every other field is unchanged. New
 * redirects are free. Returns every kept redirect that changed, by path.
 */
export function assertProductionRedirectsPreserved(
  production: ManagedSiteContractV1,
  candidateContract: ManagedSiteContractV1,
  candidateContent: ManagedSiteContentDocument,
): readonly ManagedSiteRedirectChangeV1[] {
  const candidate = candidateOf(candidateContract, candidateContent);
  const changes: ManagedSiteRedirectChangeV1[] = [];
  for (const redirect of production.internalSeo.redirects) {
    const next = candidate.redirects.get(redirect.fromPath);
    if (next === undefined) {
      fail(
        "COMPATIBILITY_REDIRECT_REMOVED",
        `Production redirect removed: ${redirect.fromPath}`,
      );
    }
    assertRedirectPreserved(redirect, next, candidate);
    const change = redirectChange(redirect, next);
    if (change !== null) changes.push(change);
  }
  return Object.freeze(changes.sort((left, right) => (left.fromPath < right.fromPath ? -1 : 1)));
}
