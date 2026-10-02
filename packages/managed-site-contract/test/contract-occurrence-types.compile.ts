import type { ManagedSiteStableOccurrenceCoverage } from "../src/contract-occurrence-registry.js";
import type { StableId } from "../src/ids.js";
import type { JsonValue } from "../src/json.js";

type PageId = StableId<"page">;
type FieldId = StableId<"field">;

const tuple = {
  "value[0]#page": "page",
  "value[1]#field": "field",
} as const satisfies ManagedSiteStableOccurrenceCoverage<{
  readonly value: readonly [PageId, FieldId];
}>;

const heterogeneousArray = {
  "value[]#page": "page",
  "value[]#field": "field",
} as const satisfies ManagedSiteStableOccurrenceCoverage<{
  readonly value: readonly (PageId | FieldId)[];
}>;

const samePathKinds = {
  "value#page": "page",
  "value#field": "field",
} as const satisfies ManagedSiteStableOccurrenceCoverage<{
  readonly value: PageId | FieldId;
}>;

const discriminatedArray = {
  "values[type=page].id#page": "page",
  "values[type=field].id#field": "field",
} as const satisfies ManagedSiteStableOccurrenceCoverage<{
  readonly values: readonly (
    | { readonly type: "page"; readonly id: PageId }
    | { readonly type: "field"; readonly id: FieldId }
  )[];
}>;

interface OptionalAncestor {
  readonly id: PageId;
  readonly child?: OptionalNarrowChild | null;
}

interface OptionalNarrowChild {
  readonly id: PageId;
  readonly child?: null;
  readonly fieldId: FieldId;
}

const optionalNarrowerChild = {
  "value.id#page": "page",
  "value.child.id#page": "page",
  "value.child.fieldId#field": "field",
} as const satisfies ManagedSiteStableOccurrenceCoverage<{
  readonly value: OptionalAncestor;
}>;

const finiteNestingAndOpaqueJson = {
  "value.nested.id#field": "field",
} as const satisfies ManagedSiteStableOccurrenceCoverage<{
  readonly value: {
    readonly nested: { readonly id: FieldId };
    readonly copy?: JsonValue;
  };
}>;

const tombstoneException = {
  "value[]#actual": "actual",
} as const satisfies ManagedSiteStableOccurrenceCoverage<{
  readonly value: readonly StableId[];
}, "value[]">;

const finiteRecord = {
  "value.left#field": "field",
  "value.right#field": "field",
} as const satisfies ManagedSiteStableOccurrenceCoverage<{
  readonly value: Record<"left" | "right", FieldId>;
}>;

// @ts-expect-error Open stable-ID records cannot be exhaustively classified.
const unsupportedOpenRecord = {} satisfies ManagedSiteStableOccurrenceCoverage<{ readonly value: Record<string, FieldId> }>;

// @ts-expect-error Symbol index signatures cannot be represented by canonical paths.
const unsupportedSymbolIndex = {} satisfies ManagedSiteStableOccurrenceCoverage<{ readonly value: { readonly [key: symbol]: FieldId } }>;

// @ts-expect-error Finite numeric keys cannot be represented by canonical paths.
const unsupportedNumericKey = {} satisfies ManagedSiteStableOccurrenceCoverage<{ readonly value: Record<1, FieldId> }>;

declare const symbolKey: unique symbol;
// @ts-expect-error Supported string keys cannot hide adjacent numeric or symbol occurrences.
const unsupportedMixedKeys = { "value.safe#field": "field" } satisfies ManagedSiteStableOccurrenceCoverage<{ readonly value: Record<"safe" | 2, FieldId> & { readonly [symbolKey]: FieldId } }>;

