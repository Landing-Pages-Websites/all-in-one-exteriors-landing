# Managed-site contract

Private runtime, schemas, framework adapters, annotations, and conformance CLI
for Gomega-managed websites. This package is the shared executable contract
used by site repositories and Site Guard; it is not the CMS UI and it does not
publish customer changes.

## Distribution

The package is published manually from `main` to GitHub Packages as
`@landing-pages-websites/managed-site-contract`. Releases are immutable: bump
the exact version in the workspace and lockfile in a reviewed PR before running
the `Publish managed-site contract` workflow.

The `managed-site-contract-release` Environment allows deployments from `main`
only. GitHub Team does not offer required Environment reviewers for private
repositories, so release approval comes from the reviewed version-bump PR,
green CI, an immutable version, and a manual workflow with no version override.
Add required Environment reviewers if the organization moves to Enterprise.

Same-organization repository workflows should:

1. receive explicit Actions access to the package in GitHub's package settings;
2. grant `packages: read` and `contents: read` to their workflow token;
3. configure `actions/setup-node` for `https://npm.pkg.github.com` and the
   `@landing-pages-websites` scope; and
4. provide `${{ github.token }}` as `NODE_AUTH_TOKEN` only to `npm ci`.

Cross-organization consumers such as `zleague/megaseo-web` must use a dedicated
read-only package credential with `read:packages`. Never place that credential
in a repository file, build artifact, browser bundle, or customer-site runtime.

## Review bridge versions

A contract names exactly one review-bridge delivery, and each version is
accepted only at its own immutable asset
(`https://app.gomega.ai/review-bridge/<version>/review-bridge.js`) with a
sha384 integrity value. `SUPPORTED_BRIDGE_VERSIONS` lists every version a
contract may name, oldest first; `CURRENT_BRIDGE_VERSION` is the one new sites
and the starter template install. Older versions stay in the list so sites
certified on them keep validating.

