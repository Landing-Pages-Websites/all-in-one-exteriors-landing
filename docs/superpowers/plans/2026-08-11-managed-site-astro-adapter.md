# Managed-Site Astro Adapter Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a small Astro-specific adapter boundary over the existing managed-site contract, source projection, semantic validation, and normalized artifact chain without changing or weakening the shipped Next.js adapter API.

**Architecture:** Extract only the framework-neutral adapter construction and typed value-reader primitives that the existing Next.js adapter already owns. Keep the public Next.js names as compatibility aliases. Add `createManagedSiteAstroV1`, which accepts the same exact raw contract/source-document envelope, requires `adapter.kind === "astro"` and version `1.0`, and returns the same frozen trusted contract/content/artifact/value-reader shape. Stable page/field render annotations remain shared, credential-free attributes because both JSX and Astro templates spread ordinary HTML attributes.

**Tech stack:** TypeScript 5, Node test runner through `tsx`, existing `@gomega/managed-site-contract` package and GitHub Actions.

## Constraints

- One risk domain: framework adapter construction and public types only.
- No Astro dependency, `.astro` fixture, framework build, starter conversion, filesystem discovery, CLI change, schema change, Site Guard, registry, UI, provider call, or publishing behavior.
- Every create input must cross C1 JSON parsing, exact contract parsing, C3 contract/content semantics, source completeness, and artifact normalization.
- A Next contract is rejected by the Astro entry point and an Astro contract is rejected by the Next entry point.
- Existing Next public functions, selectors, reader types, error codes, output keys, and annotations remain backward compatible.
- Astro exposes framework-neutral selector/reader names; legacy Next-prefixed type aliases remain exported.
- Creation envelopes reject extra keys, accessors, proxies, malformed source documents, and unclassified source values through the existing fail-closed boundaries.
- No credentials, origins, nonces, resolver paths, or content values are added to render annotations.
- Every changed source/test file remains below 500 lines.
- Under the workstation RAM guardrail, do not run local Node, TypeScript, lint, build, browser, subagent, or watcher processes. GitHub Actions is authoritative.

## Task 1: Establish the red Astro contract

**Files:**

- Add `packages/managed-site-contract/test/astro-adapter.test.ts`.
- Update `packages/managed-site-contract/test/public-surface.test.ts`.
- Add this plan.

1. Assert `createManagedSiteAstroV1` produces the independently parsed/projected/normalized oracle from an Astro fixture.
2. Assert exact site/page/collection-item reads are frozen and type-narrowed.
3. Table-test missing value, wrong owner, wrong type, expanded selector, expanded create envelope, accessor input, source conformance failure, and Next-contract rejection.
4. Assert the shared page/field annotations are exact, frozen, credential-free, and reject cross-kind IDs.
5. Assert the new Astro and framework-neutral value types are available from the curated root export while the legacy Next types remain usable.
6. Commit and push plan/tests only. Cloud CI must fail only because the Astro API and framework-neutral aliases are absent.

## Task 2: Extract the shared adapter core without API drift

**Files:**

- Add `packages/managed-site-contract/src/adapter.ts`.
- Add `packages/managed-site-contract/src/adapter-values.ts`.
- Update `packages/managed-site-contract/src/next-adapter.ts`.
- Update `packages/managed-site-contract/src/next-adapter-values.ts`.

1. Move exact creation-envelope parsing and trusted output construction into one internal framework-neutral function parameterized by expected adapter kind and stable adapter-specific error codes.
2. Move selector parsing, owner keys, content indexing, and value lookup into framework-neutral primitives.
3. Preserve `CreateManagedSiteNextV1Input`, `ManagedSiteNextV1`, `ManagedSiteNextValueReader`, and `ManagedSiteNextValueSelector` as exact type aliases, not divergent duplicate interfaces.
4. Keep `createManagedSiteNextV1` a small wrapper that emits the existing `NEXT_ADAPTER_INPUT_INVALID`, `NEXT_ADAPTER_KIND`, `NEXT_ADAPTER_SELECTOR_INVALID`, `NEXT_ADAPTER_VALUE_MISSING`, and `NEXT_ADAPTER_VALUE_TYPE` codes.
5. Do not export the internal generic constructor; only curated framework entry points are public authority boundaries.

## Task 3: Add the Astro entry point and public surface

**Files:**

- Add `packages/managed-site-contract/src/astro-adapter.ts`.
- Update `packages/managed-site-contract/src/index.ts`.

1. Export `createManagedSiteAstroV1`, `CreateManagedSiteAstroV1Input`, and `ManagedSiteAstroV1`.
2. Export framework-neutral `ManagedSiteValueReader` and `ManagedSiteValueSelector` types; retain the Next-prefixed aliases.
3. Require exact Astro adapter identity and emit stable `ASTRO_ADAPTER_INPUT_INVALID`, `ASTRO_ADAPTER_KIND`, `ASTRO_ADAPTER_SELECTOR_INVALID`, `ASTRO_ADAPTER_VALUE_MISSING`, and `ASTRO_ADAPTER_VALUE_TYPE` errors.
4. Keep the returned root keys exactly `artifacts`, `content`, `contract`, and `readValue`, with recursive parsed values and the root object frozen.

## Task 4: Simplify, review, and merge

1. Self-attack adapter-kind/version permutations, same-suffix wrong stable-ID kinds, all owner kinds, duplicate value keys, accessor/proxy/expanded inputs, and source projection failures.
2. Confirm no duplicate parsing/indexing logic remains, exported functions have return types, and all files stay under 500 lines.
3. Push implementation and require cloud package type-check, unit/runtime tests, schema fixed point, root behavior, lint, and production Next build. The Next build is the compatibility proof for the refactor.
4. Perform a fresh static local deep review instead of Tommy and record exact red/green run IDs and head SHA.
5. Squash-merge only after exact-head CI is green, then clean only this verified worktree and branch.

## Follow-up seam

The next PR adds a real Astro reference fixture with its own framework dependency/build, deterministic contract/content artifacts, shared collection and dynamic-route coverage, bridge annotations, and central conformance command. Keeping it separate makes dependency/lockfile/runtime review independent of this adapter trust-boundary refactor.
