# managed-site conversion

Reads a Next.js repository and **proposes** a managed-site contract, the content
that fills it, and a report of everything it refused to decide — then, with
`--rewire`, **converts the repository to read it**.

It automates steps 2 to 4 of `docs/managed-site-adoption.md` — declare the
contract, mint stable IDs, classify every customer-facing value, and route the
rendering through them — for the parts of a repository that are already named
well enough to be automated, and names the rest as work for a person.

```bash
npm --workspace @landing-pages-websites/managed-site-conversion run propose -- \
  --repo ../some-customer-site \
  --config ./example.conversion.json \
  --out /tmp/proposal \
  --write-sources
```

Output:

| file | what it is |
| --- | --- |
| `managed-site.contract.json` | the proposed contract, in the canonical v1 shape |
| `managed-site.sources.json` | the proposed sources as the platform reads them, one `{ path, value }` each |
| `managed-site.content.json` | the content the platform projects from that contract and those sources |
| `managed-site.content.rejected.json` | written **instead** of the content whenever the contract was refused, holding the values the walker read |
| `sources/src/content/**.json` | the same sources, laid out to be copied into the repository (`--write-sources`) |
| `needs-human.txt` / `.json` | every decision the tool refused to make, with the evidence |
| `managed-site.idmap.json` | the anchor-to-ID ledger (commit this) |

The process exits non-zero while anything is unresolved, so it can gate a
conversion pull request.

An output directory is reused across runs, so a conditional artifact could
otherwise stand beside a later run that did not produce it. The content pair
and the anchor-naming pair are both kept honest: a run writes each or removes
it. That removal is bounded to names this tool already overwrites without
asking, so it reaches nothing a normal run does not claim anyway.

`sources/` is the exception, and deliberately. A rerun without
`--write-sources` leaves the previous run's subtree in place, and a rerun whose
route set shrank leaves the pages it no longer proposes. Sweeping it means
removing a tree at a caller-supplied path, which is a much sharper capability
than dropping a fixed file name — so it is left, and named here instead.
**Treat `sources/` as belonging to the run that last passed `--write-sources`,
and delete the output directory rather than reusing it if that matters.**

`managed-site.content.json` is not a second statement of the values: it is
`projectManagedSiteContentDocumentV1(contract, sources)`, the same derivation
the platform runs when it records a site's first revision and on every later
Site Guard check. So an output directory can be checked on its own — project
its contract over its sources and the result must digest identically to the
content beside it — and a content document nothing can project is never
written as content at all.

## Writing the names it is missing

`AMBIGUOUS_ANCHOR` is the largest refusal on a real site, and the advice in
every one of those findings is the same sentence: give this element a durable
name. That is a mechanical edit, so the tool can make it:

```bash
npm --workspace @landing-pages-websites/managed-site-conversion run propose -- \
  --repo ../some-customer-site --out /tmp/proposal --apply-anchors
```

`--name-anchors` writes `anchor-names.json` and `anchor-names.txt` and changes
nothing. `--apply-anchors` also writes the ids into the repository, so the next
run reads a site whose elements have names. On All Points Media that is 64 ids
across 8 files, and it moves the proposal from 254 fields with 291 refusals to
324 fields with 225.

Every name it writes is prefixed `ms-`. The prefix is not decoration: an id is
spoken for by anything that can NAME one — a `#fragment` link, a stylesheet
rule, a `getElementById` — and a namespace removes that collision class by
construction rather than by enumeration. It also reserves every `#name` written
anywhere in the repository, stylesheets included.

It refuses to name a component (which need not pass an id anywhere), an element
carrying a spread or a non-literal `id`, and an element rendered once per item.
A group of rivals is named as a whole or not at all, and the edited file is
parsed before it is written: a file whose new text would not parse is left
exactly as it was.

## Rewiring the site to read the contract

A proposal on its own changes nothing: the site still renders its hardcoded
literals, and the contract describes values nothing reads. `--rewire` closes
that, and takes the runtime specifier the rewritten code should import from:

```bash
npm --workspace @landing-pages-websites/managed-site-conversion run propose -- \
  --repo ../some-customer-site --out /tmp/proposal --config ./site.conversion.json \
  --write-sources --rewire "@/src/content/managed-site"
```

It edits the repository in place and writes everything the edited code reads —
the contract, the content documents, and a generated runtime module beside them.
Converting a site is that one command; nothing is copied across by hand.

The rewrite runs in the **same process as the proposal that produced the
contract**, and must. A ledger mints the ids, so a second `propose` run mints
different ones: doing this as a separate pass emitted a read for an id the
shipped contract never declared, and the site threw at build time.

### Where an annotation goes

The editor applies an edit with `element.textContent = text`, so **an annotated
element's only content may be the field's value**. Every shape below is a
different answer to which element that is:

| the value is | the annotation goes |
| --- | --- |
| the only child of a host element | on that element |
| sharing its element with other children | on a span of its own, around the value |
| passed to a component as a prop | on the element the RECEIVER renders it in, reached by a prop the receiver takes |
| written between a component's tags | the same, with `children` as the name |
| handed on again by that receiver | forwarded under the name the next component knows it by |
| read inside a prop that takes a node | around the read, because the wrapper IS the node that prop renders |
| rendered by a client component | threaded in from the server component that renders it, through every client component on the way |
| an item of a collection | on the item's element, by the index the template maps at |
| a formatted block (one rich-text field) | on the block's element, with the children replaced by one read of the value and each mark rendered through the element the source used for it, carrying `data-gomega-mark` |

Every prop it adds is optional, and every wrapper it adds is conditional on the
prop arriving. A call site this pass does not rewrite therefore renders exactly
what it did before — which is what keeps a site's dynamic routes, excluded from
the contract and passed nothing, byte-identical.

A **client** component cannot read the contract at all: the package reaches for
`node:crypto`, which is unbundleable for the browser. Its values are resolved by
the nearest server component that renders it and passed as a record keyed by
field id, forwarded verbatim through any client components in between.

### Reading values that are not text

The rewrite emits only text reads (`managedText`, `managedFieldsFor`,
`managedItemsFor`, `managedItem`). The generated runtime also carries readers
for everything else a contract can hold, appended after those exports and
written in `src/runtime-readers.ts`. **Nothing calls them yet**: a person adopts
each one by editing the component that renders the value, which is also how a
site that hand-copies the runtime takes them.

