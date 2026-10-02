# Managed-Site Starter Default Conversion Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Convert the starter home page into the first production-shaped managed site: structured customer content, protected SEO content, exact stable annotations, an editable image slot, and an editable FAQ collection, without weakening the current lead, analytics, consent, or SEO plumbing.

**Architecture:** Checked-in JSON is the only authored content source. A strict managed-site contract classifies every value, resolver, page, collection, asset slot, and protected SEO field. A server-only-style module imports the exact documents, builds the existing Next adapter, and exposes narrowly typed home selectors. The App Router page remains a synchronous Server Component, reads only validated values, and emits only stable page/field annotations. Existing helpers receive explicit structured SEO overrides while operational deployment configuration remains in `site.config.ts`.

**Tech Stack:** Next.js 16 App Router, React 19 Server Components, TypeScript 5, JSON imports, `@gomega/managed-site-contract`, existing schema/metadata helpers, GitHub Actions.

## Constraints

- One risk domain: convert the starter reference home page to the managed-site contract.
- No customer CMS UI, persistence, mutations, publishing, provider calls, Guard, registry, Astro, or existing customer-site conversion.
- Preserve the current lead form, consent, analytics, route, legal-page, sitemap, and robots behavior.
- All customer-editable home copy comes from `src/content/pages/home.json`.
- Internal SEO/business identity comes from structured JSON and is never given a customer-editable capability or DOM annotation.
- FAQ items use a real collection with server-minted stable item IDs and exact item ownership.
- The hero image uses a real asset slot and immutable manifest facts. Its rendered Next Image is unoptimized so edit protocol 2 owns one direct `src` without a conflicting `srcset`.
- Collection item values are not annotated in DOM annotation v1 because field IDs alone cannot distinguish item owners; they remain editable through the schema-driven collection surface.
- The page wrapper exposes one page ID. Each non-item customer-editable value exposes its exact field ID. No source path, content value, SEO field, credential, nonce, origin, or authority is placed in attributes.
- The checked contract and installed bridge must declare the exact promoted v4 delivery URL and SRI.
- Production builds fail on unresolved `TODO_` sentinels in legacy operational configuration and every structured JSON document under `src/content`; template CI may continue with `ALLOW_TODO=1`.
- Every changed source/test file remains below 500 lines.
- Under the workstation RAM guardrail, do not run local Node, Jest, TypeScript, Prisma, lint, build, browser, subagent, or watcher processes. GitHub Actions is authoritative.

## Content model

### Customer editable

- Hero eyebrow: plain text.
- Hero heading: H1 heading text.
- Hero description: plain text.
- Hero image: PNG upload, crop, focal point, and alt text.
- FAQ heading: H2 heading text.
- FAQ collection: reorder, add, and remove.
- FAQ item question and answer: plain text.
- Contact heading: H2 heading text.

### Internal protected

- Legal and display names, telephone, postal address, email, and social profiles.
- Home metadata title, description, canonical URL, and indexing directives.
- These values feed `buildMetadata` and `buildBusinessSchema`; customer annotations never expose them.

## Task 1: Establish the red reference-site contract

**Files:**

- Add `scripts/managed-site-starter.test.mjs`.
- Update `scripts/gomega-review-bridge.test.mjs`.
- Add this plan.

1. Assert the contract, site content, and home content files exist as JSON and declare the exact expected resolver documents.
2. Assert the home page imports the managed home module, renders stable page/field helpers, renders an editable unoptimized Next Image, and no longer owns visible placeholder copy or a code-owned FAQ array.
3. Assert the managed module uses `createManagedSiteNextV1` and imports both exact source documents.
4. Assert the contract and installed bridge agree on promoted v4 URL, SRI, protocol 1 review, protocol 2 edit, and annotation version 1.
5. Assert the config sentinel scanner includes both structured content documents.
6. Commit and push plan/tests only. Cloud CI must fail only because the planned structured files/integration are absent and bridge v3 is still installed.

## Task 2: Add the exact managed contract and source documents

**Files:**

- Add `src/content/managed-site.contract.json`.
- Add `src/content/site.json`.
- Add `src/content/pages/home.json`.
- Add `src/content/managed-site.ts`.

1. Define globally unique, correct-kind stable IDs for the contract, home page, sections, rendered fields, FAQ collection/items, asset slot, and protected fields.
2. Declare exact page, field, collection, item, image, SEO, route, sitemap, performance, and bridge facts. Do not add aliases or tombstones without a real use.
3. Store all authored values once at their resolver locations. Include exact `public/logo.png` SHA-256, MIME, dimensions, and byte count in the image value.
4. Instantiate the Next adapter from the imported contract and two source documents.
5. Resolve the home page, fields, collection, and item fields from their canonical resolver addresses. Fail closed on missing, duplicate, wrong-type, wrong-route, or wrong-owner facts; do not select by presentation labels.
6. Expose a frozen home model with the page ID, stable field IDs, typed values, ordered FAQ values, public image URL, and protected SEO facts. Keep the raw resolver index internal.

## Task 3: Render the structured reference home page

**Files:**

- Update `src/app/page.tsx`.
- Update `src/lib/seo.ts`.
- Update `src/components/schema/builders.ts`.

1. Replace hard-coded home copy and `demoFaqs` with the frozen managed home model.
2. Annotate the page boundary and each non-item customer-editable element. Keep collection item DOM unannotated until annotation protocol supports owner/item identity.
3. Render the hero image with the verified installed `next/image` default export, `unoptimized`, exact width/height/alt, and its field annotation.
4. Build FAQ JSON-LD from the same resolved FAQ values rendered on page.
5. Extend metadata overrides with the exact Next.js robots shape and map protected indexing directives without weakening existing callers.
6. Extend the business schema builder with an optional exact structured identity input; the managed home page supplies it while other existing callers retain current defaults.

## Task 4: Promote bridge v4 and protect configuration completeness

**Files:**

- Update `src/components/analytics/GomegaReviewBridge.tsx`.
- Update `scripts/check-config.mjs`.

1. Replace the immutable v3 delivery literal with the promoted v4 URL and exact SRI from the deployed bridge source. Preserve literal lowercase `<script>`, anonymous CORS, and `defer` in root `<head>`.
2. Scan `src/site.config.ts` and derive every JSON document under `src/content` so future pages cannot bypass sentinel checks.
3. Report file-relative diagnostics. Preserve `ALLOW_TODO=1` warning behavior for the template CI build.

## Task 5: Simplify, review, and merge

1. Statically audit exact contract/source pointer agreement, stable-ID uniqueness/kinds, asset digest/size, page/field annotation ownership, all visible copy, SEO output use, bridge agreement, forbidden browser attributes, and collection-item non-annotation.
2. Simplify functions over 30 lines, duplicated selectors, casts, mutable exports, debug output, and files at or above 500 lines. Keep component props grouped and use existing helpers.
3. Push the implementation and require cloud starter behavior, managed-site type-check/tests/runtime/schema fixed point, ESLint, and production Next build.
4. Perform a fresh local static deep review instead of Tommy. Publish exact red/green run IDs, head SHA, scope, diff, and RAM evidence.
5. Mark ready only when exact-head CI is green, squash-merge, record the merge SHA, and clean only this verified worktree/local branch.
