import type { ManagedSiteContractV1 } from "./contract.js";
import { ManagedSiteContractError } from "./errors.js";
import { getStableIdKind, type StableId, type StableIdKind } from "./ids.js";
import type { JsonValue } from "./json.js";

const LOWERCASE_TOKEN_CHARACTERS = ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j", "k", "l", "m", "n", "o", "p", "q", "r", "s", "t", "u", "v", "w", "x", "y", "z"] as const;
const DIGIT_TOKEN_CHARACTERS = ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9"] as const;

type Join<Prefix extends string, Key extends string> = Prefix extends "" ? Key : `${Prefix}.${Key}`;
type QualifyVariant<Path extends string, Discriminator extends "type" | "kind", Variant extends string> =
  Path extends `${infer Prefix}[]`
    ? `${Prefix}[${Discriminator}=${Variant}]`
    : `${Path}[${Discriminator}=${Variant}]`;
type IsExactly<Left, Right> = [Left] extends [Right]
  ? [Right] extends [Left] ? true : false
  : false;
type HasExactAncestor<T, Ancestors extends readonly unknown[]> =
  Ancestors extends readonly [infer Head, ...infer Tail]
    ? IsExactly<T, Head> extends true ? true : HasExactAncestor<T, Tail>
    : false;
type IsUnion<T, Whole = T> = T extends Whole
  ? [Whole] extends [T] ? false : true
  : never;
type IsAny<T> = 0 extends (1 & T) ? true : false;
type LowercaseLetter = (typeof LOWERCASE_TOKEN_CHARACTERS)[number];
type Digit = (typeof DIGIT_TOKEN_CHARACTERS)[number];
type SafeTokenCharacter = LowercaseLetter | Uppercase<LowercaseLetter> | Digit | "_";
type IsSafeToken<T extends string> = string extends T
  ? false
  : T extends `${infer Character}${infer Rest}`
    ? Character extends SafeTokenCharacter ? Rest extends "" ? true : IsSafeToken<Rest> : false
    : false;
type UnsupportedReason = "any" | "key" | "object" | "open" | "path" | "recursion" | "union" | "unknown";
type UnsupportedEntry<Reason extends UnsupportedReason, Path extends string> = {
  readonly unsupported: Reason;
  readonly path: Path;
};
type StableKindEntry<Kind extends StableIdKind, Path extends string> = Kind extends unknown
  ? { readonly path: Path; readonly idKind: Kind }
  : never;
type NonOpaqueStableEntry<T, Path extends string, Ancestors extends readonly unknown[]> =
  [NonNullable<T>] extends [never]
    ? never
    : StableEntryValue<NonNullable<T>, Path, Ancestors>;
type NonUnknownStableEntry<T, Path extends string, Ancestors extends readonly unknown[]> =
  IsExactly<NonNullable<T>, NonNullable<JsonValue>> extends true
    ? never
    : NonOpaqueStableEntry<T, Path, Ancestors>;
type NonAnyStableEntry<T, Path extends string, Ancestors extends readonly unknown[]> =
  unknown extends T
    ? UnsupportedEntry<"unknown", Path>
    : NonUnknownStableEntry<T, Path, Ancestors>;
type StableEntry<T, Path extends string = "", Ancestors extends readonly unknown[] = []> =
  IsAny<T> extends true
    ? UnsupportedEntry<"any", Path>
    : NonAnyStableEntry<T, Path, Ancestors>;
type StableVariantEntry<T, Path extends string, Discriminator extends "type" | "kind", Variant extends string, Ancestors extends readonly unknown[]> =
  IsSafeToken<Variant> extends true
    ? StableProperties<T, QualifyVariant<Path, Discriminator, Variant>, Ancestors>
    : UnsupportedEntry<"path", QualifyVariant<Path, Discriminator, Variant>>;
type StableObjectEntry<T extends object, Path extends string, Ancestors extends readonly unknown[]> =
  T extends { readonly type: infer Variant extends string }
    ? StableVariantEntry<T, Path, "type", Variant, Ancestors>
    : T extends { readonly kind: infer Variant extends string }
      ? StableVariantEntry<T, Path, "kind", Variant, Ancestors>
      : StableProperties<T, Path, Ancestors>;