**Whatever the contract accepts, a reader renders.** A reader stricter than the
contract would fail a site's build on content the CMS saved and Site Guard
passed, leaving the publish stuck. So no reader restates a rule: links go
through the contract's own content-value parser, rich text through
`parseManagedRichTextDocument`, images through `resolveManagedImageAltText`
(the slot policy Site Guard runs), and what is left is a total mapping to
markup. A reader throws only on a value the contract refuses, or on an id or
field the calling code got wrong. `test/runtime-readers-differential.test.ts`
holds this over the contract's shared link and rich-text tables plus image,
search-text and hand-written adversarial cases: contract accepts implies the
reader renders.

| reader | returns | adopting it |
| --- | --- | --- |
| `managedOrder(collectionId)` | item ids in the customer's order | map over it instead of the source array: `managedOrder(c).map((id) => managedItemById(c, id))`, keyed by the id. Never join an ordered row to `managedItem(c, index)`: that index is the SOURCE position. Several fields may order one collection when they agree, and a collection with no ordering field has no items, so neither throws |
| `managedItemById(collectionId, itemId)` | `value`, `link`, `image`, `richText` and `attributes`, each by item field id | read a row's fields from it and spread `attributes(fieldId)` on the element holding each. Throws on an id the collection's source does not list, which only calling code can pass |
| `managedLink(fieldId)` | `{ href, label, target, rel, attributes }` | `<a {...link.attributes} href={link.href} target={link.target} rel={link.rel}>{link.label}</a>`, replacing the literal `href` and text. Internal links become the linked page's static route path (plus `#fragment`); since contract 0.13.0 an internal destination always names a page with one, and the reader refuses any other rather than inventing a URL, external links stay exactly as written, email and phone become `mailto:` and `tel:`. `target` and `rel` are `undefined` for a same-window link, so the markup gains no attribute it did not have |
| `resolveManagedLink(value)` | `{ href, label, target, rel }` | the same rule for a link value that reached a component some other way |
| `managedImage(fieldId)` | `{ src, alt, width, height, focalPoint, crop, attributes }` | pass `src`, `alt`, `width` and `height` to the `<img>` or `next/image` in place of the literals, and `focalPoint` (fractions) to `object-position` if the design crops. Next serves `public/` from the site root, and since contract 0.12.0 every image is under it: `public/x/y.png` renders at `/x/y.png`, and CMS uploads to `public/managed-site-cms/` at `/managed-site-cms/...`. A path outside `public/` is refused (the contract already refuses it, so no valid value reaches that). `crop` is null for the whole image; otherwise (contract 0.13.0 guarantees at least one pixel on each axis, so the styles are always finite, and the reader refuses a crop that is not) render it with `managedImageCrop(image)`, which returns a `frame` style for a wrapper and an `image` style for the `<img>` (a plain `<img>`, or `next/image` without `fill`, which would override the image style) (the crop's aspect ratio, clipped, the image scaled and shifted by the crop's fractions). A wrapper, not CSS `object-view-box`, which only Chromium supports. `alt` is the slot's fixed text for a `fixed_alt` slot and `""` for a decorative one |
| `resolveManagedImage(assetSlotId, value)` | the same, without `attributes` | an image value that reached a component some other way |
| `managedRichTextBlocks(fieldId)` | `{ value, attributes }` | `<div {...body.attributes}>{body.value}</div>` in place of literal multi-block prose. Paragraph, `h2`/`h3`, `ul`/`ol` and blockquote in their plain elements; the text of each paragraph and heading renders through the formatted-block renderer itself (`managedRichText(fieldId, templates)` with no templates), so marks nest outermost-first, carry `data-gomega-mark`, and link through the contract's `managedRichTextLinkAttributesV1`, exactly as a formatted block's do. React escapes every string. Use `managedRichText` for one formatted block in the site's own elements (what the rewrite emits) and this for a whole document |
| `renderManagedRichText(document)` | React elements | the renderer on its own, for a document from elsewhere |
| `managedMetadata(pageId, fallback)` | Next `Metadata` | in the page module, `export const metadata = managedMetadata(PAGE_ID, { ...theLiteralMetadata })`. Title and description come from the page's editable `seo_title` / `seo_description` fields when they are not blank (`trim()` empty, the contract's own test of blank alt text), else from `fallback`. An edited title keeps the shape of `fallback.title`, so `{ absolute }` stays out of the layout's template. Next merges a page's metadata into its layouts shallowly, so a page-level `openGraph` replaces the layout's whole card: a share card is patched only when `fallback` states it, and `fallback` must therefore be the page's effective metadata, including any `openGraph` or `twitter` it inherits. Those cards take the social slot's field; a null social slot has no text of its own, so a card that already states a title or description follows the edited one instead of keeping a stale copy, and a card that states none gains none. The share image (`social.imageFieldId`) becomes the cards' `images`, as an absolute URL on the origin of the page's protected canonical. Canonical and robots are whatever `fallback` says: they stay protected. A page whose share card is customer-editable (a share image, or a social slot naming an editable field) must be given an `openGraph`, or the page's first build fails with a developer error, whatever the content: without one every such edit would be dropped silently. A generated page has no editable metadata and returns `fallback` |

Every link the runtime renders -- a link field, a whole document, a formatted
block through its fallback anchor or the site's own template -- goes through
one builder, `managedRichTextLink`: the contract's href and target plus
`rel="noopener noreferrer"` for a new window.

All of these run in server components only, like the rest of the runtime.

