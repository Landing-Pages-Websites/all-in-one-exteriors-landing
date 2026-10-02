import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * Which files in the blog content directory are posts.
 *
 * This is the ONE statement of the rule. `src/lib/blog.ts` re-exports it, and
 * `scripts/check-config.mjs` and `scripts/blog-contract.test.mjs` import it
 * directly. It is plain ESM rather than TypeScript for exactly that reason:
 * the build scripts run before the TypeScript build, so a `.ts` original
 * would have to be mirrored, and a mirrored rule drifts.
 *
 * Extension alone is not enough. `README.md` is documentation, `_draft.md`
 * and other `_`-prefixed files are pipeline scratch, and dotfiles (`.gitkeep`,
 * `.DS_Store`) are repository plumbing. Counting any of them as a post lets a
 * site with no real content pass the prebuild blog check and ship an empty
 * blog, and would put a README on the site as an article.
 *
 * @param {string} filename
 * @returns {boolean}
 */
export function isPostFile(filename) {
  const lower = filename.toLowerCase();
  if (!lower.endsWith(".md") && !lower.endsWith(".mdx")) return false;
  if (filename.startsWith("_") || filename.startsWith(".")) return false;
  return lower !== "readme.md";
}

/**
 * Every file in a blog content directory that is a post AND can be read.
 *
 * The ONE enumeration of a content directory. Callers get filenames, so no
 * caller can decide for itself what an entry is, which is how the loader and
 * the prebuild gate came to disagree: the gate filtered on the name alone,
 * then read `content/blog/archive.md/` and died with EISDIR on a directory the
 * site itself ignores. A verifier that rejects what the loader accepts is
 * worse than no verifier, because it fails the build over nothing.
 *
 * `readFileSync` throws on anything that is not a regular file, so a
 * directory, a broken symlink, a symlink to a directory and a fifo are all
 * excluded here rather than discovered at read time. A symlink to a real file
 * is kept: dropping it would make a post silently vanish.
 *
 * Returns [] when the directory does not exist, so a missing content directory
 * is an empty blog rather than a thrown build.
 *
 * @param {string} directory
 * @returns {string[]}
 */
export function listPostFilenames(directory) {
  let entries;
  try {
    entries = readdirSync(directory, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter((entry) => {
      if (!isPostFile(entry.name)) return false;
      if (entry.isFile()) return true;
      if (!entry.isSymbolicLink()) return false;
      try {
        return statSync(join(directory, entry.name)).isFile();
      } catch {
        return false;
      }
    })
    .map((entry) => entry.name);
}

/**
 * Stable item id: `item_` + 26 Crockford base32 characters encoding 16 bytes.
 *
 * The final character carries only two padding bits, which are zero for any
 * 16-byte input, so its narrow class falls out of the encoding rather than
 * being a special case. Do not "fix" it.
 *
 * Uppercase is rejected rather than case-folded on purpose: two spellings of
 * one id are two identities, and a CMS edit has to attach to exactly one post.
 *
 * Stated here, beside the other rules the loader and the prebuild gate both
 * need, for the same reason as the rest of this module.
 */
const POST_ID_PATTERN = /^item_[0-9a-hjkmnp-tv-z]{25}[048cgmrw]$/;

/**
 * The id the site will attach to this post, or "" when it will attach none.
 *
 * A present-but-MALFORMED id reads as absent, because a mismatched identity
 * attaches a CMS edit to the wrong post — refusing to trust it is the
 * fail-closed direction for identity, while still rendering the post is the
 * fail-open direction for the site.
 *
 * The gate needs the same reading, not a second one. Comparing raw frontmatter
 * strings made two files carrying the same unminted sentinel "share an id"
 * that neither of them actually has, and failed the build over it.
 *
 * @param {Record<string, string | boolean>} data
 * @returns {string}
 */
export function postId(data) {
  const value = typeof data.id === "string" ? data.id.trim() : "";
  return POST_ID_PATTERN.test(value) ? value : "";
}

/**
 * The post the site will SERVE from this file, or null when it serves none.
 *
 * The one eligibility rule, for the same reason the enumeration above is one
 * function. The gate and the loader had already disagreed about which
 * directory entries are posts; they then disagreed about which of those files
 * become posts, because the loader drops a file with no title and the gate did
 * not. A blog holding only untitled files passed "at least one post" while
 * `/blog`, the sitemap, llms.txt and the generated params were empty, and an
 * untitled file could fail a build for colliding with a post it can never be
 * confused with.
 *
 * Everything a caller needs to identify a served post comes back together, so
 * there is no way to apply half the rule.
 *
 * @param {string} filename
 * @param {Record<string, string | boolean>} data
 * @returns {{ slug: string, title: string } | null}
 */
export function servablePost(filename, data) {
  if (isDraft(data)) return null;
  const slug = postSlug(filename, data);
  const title = typeof data.title === "string" ? data.title.trim() : "";
  if (!slug || !title) return null;
  return { slug, title };
}

/**
 * The slug a post is served at: its declared slug, else its filename.
 *
 * Shared for the same reason as the rest of this module. The loader and the
 * prebuild gate have to agree on what a post's URL is, or the gate's duplicate
 * detection compares different strings than the ones that actually collide.
 *
 * @param {string} filename
 * @param {Record<string, string | boolean>} data
 * @returns {string}
 */
export function postSlug(filename, data) {
  const declared = typeof data.slug === "string" ? data.slug.trim() : "";
  return declared || filename.replace(/\.mdx?$/i, "");
}

/**
 * A post marked `draft: true` never reaches the site.
 *
 * Shared because the prebuild gate has to judge the same set of posts the
 * loader serves. When only the loader knew about drafts, two drafts sharing a
 * slug failed the build over a collision the site could never have, and
 * drafting a replacement for a live post, same slug, same id, was impossible.
 *
 * The string form is accepted because a value is not typed until something
 * parses it, and `draft: "true"` is what a quoted frontmatter value gives.
 *
 * @param {Record<string, string | boolean>} data
 * @returns {boolean}
 */
export function isDraft(data) {
  return data.draft === true || data.draft === "true";
}
