import { readFileSync } from "node:fs";

import { isRepositoryPath } from "./paths.js";
import {
  bridgeSrcFor,
  isSupportedBridgeVersion,
  MANAGED_PAGE_PURPOSES,
  MANAGED_SERVED_ASSET_ROOT,
  MAX_REPOSITORY_PATH_SEGMENT_BYTES,
  parseManagedAbsoluteHttpsUrl,
  parseManagedCollectionBounds,
  parseManagedInternalString,
  parseManagedInternalStringList,
  parseManagedLinkLabelConstraints,
  parseManagedPerformanceBudget,
  parseManagedRichTextConstraints,
  parseManagedSitemapPolicy,
  parseManagedTextConstraints,
  SUPPORTED_BRIDGE_VERSIONS,
} from "@landing-pages-websites/managed-site-contract";
import type {
  ManagedPagePurpose,
  ManagedPerformanceBudget,
  ManagedSitemapPolicy,
  SupportedBridgeVersion,
} from "@landing-pages-websites/managed-site-contract";

/**
 * Facts the proposer refuses to invent.
 *
 * Everything in here is either a platform constant (the review bridge) or a
 * governance decision (length limits, collection bounds, SEO intent, business
 * identity). None of it is discoverable by reading a website's source, so the
 * tool takes it as input and reports every piece that is missing instead of
 * defaulting silently into the contract.
 */

export interface BridgeDelivery {
  /** The delivered asset is immutable per version, never rebuilt. */
  readonly version: SupportedBridgeVersion;
  readonly src: string;
  readonly integrity: string;
  readonly crossOrigin: "anonymous";
  readonly load: "head_defer";
}

export interface TextPolicy {
  readonly labelMaxLength: number;
  readonly bodyMaxLength: number;
  readonly headingMaxLength: number;
  readonly linkLabelMaxLength: number;
  readonly richTextMaxCharacters: number;
  readonly richTextMaxNodes: number;
}

export interface CollectionPolicy {
  readonly minItems: number;
  readonly maxItems: number;
}

export interface AssetPolicy {
  readonly maxBytes: number;
}

export interface BusinessIdentityInput {
  readonly legalName: string | null;
  readonly displayName: string | null;
  readonly telephone: string | null;
  readonly email: string | null;
  readonly description: string | null;
  readonly sameAs: readonly string[] | null;
}

/**
 * The page-level SEO inputs are the contract's own types, not a copy of them.
 * They are handed to the descriptor untouched, so any shape stated twice here
 * would be a second thing to keep in step with the standard.
 */
export type PagePurpose = ManagedPagePurpose;
export type SitemapPolicy = ManagedSitemapPolicy;
export type PerformanceBudget = ManagedPerformanceBudget;

export interface PageSeoInput {
  readonly purpose: PagePurpose | null;
  readonly canonical: string | null;
  readonly sitemap: SitemapPolicy | null;
  readonly performanceBudget: PerformanceBudget | null;
  /**
   * Whether a customer owns the words on this route. Defaults to true.
   *
   * Every route the scan finds and KEEPS has to be declared here or the
   * descriptor is incomplete and the contract will not validate, so a
   * repository's internal screens -- an operator console, a debug page -- have
   * to be declared too. A route the scan excludes needs no declaration; see
   * `route-serving.ts` for the one it excludes on its own evidence.
   * Declaring one used to be the same as offering its labels to the customer:
   * All Points Media's password-gated `/admin` contributed seven editable
   * fields, 'Shared password' among them, to the editor of a page no customer
   * can open.
   *
   * Setting this false keeps the route's SEO facts and gives it no content of
   * its own: none of its words become fields, collections or asset slots, and
   * it gets no page-root annotation, so the editor discovers nothing on it.
   *
   * It is a statement about this route, not about the files it renders. A
   * component it SHARES with a public page belongs to the customer and is
   * rewired as usual, and a client one is threaded at this route's call site
   * too -- otherwise the internal screen alone would keep rendering the
   * literal after the customer edits it. It says nothing about who may READ
   * the page; that is the repository's own auth.
   */
  readonly managedContent: boolean;
}