**The runtime needs contract 0.17.x**, the version this package pins. It is
type-checked and tested against that version, and for 0.x a minor release is
breaking: older releases do not compile it even where every imported name
exists (0.8.0 and 0.9.0 lack `metadata.social.imageFieldId` and the `seo_*`
semantics, 0.10.x lacks the rich-text render helpers the formatted-block
reader imports, 0.11.x lacks `isManagedServedAssetPath`, and 0.12.x accepts a
link field to a generated page and a sub-pixel crop, which the readers then
refuse, 0.13.x lacks heading level 1, which the readers render as `h1`, and
0.15.x and 0.16.x lack the `hard_break` node and
`managedRichTextBreakAttributesV1`, which the formatted-block reader imports to
draw one). 0.18.0 has not been verified. The converter never edits a
site's dependencies, so `--rewire` refuses, before writing anything, a
repository whose declared range could resolve, or whose installed copy is,
outside [0.17.0, 0.18.0) (`0.17.2`, `^0.17.0` and `~0.17.0` pass; `>=0.17.0`,
tags and `npm:` aliases do not), or that does not declare every package the
generated module imports (the contract, `next`, `react`) in its OWN
package.json `dependencies` or `devDependencies`, with a registry version. Those
two fields are what a clean deploy install provides (Next.js builds on Vercel
install devDependencies too). A package that is only installed, only in
`peerDependencies` or `optionalDependencies`, only in a parent or
workspace-root package.json, or declared as `workspace:`, `file:` or `link:`
is refused, with the declaration to add. `next` and `react` are held to the
floor the imported names need, derived from the module's own imports and a
table of first releases in `runtime-requirements.ts`: `Metadata` needs Next.js
13.2 (the Metadata API), `Fragment` React 16.2, so today the floors are
`next` 13.2.0 and `react` 16.2.0. A declared range's lower bound must reach the
floor (`13.2.0`, `^14`, `13.2.x` and `>=13.2.0` pass; `13.1.6`, `latest`, `<15`
and prereleases do not), and there is no ceiling, since no imported name has
been removed in a later major. An imported name with no known floor is refused
until the table has it. The runtime is TypeScript, so every type it imports
must resolve too: `next` ships its own declarations, but `react` does not
(through 19), so the site must also declare `@types/react` in its own
`dependencies` or `devDependencies`, at the React release the imported names
need (`^16.2.0` or later; DefinitelyTyped versions it to the React major.minor
it describes). It is not required when the installed `react` ships its own
types. Every way the module can name another package counts: imports
(side-effect and type-only included), `export … from`, `require()`,
`require.resolve()` and `import()` calls, `import()` types in code and JSDoc,
and `/// <reference types>` directives; a loader built at runtime
(`createRequire`) or a non-literal specifier is refused outright. An installed
copy is checked in addition, never instead, and looked for up to the site's
git root and no further. The message names the version to
move to. The generated runtime is Next.js only; the Astro
reference site keeps its own hand-written reader and imports no React.

The gate runs only on a first conversion: a repository that already has a
contract is refused before it, because a second pass cannot be made. A site
converted before the readers existed (All Points Media) takes them by hand:
move its contract dependency into 0.17.x, then append this package's readers
to its `src/content/managed-site.ts` (everything `runtime-module.ts` adds after
`managedItem`, with the import names in `READER_CONTRACT_IMPORTS` and
`READER_MODULE_IMPORTS`), or regenerate the file from a fresh conversion of its
unconverted commit. Its existing exports are unchanged either way. One part
of the generator's own text did change in 0.17.x: `renderSpans` draws a
`hard_break` span through `renderBreak`, and `ManagedRichTextTemplates` gains
`hard_break`. A runtime written before that cannot draw a break, so a site
taking the readers by hand takes those two as well before any field opts into
`allowHardBreaks`.

### It converts a repository once

Converting is not idempotent and cannot be: a converted value is a contract
READ, not a literal, so the proposer cannot see it again. A second pass over
converted All Points Media proposes 92 of its 286 fields, and because
`--rewire` writes the contract into the repository, that run would replace a
complete contract with the partial one and leave the site reading ids nothing
declares.

So an existing `<contentRoot>/managed-site.contract.json` refuses the run
before anything is written. Convert from a checkout that has not been
converted; to redo a conversion, start from one.

### Fields a conversion replaces

A conversion run against an existing ledger (`--ledger`, from an unconverted
checkout) can replace production fields: a formatted block that used to be one
field per text run becomes one rich-text field, and the ledger retires the old
ids. The platform accepts that only with a declared field migration (contract
0.15.0, `managed-site.migration.json`), and the converter knows half of one.

What it knows is WHICH fields merged, from anchors alone: a new field anchored
at an element replaces the retired fields anchored beneath it
(`…/role:h2` replaces `…/role:h2/text` and `…/role:h2/role:span/text`). Every
such group is printed as `field migration: <target> replaces <sources>`, and a
retired field no new field contains is printed as retired with nothing
replacing it. The run succeeds only when every id it retired is a field a
declared step consumes: any other retired id (a field in a group the plan
leaves out or replaced by nothing at all, or a page, section, item, asset or
collection, which no step can consume) is printed as `UNRESOLVED` by kind, id
and anchor, and the run exits non-zero.

What it does NOT know is HOW: the order of the parts, the separators between
them (All Points Media needed a `" "` in every target and a trailing `"."` in
three) and which mark or link each part takes. None of that is in an anchor
or in the ledger, the retired fields' text runs are no longer read as fields,
and the converter does not guess. So a person writes the steps in a plan,
`{ "bridge"?: {...}, "steps": [...] }` in the declaration's own step shape, and
passes it with the production artifacts it migrates:

```bash
npm --workspace @landing-pages-websites/managed-site-conversion run propose -- \
  --repo ../some-unconverted-checkout --ledger ./managed-site.idmap.json \
  --migration-plan ./plan.json \
  --production-contract ./prod/managed-site.contract.json \
  --production-content ./prod/managed-site.content.json
```

The run binds the plan to production by digest, parses it with the contract
package's schema, refuses it unless every step consumes exactly the fields its
target's anchor replaced, and writes `managed-site.migration.json` to `--out`
(and beside the idmap under `--rewire`); a run with no plan removes a stale
one. It does not prove the plan: `gomega-managed-site-conformance migrate`
does, against the candidate the conversion produced. A wrong order, a missing
separator or a lost mark fails there, never silently.

All Points Media #73 itself was not produced by this flow: its targets are
anchored `block:<file>#<pointer>`, a scheme no converter code mints, so its
declaration was written from the spike's mapping, and the contract package
carries it as a test fixture.

### What it refuses

The same trade as everywhere else here: a value it cannot place is reported
with its field and the line it was read from, never guessed at. On All Points
Media that is 228 of 233 customer-editable fields rewritten, and the remainder
named: two rich-text values, one link, one collection inside a client
component, and one page that is deliberately a 404.

