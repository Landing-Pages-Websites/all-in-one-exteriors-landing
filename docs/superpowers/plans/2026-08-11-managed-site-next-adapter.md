# Managed-Site Next.js Adapter Foundation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add the small Next.js-specific adapter boundary that converts a typed contract plus exact structured source documents into trusted artifacts, provides deterministic typed value lookup for server rendering, and emits only the stable DOM annotations required by edit protocol 2.

**Architecture:** The adapter stays inside the existing managed-site package so it reuses the exact contract/source projection/normalization trust chain without another workspace or dependency surface. One creation function validates the raw contract, requires adapter kind `nextjs` version `1.0`, projects/normalizes content, and returns a frozen server-side record with a closure-backed value reader. Separate pure annotation helpers validate ID kinds and return frozen credential-free page/field attribute records. The next PR will migrate the starter content and page to this adapter.

**Tech Stack:** TypeScript 5, existing managed-site C1-C3C/source-projection APIs, Node test runner, GitHub Actions.

## Constraints

- One risk domain: Next.js adapter foundation only.
- No filesystem access, JSON imports, page migration, React components, Astro, Site Guard, registry, UI, provider calls, or publishing.
- The adapter accepts raw contract input but exact source-document values; every input crosses the existing C1-C3C chain.
- Only contract adapter kind `nextjs` and version `1.0` is accepted.
- Value lookup keys use stable field IDs plus exact site/page/collection-item ownership and an expected field type. Missing or type-conflicting reads fail closed.
- The internal value map is closure-owned and never returned.
- Page annotations expose only `data-gomega-page-id`; field annotations expose only `data-gomega-field-id`.
- Annotation helpers runtime-validate the required ID kind and return frozen exact-key records.
- Contract/artifact records remain server-side facts; the annotation API never exposes source paths, SEO policy, content values, credentials, or authority.
- Every changed source/test file remains below 500 lines.
- No local Node/test/type-check/lint/build process; cloud CI is authoritative under the workstation RAM guardrail.

## Public interfaces

```ts
createManagedSiteNextV1({ contract, sourceDocuments }): ManagedSiteNextV1;

site.readValue({ fieldId, owner, type });

managedSitePageAttributesV1(pageId);
managedSiteFieldAttributesV1(fieldId);
```

`ManagedSiteNextV1` exposes deeply readonly `contract`, `content`, and normalized `artifacts`, plus the typed reader. It exposes no index, resolver, mutable source graph, or browser authority.

## Task 1: Define the red adapter contract

**Files:**

- Create `packages/managed-site-contract/test/next-adapter.test.ts`
- Modify `packages/managed-site-contract/test/public-surface.test.ts`

1. Use the complete source-projection fixture and assert the adapter output matches the independently parsed/projected/normalized oracle.
2. Assert the root and all data graphs are frozen; the reader returns the exact existing frozen value for site, page, and collection-item owners.
3. Table-test missing field, wrong owner, wrong expected type, malformed ID, Astro contract, and source projection failures.
4. Assert exact/frozen page and field attribute objects and cross-kind ID rejection. Assert serialized annotations contain no source path, content, SEO, bridge nonce, origin, or credential field.
5. Add compile-only readonly/generic return checks and the exact public function/type inventory.
6. Push the tests/plan only. Cloud CI must fail only because the adapter API is absent.

## Task 2: Implement the Next.js adapter boundary

**Files:**

- Create `packages/managed-site-contract/src/next-adapter-values.ts`
- Create `packages/managed-site-contract/src/next-adapter-annotations.ts`
- Create `packages/managed-site-contract/src/next-adapter.ts`
- Modify `packages/managed-site-contract/src/index.ts`

1. Build an exact owner key from validated stable IDs, index the already validated content once, and retain that map only inside a reader closure.
2. Require field ID, exact owner, and expected value type on every read. Return the original frozen parsed value; fail with stable adapter-specific errors for missing/type conflicts.
3. Parse the raw contract, require Next.js adapter identity, project exact source documents, normalize artifacts, and freeze the returned root record.
4. Validate page/field ID kinds and return frozen one-key annotation records.
5. Export only the creation/annotation functions and their readonly types from the package root.

## Task 3: Simplify, review, and merge

1. Statically simplify functions over 30 lines, duplicated owner logic, casts, `any`, mutable maps/results, debug output, and files over 500 lines.
2. Self-attack owner-kind permutations, same suffix/wrong ID kind, selector object extras at runtime, internal-protected variants, duplicate map keys, wrong adapter version/kind, and annotation key expansion.
3. Use only Git/diff/rg/wc locally. Require cloud package type-check/tests, fixed-point schema build, lint, starter behavior, and production Next build.
4. Perform fresh local static deep review instead of Tommy, publish exact red/green evidence, squash-merge, record the merge SHA, and clean only this worktree/local branch.