// @ts-expect-error Optional named and symbol keys still form tuple occurrence space.
const unsupportedTupleExtras = { "value[0]#page": "page" } satisfies ManagedSiteStableOccurrenceCoverage<{ readonly value: readonly [PageId] & { readonly side?: FieldId; readonly [symbolKey]?: FieldId } }>;
// @ts-expect-error An optional finite numeric key still forms tuple occurrence space.
const unsupportedTupleNumber = { "value[0]#page": "page" } satisfies ManagedSiteStableOccurrenceCoverage<{ readonly value: readonly [PageId] & { readonly 2?: FieldId } }>;
// @ts-expect-error Readonly arrays cannot hide optional named occurrences.
const unsupportedReadonlyArray = { "value[]#page": "page" } satisfies ManagedSiteStableOccurrenceCoverage<{ readonly value: readonly PageId[] & { readonly side?: FieldId } }>;
// @ts-expect-error Homogeneous arrays cannot hide an optional finite numeric occurrence.
const unsupportedArrayNumber = { "value[]#page": "page" } satisfies ManagedSiteStableOccurrenceCoverage<{ readonly value: readonly PageId[] & { readonly 2?: FieldId } }>;
// @ts-expect-error Homogeneous arrays cannot hide an optional unique-symbol occurrence.
const unsupportedArraySymbol = { "value[]#page": "page" } satisfies ManagedSiteStableOccurrenceCoverage<{ readonly value: PageId[] & { [symbolKey]?: FieldId } }>;
// @ts-expect-error Mutable arrays cannot hide combined optional key spaces or ID-kind unions.
const unsupportedMutableArray = { "value[]#page": "page" } satisfies ManagedSiteStableOccurrenceCoverage<{ readonly value: PageId[] & { side?: PageId | FieldId; 2?: FieldId; [symbolKey]?: FieldId } }>;
// @ts-expect-error Open array intersections must fail closed.
const unsupportedOpenArray = {} satisfies ManagedSiteStableOccurrenceCoverage<{ readonly value: PageId[] & Record<string, FieldId> }>;
interface AccessorArray extends ReadonlyArray<PageId> { get side(): FieldId; }
type ArrayUnionMatrix = {
  optionalNamed: PageId[] | (PageId[] & { side?: PageId | FieldId });
  optionalNumeric: readonly PageId[] | (readonly PageId[] & { readonly 2?: FieldId });
  optionalSymbol: PageId[] | (PageId[] & { [symbolKey]?: FieldId });
  requiredNamed: readonly PageId[] | (readonly PageId[] & { readonly side: FieldId });
  accessor: readonly PageId[] | AccessorArray;
  open: PageId[] | (PageId[] & Record<string, FieldId>);
  rest: PageId[] | [PageId, ...FieldId[]];
  tuple: readonly [PageId] | (readonly [PageId] & { readonly side?: FieldId });
};
type IsUnsupportedArrayUnion<T extends readonly unknown[]> = "__unsupported_union:value" extends keyof ManagedSiteStableOccurrenceCoverage<{ readonly value: T }> ? true : false;
type AssertAllUnsupported<T extends Record<keyof ArrayUnionMatrix, true>> = T;
const arrayUnionMatrixIsUnsupported: AssertAllUnsupported<{ [Case in keyof ArrayUnionMatrix]: IsUnsupportedArrayUnion<ArrayUnionMatrix[Case]> }> | null = null;
// @ts-expect-error Unknown schema roles must fail closed.
const unsupportedUnknown = {} satisfies ManagedSiteStableOccurrenceCoverage<{ readonly value: unknown }>;

type AnyValue = ReturnType<JSON["parse"]>;
// @ts-expect-error Any schema roles must fail closed.
const unsupportedAny = {} satisfies ManagedSiteStableOccurrenceCoverage<{ readonly value: AnyValue }>;

// @ts-expect-error Bare object roles must fail closed.
const unsupportedObject = {} satisfies ManagedSiteStableOccurrenceCoverage<{ readonly value: object }>;

type UnsafeProperty<Key extends string> = { readonly [Property in Key]: FieldId };
// @ts-expect-error Dot is reserved by the occurrence path grammar.
const unsupportedDot = { "value..#field": "field" } satisfies ManagedSiteStableOccurrenceCoverage<{ readonly value: UnsafeProperty<"."> }>;
// @ts-expect-error Closing bracket is reserved by the occurrence path grammar.
const unsupportedBracket = { "value.]#field": "field" } satisfies ManagedSiteStableOccurrenceCoverage<{ readonly value: UnsafeProperty<"]"> }>;
// @ts-expect-error Hash is reserved by the occurrence identity grammar.
const unsupportedHash = { "value.##field": "field" } satisfies ManagedSiteStableOccurrenceCoverage<{ readonly value: UnsafeProperty<"#"> }>;
// @ts-expect-error Discriminator values use the same safe token grammar.
const unsupportedDiscriminator = { "value[type=bad.value].id#field": "field" } satisfies ManagedSiteStableOccurrenceCoverage<{ readonly value: { readonly type: "bad.value"; readonly id: FieldId } }>;

type NondiscriminatedUnion =
  | { readonly id: PageId }
  | { readonly id: FieldId };

// @ts-expect-error Nondiscriminated stable-ID unions require explicit schema discrimination.
const unsupportedUnion = { "value.id#page": "page", "value.id#field": "field" } satisfies ManagedSiteStableOccurrenceCoverage<{ readonly value: NondiscriminatedUnion }>;

type SameKindDifferentRole =
  | { readonly mode: "declaration"; readonly id: FieldId }
  | { readonly mode: "reference"; readonly id: FieldId };

// @ts-expect-error Same-kind roles still require a recognized schema discriminator.
const unsupportedRoles = { "value.id#field": "field" } satisfies ManagedSiteStableOccurrenceCoverage<{ readonly value: SameKindDifferentRole }>;

interface RecursiveNode {
  readonly id: PageId;
  readonly child?: RecursiveNode | null;
}

// @ts-expect-error Recursive stable-ID schema coverage must fail closed.
const unsupportedRecursion = { "value.id#page": "page" } satisfies ManagedSiteStableOccurrenceCoverage<{ readonly value: RecursiveNode }>;

void [tuple, heterogeneousArray, samePathKinds, discriminatedArray, optionalNarrowerChild,
  finiteNestingAndOpaqueJson, tombstoneException, finiteRecord, unsupportedOpenRecord,
  unsupportedSymbolIndex, unsupportedNumericKey, unsupportedMixedKeys, unsupportedUnknown,
  unsupportedTupleExtras, unsupportedTupleNumber, unsupportedReadonlyArray, unsupportedArrayNumber, unsupportedArraySymbol, unsupportedMutableArray, arrayUnionMatrixIsUnsupported,
  unsupportedOpenArray, unsupportedAny, unsupportedObject, unsupportedDot, unsupportedBracket,
  unsupportedHash, unsupportedDiscriminator, unsupportedUnion, unsupportedRoles, unsupportedRecursion];