Changing a site's bridge descriptor, including moving it from one supported
version to the next, is a runtime identity change: the compatibility policy
refuses it with `COMPATIBILITY_RUNTIME_CHANGED`. A site moves to a newer bridge
by re-enrolling, never through an ordinary content or contract update, or
(since 0.15.0) through a declared field migration whose bridge step is exactly
the next supported version and admitted by the platform (see "Field
migrations" below). Remove a version from the list only after no enrolled site
still names it.

## Compatibility of a code change

`validateManagedSiteContractV1Compatibility(production, productionContent,
candidate, candidateContent)` decides whether a candidate contract may replace
production's through an ordinary code change. Besides keeping every
declaration, value and asset, a code change keeps every production URL and SEO
identity fact:

- every production page keeps its route exactly (`COMPATIBILITY_ROUTE_REMOVED`).
  URL moves are blocked until Site Guard has a combined content-and-code
  path, since a move changes the route and the canonical together;
- every production redirect is kept (`COMPATIBILITY_REDIRECT_REMOVED`) and
  compared whole, except its destination, which may change only to a page
  indexed at its own static path (a page-owned `index: true` value and a
  canonical naming that path on the site's own origin), and its status, which stays
  permanent if it was (`COMPATIBILITY_REDIRECT_CHANGED`). Every kept redirect
  that changed is listed in the result's `changedRedirects`;
- every `internalSeo` section the schema declares, except protected fields
  and redirects, is compared whole, values as well as references, except
  `MANAGED_SEO_FACTS_NOT_COMPARED` (a page's purpose, sitemap entry, minimum
  inbound links and performance budget) (`COMPATIBILITY_SEO_IDENTITY_CHANGED`,
  `COMPATIBILITY_PAGE_SEO_CHANGED`,
  `COMPATIBILITY_GENERATED_PAGE_SEO_CHANGED`). Facts may be added, never
  changed, dropped or filled: a null is a fact (a null share-card title means
  the card keeps its own text) except in business identity. A list the
  occurrence registry finds a reference in is a set, so its items may move
  (two sections swapped), and every move is listed in `reorderedSeo`; an
  outline's H1 is kept exactly, in its place, and none is added to a page
  that has one.

A page, static or generated, keeps the set of fields that render its H1,
read from every field it renders, collection items and site fields included
(`managedRenderedH1Sources`, `managedPageH1Fields`;
`COMPATIBILITY_PAGE_SEO_CHANGED`). A page with none may declare its H1 fields
in one change, which is listed in the result's `adoptedH1`.

Contract semantics also hold a static page's outline to headings: at most one
H1, and every entry a field the page renders that can carry that heading: a
heading field at its own level, or a rich-text field that admits heading
blocks, at a level its grammar has (`CONTRACT_SEO_FIELD_POLICY`). Content semantics
admit a level 1 rich-text heading block only in a field the page's outline
names at level 1 (`CONTENT_RICH_TEXT_H1_UNDECLARED`), and require a rich-text
field the outline names at level 1 to render exactly one
(`CONTENT_RICH_TEXT_H1_MISSING` for none, `CONTENT_RICH_TEXT_H1_REPEATED` for
more, since 0.16.1).

Changing a business identity fact or a page's SEO source is a CMS content
change, not a code change. The one exception: a static page's title or
description may move to a new customer-editable `seo_*` field whose value is
exactly the page-owned text production serves today, while its share-card
echo names a protected field (kept, or set where production had none). See the 0.16.0 changelog entry for the details.

## Rich text rendered in one element

A `rich_text` field whose value renders inside ONE site element (a heading, a
paragraph, a button label) declares `maxBlocks: 1` and names its one block type
in `allowedBlocks`. `maxBlocks` is optional; absent is unbounded, so every
existing contract means what it meant, and the compatibility policy treats
adding or lowering it as narrowing.

Content stays semantic: a value says `italic`, `bold` or `link`, never how the
site styles it. The site renders each mark with its own element and names the
mark on that element with `data-gomega-mark="<type>"`
(`managedRichTextMarkAttributesV1`), and an unmarked run is a bare text node.
The field's root element keeps `data-gomega-field-id` (and
`data-gomega-item-id` for an item) exactly as a text field's does.

The helpers every renderer shares:

- `managedRichTextBlockInlines(document)` returns the one paragraph or heading
  block's text, and refuses (`RICH_TEXT_NOT_ONE_BLOCK`) anything else rather
  than rendering part of it.
- `groupManagedRichTextInlines(inlines)` groups runs that share their outer
  mark into one element; a text node lists its marks outermost first, and a
  hard break becomes a `hard_break` span (see below).
- `managedRichTextLinkAttributesV1(mark)` gives a link mark's `href` and
  `target` for an external, email or phone destination. An internal link names
  a page id, whose path this package is not given, so it is refused
  (`RICH_TEXT_LINK_UNRESOLVED`) for the site to resolve from its contract.

## Hard breaks

Since 0.17.0 a line inside one block is the inline node `{ "type": "hard_break" }`,
never a newline in text. The node has no attrs, no marks and no other key. It
sits in a paragraph's or heading's `content` between two non-empty text nodes:
never first, never last, and never next to another break or to empty text. Text nodes refuse every
control character (`\p{Cc}`, `"\n"` included), as the CMS writer and reader
do, so a value has one spelling for a line break.

A field admits breaks only with `allowHardBreaks: true`; absent (or `false`)
admits none, so a site whose renderer predates breaks is never handed one.
`maxHardBreaks` (a whole number from 1 to 16, `MANAGED_RICH_TEXT_MAX_HARD_BREAKS`)
caps the value's total, and is refused without the opt-in; absent is unbounded,
like `maxBlocks`. A break counts as a node toward `maxNodes` and as no character
toward `maxCharacters`. The compatibility policy treats adding the opt-in or
raising (or removing) the cap as widening, and dropping the opt-in, adding a cap
or lowering one as narrowing.

A break renders as `<br data-gomega-break="">` (`managedRichTextBreakAttributesV1`,
`MANAGED_RICH_TEXT_BREAK_ATTRIBUTE`) unless the site renders its own line
element, which carries the same attribute so an editor can find and clone it.
`groupManagedRichTextInlines` emits it as a `{ kind: "hard_break" }` span, inside
every mark its two neighbours share from the outside in, so
`<strong>Grow<br>more</strong>` round-trips.

A field migration can write a break (since 0.19.0, a part declared
`joinedBy: "hard_break"`, see "Field migrations") but does not move a block
already holding one: such a source is `MIGRATION_TRANSFORM_DEFERRED`.

Any internal destination -- a rich-text link mark's or, since 0.13.0, a link
field's -- must name a page with one path (a static route): a destination names
a page and no item, so a generated page has no URL to render. One predicate
decides both; a prose link is refused with `CONTENT_RICH_TEXT_LINK_PAGE_UNPATHED`
and a link field with `CONTENT_LINK_PAGE_UNPATHED`.

`MANAGED_RICH_TEXT_HEADING_LEVELS` is the set of heading levels a document may
hold (1, 2 and 3), read from the schema.

## Field migrations

The compatibility policy refuses any change to a production value, so a
change that reshapes fields (two plain-text fields becoming one rich-text
heading, say) cannot pass it however faithful the new value is. Since 0.15.0
such a change can be declared and proved instead.

A site commits the declaration beside its contract as
`managed-site.migration.json` (`MANAGED_SITE_FIELD_MIGRATION_FILE`, schema in
`schema/managed-site.migration.v1.schema.json`):

    { "schemaVersion": "1.0",
      "from": { "contractSha256": "...", "contentSha256": "..." },
      "bridge": { "from": "v8", "to": "v9" },
      "steps": [{ "op": "merge", "target": "field_...",
                  "into": { "type": "rich_text", "block": { "type": "heading", "level": 2 } },
                  "parts": [{ "source": "field_..." }, { "literal": " " },
                            { "source": "field_...", "marks": [{ "type": "italic" }] }] }] }

A part is a source or a literal, with optional declared `marks`, and since
0.19.0 an optional `"joinedBy": "hard_break"`: the part meets the one before it
through one `hard_break` node instead of directly. It is declared on the part,
never inferred, because a line of a block may be several parts (`"Activate"`, a
literal `" "`, an italic `"Real-World"`): the first part has none, and only a
paragraph or heading target takes one (not plain text, not list items).

`from` is the sha256 of the canonical production contract and content, as
`normalizeManagedSiteArtifactsV1` digests them (`managedSiteFieldMigrationFromV1`
computes it), so a declaration written against other production artifacts is
refused. `bridge` is present only when the bridge changes. `merge` is the only
op; anything else (split, retire, rename, type widening, collection items,
alias groups) is refused with `MIGRATION_TRANSFORM_DEFERRED`.

`validateManagedSiteContractV1MigrationCompatibility(production contract,
production content, candidate contract, candidate content, declaration,
{ admitBridge })` holds one invariant: every production value is either
unchanged in the candidate or consumed by exactly one step, and each step's
target is exactly `F(sources, parts)` in canonical JSON. `F`
(`applyManagedSiteFieldMigrationStepV1`) is pure: a source's text with its own
marks, a part's declared marks outermost, adjacent runs with identical marks
joined, a bullet list holding one item per part, and one `hard_break` before
each part declared `joinedBy` (runs on either side of a break never join, even
with identical marks). Reading the target back
(`readBackManagedSiteFieldMigrationStepV1`) must give each source's text with
its original marks and the target's breaks exactly where the parts declare
them, none moved, dropped or added. Beyond that:

- a break is only ever the node: a part whose text holds a control character
  (a newline, a tab) is `MIGRATION_TRANSFORM_DEFERRED`, and a source that
  already holds a break stays deferred. A break sits between two lines that
  each hold text (an empty part beside a break is
  `MIGRATION_HARD_BREAK_EMPTY_LINE` too), so a line of only empty or space parts is
  `MIGRATION_HARD_BREAK_EMPTY_LINE`. The target admits breaks only by its own
  constraints: `allowHardBreaks`, and the declared breaks within
  `maxHardBreaks`, else `MIGRATION_TARGET_CONSTRAINTS`; each break is listed in
  the proof as a `hard_break` item;

- the contract id and adapter are unchanged; the bridge is unchanged, or moves
  one supported version forward and `admitBridge(version, integrity)`, which
  the caller supplies and which has no default, says the platform serves it;
- a source is a live production page or site field, claimed once, no longer
  declared, and tombstoned in the candidate;
- a target is new (never declared, never tombstoned), customer-editable, of
  the declared type, shares its sources' scope and owner and is shown on
  exactly the pages each of them was (its `usages`), and its constraints
  admit F's value, so a declared mark, block or link its policy refuses fails
  as `MIGRATION_TARGET_CONSTRAINTS`;
- a source keeps the structure a reader or crawler sees: a `heading_text`
  source goes only into a rich-text heading at exactly its `semanticLevel`,
  and a rich-text source keeps its block type and level, so flattening either
  into plain text, a paragraph, a list item or another level is refused
  (`MIGRATION_SOURCE_STRUCTURE_LOST`); a step joins at most one heading or
  rich-text block, so no block boundary is lost. A `heading_text` that no
  outline names is a line of a heading, not a heading the contract can see
  (the converter declares each line of a split heading, a TextReveal or a
  `<br>`, as its own field), so since 0.19.0 the lines of one heading count as
  one block, provided they share a level and are consecutive fields of one
  section with nothing declared between them, and the declaration separates
  each pair (a break, or a literal part, never nothing)
  (`MIGRATION_SOURCE_STRUCTURE_LOST` otherwise); a heading the outline names,
  and any rich-text source, still counts as its own. Plain text keeps its role:
  only running text (`body`, `label`, `caption`) may merge, and every other
  role in the schema's enum (phone, email, address, legal, search text, and
  any role added later) carries structured meaning and is deferred; only a
  label or caption may become a heading, never body copy
  (`MIGRATION_SEMANTIC_CHANGED`). The block running text lands in comes from
  code, and the proof's block item names it with each source's role
  (`heading:2`, `label`, `body`, `rich_text`) and the target's. A plain-text
  target whose role differs from a source's (`body` made `label`) is named
  in a `role` item; for a rich-text target the block item is the authority;