export interface ConversionConfig {
  readonly contentRoot: string;
  readonly assetRoot: string;
  readonly bridge: BridgeDelivery | null;
  readonly text: TextPolicy;
  readonly collections: CollectionPolicy;
  readonly assets: AssetPolicy;
  readonly businessIdentity: BusinessIdentityInput;
  readonly pages: ReadonlyMap<string, PageSeoInput>;
}

export const DEFAULT_TEXT_POLICY: TextPolicy = {
  labelMaxLength: 160,
  bodyMaxLength: 1_000,
  headingMaxLength: 300,
  linkLabelMaxLength: 160,
  richTextMaxCharacters: 2_000,
  richTextMaxNodes: 200,
};

export const DEFAULT_COLLECTION_POLICY: CollectionPolicy = { minItems: 1, maxItems: 24 };
export const DEFAULT_ASSET_POLICY: AssetPolicy = { maxBytes: 5_242_880 };

const EMPTY_BUSINESS_IDENTITY: BusinessIdentityInput = {
  legalName: null,
  displayName: null,
  telephone: null,
  email: null,
  description: null,
  sameAs: null,
};

export function defaultConfig(): ConversionConfig {
  return {
    contentRoot: "src/content",
    assetRoot: "public",
    bridge: null,
    text: DEFAULT_TEXT_POLICY,
    collections: DEFAULT_COLLECTION_POLICY,
    assets: DEFAULT_ASSET_POLICY,
    businessIdentity: EMPTY_BUSINESS_IDENTITY,
    pages: new Map(),
  };
}

type UnknownRecord = Readonly<Record<string, unknown>>;

/**
 * Absent and wrong are different answers, at every key.
 *
 * A default belongs to a key nobody wrote. A key somebody wrote, with a value
 * this loader cannot use, is a mistake in the file, and replacing it with the
 * default hides the one thing the person needs told. That was not a hypothetical
 * shape: `"pages": 42` loaded as zero declared pages, and the run then failed
 * three stages later on `internalSeo: null` with `expected object, received
 * null`, naming neither the config nor the key.
 *
 * So every read below goes through `readOptional`, which defaults only on
 * absence. JSON has no `undefined`, so an explicit `null` is how a person writes
 * "not set" and is treated as absence too. Everything else is refused, named.
 */

type Read<Value> = (raw: unknown, refuse: (reason: string) => never) => Value;

function readOptional<Value>(
  record: UnknownRecord,
  key: string,
  fallback: Value,
  read: Read<Value>,
  path: string,
): Value {
  const raw = record[key];
  if (raw === undefined || raw === null) return fallback;
  return read(raw, (reason) => {
    throw new Error(`Conversion config at ${path} has an invalid ${key}: ${reason}`);
  });
}

function asRecord(value: unknown): UnknownRecord | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as UnknownRecord)
    : null;
}

function readRecord(raw: unknown, refuse: (reason: string) => never): UnknownRecord {
  return asRecord(raw) ?? refuse("it must be an object");
}

function readString(raw: unknown, refuse: (reason: string) => never): string {
  if (typeof raw !== "string") refuse("it must be a string");
  if (raw.length === 0) refuse("it must not be empty");
  return raw;
}

function readBoolean(raw: unknown, refuse: (reason: string) => never): boolean {
  if (typeof raw !== "boolean") refuse("it must be true or false");
  return raw;
}

function readStringArray(raw: unknown, refuse: (reason: string) => never): readonly string[] {
  if (!Array.isArray(raw)) refuse("it must be an array of strings");
  return raw.map((entry, index) =>
    typeof entry === "string" && entry.length > 0
      ? entry
      : refuse(`entry ${index} must be a non-empty string`),
  );
}

/**
 * Anything the contract package can parse is parsed by it, never re-described
 * here. A second statement of the purpose vocabulary, or of the priority and
 * budget bounds, is a second thing to keep in step, and the one that drifts is
 * always the copy.
 */
