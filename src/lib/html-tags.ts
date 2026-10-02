/**
 * Which Block or inline node each HTML tag becomes.
 *
 * One table, and every set below it is a view of that table, so adding a
 * container tag is one edit rather than an edit plus four hand-maintained
 * membership lists that have to be kept in step. `html-blocks.ts` reads this;
 * nothing here knows about parsing.
 *
 * A tag absent from the table is unwrapped, never leaked. See the rules in the
 * `html-blocks.ts` header.
 */

/**
 * `#### Deep` and `<h4>` must land on the same level, so the markdown grammar
 * and the tag table read the depth-to-level mapping from here rather than each
 * stating it.
 */
/**
 * A lookup table with no prototype.
 *
 * A plain object literal answers `TAG_ROLES["constructor"]` with
 * `Object.prototype.constructor`, so `<constructor>` in a post resolves to a
 * function where a role belongs and takes the build down. Prose is not a tag,
 * and there is no key here that is not written here.
 */
export function lookup<T>(entries: Record<string, T>): Readonly<Record<string, T>> {
  return Object.assign(Object.create(null) as Record<string, T>, entries);
}

export function headingLevel(depth: number): 2 | 3 {
  return depth >= 3 ? 3 : 2;
}

export type TagRole =
  | { flow: "block"; block: "paragraph" }
  | { flow: "block"; block: "heading"; level: 2 | 3; dropWhenLeading?: true }
  | { flow: "block"; block: "list"; ordered: boolean }
  | { flow: "block"; block: "blockquote" }
  | { flow: "block"; block: "table" }
  | { flow: "block"; block: "code" }
  /**
   * Consumed by the block that owns it; unwrapped anywhere else. `part` names
   * which piece it is, so the walkers derive their tag sets from this table
   * instead of restating membership in sets that have to be kept in step.
   */
  | { flow: "structure"; part?: "item" | "row" | "cell" | "section" | "head" }
  | { flow: "inline"; inline: "strong" | "em" | "code" | "link" | "image" | "space" }
  /**
   * Rule 1: dropped whole, content included. `raw` marks the ones whose content
   * is raw TEXT rather than markup, which decides how the scanner finds the end
   * of one. Unmarked is the fail-closed reading: depth-counted.
   */
  | { flow: "drop"; raw?: true };

export const TAG_ROLES: Readonly<Record<string, TagRole>> = lookup<TagRole>({
  p: { flow: "block", block: "paragraph" },
  div: { flow: "block", block: "paragraph" },
  section: { flow: "block", block: "paragraph" },
  article: { flow: "block", block: "paragraph" },
  aside: { flow: "block", block: "paragraph" },
  main: { flow: "block", block: "paragraph" },
  // The pipeline wraps a body image in `<figure><img><figcaption>`. Naming the
  // caption a block is what keeps the image its own Block instead of folding
  // both into one paragraph.
  figure: { flow: "structure" },
  figcaption: { flow: "block", block: "paragraph" },
  // A definition list has no Block of its own. Naming each part a paragraph is
  // what keeps `<dt>Q</dt><dd>A</dd>` from unwrapping into the run-on "QA".
  dl: { flow: "structure" },
  dt: { flow: "block", block: "paragraph" },
  dd: { flow: "block", block: "paragraph" },
  address: { flow: "block", block: "paragraph" },
  // The pipeline emits its own duplicate of the post title as a leading h1 and
  // the page template already renders the title, so a leading h1 is dropped
  // rather than demoted to a visible h2 that repeats the headline.
  h1: { flow: "block", block: "heading", level: headingLevel(1), dropWhenLeading: true },
  h2: { flow: "block", block: "heading", level: headingLevel(2) },
  h3: { flow: "block", block: "heading", level: headingLevel(3) },
  h4: { flow: "block", block: "heading", level: headingLevel(4) },
  h5: { flow: "block", block: "heading", level: headingLevel(5) },
  h6: { flow: "block", block: "heading", level: headingLevel(6) },
  ul: { flow: "block", block: "list", ordered: false },
  ol: { flow: "block", block: "list", ordered: true },
  blockquote: { flow: "block", block: "blockquote" },
  table: { flow: "block", block: "table" },
  pre: { flow: "block", block: "code" },
  li: { flow: "structure", part: "item" },
  tr: { flow: "structure", part: "row" },
  td: { flow: "structure", part: "cell" },
  th: { flow: "structure", part: "cell" },
  thead: { flow: "structure", part: "head" },
  tbody: { flow: "structure", part: "section" },
  tfoot: { flow: "structure", part: "section" },
  colgroup: { flow: "structure" },
  strong: { flow: "inline", inline: "strong" },
  b: { flow: "inline", inline: "strong" },
  em: { flow: "inline", inline: "em" },
  i: { flow: "inline", inline: "em" },
  code: { flow: "inline", inline: "code" },
  a: { flow: "inline", inline: "link" },
  img: { flow: "inline", inline: "image" },
  br: { flow: "inline", inline: "space" },
  // `script` and `style` hold raw text, so `</script` inside a JS string really
  // does end the element. `template` and `noscript` hold real markup and nest.
  script: { flow: "drop", raw: true },
  style: { flow: "drop", raw: true },
  template: { flow: "drop" },
  noscript: { flow: "drop" },
});