### One field per text block

One visual text block is exactly one field. A heading, paragraph, list item,
button or link label whose text is interrupted by inline formatting used to
become one field per text run, so a customer saw fragments of one sentence as
separate values. It is now ONE `rich_text` field holding one block: a heading
at the element's level when the contract's heading block admits that level (1,
2 or 3), and a paragraph otherwise, the element keeping its own level in code.
`allowedBlocks` is that one block, `maxBlocks` is 1, `allowedMarks` is the
marks the block actually uses, and links are allowed only if it had one, to the
hosts and targets it used. A `<br>` inside the block is a `hard_break` node, and
the field gains `allowHardBreaks: true` (with no cap) only if the block had one.
A static list whose item holds a `<br>` is not read as a list document (a list
is never rendered in place, so the `<br>` would lose its class); it keeps the
ordinary walk.

What maps to a mark, and nothing else:

| source | mark |
| --- | --- |
| `em`, `i`, a `span` whose literal class is `italic` | italic |
| `strong`, `b`, a `span` whose literal class is `font-semibold`, `font-bold`, `font-extrabold` or `font-black` | bold |
| `a` (or `next/link`) to an https URL, an email address or a phone number, written as a literal | link |

A plain block is unchanged, and so is anything that is not formatting: a
decorative child with no text (an icon, an empty dot), a container whose
children are blocks of their own, and a paragraph that is only a link.