type StablePropertyEntry<T, Key extends string, Path extends string, Ancestors extends readonly unknown[]> =
  IsSafeToken<Key> extends true
    ? StableEntry<T, Join<Path, Key>, Ancestors>
    : UnsupportedEntry<"path", Join<Path, Key>>;
type StableProperties<T, Path extends string, Ancestors extends readonly unknown[]> = {
  [Key in keyof T & string]: StablePropertyEntry<T[Key], Key, Path, Ancestors>
}[keyof T & string];
type StableArrayEntry<T extends readonly unknown[], Path extends string, Ancestors extends readonly unknown[]> =
  number extends T["length"]
    ? StableEntry<T[number], `${Path}[]`, Ancestors>
    : { [Key in keyof T & `${number}`]: StableEntry<T[Key], `${Path}[${Key}]`, Ancestors> }[keyof T & `${number}`];
type CanonicalMutableArray<T extends unknown[]> = number extends T["length"]
  ? T[number][]
  : T extends [...infer Items] ? [...Items] : never;
type CanonicalReadonlyArray<T extends readonly unknown[]> = number extends T["length"]
  ? readonly T[number][]
  : T extends readonly [...infer Items] ? readonly [...Items] : never;
type CanonicalArray<T extends readonly unknown[]> = T extends unknown[]
  ? CanonicalMutableArray<T>
  : CanonicalReadonlyArray<T>;
type HasArrayExtraKeys<T extends readonly unknown[]> =
  Exclude<keyof T, keyof CanonicalArray<T>> extends never
    ? IsExactly<Required<T>, Required<CanonicalArray<T>>> extends true ? false : true
    : true;
type CheckedStableArrayEntry<T extends readonly unknown[], Path extends string, Ancestors extends readonly unknown[]> =
  true extends IsUnion<T> | IsUnion<Required<T>> ? UnsupportedEntry<"union", Path>
    : HasArrayExtraKeys<T> extends true ? UnsupportedEntry<"key", Path>
      : StableArrayEntry<T, Path, Ancestors>;
type DistributedUnionEntry<T, Path extends string, Ancestors extends readonly unknown[]> =
  T extends unknown ? StableEntryValue<T, Path, Ancestors> : never;
type DiscriminatedUnionEntry<T, Whole, Path extends string, Ancestors extends readonly unknown[]> =
  T extends object ? StableObjectEntry<T, Path, [...Ancestors, Whole, T]> : never;
type TypeDiscriminatedEntry<T, Path extends string, Ancestors extends readonly unknown[]> =
  IsUnion<T extends { readonly type: infer Variant } ? Variant : never> extends true
    ? DiscriminatedUnionEntry<T, T, Path, Ancestors>
    : UnsupportedEntry<"union", Path>;
type KindDiscriminatedEntry<T, Path extends string, Ancestors extends readonly unknown[]> =
  IsUnion<T extends { readonly kind: infer Variant } ? Variant : never> extends true
    ? DiscriminatedUnionEntry<T, T, Path, Ancestors>
    : UnsupportedEntry<"union", Path>;
type UndiscriminatedUnionEntry<T, Path extends string, Ancestors extends readonly unknown[]> =
  [DistributedUnionEntry<T, Path, Ancestors>] extends [never]
    ? never
    : UnsupportedEntry<"union", Path>;
type StableUnionEntry<T, Path extends string, Ancestors extends readonly unknown[]> =
  [T] extends [{ readonly type: string }]
    ? TypeDiscriminatedEntry<T, Path, Ancestors>
    : [T] extends [{ readonly kind: string }]
      ? KindDiscriminatedEntry<T, Path, Ancestors>
      : UndiscriminatedUnionEntry<T, Path, Ancestors>;
