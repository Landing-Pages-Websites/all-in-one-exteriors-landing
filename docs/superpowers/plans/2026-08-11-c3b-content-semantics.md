# C3B Managed-Site Content Semantics — Implementation Plan

> **Goal:** Fail closed unless a parsed logical content document is a complete, policy-valid realization of the same parsed managed-site contract.

## Table of Contents

- [WI-1: Content facts and identity](#wi-1-content-facts-and-identity)
- [WI-2: Collection and item graph](#wi-2-collection-and-item-graph)
- [WI-3: Value, link, and asset policy](#wi-3-value-link-and-asset-policy)
- [WI-4: Public orchestration and verification](#wi-4-public-orchestration-and-verification)
- [Migration Strategy](#migration-strategy)
- [PR Strategy](#pr-strategy)
- [Implementation Order](#implementation-order)

## Invariants

1. Contract C3A semantics succeed before C3B reads content.
2. Every logical value resolves to one live exact-kind descriptor and one allowed owner.
3. Site-scoped descriptors have exactly one site-owned value; page-scoped descriptors have exactly one value owned by their declared page.
4. Collection-item descriptors have exactly one value for every active item in their collection and no value outside that collection.
5. Active item IDs are globally unique, never tombstoned, never reuse another stable-ID kind's entropy, and appear in one collection's canonical ordered list.
6. Every collection value obeys its descriptor bounds, all values for the same collection agree on order, and declared uniqueness rules hold over resolved item values.
7. Every managed-page link resolves to a live page.
8. Every image value resolves through its declared asset slot, passes slot policy, and matches one exact manifest material identity.
9. Every manifest entry resolves to a live contract-referenced slot, is unique, passes material policy, and is used; there are no arbitrary values, items, or assets.
10. Validation order and `CONTENT_*` errors are deterministic. No source paths, private indexes, or canonical content model are exported.

## WI-1: Content Facts and Identity

### Rationale

C2 validates local shapes and C3A validates the contract graph, but neither proves that a complete content document belongs to that contract. C3B needs typed indexes derived only from the parsed inputs.

### New Interface

```ts
export function validateManagedSiteContractV1ContentSemantics(
  contract: ManagedSiteContractV1,
  content: ManagedSiteContentDocument,
): void;
```

The function is a validation boundary only. It does not parse raw input, return mutable facts, or create a competing normalized model.

### Files to Change

| File | Change |
| --- | --- |
| `packages/managed-site-contract/src/content-semantics-facts.ts` | Derive typed contract/content indexes, resolve every value, enforce exact owner scope, reject duplicates/extras, and prove required non-item values. |

### Tests

- Unknown, tombstoned, and cross-kind-colliding field IDs.
- Duplicate `(fieldId, owner)` and forbidden alternate owners.
- Missing site/page/protected values.
- Foreign page owners and collection-item fields under the wrong collection.
- Contract-semantic failure before any content read.

## WI-2: Collection and Item Graph

### Rationale

Collection values declare active ordered items while item-owned values materialize their fields. Both views must converge before edits or publishing can be safe.

### Files to Change

| File | Change |
| --- | --- |
| `packages/managed-site-contract/src/content-semantics-collections.ts` | Materialize canonical per-collection item order, enforce bounds/global identity, validate completeness, deferred usages, and uniqueness rules. |

### Rules

- Multiple collection fields referencing one descriptor may exist only when their ordered item IDs are identical.
- A generated-page usage with an item ID must resolve to an active item in that route's collection; static-page item usages fail closed.
- `exact` uniqueness compares canonical JSON values.
- `case_folded` uniqueness accepts only plain/heading text and compares normalized lowercase strings.

### Tests

- Duplicate/missing/orphan/cross-collection items.
- Same item reused across collections and content-only item entropy collision.
- Partial, duplicate, and wrong-type item fields.
- Missing deferred usage item, static-page item usage, and wrong generated-route collection.
- Collection bound/order conflicts and exact/case-folded uniqueness collisions.

## WI-3: Value, Link, and Asset Policy

### Rationale

Local C2 helpers validate individual field and image policies. C3B must reuse those rules while adding contract-wide page resolution and manifest agreement.

### Files to Change

| File | Change |
| --- | --- |
| `packages/managed-site-contract/src/content.ts` | Extract a narrow internal parsed-field value validator reusable for collection item fields without changing public behavior. |
| `packages/managed-site-contract/src/content-semantics-values.ts` | Apply descriptor/value compatibility, internal protected value types, managed-page link resolution, asset material policy, and exact image-to-manifest agreement. |

### Asset Rules

- A manifest row is allowed only for a slot referenced by a contract field, collection item field, or internal SEO declaration.
- Every image value requires one manifest row with the same path, SHA-256, MIME, width, height, and byte count.
- Manifest material must obey slot output MIME, dimensions, aspect ratio, and byte limits.
- Crop, focal-point, and alt rules are validated from the full image value.
- Referenced but currently unmaterialized collection-image slots do not require placeholder manifest rows.

### Tests

- Rendered and internal value-type/policy mismatch across every field variant.
- Internal links and rich-text links to missing/tombstoned pages.
- Unknown, duplicate, unreferenced, and missing manifest slots.
- Manifest/image immutable-material mismatch across every identity field.
- Slot MIME/dimension/aspect/byte, crop/focal, and alt-policy failures.

## WI-4: Public Orchestration and Verification

### Rationale

One fixed-order entry point prevents callers from skipping a semantic layer and provides the only new public capability.

### Files to Change

| File | Change |
| --- | --- |
| `packages/managed-site-contract/src/content-semantics.ts` | Run C3A, identity, local values/links, collections/items, and assets in a fixed order. |
| `packages/managed-site-contract/src/index.ts` | Export only the validation function. |
| `packages/managed-site-contract/test/content-semantics-fixture.ts` | Build one all-variant conforming contract/content pair with deterministic stable IDs. |
| `packages/managed-site-contract/test/content-semantics.test.ts` | Table-driven positive and adversarial semantic coverage. |
| `packages/managed-site-contract/test/public-surface.test.ts` | Pin the new validation-only root export. |

### Verification

- TDD red commit pushed first so GitHub Actions records the missing API.
- Cloud CI is authoritative: starter tests, contract type-check/tests/build/schema fixed point, lint, and Next build.
- Local work is restricted to short Git/static review commands; no local Node test, build, lint, type-check, or browser process.
- Fresh local deep review replaces Tommy for this repository.

## Migration Strategy

This is an additive package API and semantic gate. It changes no persisted schema and has no data migration. Existing C2 parsers and C3A validation remain intact. Rollback is a package/application rollback; no content is rewritten.

## PR Strategy

One concise PR owns one risk domain: parsed contract-to-content semantic conformance. It excludes JSON Schema changes, source-document addressing, canonical serialization/digests, framework adapters, Site Guard integration, UI, storage, and publishing.

Target: at most 10 files, roughly 2,000 handwritten lines, and fewer than 500 lines per file. The all-variant fixture and adversarial matrix intentionally account for about half the footprint; splitting the production layers would expose an incomplete public semantic validator, so they remain one risk domain.

## Implementation Order

1. Commit this plan and the failing public/all-variant semantic tests.
2. Add private contract/content facts and identity/owner validation.
3. Extract the narrow parsed-value helper and add value/link validation.
4. Add collection/item materialization and uniqueness.
5. Add manifest/image validation.
6. Wire the fixed-order public orchestrator.
7. Run simplify and static deep review locally; use full GitHub Actions for execution evidence.
8. Mark the plan complete with the PR number after merge.
