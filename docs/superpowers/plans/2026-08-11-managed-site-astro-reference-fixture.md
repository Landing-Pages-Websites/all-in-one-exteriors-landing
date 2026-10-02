# Managed-Site Astro Reference Fixture Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Ship a real Astro 7.2 static-site workspace that proves the managed-site contract can drive a production-shaped home page and generated service pages through the same validated content, SEO, annotation, and conformance chain used by Site Guard.

**Architecture:** Add one private npm workspace under `fixtures/astro-reference`. Checked JSON source documents remain the only authored content. `createManagedSiteAstroV1` parses the exact Astro contract, projects the source graph, validates contract/content semantics, and exposes frozen page models. Astro prerenders `/` and one `/services/[slug]` route per active service item. A checked projected content artifact is compared byte-for-byte with adapter output before the existing conformance CLI validates and emits normalized digests. The fixture uses the root `public/logo.png` through an explicit `publicDir`; it adds no remote asset or font dependency.

**Aesthetic direction:** A warm editorial field guide for a fictional local home-services company: ink, limestone, cedar, and safety orange; asymmetric service cards; high-contrast serif display type with restrained sans-serif utility copy. CSS-only motion respects reduced-motion preferences.

**Pinned framework:** `astro@7.2.0`, which requires Node `>=22.12.0`; `@astrojs/check@0.9.10` supplies the framework-aware type/template gate. CI remains on Node 22.

## Constraints

- One risk domain: a reference Astro consumer of the already-shipped contract/adapter APIs.
- No managed-site schema expansion, Guard policy, CMS UI, customer write authority, provider integration, registry write, preview gateway, or production publishing behavior.
- Authored values exist once in `site.json`, `pages/home.json`, or `collections/services.json`; pages and components contain interface copy only.
- The contract declares exact static/generated route coverage, protected route/SEO fields, shared collection order, source pointers, bridge v4, and credential-free annotation v1.
- Generated slugs come only from protected `route.slug` item fields. `getStaticPaths()` receives exact string params and frozen props derived from validated content.
- Static metadata and generated metadata, canonical URLs, robots directives, headings, sitemap intent, and required JSON-LD values come from internal protected fields.
- Home-page item cards are not field-annotated because several owners render together. Generated detail pages may annotate the current item fields because the exact route selects one owner.
- The external v4 bridge is a literal inline Astro script with exact `src`, SRI, anonymous CORS, and `defer`; no nonce, credential, source address, or content value is written to DOM attributes.
- The reference build has no remote fetch, runtime database, browser JavaScript, image optimizer, or framework server adapter.
- Every handwritten source/test file stays below 500 lines. Generated/checkpoint JSON may be larger only when it is an exact machine artifact.
- Under the workstation RAM guardrail, do not run local root/package tests, TypeScript, Astro check/build, browser, watcher, or broad install. GitHub Actions is authoritative. A lockfile-only install and deterministic fixture generator may run under explicit 256/384 MB heap caps.

## Task 1: Establish the cloud-red fixture contract

**Files:**

- Add `scripts/managed-site-astro-reference.test.mjs`.
- Add this plan.

1. Assert the Astro workspace, pinned package metadata, configuration, exact source documents, checked projected content, managed model, layout, static page, generated route, styles, and conformance checker exist.
2. Assert the contract declares Astro adapter v1, bridge v4, `/`, `/services/[slug]`, one services collection, protected route/SEO item fields, and exact resolver document paths.
3. Assert the generated route exports typed `getStaticPaths`, consumes frozen managed props, and owns no raw content document or arbitrary URL input.
4. Assert pages consume the managed model, emit page/field annotation helpers, install the literal credential-free bridge, and derive metadata/JSON-LD rather than hard-code authored values.
5. Assert the root package and CI expose Astro conformance, check, and build gates.
6. Push the plan/test-only commit and open a draft PR. Cloud CI must fail only because the planned fixture files/scripts do not yet exist.

## Task 2: Add the exact Astro workspace and content graph

**Files:**

- Add `fixtures/astro-reference/package.json`.
- Add `fixtures/astro-reference/astro.config.mjs`.
- Add `fixtures/astro-reference/tsconfig.json`.
- Add `fixtures/astro-reference/src/content/managed-site.contract.json`.
- Add `fixtures/astro-reference/src/content/site.json`.
- Add `fixtures/astro-reference/src/content/pages/home.json`.
- Add `fixtures/astro-reference/src/content/collections/services.json`.
- Add `fixtures/astro-reference/src/content/managed-site.content.json` as a generated checkpoint.
- Add `fixtures/astro-reference/src/lib/managed-site.ts`.
- Update root `package.json` and `package-lock.json`.