type HasOpenIndex<T> = string extends keyof T ? true : false;
type HasUnsupportedKey<T> = Exclude<keyof T, string> extends never ? false : true;
type NonBareObjectStableEntry<T extends object, Path extends string, Ancestors extends readonly unknown[]> =
  HasOpenIndex<T> extends true
    ? UnsupportedEntry<"open", Path>
    : HasUnsupportedKey<T> extends true
      ? UnsupportedEntry<"key", Path>
      : StableObjectEntry<T, Path, [...Ancestors, T]>;
type KnownObjectStableEntry<T extends object, Path extends string, Ancestors extends readonly unknown[]> =
  [keyof T] extends [never]
    ? UnsupportedEntry<"object", Path>
    : NonBareObjectStableEntry<T, Path, Ancestors>;
type NonStableScalar = string | number | boolean | bigint | symbol;
type NonUnionStableEntry<T, Path extends string, Ancestors extends readonly unknown[]> =
  [T] extends [NonStableScalar]
    ? never
    : [T] extends [object] ? KnownObjectStableEntry<T & object, Path, Ancestors> : never;
type NonArrayStableEntry<T, Path extends string, Ancestors extends readonly unknown[]> =
  IsUnion<T> extends true
    ? StableUnionEntry<T, Path, Ancestors>
    : NonUnionStableEntry<T, Path, Ancestors>;
type FreshStableEntry<T, Path extends string, Ancestors extends readonly unknown[]> =
  [T] extends [readonly unknown[]]
    ? CheckedStableArrayEntry<Extract<T, readonly unknown[]>, Path, [...Ancestors, T]>
    : NonArrayStableEntry<T, Path, Ancestors>;
type StructuredStableEntry<T, Path extends string, Ancestors extends readonly unknown[]> =
  HasExactAncestor<T, Ancestors> extends true
    ? UnsupportedEntry<"recursion", Path>
    : FreshStableEntry<T, Path, Ancestors>;
type StableEntryValue<T, Path extends string, Ancestors extends readonly unknown[]> =
  [T] extends [StableId<infer Kind extends StableIdKind>]
    ? StableKindEntry<Kind, Path>
    : StructuredStableEntry<T, Path, Ancestors>;
type NormalizeAllKinds<Entry, AllKindsPath extends string> =
  Entry extends { readonly path: AllKindsPath; readonly idKind: StableIdKind }
    ? { readonly path: AllKindsPath; readonly idKind: "actual" }
    : Entry;
type EntryKey<Entry> = Entry extends { readonly path: infer Path extends string; readonly idKind: infer Kind extends StableIdKind | "actual" }
  ? `${Path}#${Kind}`
  : Entry extends UnsupportedEntry<infer Reason, infer Path>
    ? `__unsupported_${Reason}:${Path}`
    : never;

export type ManagedSiteStableOccurrenceCoverage<T, AllKindsPath extends string = never> = {
  readonly [Entry in NormalizeAllKinds<StableEntry<T>, AllKindsPath> as EntryKey<Entry>]:
    Entry extends { readonly idKind: infer Kind extends StableIdKind | "actual" } ? Kind : never;
};

type ContractStableEntry = StableEntry<ManagedSiteContractV1>;
type ContractRegistryEntry = NormalizeAllKinds<ContractStableEntry, "tombstonedIds[]">;
type ContractStablePath = Extract<ContractRegistryEntry, { path: string }>["path"];

type OccurrenceScopeRule = "global" | "collection" | "route_collection";
type OccurrenceRule<Kind extends StableIdKind> =
  { readonly idKind: Kind } & (
  | { readonly role: "declaration"; readonly scope: Exclude<OccurrenceScopeRule, "route_collection"> }
  | { readonly role: "reference"; readonly scope: OccurrenceScopeRule }
  | { readonly role: "deferred" }
  );
type TombstoneRule = { readonly idKind: "actual"; readonly role: "tombstone" };
type RuleFor<Entry> = Entry extends { readonly idKind: infer Kind extends StableIdKind }
  ? OccurrenceRule<Kind>
  : Entry extends { readonly idKind: "actual" } ? TombstoneRule : never;
type OccurrenceRegistryMap = {
  readonly [Entry in ContractRegistryEntry as EntryKey<Entry>]: RuleFor<Entry>;
};