function readContractValue<Value>(
  parse: (input: unknown) => Value,
  subject: string,
): Read<Value> {
  return (raw, refuse) => {
    try {
      return parse(raw);
    } catch (error) {
      // Every throw is treated as a refusal rather than only the two error
      // classes this package knows the names of. A validator called with
      // untrusted input has no other reason to throw, and guessing wrong in the
      // other direction is the failure this whole file exists to stop: an
      // unrecognised error would escape as a stack trace naming no config key.
      // The underlying reason is carried through, so a fault in the validator
      // itself still reads as what it is rather than as a lie about the config.
      return refuse(`${subject} (${describeParseFailure(error)})`);
    }
  };
}

interface ParseIssue {
  readonly path?: readonly PropertyKey[];
  readonly message?: string;
}

/**
 * Schema failures arrive as a list of issues, and the list is what a person
 * needs: which field, and what was wrong with it. The raw message is a JSON dump
 * of the same thing.
 */
function describeParseFailure(error: unknown): string {
  const issues: unknown = (error as { readonly issues?: unknown }).issues;
  if (Array.isArray(issues)) {
    return (issues as readonly ParseIssue[])
      .map((issue) => {
        const where = issue.path?.join(".");
        return `${where === undefined || where === "" ? "value" : where}: ${issue.message ?? "invalid"}`;
      })
      .join("; ");
  }
  return error instanceof Error ? error.message : String(error);
}

/**
 * Identity values are emitted as internal-protected content unchanged, so they
 * are held to what that content may be. A `legalName` past the cap, a `sameAs`
 * entry past its own, or a hundred-and-first entry used to load, reach the
 * document, and come back as `contract: null` without naming the key that did it.
 */
const readIdentityText: Read<string> = (raw, refuse) => {
  readString(raw, refuse);
  return readContractValue(
    parseManagedInternalString,
    "is longer than the standard carries",
  )(raw, refuse);
};

const readIdentityUrls: Read<readonly string[]> = (raw, refuse) => {
  readStringArray(raw, refuse);
  return readContractValue(
    parseManagedInternalStringList,
    "is not a list the standard carries",
  )(raw, refuse);
};

function readBusinessIdentity(raw: unknown, refuse: (reason: string) => never): BusinessIdentityInput {
  const record = readRecord(raw, refuse);
  const optional = <Value>(key: string, read: Read<Value>): Value | null => {
    const entry = record[key];
    if (entry === undefined || entry === null) return null;
    return read(entry, (reason) => refuse(`${key} ${reason}`));
  };
  return {
    legalName: optional("legalName", readIdentityText),
    displayName: optional("displayName", readIdentityText),
    telephone: optional("telephone", readIdentityText),
    email: optional("email", readIdentityText),
    description: optional("description", readIdentityText),
    sameAs: optional("sameAs", readIdentityUrls),
  };
}

/**
 * The purpose vocabulary is the contract's own list, so a purpose added there
 * becomes settable here with no edit and none is spelled twice.
 */
const readPurpose: Read<PagePurpose> = (raw, refuse) => {
  const value = readString(raw, refuse);
  const purposes: readonly string[] = MANAGED_PAGE_PURPOSES;
  if (!purposes.includes(value)) {
    refuse(`"${value}" is not one of ${MANAGED_PAGE_PURPOSES.join(", ")}`);
  }
  return value as PagePurpose;
};
const readSitemap = readContractValue(parseManagedSitemapPolicy, "it is not a sitemap policy");
/**
 * The canonical URL is an internal-SEO `url` value, and the contract holds those
 * to an absolute HTTPS URL. Accepting any non-empty string here meant
 * `"not-a-url"` loaded, reached the descriptor, and came back as `contract: null`
 * without a word about which route or which key put it there.
 */
const readCanonical = readContractValue(
  parseManagedAbsoluteHttpsUrl,
  "it is not an absolute https URL",
);
const readBudget = readContractValue(
  parseManagedPerformanceBudget,
  "it is not a performance budget",
);

