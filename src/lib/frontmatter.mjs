/**
 * Reading the frontmatter block at the top of a post file.
 *
 * This is the ONE statement of how frontmatter is read. `src/lib/blog.ts`
 * re-exports it and `scripts/check-config.mjs` imports it, so the prebuild
 * gate sees exactly the values the site will render. It is plain ESM for that
 * reason: the gate runs before the TypeScript build, and a mirrored parser
 * would drift from the real one, which is the worst kind of gate — one that
 * passes what the site then reads differently.
 *
 * It is not a YAML parser and does not try to be. It reads the scalar keys
 * this site uses and ignores everything else, because the pipeline's
 * frontmatter projection is per-customer and emits keys no site reads.
 */

/**
 * A line that is shaped like a mapping key: optional indentation, a bare key,
 * then a colon.
 *
 * Stated positively on purpose. Live pipelines emit nested blocks (`faq:` with
 * indented `- question:` children), and a reader that enumerated the line
 * shapes to SKIP would treat every shape nobody thought of as a key. That is
 * the fail-open direction on identity: an `id:` inside a nested block would
 * become the post's own id, giving it an identity that belongs to something
 * else. Matching what a key IS rejects list items, comments, `---`,
 * block-scalar continuations and stray prose by construction.
 *
 * Indentation is captured, not banned. Which of these lines are ROOT keys is a
 * separate question, answered by `rootIndent` below, because "root" is not the
 * same as "column zero": a whole document may be written indented.
 */
const KEY_LINE = /^([ \t]*)([A-Za-z0-9_][A-Za-z0-9_.-]*)[ \t]*:(.*)$/;

/**
 * The indentation shared by the document's root keys.
 *
 * A root key is not "a key at column zero", it is a key at the SHALLOWEST
 * depth the document uses. Nesting is relative: `faq:` and its `answer:` child
 * differ by indentation, and that relationship holds whether the document
 * starts at column zero or is uniformly indented. Taking the minimum keeps a
 * legacy post whose whole frontmatter is indented, which the previous reader
 * accepted by trimming the key, while still rejecting anything indented
 * relative to it. A post that stops parsing does not error, it disappears from
 * the index, the routes, the sitemap and llms.txt, so widening this back is a
 * deliberate compatibility choice.
 */
function rootIndent(lines) {
  let indent = null;
  for (const line of lines) {
    const match = KEY_LINE.exec(line);
    if (!match) continue;
    if (indent === null || match[1].length < indent) indent = match[1].length;
  }
  return indent;
}

/**
 * A YAML block-scalar header: `>` or `|`, then an optional indentation
 * indicator and an optional chomping indicator in either order, then an
 * optional comment.
 *
 * The value of such a key is on the following lines, which are indented and so
 * are not key lines. Reading the header itself as the value is how
 * `description: >` became the literal string ">", which then shipped as
 * `<meta name="description" content="&gt;">` and rendered a bare `>` where the
 * date belonged. Derived from the indicator grammar rather than listing
 * spellings, so `>-`, `|+`, `|2` and `>2-` are all covered.
 */
const BLOCK_SCALAR_HEADER = /^[|>](?:[1-9][-+]?|[-+][1-9]?)?(?:[ \t]+#.*)?$/;

/**
 * @typedef {Record<string, string | boolean>} Frontmatter
 */

/**
 * The frontmatter block is read line by line with regexes, and a JS `.` does
 * not cross a "\r" while `$` only matches the very end of the string, so on a
 * CRLF-authored file every key looked like no key at all: the post lost its
 * title and disappeared from the index, the routes, the sitemap and llms.txt.
 * The reader this replaced used indexOf and was immune, so stripping it back
 * off is compatibility rather than preference. Only the frontmatter is
 * touched; the body is passed through exactly as written.
 *
 * @param {string} line
 * @returns {string}
 */
function stripCarriageReturn(line) {
  return line.endsWith("\r") ? line.slice(0, -1) : line;
}

/**
 * @param {string} raw
 * @returns {string | boolean}
 */
export function parseScalar(raw) {
  const value = raw.trim();
  if (value === "true") return true;
  if (value === "false") return false;
  // A block scalar's content lives on the following lines, so from this line
  // alone the value is empty. Empty, not the marker: every consumer already
  // handles a missing value, and none of them handle a stray ">".
  if (BLOCK_SCALAR_HEADER.test(value)) return "";
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

/**
 * Splits a post file into its frontmatter values and its body.
 *
 * @param {string} source
 * @returns {{ data: Frontmatter, body: string }}
 */
export function parseFrontmatter(source) {
  // A byte-order mark before the opening fence would otherwise mean no
  // frontmatter at all, so the post would lose its title and disappear from
  // the site rather than fail loudly. Editors add one without being asked.
  const raw = source.charCodeAt(0) === 0xfeff ? source.slice(1) : source;
  if (!raw.startsWith("---")) {
    return { data: {}, body: raw.trim() };
  }
  const end = raw.indexOf("\n---", 3);
  if (end === -1) {
    return { data: {}, body: raw.trim() };
  }
  const block = raw.slice(4, end);
  const body = raw.slice(end + 4).replace(/^\s+/, "");
  // See stripCarriageReturn: a CRLF file would otherwise parse as no keys.
  const lines = block.split("\n").map(stripCarriageReturn);
  const root = rootIndent(lines);
  /** @type {Frontmatter} */
  const data = {};
  for (const line of lines) {
    const match = KEY_LINE.exec(line);
    if (!match || match[1].length !== root) continue;
    data[match[2]] = parseScalar(match[3]);
  }
  return { data, body: body.trim() };
}