const OCCURRENCE_RULES = {
  "contractId#contract": { idKind: "contract", role: "declaration", scope: "global" },
  "pages[].id#page": { idKind: "page", role: "declaration", scope: "global" },
  "pages[].route[kind=generated].collectionId#collection": { idKind: "collection", role: "reference", scope: "global" },
  "pages[].route[kind=generated].routeKeyFieldId#field": { idKind: "field", role: "reference", scope: "route_collection" },
  "pages[].sections[].id#section": { idKind: "section", role: "declaration", scope: "global" },
  "pages[].sections[].fields[type=plain_text].id#field": { idKind: "field", role: "declaration", scope: "global" },
  "pages[].sections[].fields[type=plain_text].usages[].pageId#page": { idKind: "page", role: "reference", scope: "global" },
  "pages[].sections[].fields[type=plain_text].usages[].itemId#item": { idKind: "item", role: "deferred" },
  "pages[].sections[].fields[type=heading_text].id#field": { idKind: "field", role: "declaration", scope: "global" },
  "pages[].sections[].fields[type=heading_text].usages[].pageId#page": { idKind: "page", role: "reference", scope: "global" },
  "pages[].sections[].fields[type=heading_text].usages[].itemId#item": { idKind: "item", role: "deferred" },
  "pages[].sections[].fields[type=rich_text].id#field": { idKind: "field", role: "declaration", scope: "global" },
  "pages[].sections[].fields[type=rich_text].usages[].pageId#page": { idKind: "page", role: "reference", scope: "global" },
  "pages[].sections[].fields[type=rich_text].usages[].itemId#item": { idKind: "item", role: "deferred" },
  "pages[].sections[].fields[type=link].id#field": { idKind: "field", role: "declaration", scope: "global" },
  "pages[].sections[].fields[type=link].usages[].pageId#page": { idKind: "page", role: "reference", scope: "global" },
  "pages[].sections[].fields[type=link].usages[].itemId#item": { idKind: "item", role: "deferred" },
  "pages[].sections[].fields[type=image].id#field": { idKind: "field", role: "declaration", scope: "global" },
  "pages[].sections[].fields[type=image].usages[].pageId#page": { idKind: "page", role: "reference", scope: "global" },
  "pages[].sections[].fields[type=image].usages[].itemId#item": { idKind: "item", role: "deferred" },
  "pages[].sections[].fields[type=image].assetSlotId#asset": { idKind: "asset", role: "reference", scope: "global" },
  "pages[].sections[].fields[type=collection].id#field": { idKind: "field", role: "declaration", scope: "global" },
  "pages[].sections[].fields[type=collection].usages[].pageId#page": { idKind: "page", role: "reference", scope: "global" },
  "pages[].sections[].fields[type=collection].usages[].itemId#item": { idKind: "item", role: "deferred" },
  "pages[].sections[].fields[type=collection].collectionId#collection": { idKind: "collection", role: "reference", scope: "global" },
  "collections[].id#collection": { idKind: "collection", role: "declaration", scope: "global" },
  "collections[].itemFields[type=plain_text].id#field": { idKind: "field", role: "declaration", scope: "collection" },
  "collections[].itemFields[type=heading_text].id#field": { idKind: "field", role: "declaration", scope: "collection" },
  "collections[].itemFields[type=rich_text].id#field": { idKind: "field", role: "declaration", scope: "collection" },
  "collections[].itemFields[type=link].id#field": { idKind: "field", role: "declaration", scope: "collection" },
  "collections[].itemFields[type=image].id#field": { idKind: "field", role: "declaration", scope: "collection" },
  "collections[].itemFields[type=image].assetSlotId#asset": { idKind: "asset", role: "reference", scope: "global" },
  "collections[].itemFields[type=internal_protected].id#field": { idKind: "field", role: "declaration", scope: "collection" },
  "collections[].uniqueness[].fieldIds[]#field": { idKind: "field", role: "reference", scope: "collection" },
  "assets[].id#asset": { idKind: "asset", role: "declaration", scope: "global" },
  "internalSeo.protectedFields[type=internal_protected].id#field": { idKind: "field", role: "declaration", scope: "global" },
  "internalSeo.protectedFields[type=internal_protected].usages[].pageId#page": { idKind: "page", role: "reference", scope: "global" },
  "internalSeo.protectedFields[type=internal_protected].usages[].itemId#item": { idKind: "item", role: "deferred" },
  "internalSeo.businessIdentity.legalName#field": { idKind: "field", role: "reference", scope: "global" },
  "internalSeo.businessIdentity.displayName#field": { idKind: "field", role: "reference", scope: "global" },
  "internalSeo.businessIdentity.telephone#field": { idKind: "field", role: "reference", scope: "global" },
  "internalSeo.businessIdentity.postalAddress#field": { idKind: "field", role: "reference", scope: "global" },
  "internalSeo.businessIdentity.email#field": { idKind: "field", role: "reference", scope: "global" },
  "internalSeo.businessIdentity.geo#field": { idKind: "field", role: "reference", scope: "global" },
  "internalSeo.businessIdentity.openingHours#field": { idKind: "field", role: "reference", scope: "global" },
  "internalSeo.businessIdentity.sameAs#field": { idKind: "field", role: "reference", scope: "global" },
  "internalSeo.pages[].pageId#page": { idKind: "page", role: "reference", scope: "global" },
  "internalSeo.pages[].intent.primaryEntity#field": { idKind: "field", role: "reference", scope: "global" },
  "internalSeo.pages[].intent.services[]#field": { idKind: "field", role: "reference", scope: "global" },
  "internalSeo.pages[].intent.locations[]#field": { idKind: "field", role: "reference", scope: "global" },
  "internalSeo.pages[].metadata.title#field": { idKind: "field", role: "reference", scope: "global" },
  "internalSeo.pages[].metadata.description#field": { idKind: "field", role: "reference", scope: "global" },
  "internalSeo.pages[].metadata.canonical#field": { idKind: "field", role: "reference", scope: "global" },
  "internalSeo.pages[].metadata.indexing#field": { idKind: "field", role: "reference", scope: "global" },
  "internalSeo.pages[].metadata.social.title#field": { idKind: "field", role: "reference", scope: "global" },
  "internalSeo.pages[].metadata.social.description#field": { idKind: "field", role: "reference", scope: "global" },
  "internalSeo.pages[].metadata.social.image#asset": { idKind: "asset", role: "reference", scope: "global" },
  "internalSeo.pages[].metadata.social.imageFieldId#field": { idKind: "field", role: "reference", scope: "global" },
  "internalSeo.pages[].headingOutline[].fieldId#field": { idKind: "field", role: "reference", scope: "global" },
  "internalSeo.pages[].jsonLd[].sourceFieldIds[]#field": { idKind: "field", role: "reference", scope: "global" },
  "internalSeo.pages[].breadcrumbParentPageId#page": { idKind: "page", role: "reference", scope: "global" },
  "internalSeo.pages[].internalLinks.requiredPageIds[]#page": { idKind: "page", role: "reference", scope: "global" },
  "internalSeo.pages[].primaryImageAssetSlotId#asset": { idKind: "asset", role: "reference", scope: "global" },
  "internalSeo.generatedPages[].pageId#page": { idKind: "page", role: "reference", scope: "global" },
  "internalSeo.generatedPages[].collectionId#collection": { idKind: "collection", role: "reference", scope: "global" },
  "internalSeo.generatedPages[].intent.primaryEntity#field": { idKind: "field", role: "reference", scope: "route_collection" },
  "internalSeo.generatedPages[].intent.services[]#field": { idKind: "field", role: "reference", scope: "route_collection" },
  "internalSeo.generatedPages[].intent.locations[]#field": { idKind: "field", role: "reference", scope: "route_collection" },
  "internalSeo.generatedPages[].metadata.title#field": { idKind: "field", role: "reference", scope: "route_collection" },
  "internalSeo.generatedPages[].metadata.description#field": { idKind: "field", role: "reference", scope: "route_collection" },
  "internalSeo.generatedPages[].metadata.canonical#field": { idKind: "field", role: "reference", scope: "route_collection" },
  "internalSeo.generatedPages[].metadata.indexing#field": { idKind: "field", role: "reference", scope: "route_collection" },
  "internalSeo.generatedPages[].metadata.social.title#field": { idKind: "field", role: "reference", scope: "route_collection" },
  "internalSeo.generatedPages[].metadata.social.description#field": { idKind: "field", role: "reference", scope: "route_collection" },
  "internalSeo.generatedPages[].metadata.social.imageFieldId#field": { idKind: "field", role: "reference", scope: "route_collection" },
  "internalSeo.generatedPages[].headingOutline[].fieldId#field": { idKind: "field", role: "reference", scope: "route_collection" },
  "internalSeo.generatedPages[].jsonLd[].itemSourceFieldIds[]#field": { idKind: "field", role: "reference", scope: "route_collection" },
  "internalSeo.generatedPages[].jsonLd[].siteSourceFieldIds[]#field": { idKind: "field", role: "reference", scope: "global" },
  "internalSeo.generatedPages[].breadcrumbParentPageId#page": { idKind: "page", role: "reference", scope: "global" },
  "internalSeo.generatedPages[].internalLinks.requiredPageIds[]#page": { idKind: "page", role: "reference", scope: "global" },
  "internalSeo.generatedPages[].primaryImageFieldId#field": { idKind: "field", role: "reference", scope: "route_collection" },
  "internalSeo.redirects[].destination[kind=page].pageId#page": { idKind: "page", role: "reference", scope: "global" },
  "atomicAliasGroups[].id#alias": { idKind: "alias", role: "declaration", scope: "global" },
  "atomicAliasGroups[].fieldIds[]#field": { idKind: "field", role: "reference", scope: "global" },
  "tombstonedIds[]#actual": { idKind: "actual", role: "tombstone" },
} as const satisfies OccurrenceRegistryMap;