function readPageSeo(raw: unknown, refuse: (reason: string) => never): PageSeoInput {
  const record = readRecord(raw, refuse);
  const optional = <Value>(key: string, read: Read<Value>): Value | null => {
    const entry = record[key];
    if (entry === undefined || entry === null) return null;
    return read(entry, (reason) => refuse(`${key} ${reason}`));
  };
  return {
    purpose: optional("purpose", readPurpose),
    canonical: optional("canonical", readCanonical),
    sitemap: optional("sitemap", readSitemap),
    performanceBudget: optional("performanceBudget", readBudget),
    managedContent: optional("managedContent", readBoolean) ?? true,
  };
}

function readPages(
  raw: unknown,
  refuse: (reason: string) => never,
): ReadonlyMap<string, PageSeoInput> {
  const record = readRecord(raw, refuse);
  return new Map(
    Object.entries(record).map(([route, entry]) => [
      route,
      readPageSeo(entry, (reason) => refuse(`route ${route} ${reason}`)),
    ]),
  );
}

/**
 * A policy override is checked against the policy it overrides, and then against
 * what the contract will do with it.
 *
 * The accepted keys are the default policy's own keys, so a policy field added
 * anywhere becomes settable here with no edit, and a typo -- `maxItem` for
 * `maxItems` -- is refused instead of spreading a key the rest of the tool never
 * reads.
 *
 * Being an integer is not enough. `labelMaxLength: 0` and `maxItems: 0` are
 * integers the contract refuses, and leaving them to fail there produced a late
 * `contract: null` -- or nothing at all, when no field of that type happened to
 * be emitted, so the setting was simply ignored. `verify` builds the constraint
 * the emitter would build and hands it to the contract's own parser, which is the
 * only way this file can hold the same bounds without restating them.
 */
function readPolicy<Policy extends object>(
  base: Policy,
  verify: (policy: Policy, refuse: (reason: string) => never) => void,
): Read<Policy> {
  return (raw, refuse) => {
    const record = readRecord(raw, refuse);
    const overrides: Record<string, number> = {};
    for (const [key, value] of Object.entries(record)) {
      if (!Object.hasOwn(base, key)) refuse(`${key} is not a setting of this policy`);
      overrides[key] =
        typeof value === "number" && Number.isInteger(value)
          ? value
          : refuse(`${key} must be an integer`);
    }
    const policy = { ...base, ...overrides };
    verify(policy, refuse);
    return policy;
  };
}

/** Runs a contract parser over a value this config decides, and names the key. */
function check(
  key: string,
  parse: () => unknown,
  refuse: (reason: string) => never,
): void {
  try {
    parse();
  } catch (error) {
    refuse(`${key} is not a limit the standard accepts (${describeParseFailure(error)})`);
  }
}

/**
 * Every text limit becomes the `maxLength` of a constraint the contract parses,
 * and link labels have a lower ceiling than other text, so they are checked
 * through the schema that knows it.
 */
function verifyTextPolicy(policy: TextPolicy, refuse: (reason: string) => never): void {
  const lengths: readonly (readonly [string, number])[] = [
    ["labelMaxLength", policy.labelMaxLength],
    ["bodyMaxLength", policy.bodyMaxLength],
    ["headingMaxLength", policy.headingMaxLength],
  ];
  for (const [key, maxLength] of lengths) {
    check(key, () => parseManagedTextConstraints({ minLength: 0, maxLength, newlines: "forbid" }), refuse);
  }
  check(
    "linkLabelMaxLength",
    () =>
      parseManagedLinkLabelConstraints({
        minLength: 0,
        maxLength: policy.linkLabelMaxLength,
        newlines: "forbid",
      }),
    refuse,
  );
  check(
    "richTextMaxCharacters and richTextMaxNodes",
    () =>
      parseManagedRichTextConstraints({
        maxCharacters: policy.richTextMaxCharacters,
        maxNodes: policy.richTextMaxNodes,
        allowedBlocks: ["paragraph"],
        allowedMarks: [],
        allowLinks: false,
        allowedExternalHosts: [],
        allowedTargets: [],
      }),
    refuse,
  );
}

