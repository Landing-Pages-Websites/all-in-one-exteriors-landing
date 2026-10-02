# content/blog

**This directory is written by the MEGA content pipeline, not by hand.** Posts
are committed here by the `github_markdown` publisher, one markdown file per
post, on a PR that is squash-merged immediately. Hand-editing a post is fine in
an emergency, but the pipeline is the normal author.

## The path is a contract

`src/lib/blog.ts` reads `BLOG_CONTENT_DIR`, and it must equal the customer's
`github_markdown_config.contentDir` in MEGA. `contentDir` is per-customer
configuration, not a constant. When the two disagree nothing errors: the
publisher keeps committing and merging successfully, the files land in a
directory nothing reads, `/blog` stays empty, and every published post 404s.
Change one side and you must change the other.

## Frontmatter

| key | required | owner | notes |
|---|---|---|---|
| `id` | yes, on new posts | pipeline | Stable identity. See below. |
| `title` | yes | customer-editable | No title means the file is skipped entirely. |
| `slug` | no | SEO | Falls back to the filename. |
| `date` | no | SEO | `YYYY-MM-DD` or a full ISO datetime. Undated posts sort last. |
| `description` | no | SEO | `excerpt` and `summary` are accepted aliases. |
| `image` / `imageAlt` | no | SEO | `heroImage` / `featuredImage` are accepted aliases. |
| `author` | no | SEO | |
| `draft: true` | no | either | Keeps the post out of the index and off the site. |

Any other key is ignored, not an error — the pipeline's frontmatter projection
is per-customer and emits keys this site does not use. Only top-level keys are
read, so a nested block (`faq:` with indented children) is ignored rather than
mistaken for a key of the post. A folded or block scalar (`description: >` or
`date: |`, with the text on following lines) reads as **empty**, in every
spelling including `>-`, `|+` and `|2`. Write any value this site renders on
the key's own line.

## `id` is minted once and never changes

`id` is `item_` followed by 26 Crockford base32 characters. It is what a CMS
edit attaches to, so:

- **Whoever creates the file mints it. Every later writer keeps the id already
  in the file, verbatim**, even when recomputing would agree.
- **A reslug keeps the id.** That makes the reslug an update. A changed id is a
  delete plus a create, and every customer edit on that post is gone.
- The loader only ever reads ids. It never mints one, because a loader that
  minted would hand out a fresh id on every build.

A post with no `id`, or with a malformed one, still renders — it is just not
CMS-editable yet, and pre-live QA grades it. That direction is deliberate: a
blog that goes blank is a far worse failure than a post that cannot be edited.

## Which files are read

`isPostFile` in `src/lib/post-file.mjs` is the one place that decides, and both
the site and the prebuild check import it from there. In short: `.md` and
`.mdx` only, and never this `README.md`, anything starting with `_`
(`_draft.md`, `_inventory.json`), anything starting with `.` (`.gitkeep`), or a
subdirectory.
