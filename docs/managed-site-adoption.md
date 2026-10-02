# Managed-site adoption

This runbook explains how Gomega adopts the Managed Site Standard for a new
website or a website that is still being built. It does not authorize a fleet
migration, customer editing, or changes to former-customer repositories.

## Choose the correct path

### New website

Create the repository from the current `site-starter` template. Keep the
managed-site contract workspace, structured content, adapters, bridge,
annotations, tests, and repository CI intact. Build new pages by extending
those primitives rather than creating a parallel content system.

### Active build that is not live

Adopt the standard before the next customer review or go-live. Preserve the
current rendered copy, routes, SEO output, forms, analytics, and asset behavior
while changing how those values are classified and loaded. Initial adoption is
a structural migration, not a redesign.

### Live website

Do not convert it through this runbook. Live-site conversion belongs to the
Phase 3 eligibility register and rollout, with an exact inventory, preview,
production verification, and rollback plan for each active customer.

### Landing page, former customer, or uncertain repository

Do not infer eligibility from the repository name or recent Git activity. An
operator must first prove the active customer entitlement and canonical
managed-site identity. Landing pages are enrolled only when explicitly chosen;
churned and former-customer repositories are excluded.

## Adoption sequence for an active build

Keep each pull request in one risk domain and preserve a working preview after
every merge.

1. **Inventory and freeze the baseline.** Record the current default-branch
   commit, Vercel project, preview URL, routes, redirects, content sources,
   managed assets, forms, analytics, metadata, schema, sitemap, and bridge.
   Capture desktop and mobile reference output before moving values.
2. **Introduce the contract and structured sources.** Add
   `managed-site.contract.json` and structured JSON for page, site, collection,
   image, and internal SEO values. Give every declared page, section, field,
   collection, item, asset slot, and alias a stable ID. Classify all visible
   customer content; keep SEO fields internal-protected.
3. **Route rendering through the framework adapter.** Use the Next.js or Astro
   adapter to read declared values. Add stable page and field annotations while
   preserving markup, layout, styling, routes, and behavior. Never select a
   source by label, file name guess, DOM text, or visual coordinates. For a
   Next.js repository this is mechanical: `managed-site-conversion --rewire`
   makes the edits, writes the contract, the content documents and the runtime
   into the repository, and reports every value it would not place rather than
   guessing. Steps 2 and 3 are then one command, and must be — the ledger that
   mints the IDs lives in that run, so a contract and a rewrite from two runs
   describe different IDs.
4. **Prove conformance and parity.** Run the repository checks, conform every
   declared route, and compare the candidate preview with the frozen baseline.
   The comparison that catches a silent change is the **prerendered HTML**,
   before and after, normalized only for what a reader cannot see: the build
   id, hashed and numbered chunk filenames, React's empty-text separators, the
   annotation attributes, and the page-root and value wrappers the rewrite
   adds. Screenshots and a click-through do not substitute; every defect this
   has caught was invisible on the page and exact in the markup. A route the
   framework renders on demand writes no file to compare, so check the declared
   routes against the output and fetch the remainder from a running build: a
   page the comparison cannot see is not a page it has cleared. The conversion
   tool ships that comparison as `run parity`, which fails on a declared route
   it could not compare rather than reporting the ones it could, and
   site-starter CI runs the whole build-convert-build-compare loop against a
   reference site on every push, so a regression in the tool is caught before
   it reaches a customer's repository. Confirm too
   that every declared page carries exactly one page annotation, which is what
   field discovery scopes to — without it a page has no editable fields
   however many of its values were converted. Fix unclassified values, broken
   references, metadata differences, layout drift, missing assets, or bridge
   failures before continuing.
5. **Enroll the exact repository and site.** Operations links the immutable
   repository, provider project, production origin, contract revision, and
   content revision to the canonical managed-site registry. Repository names,
   slugs, and URLs are display facts, not authority.
6. **Enable organization governance.** Operations assigns the managed-site
   repository property and reconciles the dedicated Site Guard App and
   organization ruleset. Do not substitute a repository-owned workflow, a PAT,
   or a human bypass for the central required check.
7. **Certify only after exact evidence is green.** `CMS_READY` requires the
   immutable contract/content revision, production commit and deployment,
   bridge, routes, provider identity, and Site Guard policy to agree. Adoption
   alone does not expose a customer editor or publishing authority.

## Pull request boundaries

A normal active-build adoption should use concise, reviewable pull requests:

1. structured content and contract classification;
2. adapter, rendering, and annotation migration;
3. repository verification and operational enrollment.

Split further by page family when a repository is large. Do not combine the
structural migration with a redesign, copy refresh, SEO strategy change,
framework upgrade, analytics rewrite, or production cutover.

## Two independent protection layers

Repository CI and Site Guard solve different problems.

- **Repository CI is per repository.** The template's
  `.github/workflows/site-starter-ci.yml` runs on that repository's pull
  requests and `main`. It gives developers fast feedback for tests, contract
  conformance, lint, and builds. Repositories created from a template do not
  receive later template changes automatically.
- **Site Guard is organization-governed.** Once a repository is enrolled, the
  organization ruleset requires the check produced by the dedicated Site Guard
  App. The central service resolves the certified production baseline and
  evaluates the exact candidate commit. Editing or deleting repository-local
  scripts cannot make that central check pass.

