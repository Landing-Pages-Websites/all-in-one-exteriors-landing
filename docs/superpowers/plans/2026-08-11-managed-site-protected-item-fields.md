# Managed-Site Protected Collection-Item Fields Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Let repeatable collection items carry internal-protected values such as per-service metadata, canonicals, indexing directives, and structured-data inputs without exposing those fields to customer editing.

**Architecture:** Move the internal value-type enum into a dependency-neutral module, then add one strict `internal_protected` collection-item descriptor variant. Source projection emits the existing protected content-value shape with exact collection/item ownership, while the existing content graph continues to enforce completeness, uniqueness, immutable item identity, and value-type agreement. The schema remains version `1.0` because this is an additive variant that old inputs do not need to adopt.

## Constraints

- One risk domain: protected collection-item declaration, projection, and semantic validation only.
- No generated-page SEO descriptor, Astro fixture, UI, customer capability, Site Guard, provider, registry, or publishing change.
- Protected item descriptors always use classification `internal_protected`, zero customer capabilities, a typed `valueType`, a stable semantic key, and an item-relative JSON Pointer.
- Protected item values use the existing `internal_protected` content union and exact `collection_item` owner.
- Every active item must supply every declared protected value; orphan, cross-collection, wrong-type, and missing values fail closed.
- Case-folded collection uniqueness remains limited to rendered text fields; protected values may participate only in exact uniqueness.
- Existing rendered item fields and non-item protected fields remain byte-for-byte/API compatible.
- Every source and test file stays below 500 lines.
- Under the workstation RAM guardrail, local work is limited to Git, static inspection, exact-file formatting, and bounded schema generation only if necessary. Cloud CI is authoritative for tests, type-check, lint, and builds.

## Task 1: Establish the red contract

1. Add a dedicated protected-item fixture over the existing complete content/source fixture.
2. Assert strict descriptor parsing, frozen output, exact protected projection, semantic acceptance, and public type availability.
3. Table-test wrong value type, missing value, customer capability/classification escalation, cross-collection owner, and case-folded uniqueness misuse.
4. Push the tests and plan first; cloud CI must fail only because the new descriptor variant is absent.

## Task 2: Add the protected item variant

1. Extract `managedInternalValueTypeSchema` and its type into a dependency-neutral internal-value module.
2. Add the strict protected item descriptor to the collection-item discriminated union and export its readonly type.
3. Classify the new stable field declaration as collection-scoped in the derived occurrence registry.
4. Project protected item values with `valueType` and exact item ownership.
5. Validate type/value agreement through the existing content semantic path without widening customer capabilities.

## Task 3: Regenerate and verify the contract

1. Regenerate the checked Draft 2020-12 schema artifact and require the fixed-point guard.
2. Self-attack adjacent internal value types, malformed item pointers, wrong owner/collection/item, duplicate/missing values, and uniqueness-policy misuse.
3. Run simplify and a fresh static deep review; require exact-head cloud type-check, unit/runtime tests, schema fixed point, root behavior, lint, and production Next build.
4. Squash-merge only after the exact head is green and independently reviewed, then clean only this worktree and branch.

## Follow-up seams

1. Add an explicit generated-page SEO descriptor that binds protected item fields to the route's declared collection and requires complete SEO coverage for every route.
2. Build the production-style Astro fixture on that complete model.