Everything else is refused whole with `INLINE_FORMATTING_UNMAPPED`, never split
and never guessed: a span whose classes name no mark or more than one, or set
formatting only at a breakpoint or state, or turn it off; a class or attribute
that is not a literal (a `<br>`'s included); a `<br>` with children; a
component; a link to a page of this site or a fragment; and a mark nested
inside itself. Last, the value is rendered back through the site's own elements
exactly as the rewritten site will render it and compared to the source, so
anything the value cannot say (two adjacent runs of one mark, one mark written
two ways, two `<br>`s written two ways, a `<br>` between two elements of one
mark, an empty element, a link target other than `_blank` or none) is refused
because it would render differently. A `<br>` at the edge of the block or
beside another, and text holding a control character (a `{"\n"}`, a tab, a C1
reference such as `&#x80;`), are refused because the contract refuses the value. A computed value inside the block
is `NON_LITERAL_VALUE`, as before.

A link label has exactly one editor. A formatted label (by a tag or by a
span's class, alone or beside text) becomes ONE rich-text field of its own,
rendered in place inside the link, and a link inside it is refused. The link
field keeps the destination and target, and offers `link.label.edit` only when
the label is bare text: a label beside other elements has its text read as a
field of its own.

The rewrite renders the block through `managedRichText(id, templates)` from
the generated runtime, which resolves a customer's link to a page of this site
through the contract's static page paths, where each template is the element the source used for
that mark (and `hard_break` is the source's own `<br>` with `data-gomega-break=""`
added; without one the runtime draws `<br data-gomega-break="">`), and the parity gate proves the page is byte-identical apart from the
annotations. A link template also gains `rel={link.rel}` where the source
element wrote no `rel`: it renders only for a new window, so an element that
opens in the same window keeps exactly its attributes, and a customer who
switches the link to a new window gets `rel="noopener noreferrer"` with it. A
`rel` the source wrote is its own and stays. A block in a client component,
and a list document, are refused by the rewrite and reported.

### What proves it

Two guarantees, one per failure mode.

**Nothing unparseable is written.** Every rewritten file is parsed before it
reaches disk, and a file that would not parse stops the run naming itself.
Every corruption this rewrite has produced was a parse error — a tag renamed by
a missing space, a redundant fragment inside a new element, an opening tag
spliced into an import — and each was otherwise found by a `next build` error
pointing a dozen lines away from its cause.

**Nothing rendered changes.** Build the site before and after and compare the
prerendered HTML, with the command that ships beside this tool:

```bash
npm --workspace @landing-pages-websites/managed-site-conversion run parity -- \
  /tmp/before/.next/server/app /tmp/after/.next/server/app \
  --contract src/content/managed-site.contract.json \
  --css /tmp/before/.next/static/css,/tmp/after/.next/static/css
```

It exits non-zero on any difference it is not allowed to normalise away, and on
any declared route it could not compare.

**CI runs that whole loop on every push**, against a reference site in
`fixtures/next-unconverted` that is deliberately left unconverted: build it,
convert a copy, build that, compare. The repository's only other Next
application is the starter, which is already a managed site, so nothing else
here can be converted to prove anything. The reference contains only shapes the
rewriter HANDLES -- a documented refusal such as a rich-text list would leave a
customer-editable field unconverted and make the gate unpassable by design,
which teaches whoever meets it to ignore the gate rather than the shape.

It is also a mutation test in the ordinary sense: changing the page wrapper
from `display:contents` to anything a reader could see turns it red and names
both pages. A page rendered ON DEMAND writes no file, so it is absent
from both sides and a comparison of built output never mentions it: All Points
Media's `/contact` is dynamic because of its form, and a run reporting "90 of
90 identical" had not looked at it. Given `--contract` it names those routes and
FAILS, rather than reporting the pages it could see: fetch each from a running
build and drop it into both trees under the same name. Silence about a page is
not evidence about it.

Stylesheets are compared as an ordered sequence carrying at-rule context, not
as a set of rule text. A rule moved into an `@media` block reads identically
either side, and two rules swapped are the same two rules — both change what
renders. An added rule is reported and allowed, because the conversion does add
exactly one: the page-root wrapper is the first user of `display:contents` on
most sites. Normalise only what a reader cannot see and the rewrite is
allowed to change: the hydration payload, the build id, hashed and numbered
chunk filenames, React's empty-text separators, the `data-gomega-*` attributes,
and the page-root wrapper and annotation spans (unwrapped by matching depth,
not by regex). A single changed character anywhere else is a failure, and has
been: the whitespace, HTML-entity and fragment defects in this tool's history
were all found that way rather than by review.

## The confidence rule

> A value enters the proposed contract only when its **identity**, its **field
> type** and its **classification** are each decided by a rule reading
> exclusively from structural source facts — declared identifiers, JSX tags,
> attribute names, literal syntactic kind — and no other candidate in the
> repository resolves to the same anchor path. If any one of the three is
> undetermined, the value is reported and **nothing** is written into the
> contract for it.

The rule is printed at the top of every report, so a reader never has to infer
what "confident" meant for a given run.

### A component's props are read from the component

A host element's attributes are a fixed vocabulary, so a list can classify
them. A component's props are not: `title` is customer copy on one component
and a tooltip on another, and `as` is never copy anywhere. So the role is not
read from the NAME — it is read from what the receiving component does with the
value, in that component.

A prop rendered as text is content. A prop that ends up in an `aria-*` or `alt`
attribute is an accessibility interface. A prop that is tested, used as a tag,
used as a key into a lookup, or lands in a structural attribute is code.

Nothing is guessed. The reading returns nothing — and the value is reported
exactly as any other refusal — when the prop's uses disagree, when the
receiving component cannot be read, when the value crosses a call this reader
cannot see through, when a later spread could replace it, or when the props
object reaches anything this reader cannot follow.

One prop's meaning depends on the site rather than on the code: `ref` reaches a
function component from React 19 and is consumed before it. That is read from
the repository being converted, and a manifest that does not PIN a major
answers unknown, which fails closed.

The trade this makes is deliberate. A wrong classification is a silent failure:
either internal SEO copy becomes customer-editable, or content the customer
needs is locked away, and neither is discovered until much later. An unresolved
value is a loud failure that costs a person five minutes. The tool is tuned to
convert loud failures into work and never to convert silent ones into coverage.

Concretely it refuses, rather than guesses, on:

| code | what it means |
| --- | --- |
| `AMBIGUOUS_ANCHOR` | two or more values resolve to the same anchor; both are withheld, and so is anything nested inside them |
| `NO_DURABLE_ANCHOR` | a `<section>` with no `id` and no component of its own, or an element whose only available name is a value this tool proposes as the customer's — a component prop it renders as copy, an image `src`, an editable link destination |
| `NON_LITERAL_VALUE` | the rendered value is computed, not a literal that can be migrated |
| `INLINE_FORMATTING_UNMAPPED` | a text block's inline formatting maps to no mark, so the block is refused whole rather than split into one field per run |
| `UNKNOWN_ATTRIBUTE_ROLE` | on a host element, a literal attribute that is neither structural nor a known accessibility interface; on a COMPONENT, one whose receiver was read but does not decide what the prop is |
| `DUPLICATE_COMPONENT_NAME` | one component name declared in two files |
| `UNRESOLVED_COMPONENT` | a local import of a rendered component that could not be resolved, so its markup was never read |
| `UNRESOLVED_RENDER_TARGET` | a rendered element names no traceable declaration — chosen at runtime, arriving as a prop, an unnamed default export, or a component that always calls `notFound()` — or a JSX-writing function was handed to a call or to a component and where its result renders could not be read |
| `COLLECTION_BOUNDS_NOT_DERIVABLE` | item counts are policy, and item IDs were bootstrapped from present array order |
| `COLLECTION_ITEM_IMAGE_UNSUPPORTED` | items each carry a different image, and the converter does not yet derive one asset slot that fits them all |
| `ASSET_UNREADABLE` | an image whose dimensions could not be read |
| `ASSET_PATH_UNREPRESENTABLE` | the configured `assetRoot` joined to the referenced file is not a path the standard can carry |
| `SEO_INPUT_REQUIRED` | an internal-SEO or platform fact with no source in the repository |
| `SCOPE_NOT_OBSERVABLE` | a component renders on several routes, so site scope was assumed and needs confirming |
| `CONSTRAINTS_DEFAULTED` | a length or node limit came from policy rather than from anything the source proves |
| `DYNAMIC_ROUTE_NOT_A_PAGE` | a route template stands for many URLs, so it is not one page to convert |
| `ROUTE_PATH_UNREPRESENTABLE` | a route folds into a file name longer than one path segment may be, so no content file can hold it |
| `ROUTE_NOT_SERVED` | this repository does not serve a route the contract would describe — a module in its chain always calls `notFound()` (which excludes the route), or the route is in the sitemap and its module could not be read or carries no editable value (both reported only) |

## What counts as customer content

Only what a visitor can actually reach. A route is read through the chain that
renders it — its `page` module and every `layout` above it, nearest first — and
the render tree is followed from those default exports through JSX element names,
across imports, renames, default exports and barrel re-exports.

A capitalized export sitting beside a page is **not** proposed: an editor for
markup the browser never shows is worse than no editor at all. Neither is a
function declared *inside* a component and left there — nested or top level,
capitalized or not, its JSX renders only where something runs or renders that
function, so it is read only when the tree reaches it, and then under its own
name rather than its parent's.

Running a function is **not** the same as rendering what it returns.
`useEffect(() => <Row />)` runs its function and throws the result away, and so
do `setTimeout` and `forEach`. So the question asked of every nested function is
not whether something runs it but whether **what it returns reaches the browser
as markup**. One answer says yes: a call runs it *and* the call's own result
lands in rendered output — written as a child of an element, or handed back by
the function it sits in. A component reached that way is still extracted under
its own name, never its caller's.

Being written as an element's **attribute** is not such an answer. An attribute's
function renders only if the element renders what it returns, and the attribute
says nothing about whether it does: `<button onClick={() => <Row />}>` hands the
result to the DOM, which discards it, and a component is as free to take a
callback it never renders (`onConfirm`, `onSelect`) as one it does. Nothing is
followed on attribute spelling. Where the answer is knowable it comes from the
receiving element and is always no, so the element decides only whether the
refusal is silent or spoken:

| Given to | Answer | Result |
| --- | --- | --- |
| a host element | renders no return value, ever | ignored, **silently** |
| a component | only its own declaration says | withheld and **reported** |

So `renderItem={() => <Row />}` is reported rather than extracted, even where the
receiving component does render it: resolving a tag to its declaration and
proving it renders the prop is beyond what this reads, and a rule right about
`renderItem` but wrong about `onConfirm` cannot tell you which one you have. The
refusal is scoped to callbacks that actually write JSX, so ordinary handlers stay
silent. A dotted tag is a component whatever its case — `<motion.div />` is not a
`div` — so it is reported rather than ignored.

Which call it is never matters, so no list of method or hook names appears
anywhere in the rule. One consequence is worth stating: `{items.filter((i) =>
<Row />)}` puts its result in rendered output, but `filter` passes the items
through rather than what the function returned, so `Row` is read when nothing
renders it. Nothing syntactic separates it from `map`, and such a filter is
already broken — every item is truthy, so it filters nothing.

One call shape does not render what the function returns but builds a component
out of it: `memo`, `forwardRef`, `lazy`, `dynamic`. They are told apart by what
the call's **result** becomes, never by the callee's name, which no list could
keep up with — a result bound to a component-shaped name is a declaration, and
React reaches a declaration only through a capitalized tag, so that tag is the
edge.

Where the tree cannot be followed — a component chosen at runtime, one arriving
as a prop, an import that does not resolve, an unnamed default export, a call
given a JSX-writing function whose result goes somewhere unreadable, or a
component given a JSX-writing function as an attribute — the
subtree is withheld **and** reported, because a silent drop hides the same
coverage gap as a silent inclusion. That last case covers `const rows =
items.map((i) => <Row />)`: following the binding to the place it is read is
dataflow this proposer does not do, so the call is named rather than guessed at.

Being unrendered is not such a case: it is a resolved answer, so it is left out
in silence rather than filed as a decision. A discarded result is resolved in
the same way — nothing an effect or a `forEach` returns reaches a visitor, so
there is nothing for a human to decide, and neither does anything returned by a
host element's handler.

Two shapes are still left out in silence, and both are recoverable by hand: a
component passed by name rather than written as a tag (`renderItem={Card}`,
`items.map(Card)`), and a callback named twice in one module, where which
declaration a call reaches is a scope question the source alone cannot settle.

Internal SEO follows the same chain. `metadata.title`, `metadata.description` and
`robots` are resolved per route from the route's own module first, then its
layouts: a field the route omits legitimately inherits from a layout, exactly as
Next.js renders it, and nothing a sibling route declares can reach it. A field a
route declares but the tool cannot read as a literal does **not** fall back to a
layout — it is reported, so an ancestor's value is never attributed to a route
that overrode it.

What Next.js serves is the module object once the module has finished running,
so a route's own top-level writes are part of the answer: `metadata.robots = {
index: false }` beside a shared `seo(...)` call — the usual way one route is
hidden out of a site-wide metadata shape — resolves to `index: false`, and a
second write to the same key wins over the first. That is the only write shape
read. The binding may otherwise be **mentioned** nowhere but its declaration and
its export: a read is enough to refuse, because a read is how the object reaches
a mutator, and no list of ways to write one ever terminates.

## The ID scheme

Stable IDs are random, exactly as the platform mints them. What has to be
durable is the **binding** between an ID and the source, and that binding is the
**anchor path**: a chain of names a developer wrote on purpose.

```
component:Navigation / region:pricing / role:a / at:#contact
component:Hero       / role:h1        / text
component:Method     / region:steps   / each:STEPS / prop:title
```

A segment may only be:

- `component:<Name>` — a uniquely named component declaration
- `region:<name>` — a container's literal `id` attribute (also a URL fragment target), the accessible name a literal `aria-labelledby` or `aria-label` gives it, or a unique landmark element
- `role:<tag>[#<attribute>]` — the element, or the attribute a value flows into
- `at:<discriminator>` — a durable way to tell siblings apart: a declared `id`, a module constant name, a destination the customer is granted nothing over
- `each:<BINDING>` / `prop:<name>` — a module-level array and an object-literal property name
- `text` — the direct text run of an element

A name written on a COMPONENT is not a host fact. It is an ordinary prop, and a
component may render a prop as visible copy. So a `region:` name, and the `at:`
discriminator a literal `id` gives a leaf, are taken from a component's prop
only when that component's own source proves the value is not the customer's to
edit. A name the customer owns makes a region's identity depend on its own
contents. What the prop is comes from the same reading that decides whether it
is a field, *A component's props are read from the component* above, and a prop
that cannot be read names nothing.

The two `at:` discriminators that used to bypass that reading — an image's `src`
and a link's `href` fragment — no longer exist. Both were offered to the
customer as editable, so both identified a field by a value the customer owns:
`image.upload` replaced the one and `link.destination.edit` rewrote the other,
and the next run saw a different anchor. A link destination is now named only
through `ownershipOfDestination`, the single reading `emit-contract.ts` grants
the capability from, and an image is named only by a literal `id`.

What holds all of it together is `AnchorName`: `region:` and `at:` carry that
branded type, and only `anchor-name.ts` mints one, from the reading that decided
the value is not the customer's. A collector cannot reach an anchor segment with
a value nothing asked about — the two bypasses above were review findings, and
their shape is now a compile error.

Deliberately excluded, because none of it survives normal work: **visible text**
(changes on every copy edit), **DOM or sibling order** (changes when a section
moves), **array index** (changes on reorder), and **file name or path** (changes
when a component is extracted).

And excluded for a second reason, which is about this tool rather than about the
source: **any value this tool proposes as the customer's to edit**. The rule is
read from the capability granted, not from a list of value kinds, so an external
URL, a `mailto:`, a `tel:` and a `#fragment` fall out of it together — this file
used to name only the external URL, and `destinations.ts` refused only that one
while keeping the fragment. A module constant's NAME survives, because the
customer edits the value behind `BOOK_URL` and never the name the markup reads
it through.

Refusing a name is never silent: the element is reported under
`NO_DURABLE_ANCHOR`, naming the value declined and the `id` that would replace
it, and identical siblings that can no longer be told apart are then withheld
under `AMBIGUOUS_ANCHOR` as any other tie is.

Consequences, all covered by `test/anchors.test.ts`:

- Wrapping content in extra `<div>`s changes nothing. Layout containers that
  render no text of their own contribute no anchor segment at all.
- Reordering siblings changes nothing.
- Rewriting every word of copy changes nothing.
- Swapping `<section>` for `<article>` changes nothing.
- Moving a component into its own file changes nothing — the anchor is rooted on
  the component **name**, not its path. This is the one refactor the real
  TrendCandy conversion actually performed.
- Renaming a component **does** move its anchors. That is intended: the tool
  reports the old anchors as retired and the new ones as fresh, so a human
  either accepts the churn or declares an alias. A silent rebind would be worse.

Re-running the PROPOSAL is idempotent. `managed-site.idmap.json` maps anchor to
ID; a known anchor keeps its ID, a new one mints, and an anchor that disappeared
has its ID written to `tombstonedIds` rather than recycled.

Re-running the CONVERSION is not, and is refused — a converted value is a
contract read rather than a literal, so a second pass cannot see it. See
"It converts a repository once".

Item IDs inside a collection are the one place position is used, and only once:
at the first run, when position is the only truth available. The IDs are written
straight into the emitted content, so from then on they live in the source. Every
collection carries a `COLLECTION_BOUNDS_NOT_DERIVABLE` finding saying so.

## What the operator must supply

The repository cannot know its own production origin, legal name, telephone,
sitemap policy, performance budget, page intent, or the current review-bridge
integrity hash. Those come from `--config` (see `example.conversion.json`).
Anything missing is reported as `SEO_INPUT_REQUIRED` and the contract is withheld
— it is never defaulted into place.

A declaration is checked against the repository, not only against the schema. A
route the config names and the scan never found is reported against the config
rather than against the route that does exist, and the contract describes no
route this repository does not serve:

| what the walk read | what happens |
| --- | --- |
| a module in the route's chain always calls Next's `notFound()` | the route is **excluded**: no contract page, no canonical, no indexing directives, no content document |
| the route is in the sitemap and its module could not be read at all | reported beside the declaration; the route is kept |
| the route is in the sitemap, owns content, and this run proposed none | reported — a sparse page is thin, not unserved |

Only the first decides anything, because only the first is a fact about the
ROUTE: a function that always reaches `notFound()` renders nothing whatever else
is true of it. The other two are facts about this reader, and a legitimately
sparse page produces one of them.

The exclusion holds whatever the config declares, because the whole page
descriptor is the advertisement. Keying it on `sitemap.included` alone leaves
the canonical URL, the robots directives and a content document behind for a
route that 404s, which is the same defect one field over. The proof is taken
from the import graph rather than the spelling — a local function called
`notFound` is not the framework's — and it fails towards "cannot prove it": `if
(hidden) notFound();` above a `return <section/>` is a page that renders, and is
left alone.

All Points Media is why this exists. `/innovation/network-portal` is `export
default function NetworkPortalHidden() { notFound(); }`, declared `purpose:
"service"` with `sitemap.included: true`, and the emitted contract advertised an
indexable service page, with a canonical URL, for a route the site 404s. Both
halves were already in the run — an `UNRESOLVED_RENDER_TARGET` quoting the
`notFound()` body, and the declaration in the config — in two different files,
so nothing joined them. `ROUTE_NOT_SERVED` is that join, and it carries the
route, the declaration and the line in one finding.

A key nobody wrote takes the default. A key somebody wrote, with a value the
loader cannot use, is refused by name — `"pages": 42` is a mistake in the file,
and loading it as no declared pages hides the one thing the writer needs told.
An explicit `null` is how JSON says "not set", so it counts as absence. The
values the standard defines — page purpose, sitemap policy, performance budget —
are checked by the standard's own parser rather than by a second description of
them here.

### The two files a converted site keeps

Both inputs a conversion cannot re-derive belong in the site's own repository,
committed:

| file | what it is |
| --- | --- |
| `<contentRoot>/managed-site.idmap.json` | the anchor-to-ID ledger. It is what keeps a field's ID the same across conversions, and the CMS addresses a customer's edits by that ID. `--ledger` defaults here. |
| the conversion config | everything the repository cannot know about itself, including which routes own customer content. Pass it as `--config`; keep it beside the code it converts, not with this tool. |

The ledger's old default was `<out>/managed-site.idmap.json`, a report folder
nobody commits, so a re-run minted a fresh ID for every field and orphaned every
edit made through the CMS. Remembering `--ledger` was the only thing standing
between a site and that.

It is also excluded from the scan that mints anchor names, along with the output
directory. It records the anchor every ID was minted for, so unexcluded it
reserves the names it is the record of: converting All Points Media a second
time turned `ms-proof-challenge` into `ms-proof-challenge-2`, which changed that
value's anchor and minted it a new field ID although nothing about the value had
moved.

### Routes whose words the customer does not own

Every route the scan finds and KEEPS has to be declared, or internal SEO is
incomplete and the contract is withheld. A route it excludes — a dynamic
template, a path no content file can carry, a route that answers 404 — needs no
declaration, and one written for it is reported as inert rather than as a page
missing its inputs. That includes a repository's internal screens —
an operator console, a debug page — and declaring one used to be the same as
offering its labels to the customer: All Points Media's password-gated
`/admin` contributed seven editable fields, `Shared password` among them, to
the editor of a page no customer can open.

`"managedContent": false` on a page declares the route and gives it no content
of its own. It keeps the route's SEO facts and its content document's `seo`
block; none of the words it alone renders become fields, collections or asset
slots; the anchor pass has nothing to name in them; and the route gets no
page-root annotation, so the editor discovers nothing on it. It says nothing
about who may READ the page; that is the repository's own auth.

The question is about the routes that REACH a component, never about the file.
A header rendered by both `/admin` and `/about` is still the customer's, so it
is proposed and rewired as usual; only a component no content-bearing route
reaches is left out. Where that shared component is a CLIENT one, its values
arrive as a prop, so the internal screen's call site is threaded too — skipping
it would leave that one route rendering the literal the repository shipped
while every public page rendered the customer's edit. Absence of the key is not
`false`: a route declared without it behaves exactly as it always did.

`contentRoot` and `assetRoot` are checked against the paths derived beneath them,
not only their own shape, because the standard bounds a whole path: a root that
loads must not be able to fail at emission. A content root has to leave room for
`/pages/<slug>.json` at the longest slug that can exist. An asset root has to
leave room for one file name at the longest the standard permits — an asset path
is whatever the repository already calls the file, so anything deeper is decided
when that path is built, and reported as `ASSET_PATH_UNREPRESENTABLE`.

`assetRoot` must be the contract's served root, `public` (`MANAGED_SERVED_ASSET_ROOT`),
and any other value is refused at config load. The contract (0.12.0) accepts an
image only under `public/`, so a root outside it would emit images the contract
refuses; and an image the source writes as `/hero.png` is the file served from
`public/hero.png`, so even a root inside it, such as `public/images`, would
record a different file than the one rendered. The key stays so a config that
states it keeps loading. Every image path the proposer emits is also checked
with the contract's `isManagedServedAssetPath` as it is built.

What *is* migrated automatically: `metadata.title`, `metadata.description` and
`robots`, resolved per route from the Next.js `metadata` exports along that
route's own chain (that export is the route's SEO contract), the heading outline
from the headings actually found, and image dimensions, byte counts and SHA-256
digests read from the committed files.

## Verification

The proposal is only reported as valid when the platform's own parsers accept
it: `parseManagedSiteContractV1`, and then
`projectManagedSiteContentDocumentV1`, which resolves every resolver against
the sources this run wrote and runs
`validateManagedSiteContractV1ContentSemantics` over what it derives. A
resolver that reaches nothing, a source document nothing references, or a value
in one left unclassified is therefore a refused contract rather than a proposal
that only fails once the platform reads it. There is no second implementation
of the schema in this package — resolvers and pointers are built
through `parseRepositoryPath` and `parseJsonPointer` so a malformed address fails
at construction rather than at review time.

## Measured behaviour on TrendCandy

`trendcandy-taste` is the only site converted by hand, so it is the only real
yardstick. The tool was run against its pre-conversion commit (`3093065`, the
parent of the adoption commit) and compared against the contract and content that
were actually shipped, matching on value rather than on ID.

The shipped artefacts hold **62 distinct customer-facing and internal values**.

| run | proposed | matched | needs human | classification errors |
| --- | --- | --- | --- | --- |
| pre-conversion source, untouched | 34 | 29 (47%) | 24 | **0** |
| after adding `id` to 4 unnamed sections (~5 min) | 36 | 31 (50%) | 16 | **0** |
| after the full mechanical pass (~30 min) | 62 | 57 (92%) | 3 | **0** |

These three rows were measured **before** the rule that a value the customer may
edit names nothing, and the `matched` column cannot be recomputed here — it was
compared by hand against the shipped artefacts. Re-running the untouched-source
row on the current code moves 6 of its 34 anchors: the nav's three fragment
links (`#method`, `#proof`, `#research`) now share one anchor and are withheld
together, and the hero image and the body's `#method` link keep their fields
under shallower anchors. That is 3 fewer proposed fields (19 to 16), 6 more
`NO_DURABLE_ANCHOR` findings and 3 more `AMBIGUOUS_ANCHOR`. The mechanical pass
below closes it: an `id` on each nav link returns all three, on top of the work
the rows already describe.

The full mechanical pass is: name 4 sections, give 6 sibling paragraphs an `id`,
declare the three proof metrics as an array, and write the eight partner logos out
as declared list items. No copy was touched and no layout changed.

**What it got right, unaided.** Five of the eight navigation fields — the other
three are the fragment links above, which the current code withholds — including the split
of `Trend<span>Candy</span>` into two editable values (since read as the link's one
label, see "One field per text block") and the `href="#"` brand
link as `code_owned_interface`. The hero heading as `rich_text` with the `<em>`
preserved as an italic mark. Every heading, every link with its destination and
target, the hero image with real dimensions and digest, the method steps as a
collection, and the two `aria-label` values as `code_owned_interface`.

**Zero classification disagreements in every run.** Nothing the hand-written
contract protects was ever proposed as customer-editable, and nothing it exposes
was ever proposed as protected.

**What it missed, and reported.** On the untouched source: six proof metrics and
seven loose paragraphs, whose `<p>` siblings are indistinguishable without a
name; the two identical `BOOK_URL` calls to action, which cannot be told apart
from each other; and sixteen partner values, because the converter does not yet
propose a collection whose items vary an image. That is seventeen `AMBIGUOUS_ANCHOR`
findings plus one `COLLECTION_ITEM_IMAGE_UNSUPPORTED` covering all sixteen
partner values — every missed value is covered by a finding that names the
decision required.

(The two calls to action do not appear as misses in the table, because the
comparison matches on value and the navigation's "Book a Call" link carries an
identical label and destination. The table therefore flatters the tool very
slightly.)

**What it never proposed at all.** Business identity: legal name, telephone,
email and same-as URLs appear nowhere in the pre-conversion source. Six of the
ten internal-SEO fields in the shipped contract were *authored* during the
conversion, not migrated. That is invisible in a diff and is the single most
underestimated part of the per-site cost.

**Where it disagrees defensibly.** Three method step titles are proposed as
`heading_text` (they are `<h3>` in the source) where the hand-written contract
used `plain_text`. The testimonial quote keeps the `&ldquo;` / `&rdquo;` the
source renders, which the hand-written version dropped. These show as
non-matches in the table above and are counted against the tool.

**One finding about the standard, not the site.** The hand-written contract keys
its eight partner entries as `workvivo`, `sap`, `adobe` and so on — identities
derived from logo file names and visible text, which is exactly what step 3 of
the runbook forbids. The tool cannot reproduce that and should not.

### Realistic per-site effort after tooling

TrendCandy is one route and 62 values. Extrapolating from it:

- **~30 minutes** of mechanical remediation to clear the structural findings —
  naming sections, disambiguating sibling paragraphs, declaring repeated content
  as arrays. This is the bulk of what the tool converts from authoring into
  review.
- **~15 minutes** of operator input per site — canonical origin, business
  identity, page intent, sitemap and performance policy. Mostly not derivable and
  mostly shared across a customer's routes.
- **~15 minutes** of review of the proposal itself: confirm collection bounds,
  confirm presentation names and grouping, confirm the classification of anything
  the tool marked `code_owned_interface`.
- Then the parts this tool does not touch at all: routing rendering through the
  adapter, annotations, and parity proof against the frozen baseline.

Against roughly a day per site today, this is a plausible **1 to 1.5 hours** for
the contract-and-content half of the work on a site of TrendCandy's size, with
the residual risk moved from silent misclassification to an explicit list.

Two caveats on that number. Multi-route sites will spend more on scope decisions
that a single route cannot make observable. And a repository written without
`id` attributes or named components will spend most of its time in the mechanical
pass, because that is precisely the input the tool needs.