The managed-site npm package contains the executable schema, validators,
normalizers, adapters, and policy facts shared by the starter and central
control plane. It is not the website structure by itself and it is not the CMS.
Do not fork or hand-edit that library inside a customer repository to weaken a
rule; update it centrally through its reviewed release process.

## Required verification

Before operational enrollment, the active-build pull request must prove:

- the conversion's two durable inputs are committed in the site's own
  repository: its config, and `<contentRoot>/managed-site.idmap.json`, the
  ledger that keeps a field's ID stable across conversions;
- every route the scan finds is declared, whether public or internal; a public
  one renders from classified sources, and an internal screen is declared
  `"managedContent": false`, which keeps its SEO facts and offers the customer
  none of the words that route alone renders;
- no customer-facing copy or image is silently hard-coded;
- internal SEO fields remain protected from customer authority;
- content, collections, links, and assets pass contract semantics;
- the review/edit bridge version, integrity, framing, and annotations match;
- metadata, canonical URLs, robots, sitemap, redirects, JSON-LD, internal
  links, lead forms, analytics, and responsive output remain correct;
- an allowed content change passes the policy;
- a compatible code change passes: code may be added, modified, renamed or
  deleted as long as every production declaration, content value, asset and
  source binding (path and pointer) is kept, and the contract, sources and
  assets stay regular files. The contract package's compatibility policy does
  not compare source bindings, so a moved resolver pointer passes
  `validateManagedSiteContractV1Compatibility`. Site Guard runs that policy
  and then compares production and candidate bindings itself, refusing a
  moved binding as `SOURCE_BINDING_CHANGED`. Verify an adoption against Site
  Guard, not against the package policy alone;
- a code change keeps every production URL and SEO identity fact: each
  production page stays at its route exactly (URL moves are blocked), each
  production redirect stays at its path, permanent, and otherwise
  unchanged, and every production business-identity and page SEO fact is kept,
  facts only added (a page's purpose, sitemap entry, minimum inbound links and
  performance budget excepted). These
  fail as `COMPATIBILITY_ROUTE_REMOVED`, `COMPATIBILITY_REDIRECT_REMOVED`,
  `COMPATIBILITY_REDIRECT_CHANGED`, `COMPATIBILITY_SEO_IDENTITY_CHANGED`,
  `COMPATIBILITY_PAGE_SEO_CHANGED` and
  `COMPATIBILITY_GENERATED_PAGE_SEO_CHANGED` (contract 0.16.0); changing one
  of those facts is CMS content, not code. A URL move needs its canonical
  changed with it, so it waits for a combined content-and-code path. A page
  keeps the fields that render its H1, outlined or not, read from every field
  it renders (collection items and site fields included, static and generated
  pages alike); a page with none may declare them once, listed in the
  result's `adoptedH1`. A changed
  redirect target (a page indexed at its own static path) or status is admitted and listed
  in the result's `changedRedirects`, and sections moved within a page's
  outline (never its H1, which keeps its place) are admitted and listed in
  `reorderedSeo`. A static page's outline names only fields that page renders
  and that can carry that heading (a heading field at its level, or a rich-text
  field admitting headings), with at most one H1. A static page's
  title or description may move to a new
  editable `seo_*` field holding exactly the page-owned text production serves,
  with its share-card echo naming a protected field;
- a change that removes, narrows or moves a production field, or changes a
  production value, fails under the ordinary policy; a tombstoned production
  field counts as removed. To reshape fields, either add the new field beside
  the old one and keep the old one declared, or declare a field migration:
  commit `managed-site.migration.json` beside the contract, naming each merge
  step, its source fields and the target that consumes them. Site Guard then
  judges the change with `validateManagedSiteContractV1MigrationCompatibility`
  instead of the ordinary policy, lists every item the proof adds (separators,
  marks, links, blocks, reorders, moves) in the check output, and the merge
  advance records the migration, so the CMS follows it with no retire. A
  customer draft that edited a consumed field is refused `FIELD_MIGRATED`,
  naming the target. After the migration is in production, an unchanged copy
  of the file is ignored and later code changes take the ordinary policy; an
  edited copy refuses as `MIGRATION_FROM_STALE` until it is restored to
  production's bytes or deleted; and
- a code change that adds, edits, deletes or retypes checkout configuration
  (`.gitattributes` at any depth, `.gitmodules`, `.lfsconfig`) fails as
  `CHECKOUT_BEHAVIOR_CHANGED`, because those files change the bytes a
  checkout produces without changing the blobs Site Guard compares.

## Stop conditions

Stop and create an internal task instead of widening the contract when:

- source ownership is ambiguous;
- a value is computed from multiple uncontrolled sources;
- adopting the adapter changes layout or runtime behavior;
- the repository or provider identity cannot be proven by immutable IDs;
- the site is live, former, churned, or lacks confirmed entitlement;
- required checks, bridge validation, or exact preview delivery are unavailable;
  or
- the migration would require direct production edits.

Phase 1 establishes this structure and its guardrails. Customer editing and
self-publishing remain disabled until the governed Phase 2 workflow is ready.