/** Rule 2: anything absent from the table is unwrapped, never leaked. */
const UNWRAP: TagRole = { flow: "structure" };

/** `Object.hasOwn`, not `in`: `<constructor>` and `<toString>` are prose, and
 * an inherited prototype member is not a tag role. */
function isKnownTag(tag: string): boolean {
  return Object.hasOwn(TAG_ROLES, tag);
}

export function roleFor(tag: string): TagRole {
  return isKnownTag(tag) ? TAG_ROLES[tag] : UNWRAP;
}

/** Whether a list tag numbers its items, read from the table rather than from
 * the tag name, so `ol` is spelled in exactly one place. */
export function isOrderedList(tag: string): boolean {
  const role = roleFor(tag);
  return role.flow === "block" && role.block === "list" && role.ordered;
}

function tagsWhere(match: (role: TagRole) => boolean): ReadonlySet<string> {
  return new Set(
    Object.entries(TAG_ROLES)
      .filter(([, role]) => match(role))
      .map(([tag]) => tag),
  );
}

export const DROPPED_TAGS = tagsWhere((role) => role.flow === "drop");

/** Every set below is a view of `TAG_ROLES`, so a new container tag is one edit. */
const BLOCK_TAGS = tagsWhere((role) => role.flow === "block");
export const LIST_TAGS = tagsWhere((role) => role.flow === "block" && role.block === "list");
export const TABLE_TAGS = tagsWhere((role) => role.flow === "block" && role.block === "table");
const part = (name: string) => (role: TagRole): boolean =>
  role.flow === "structure" && role.part === name;
export const ITEM_TAGS = tagsWhere(part("item"));
export const ROW_TAGS = tagsWhere(part("row"));
export const CELL_TAGS = tagsWhere(part("cell"));
export const HEAD_TAGS = tagsWhere(part("head"));
export const SECTION_TAGS: ReadonlySet<string> = new Set([...HEAD_TAGS, ...tagsWhere(part("section"))]);
export const ITEM_AND_LIST_TAGS: ReadonlySet<string> = new Set([...ITEM_TAGS, ...LIST_TAGS]);
export const TABLE_SECTIONS: ReadonlySet<string> = new Set([...SECTION_TAGS, ...ROW_TAGS]);

/**
 * Dropped elements whose content is raw text, so a `<script>` inside a JS string
 * is not a real open tag. A view of the table like every other set here: a drop
 * tag added without the `raw` flag gets depth counting, which is the reading
 * that cannot end an element early.
 */
export const RAW_TEXT_TAGS = tagsWhere((role) => role.flow === "drop" && role.raw === true);

export const VOID_TAGS: ReadonlySet<string> = new Set([
  "area",
  "base",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "link",
  "meta",
  "param",
  "source",
  "track",
  "wbr",
]);

/**
 * Start tags that imply the end of an already-open element. Real bodies are
 * full of `<p>a<p>b` and `<li>a<li>b`, and without this they nest instead of
 * becoming siblings. The `p` row is derived from the table: any block-level
 * start tag closes an open paragraph.
 */
const ROW_CLOSERS: ReadonlySet<string> = new Set([...ROW_TAGS, ...SECTION_TAGS]);
const CELL_CLOSERS: ReadonlySet<string> = new Set([...CELL_TAGS, ...ROW_CLOSERS]);

export const CLOSED_BY: Readonly<Record<string, ReadonlySet<string>>> = lookup<ReadonlySet<string>>({
  // Any block-level start tag, or any table part, closes an open paragraph.
  p: new Set([...BLOCK_TAGS, ...ITEM_TAGS, ...CELL_CLOSERS]),
  // A part is closed by the next part at its level or above.
  ...Object.fromEntries([...ITEM_TAGS].map((tag) => [tag, ITEM_TAGS])),
  ...Object.fromEntries([...CELL_TAGS].map((tag) => [tag, CELL_CLOSERS])),
  ...Object.fromEntries([...ROW_TAGS].map((tag) => [tag, ROW_CLOSERS])),
  ...Object.fromEntries(
    [...SECTION_TAGS].map((tag) => [
      tag,
      new Set([...SECTION_TAGS].filter((other) => other !== tag)),
    ]),
  ),
});
