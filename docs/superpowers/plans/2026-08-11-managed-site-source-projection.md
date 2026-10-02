# Managed-Site Source Projection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Deterministically project exact JSON-compatible repository source documents through contract paths and JSON Pointers into a fully validated `ManagedSiteContentDocument` shared by the Next.js and Astro adapters.

**Architecture:** A public validation boundary accepts an already parsed `ManagedSiteContractV1` plus an array of path/value source documents. It validates contract semantics first, canonicalizes and indexes source paths, resolves every declared field and collection pointer, derives owners and asset-manifest entries from immutable contract facts, rejects unused source documents, then parses and validates the complete projected content graph. Framework adapters will own filesystem discovery; this package owns the shared source semantics.

**Tech Stack:** TypeScript 5, existing managed-site contract C1-C3C APIs, RFC 6901 pointer parsing, Node test runner, GitHub Actions.

## Global constraints

- One risk domain: JSON-compatible source-document projection only.
- No filesystem access, framework imports, React/Astro rendering, annotations, CLI changes, Site Guard, registry, UI, provider calls, or publishing.
- Source input is an ordered array of `{path, value}` records, never an object map whose prototype/key behavior could be ambiguous.
- Every source value crosses `parseJsonValue` before traversal.
- Repository paths use the existing portable path parser and case-insensitive alias rules.
- JSON Pointer traversal uses own data properties only and canonical array indexes; missing, scalar, accessor, or ambiguous traversal fails closed.
- Collection item identity and item-field pointers cannot overlap. V1 atomic alias groups resolve global fields only, so exact and ancestor/descendant item-pointer overlap always fails closed.
- Contract semantics run before source traversal; complete content semantics run before return.
- Every supplied source document must be referenced by the contract, and every primitive or empty content subtree inside it must be consumed by a field, item-field, or item-ID resolver. Extra documents and extra values fail instead of becoming unclassified content escape hatches.
- Projection order derives only from contract declaration order and collection item order.
- Asset-manifest records are derived from image values and emitted in contract asset-slot order.
- Every changed source/test file remains below 500 lines.
- No local Node, test, type-check, lint, or build process; cloud CI is authoritative under the workstation RAM guardrail.

## Public interface

```ts
export interface ManagedSiteSourceDocumentV1 {
  readonly path: string;
  readonly value: unknown;
}

export function projectManagedSiteContentDocumentV1(
  contract: ManagedSiteContractV1,
  sourceDocuments: readonly ManagedSiteSourceDocumentV1[],
): ManagedSiteContentDocument;
```

The function returns the same deeply readonly parsed content type already consumed by C3B/C3C. It does not return indexes, resolver facts, source documents, or mutable adapter state.

## Task 1: Define the failing projection contract

**Files:**

- Create `packages/managed-site-contract/test/source-projection-fixture.ts`
- Create `packages/managed-site-contract/test/source-projection.test.ts`
- Modify `packages/managed-site-contract/test/public-surface.test.ts`

1. Build one complete source bundle from the existing all-variant C3B fixture. Assert projection deep-equals its expected `ManagedSiteContentDocument`, passes C3B, derives the exact manifest, and is recursively frozen.
2. Pin deterministic declaration/item order, site/page/collection-item ownership, shared atomic-alias pointers, escaped pointer tokens, canonical array indexes, and collection-relative item-pointer ownership.
3. Add table-driven source-document attacks: missing, duplicate, case-alias, unused, extra unclassified property/array element/empty subtree, invalid JSON value, root type mismatch, missing pointer, scalar intermediate, noncanonical/out-of-range array index, collection non-array, item non-object, and missing/invalid item identity.
4. Add image attacks covering invalid material, same-slot material disagreement, and deterministic contract-slot manifest ordering.
5. Prove a C2-valid but C3A-invalid contract fails before a hostile/unreadable source value is traversed.
6. Commit and push only the plan/tests/public-surface expectation. Cloud CI must fail only because the projection API is absent.

## Task 2: Implement exact document and pointer resolution

**Files:**

- Create `packages/managed-site-contract/src/source-documents.ts`
- Create `packages/managed-site-contract/src/source-projection-values.ts`
- Create `packages/managed-site-contract/src/source-projection-collections.ts`
- Create `packages/managed-site-contract/src/source-projection.ts`
- Modify `packages/managed-site-contract/src/index.ts`

1. Parse each input path/value, reject aliases/duplicates, index exact paths, and track every used path. Use an own-data-property JSON Pointer walker with canonical array-index validation. Record whether each resolved address consumes its whole subtree or only a collection container.
2. Traverse page/section fields and protected SEO fields in declaration order. Resolve their source values and derive the only valid site/page owner from the descriptor scope.
3. Traverse each collection source array in declaration/item order. Resolve the server-minted item ID and every item-field pointer relative to that item, deriving the exact collection-item owner.
4. Collect image material while projecting image descriptors; emit one record per used slot in contract asset order. Let the existing content semantic validator reject missing or conflicting material.
5. Audit every source graph after projection. A field/item resolver consumes its exact subtree; collection array/item containers are structural only; every remaining primitive, extra array element/property, and empty object/array fails `SOURCE_VALUE_UNCLASSIFIED`.
6. Parse the constructed document through `parseManagedSiteContentDocument`, run `validateManagedSiteContractV1ContentSemantics`, freeze the source-document API result through the existing parser, and reject every unused source document.
7. Export only the public function and source-document input type from the package root.

## Task 3: Simplify, self-attack, and merge

1. Run static simplify over the complete diff: functions over 30 lines, repeated descriptor branching, casts, `any`, getters/proxies, deep nesting, mutable returns, debug output, and files over 500 lines.
2. Self-attack adjacent classes: optional/missing array elements, prototype-shaped object keys, multiple resolvers in one document, one resolver across atomic aliases, empty root pointers, image slots shared across ordinary/item fields, and unused sources whose paths differ only by case.
3. Use only short Git/static checks locally. Send the exact head through cloud type-check, unit/runtime tests, fixed-point schema build, lint, starter behavior, and production Next build.
4. Perform a fresh local static deep review instead of Tommy. Publish red/green run IDs and exact-head evidence, squash-merge, record the merge SHA, and clean only this worktree/local branch.