function verifyCollectionPolicy(
  policy: CollectionPolicy,
  refuse: (reason: string) => never,
): void {
  check("minItems and maxItems", () => parseManagedCollectionBounds(policy), refuse);
}

/**
 * An asset slot's `maxBytes` must be a positive integer. The contract states that
 * inside a slot schema that needs a dozen unrelated facts to parse, so this is
 * the one bound the config states itself; the emitter takes the larger of this
 * and the real file, so zero would simply be ignored rather than refused.
 */
function verifyAssetPolicy(policy: AssetPolicy, refuse: (reason: string) => never): void {
  if (policy.maxBytes <= 0) refuse("maxBytes must be a positive number of bytes");
}

/**
 * A real Subresource Integrity digest, which is what makes the placeholder in a
 * copied example fail loudly instead of reaching a contract. SHA-384 is 48
 * bytes, so its base64 is 64 characters and needs no padding.
 */
const SRI_SHA384 = /^sha384-[A-Za-z0-9+/]{64}$/u;

/**
 * The bridge block was previously cast, not read, so nothing caught a stale
 * version or an unreplaced digest.
 *
 * The version and source are checked against the contract package's own
 * supported list, and the source must be that version's own asset, rather than
 * a shape this file decides. Accepting anything the canonical parser rejects
 * would only move the failure: the config would load, and the proposal would
 * then fail to parse with `contract: null` and no statement of why. Promoting
 * the next bridge stays a single edit in the contract package, which this
 * follows automatically.
 *
 * The digest is still checked by shape, because it is per-asset and this package
 * has no way to know the right one -- only that the example's placeholder is not
 * it.
 */
function readBridge(raw: unknown, refuse: (reason: string) => never): BridgeDelivery {
  const record = readRecord(raw, refuse);
  const field = (key: string): string => {
    const value = record[key];
    return typeof value === "string" && value.length > 0 ? value : refuse(`${key} is missing`);
  };
  const version = field("version");
  if (!isSupportedBridgeVersion(version)) {
    refuse(`version ${version} is not one of the supported ${SUPPORTED_BRIDGE_VERSIONS.join(", ")}`);
  }
  const expectedSrc = bridgeSrcFor(version);
  const src = field("src");
  if (src !== expectedSrc) refuse(`src ${src} is not ${expectedSrc}`);
  const integrity = field("integrity");
  if (!SRI_SHA384.test(integrity)) {
    refuse("integrity is not a sha384 digest; replace the example placeholder");
  }
  if (record["crossOrigin"] !== "anonymous") refuse("crossOrigin must be anonymous");
  if (record["load"] !== "head_defer") refuse("load must be head_defer");
  return {
    version,
    src: expectedSrc,
    integrity,
    crossOrigin: "anonymous",
    load: "head_defer",
  };
}

/**
 * The longest content path the proposer can derive from `contentRoot`.
 *
 * Emitted content paths are `<root>/site.json` and `<root>/pages/<slug>.json`,
 * and `routeSlug` folds a route into a single segment. The contract caps a
 * segment, and that segment is `<slug>.json`, so the longest slug any valid path
 * can carry is the cap less the extension. A root with room for this suffix
 * cannot be the reason an emitted path is rejected; a longer slug is refused for
 * its own length, wherever the root came from.
 */
const CONTENT_SUFFIX = ".json";
const LONGEST_SLUG_BYTES = MAX_REPOSITORY_PATH_SEGMENT_BYTES - CONTENT_SUFFIX.length;

/**
 * The shortest asset path the proposer can derive from `assetRoot`.
 *
 * Unlike content paths, an asset path is whatever the repository already calls
 * the file, so no load-time budget can promise every one of them fits. What a
 * root must clear is the floor: an asset occupying a single file name, at the
 * longest name the contract permits. A root too long for that cannot address
 * some legal file, and is refused here rather than at the first image. Whether a
 * deeper path fits is decided where that path is built, in `assetRepositoryPath`.
 */