- references follow the occurrence registry, the authority on where a
  contract names a field. Only a heading-outline entry may name a source: it
  names a heading, and the target renders that heading. Any other reference
  (JSON-LD, intent, business identity, an alias group) reads the field's
  value, and a merged target holds more than one source did, so it is
  deferred (`MIGRATION_TRANSFORM_DEFERRED`). Every outline that named a source
  must name its target instead, at the same level (other entries are the
  ordinary policy's business, so an unrelated heading added to the same
  outline blocks nothing). Since 0.16.0 where every entry sits is the
  ordinary URL and SEO rule's, run with production read through the
  migration (each source renamed to its target, since 0.16.2 only where the
  occurrence registry declares a global field reference; any other string
  equal to a source, such as a JSON-LD `schemaType` or
  `requiredOutputProperties` literal, is compared verbatim): entries may move, as they
  should when a target renders elsewhere, and each move is listed as a
  `seo_reordered` item, exactly as the ordinary result's `reorderedSeo`
  lists it; nothing may be dropped or re-levelled.
  No other reference may name a target
  (`MIGRATION_REFERENCE_CHANGED`); an outline must give a target the level its
  heading renders (`MIGRATION_OUTLINE_LEVEL_MISMATCH`). One exception, since
  0.19.0: a level 1 rich-text target may add the one level 1 outline entry, per
  outline, that no source had, listed as an `outline_entry` item, because content semantics
  require every rich-text H1 to be outlined (`CONTENT_RICH_TEXT_H1_UNDECLARED`)
  and a `heading_text` H1 never was; the page's H1 itself stays the H1 rule's
  (a page keeps the H1 fields production had, read through the migration, or a
  page that had none adopts one, listed as `h1_adopted`). Routes, redirects
  and every other SEO fact are held by the ordinary URL and SEO rule, exactly
  as for any change, except that a migration may not move a production page
  (`COMPATIBILITY_ROUTE_REMOVED`) or add or change a redirect
  (`COMPATIBILITY_REDIRECT_CHANGED`): its proof does not list URLs;
