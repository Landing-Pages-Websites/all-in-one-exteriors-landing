# C3A Contract Self-Conformance Design

## Goal

Validate the parsed `ManagedSiteContractV1` graph without reading content documents, files, adapters, encoders, or generated schema artifacts.

## Boundary

`validateManagedSiteContractV1Semantics(contract)` is the sole new package entry point. The C2 package convention exports safe parse/validate operations from its root, and C3B/C3C need this cross-phase seam without importing internals. It accepts a C2-parsed contract, returns only a deeply frozen, narrowly typed `deferred.itemIds` carrier for C3B, and throws `ManagedSiteContractError` for all C3A violations. It does not expose collector facts or indexes, parse JSON, normalize data, hash data, invoke adapters, or inspect content values.

## Architecture

The collector walks every C1 stable-ID-bearing location in the parsed contract using an exhaustive discriminated-union switch. It records immutable declaration, reference, source, and route facts. The switch is intentionally typed to fail compilation when C1 adds a kind or C2 adds a union member.

Validation then runs in fixed order:

1. Live/tombstone identity graph and cross-kind ID entropy uniqueness.
2. Exact kind and lexical scope of every contract-local reference.
3. Alias-group membership and field distinctness.
4. Portable source-path aliases and non-overlapping JSON Pointer regions.
5. Static/generated/redirect route identity and collision rules.

The collector records `item` references and content-owned items/assets as deferred C3B facts. C3A never fabricates a declaration for them and never treats their absence from the contract as an unresolved reference.

## Invariants

- Every stable-ID occurrence belongs to exactly one classified fact category; unknown future occurrences fail closed.
- Live declarations are globally unique, kind-correct, and disjoint from unique tombstones.
- References resolve only to a live declaration of their exact expected kind and allowed scope, except explicitly deferred C3B facts.
- Alias groups identify a unique live alias and distinct, globally non-overlapping live fields.
- Resolver paths are portable and case-alias-free; pointer regions on the same path are pairwise distinct and non-ancestor/non-descendant, including the root pointer.
- Routes are unique across page static routes, page generated patterns, and redirects; a generated route binds a declared collection and a route-key field declared by that collection.

## Error and Test Strategy

Each violation throws `ManagedSiteContractError` with a stable `CONTRACT_*` code. Tests use one complete every-variant conforming fixture plus literal table-driven adversarial matrices. Tests call the C3A validator directly, proving semantic failure occurs before any later encoder seam.

## Non-goals

No contract/content cross-validation, content item/value/asset resolution, canonical serialization/digests, JSON Schema work, filesystem access, adapter work, UI, dependency changes, or publishing.