export type ManagedSiteContractOccurrenceRegistryEntry =
  (OccurrenceRule<StableIdKind> | TombstoneRule) & { readonly path: ContractStablePath };

function registryPath(key: string): ContractStablePath {
  return key.slice(0, key.lastIndexOf("#")) as ContractStablePath;
}

export const MANAGED_SITE_CONTRACT_OCCURRENCE_REGISTRY = Object.freeze(
  Object.entries(OCCURRENCE_RULES).map(([key, rule]) =>
    Object.freeze({ path: registryPath(key), ...rule }) as ManagedSiteContractOccurrenceRegistryEntry,
  ),
);

interface OccurrenceCommon {
  readonly id: StableId;
  readonly idKind: StableIdKind;
  readonly location: string;
}

export type ManagedSiteContractOccurrence = OccurrenceCommon & (
  | { readonly role: "declaration" | "reference"; readonly scope: { readonly collectionId: StableId<"collection"> } | "global" }
  | { readonly role: "deferred" | "tombstone" }
);

interface LocatedValue {
  readonly value: unknown;
  readonly location: string;
  readonly ancestors: readonly unknown[];
}

type PathStep =
  | { readonly kind: "property"; readonly key: string }
  | { readonly kind: "array"; readonly key: string }
  | { readonly kind: "index"; readonly key: string; readonly index: number }
  | { readonly kind: "variant"; readonly key: string; readonly discriminator: "type" | "kind"; readonly variant: string };