- every other compatibility rule holds for everything the migration does not
  retire, and the candidate content passes content semantics.

It returns a `ManagedSiteFieldMigrationProofV1`: the declaration's sha256,
the bridge step, the accounting (production values, unchanged, consumed), each
step's target, owner, sources and part offsets, `added`, every literal, mark,
link, hard break and block the declaration adds, an `outline_entry` item for each level 1 outline entry a rich-text H1 target adds, plus a `reordered` item for any step
whose sources were not side by side in production: joined in another order,
or with other fields declared between them (`interleaved`). Production's
order is the contract's declaration order, pages then sections then fields,
which the converter writes in rendering order; a hand-written contract is
held to that order, not to `presentation.order`. A `moved` item names text a
reader now sees somewhere else, with from and to: each source that rendered
in another section than its target's (#73 has two), and each target declared
out of production's order within its section, ranked by its source in that
section and judged by the fewest unchanged fields out of order, so a field
added or retired beside a target never makes it look moved, an unchanged
neighbour is never blamed for a target's move, and two targets that swap are
both named. A move is listed, not refused. A field is read on its usage page,
so a site-scoped target, or a page-scoped one declared off its usage page, has
no declaration place a reader sees and reports no move; its usages are bound
exactly instead. Section and page order stay the
ordinary policy's, as for any change, and a section a merge empties stays
declared (#73 keeps two empty), because removing a declaration is refused.
Then `additions`, every declaration, value
and asset entry the candidate adds outside any step, read from the diff rather
than from the declaration. Added material comes from code, not content; it is
allowed, and listed so a reviewer sees each item. The accounting holds both
ways: production values are unchanged or consumed, and candidate values are
unchanged, a target, or a listed addition.

A site's CI can run the same check:

    gomega-managed-site-conformance migrate --production-contract <path> \
      --production-content <path> --contract <path> --content <path> \
      --migration <path> [--admit-bridge <version>=<integrity>]

The CLI cannot see what the platform serves, so a bridge change passes only
when `--admit-bridge` names exactly the candidate's version and integrity.

Site Guard runs this check whenever the candidate carries a
`managed-site.migration.json` that differs from production's, and the merge
advance records the migration in the platform's field-migration ledger. A
copy byte-identical to production's is an applied migration: Site Guard
ignores it and runs the ordinary policy.

## Local workspace

The starter and reference fixtures resolve this package through npm workspaces,
so local development does not require a GitHub Packages credential.