const SHORTEST_ASSET_SUFFIX = `/${"a".repeat(MAX_REPOSITORY_PATH_SEGMENT_BYTES)}`;

interface RootBudget {
  readonly suffix: string;
  readonly reason: string;
}

const ROOT_BUDGETS: Readonly<Record<"contentRoot" | "assetRoot", readonly RootBudget[]>> = {
  contentRoot: [
    { suffix: "/site.json", reason: "the site content path derived from it" },
    {
      suffix: `/pages/${"a".repeat(LONGEST_SLUG_BYTES)}${CONTENT_SUFFIX}`,
      reason: "the longest page content path derived from it",
    },
  ],
  assetRoot: [
    { suffix: SHORTEST_ASSET_SUFFIX, reason: "the longest single file name an asset may have" },
  ],
};

/**
 * Roots are validated together with what gets appended to them.
 *
 * Checking the prefix alone was a guarantee that did not hold: the contract
 * bounds a whole path, so a root just inside the limit passed on load and then
 * failed at emission, which is exactly the late failure this validation exists
 * to prevent. Each root states its own budgets above rather than this function
 * asking which root it is, so a new root without a stated budget is a type
 * error, not a silently unbudgeted one. The error stays keyed to the config
 * field, because that is what a person can act on.
 */
function readRoot(key: keyof typeof ROOT_BUDGETS): Read<string> {
  return (raw, refuse) => {
    const root = readString(raw, refuse);
    const check = (candidate: string, reason: string): void => {
      if (!isRepositoryPath(candidate)) refuse(`"${root}" ${reason}`);
    };
    check(root, "is not a relative POSIX repository path");
    for (const budget of ROOT_BUDGETS[key]) {
      check(`${root}${budget.suffix}`, `leaves no room for ${budget.reason}`);
    }
    return root;
  };
}

/**
 * The asset root is where the converter records every image it reads, and the
 * pinned contract accepts an image only at a served path
 * (isManagedServedAssetPath: under MANAGED_SERVED_ASSET_ROOT). So a root is
 * accepted only if it IS that served root. A root outside it would emit image
 * values the contract refuses, and the proposal would come back with no
 * contract. A root inside it (public/images) would be contract-valid and still
 * wrong: the source writes an image as a URL, `/hero.png`, which is served from
 * public/hero.png, and joining that URL to public/images records a different
 * file than the one rendered. Refused here, where a person can act on it.
 */
const readServedAssetRoot: Read<string> = (raw, refuse) => {
  const root = readRoot("assetRoot")(raw, refuse);
  if (`${root}/` !== MANAGED_SERVED_ASSET_ROOT) {
    refuse(
      `"${root}" is not the served root "${MANAGED_SERVED_ASSET_ROOT.slice(0, -1)}": the contract accepts an ` +
        `image only under ${MANAGED_SERVED_ASSET_ROOT}, and an image written as /name.png is the file ` +
        `${MANAGED_SERVED_ASSET_ROOT}name.png`,
    );
  }
  return root;
};

export function loadConfig(path: string | null): ConversionConfig {
  const base = defaultConfig();
  if (path === null) return base;
  const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
  const record = asRecord(parsed);
  if (record === null) throw new Error(`Conversion config at ${path} is not a JSON object`);
  const read = <Value>(key: string, fallback: Value, reader: Read<Value>): Value =>
    readOptional(record, key, fallback, reader, path);
  return {
    contentRoot: read("contentRoot", base.contentRoot, readRoot("contentRoot")),
    assetRoot: read("assetRoot", base.assetRoot, readServedAssetRoot),
    bridge: read("bridge", base.bridge, readBridge),
    text: read("text", base.text, readPolicy(base.text, verifyTextPolicy)),
    collections: read(
      "collections",
      base.collections,
      readPolicy(base.collections, verifyCollectionPolicy),
    ),
    assets: read("assets", base.assets, readPolicy(base.assets, verifyAssetPolicy)),
    businessIdentity: read("businessIdentity", base.businessIdentity, readBusinessIdentity),
    pages: read("pages", base.pages, readPages),
  };
}