1. Register `fixtures/*` as npm workspaces and pin Astro/check dependencies exactly.
2. Define globally distinct stable IDs for the contract, two pages, sections, fields, collection/items, and one image asset slot.
3. Model home hero/service-order content; site identity; and two service items with protected slug/title/description/canonical/indexing fields plus editable H1, summary, rich body, and image.
4. Declare one exact static descriptor and one exact generated descriptor. Generated metadata and JSON-LD item/global sources must use the new separated source identities.
5. Instantiate `createManagedSiteAstroV1` from the three exact source documents. Resolve descriptors by canonical route/source identity, fail on missing/duplicate/type/owner conflicts, and export only frozen home/service route models.
6. Generate and check in the exact projected content document. Do not hand-maintain its order or digest.

## Task 3: Render the production-shaped static and generated pages

**Files:**

- Add `fixtures/astro-reference/src/layouts/ManagedLayout.astro`.
- Add `fixtures/astro-reference/src/components/ManagedRichText.astro`.
- Add `fixtures/astro-reference/src/pages/index.astro`.
- Add `fixtures/astro-reference/src/pages/services/[slug].astro`.
- Add `fixtures/astro-reference/src/styles/global.css`.

1. Build one shared layout that renders title, description, canonical, exact robots directives, JSON-LD, page annotation, and the immutable bridge delivery in `<head>`.
2. Render the home page from `managedAstroHome`: annotated hero fields, responsive local image, ordered service cards, and interface-only navigation/footer copy.
3. Export typed `getStaticPaths` from the generated route and create one page per active service. Reject a prop/slug mismatch before rendering.
4. Render the current item heading, summary, rich body, and image with exact field annotations. Render no raw HTML and allow only the managed rich-text node/mark/link vocabulary.
5. Use semantic HTML, one H1 per route, visible focus states, responsive layouts, reduced-motion fallback, and no client-side hydration.

## Task 4: Make conformance and framework build central CI gates

**Files:**

- Add `fixtures/astro-reference/scripts/check-managed-site.mjs`.
- Update `.github/workflows/ci.yml`.
- Update root `package.json` scripts.

1. Read the exact contract/source/checkpoint files as bounded UTF-8 inputs and instantiate the Astro adapter from those sources.
2. Compare canonical projected content with `managed-site.content.json`; fail on stale/missing/extra values or order drift.
3. Invoke the existing installed `gomega-managed-site-conformance` binary against the exact contract/content checkpoint and require one successful canonical artifact line.
4. Add root commands for `conformance:astro-reference`, `check:astro-reference`, and `build:astro-reference`.
5. Extend CI after the managed-site package build: conformance checkpoint, `astro check`, then `astro build`. Preserve the existing Next starter gate as backward-compatibility proof.

## Task 5: Simplify, deep-review, and merge

1. Self-attack route/descriptor mismatch, duplicate slug, bad canonical/robots types, stale projected content, missing source, bridge drift, annotation leakage, hard-coded authored copy, unsafe rich text, invalid local asset facts, and generated output route completeness.
2. Review every changed file for functions over 30 lines, duplicate selectors, `any`, unsafe casts, debug artifacts, mutable exports, files at/over 500 lines, and framework-import assumptions.
3. Keep all heavy verification in GitHub. Locally run only Git/status/diff/`rg`/`wc`, a capped lockfile operation, and the deterministic capped checkpoint generator.
4. Perform a fresh local static deep review instead of Tommy. Record exact red/green run IDs, exact head, Astro/package versions, generated artifact hash, diff size, and skipped local browser reason.
5. Mark ready only when exact-head CI is green. Squash-merge and clean only this verified worktree/local branch and its temporary dependencies.

## PR strategy

One PR is appropriate because the fixture is inert unless its content graph, render pages, and CI conformance gate land together. It remains independently deployable, changes no production application, and targets roughly 1,500-2,200 handwritten lines plus lockfile/generated JSON. If handwritten scope approaches 2,500 lines or any single file reaches 500 lines, stop and split rendering/styles into a follow-up PR before adding scope.