type CollectionPathStep = Exclude<PathStep, { readonly kind: "property" | "index" }>;
const OCCURRENCE_PATH_TOKEN_CHARACTERS = new Set<string>([
  ...LOWERCASE_TOKEN_CHARACTERS,
  ...LOWERCASE_TOKEN_CHARACTERS.map((character) => character.toUpperCase()),
  ...DIGIT_TOKEN_CHARACTERS,
  "_",
]);

function fail(code: string, message: string): never {
  throw new ManagedSiteContractError(code, message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function isManagedSiteOccurrencePathToken(value: string): boolean {
  return value.length > 0 && [...value].every((character) =>
    OCCURRENCE_PATH_TOKEN_CHARACTERS.has(character));
}

function assertPathToken(value: string, rawStep: string): void {
  if (!isManagedSiteOccurrencePathToken(value)) {
    fail("CONTRACT_OCCURRENCE_UNCLASSIFIED", `Unsafe occurrence path step: ${rawStep}`);
  }
}

function rulesMatch(left: ManagedSiteContractOccurrenceRegistryEntry, right: ManagedSiteContractOccurrenceRegistryEntry): boolean {
  const leftScope = "scope" in left ? left.scope : undefined;
  const rightScope = "scope" in right ? right.scope : undefined;
  return left.path === right.path && left.idKind === right.idKind && left.role === right.role && leftScope === rightScope;
}

function registryEntryKey(entry: ManagedSiteContractOccurrenceRegistryEntry): string {
  return `${entry.path}#${entry.idKind}`;
}

function assertCompleteRegistry(registry: readonly ManagedSiteContractOccurrenceRegistryEntry[]): void {
  const expected = new Map(MANAGED_SITE_CONTRACT_OCCURRENCE_REGISTRY.map((entry) => [registryEntryKey(entry), entry]));
  const seen = new Set<string>();
  for (const entry of registry) {
    const key = registryEntryKey(entry);
    if (seen.has(key)) fail("CONTRACT_OCCURRENCE_CLASSIFIED_TWICE", `Stable-ID occurrence is classified twice: ${key}`);
    const canonical = expected.get(key);
    if (canonical === undefined || !rulesMatch(entry, canonical)) fail("CONTRACT_OCCURRENCE_UNCLASSIFIED", `Stable-ID occurrence has no canonical classification: ${entry.path}`);
    seen.add(key);
  }
  if (seen.size !== expected.size) fail("CONTRACT_OCCURRENCE_UNCLASSIFIED", "Stable-ID occurrence registry is incomplete");
}

function parsePathStep(rawStep: string): PathStep {
  if (rawStep.endsWith("[]")) {
    const key = rawStep.slice(0, -2);
    assertPathToken(key, rawStep);
    return { kind: "array", key };
  }
  const variantMatch = /^(.+)\[(type|kind)=([^\]]+)\]$/.exec(rawStep);
  if (variantMatch !== null) {
    const [, key, discriminator, variant] = variantMatch;
    if (key === undefined || discriminator === undefined || variant === undefined) return fail("CONTRACT_OCCURRENCE_UNCLASSIFIED", `Invalid occurrence path step: ${rawStep}`);
    assertPathToken(key, rawStep);
    assertPathToken(variant, rawStep);
    return { kind: "variant", key, discriminator: discriminator as "type" | "kind", variant };
  }
  const indexMatch = /^(.+)\[(\d+)\]$/.exec(rawStep);
  if (indexMatch === null) {
    assertPathToken(rawStep, rawStep);
    return { kind: "property", key: rawStep };
  }
  const [, key, index] = indexMatch;
  if (key === undefined || index === undefined) return fail("CONTRACT_OCCURRENCE_UNCLASSIFIED", `Invalid occurrence tuple step: ${rawStep}`);
  assertPathToken(key, rawStep);
  return { kind: "index", key, index: Number(index) };
}

function matchesVariant(value: unknown, discriminator: "type" | "kind", variant: string): boolean {
  return isRecord(value) && value[discriminator] === variant;
}

function addArrayChildren(found: LocatedValue[], child: readonly unknown[], location: string, ancestors: readonly unknown[], step: CollectionPathStep): void {
  for (const [index, value] of child.entries()) {
    if (step.kind === "variant" && !matchesVariant(value, step.discriminator, step.variant)) continue;
    found.push({ value, location: `${location}[${index}]`, ancestors });
  }
}

function addTupleChild(found: LocatedValue[], child: unknown, location: string, ancestors: readonly unknown[], index: number): void {
  if (!Array.isArray(child)) return;
  const value = child[index];
  if (value === null || value === undefined) return;
  found.push({ value, location: `${location}[${index}]`, ancestors });
}

function descend(values: readonly LocatedValue[], rawStep: string): readonly LocatedValue[] {
  const step = parsePathStep(rawStep);
  const found: LocatedValue[] = [];
  for (const current of values) {
    if (!isRecord(current.value)) continue;
    const child = current.value[step.key];
    if (child === null || child === undefined) continue;
    const location = current.location === "" ? step.key : `${current.location}.${step.key}`;
    const ancestors = [...current.ancestors, current.value];
    if (step.kind === "property") found.push({ value: child, location, ancestors });
    else if (step.kind === "index") addTupleChild(found, child, location, ancestors, step.index);
    else if (Array.isArray(child)) addArrayChildren(found, child, location, ancestors, step);
    else if (step.kind === "variant" && matchesVariant(child, step.discriminator, step.variant)) {
      found.push({ value: child, location, ancestors });
    }
  }
  return found;
}

function valuesAtPath(contract: ManagedSiteContractV1, path: string): readonly LocatedValue[] {
  let values: readonly LocatedValue[] = [{ value: contract, location: "", ancestors: [] }];
  for (const step of path.split(".")) values = descend(values, step);
  return values;
}

function collectionIdFrom(occurrence: LocatedValue, scope: OccurrenceScopeRule): StableId<"collection"> | null {
  if (scope === "global") return null;
  for (const value of [...occurrence.ancestors].reverse()) {
    if (!isRecord(value)) continue;
    const candidate = scope === "route_collection" ? value.collectionId : value.id;
    const ownsCollection =
      scope === "route_collection"
        ? typeof value.collectionId === "string"
        : "itemFields" in value;
    if (ownsCollection && typeof candidate === "string") return candidate as StableId<"collection">;
  }
  return fail("CONTRACT_OCCURRENCE_UNCLASSIFIED", `Stable-ID occurrence has no collection scope: ${occurrence.location}`);
}

function classify(entry: ManagedSiteContractOccurrenceRegistryEntry, occurrence: LocatedValue): ManagedSiteContractOccurrence {
  if (typeof occurrence.value !== "string") return fail("CONTRACT_OCCURRENCE_UNCLASSIFIED", `Stable-ID occurrence is not a string: ${occurrence.location}`);
  const idKind = entry.idKind === "actual" ? getStableIdKind(occurrence.value) : entry.idKind;
  const common = {
    id: occurrence.value as StableId,
    idKind,
    location: occurrence.location,
  };
  if (!("scope" in entry)) return Object.freeze({ ...common, role: entry.role });
  const collectionId = collectionIdFrom(occurrence, entry.scope);
  const scope = collectionId === null ? "global" : Object.freeze({ collectionId });
  return Object.freeze({ ...common, role: entry.role, scope });
}

function pathsWithMultipleKinds(registry: readonly ManagedSiteContractOccurrenceRegistryEntry[]): ReadonlySet<string> {
  const kinds = new Map<string, Set<string>>();
  for (const entry of registry) {
    const pathKinds = kinds.get(entry.path) ?? new Set<string>();
    pathKinds.add(entry.idKind);
    kinds.set(entry.path, pathKinds);
  }
  return new Set([...kinds].filter(([, pathKinds]) => pathKinds.size > 1).map(([path]) => path));
}

function matchesEntryKind(entry: ManagedSiteContractOccurrenceRegistryEntry, occurrence: LocatedValue, multiKindPaths: ReadonlySet<string>): boolean {
  if (entry.idKind === "actual" || !multiKindPaths.has(entry.path)) return true;
  return typeof occurrence.value === "string" && getStableIdKind(occurrence.value) === entry.idKind;
}

export function collectManagedSiteContractOccurrences(
  contract: ManagedSiteContractV1,
  registry: readonly ManagedSiteContractOccurrenceRegistryEntry[] = MANAGED_SITE_CONTRACT_OCCURRENCE_REGISTRY,
): readonly ManagedSiteContractOccurrence[] {
  assertCompleteRegistry(registry);
  const multiKindPaths = pathsWithMultipleKinds(registry);
  return Object.freeze(registry.flatMap((entry) =>
    valuesAtPath(contract, entry.path)
      .filter((occurrence) => matchesEntryKind(entry, occurrence, multiKindPaths))
      .map((occurrence) => classify(entry, occurrence)),
  ));
}
