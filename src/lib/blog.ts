import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseFrontmatter } from "./frontmatter.mjs";
import {
  isPostFile,
  listPostFilenames,
  postId,
  servablePost,
} from "./post-file.mjs";

// Re-exported so a caller reaching for either rule finds it on the loader,
// while the rule itself stays stated once in a module the prebuild scripts can
// import. They run before the TypeScript build, so they cannot import this.
export { isPostFile, parseFrontmatter };

/**
 * Directory MEGA git-as-CMS publishes into.
 *
 * This value must equal the customer's `github_markdown_config.contentDir`.
 * `contentDir` is per-customer configuration, not a constant, so the two can
 * disagree silently: the publisher keeps committing and squash-merging
 * successfully, the files land in a directory nothing reads, the index stays
 * empty and every published post 404s. Change one side and you must change the
 * other.
 */
export const BLOG_CONTENT_DIR = "content/blog";

export interface BlogPost {
  /**
   * Stable identity, minted once when the file is created and never
   * recomputed. It is what a CMS edit attaches to, which is why it cannot be
   * derived from the filename or from array position.
   *
   * Nullable on purpose, and this direction is deliberate: hundreds of posts
   * are already committed on live customer sites without an id, so treating a
   * missing or malformed id as fatal would empty those blogs. A post that is
   * not yet CMS-editable is a much smaller failure than a customer's blog
   * going blank. Pre-live QA grades a missing id red from the repo, which is
   * where that failure belongs loud. Do not tighten this into a hard
   * requirement here.
   */
  id: string | null;
  slug: string;
  title: string;
  description: string;
  date: string | null;
  image: string | null;
  imageAlt: string | null;
  author: string | null;
  body: string;
}

type Frontmatter = Record<string, string | boolean>;

function blogRoot(): string {
  return join(process.cwd(), BLOG_CONTENT_DIR);
}

function pickString(data: Frontmatter, keys: readonly string[]): string | null {
  for (const key of keys) {
    const value = data[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

/**
 * Reads the id already in the file. It never mints one.
 *
 * Minting belongs to whatever creates the file (the publisher, or the go-live
 * migrator). A loader that minted would hand out a fresh id on every build,
 * which is the exact opposite of stable, and every CMS edit made against the
 * previous build would be orphaned.
 *
 * The rule itself lives in `post-file.mjs`, because the prebuild gate compares
 * ids too and has to read them exactly this way.
 */
function parsePostId(data: Frontmatter): string | null {
  return postId(data) || null;
}

/** ISO-8601: a calendar day, optionally a time, optionally an offset. */
const ISO_DATE =
  /^(\d{4}-\d{2}-\d{2})(?:[T ](\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?)(Z|[+-]\d{2}:\d{2})?)?$/;

/**
 * The post's publish date, or null when there is not a usable one.
 *
 * `date` is free text out of frontmatter: 61 of 253 live posts have none at
 * all, and nothing stops one saying "sometime last spring". Every consumer
 * that turns it into machine-readable output — `<lastmod>` in the sitemap, the
 * Article schema's `datePublished`, a `<time dateTime>` attribute — asks this
 * rather than trusting the string, because a date a crawler cannot parse is
 * worse than no date at all.
 *
 * Only ISO-8601 is accepted, and `new Date` is never handed the raw string.
 * Its parsing of anything else is implementation-defined, and for the shapes
 * it does accept it reads them as LOCAL time: "March 4, 2026" becomes local
 * midnight, and `.toISOString()` on any build host ahead of UTC then publishes
 * March 3rd. The same file would date itself differently depending on where it
 * was built. A date-only value is a calendar day, so it is pinned to UTC
 * midnight, and a time with no offset is read as UTC for the same reason.
 *
 * Returning null, not throwing: an unusable date costs the post its machine-
 * readable date, never its page, and the page still shows the text as written.
 */
export function publishedDate(post: BlogPost): Date | null {
  if (!post.date) return null;
  const match = ISO_DATE.exec(post.date.trim());
  if (!match) return null;
  const [, day, time, offset] = match;
  // The day is checked by arithmetic, not by asking `new Date` whether it
  // parsed: given a time component it rolls 2026-02-30 forward to March 2nd
  // rather than reporting NaN, so a date that never existed would publish
  // itself as a different, real one.
  const [year, month, date] = day.split("-").map(Number);
  const probe = new Date(Date.UTC(year, month - 1, date));
  if (
    probe.getUTCFullYear() !== year ||
    probe.getUTCMonth() !== month - 1 ||
    probe.getUTCDate() !== date
  ) {
    return null;
  }
  if (!time) return probe;
  const parsed = new Date(`${day}T${time}${offset ?? "Z"}`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function toPost(filename: string, raw: string): BlogPost | null {
  const { data, body } = parseFrontmatter(raw);
  // Eligibility is asked once, of the shared rule, so the prebuild gate judges
  // exactly the posts this loader serves.
  const served = servablePost(filename, data);
  if (served === null) return null;
  return {
    id: parsePostId(data),
    slug: served.slug,
    title: served.title,
    description:
      pickString(data, ["description", "excerpt", "summary"]) ?? "",
    date: pickString(data, ["date", "publishedAt", "publishDate"]),
    image: pickString(data, ["image", "heroImage", "featuredImage"]),
    imageAlt: pickString(data, [
      "imageAlt",
      "heroImageAlt",
      "featuredImageAlt",
    ]),
    author: pickString(data, ["author"]),
    body,
  };
}

function readPostFiles(): BlogPost[] {
  return listPostFilenames(blogRoot())
    .map((name) => {
      // `isReadablePost` checked this entry, but it checked it earlier: a file
      // can lose its permissions or its symlink target in between. Reading is
      // the last place that race can surface, and an unreadable post must cost
      // one post rather than the whole build, so it is dropped here — loudly,
      // because a post that vanishes with no signal anywhere is the failure
      // this module works hardest to avoid.
      let raw: string;
      try {
        raw = readFileSync(join(blogRoot(), name), "utf8");
      } catch (error) {
        console.warn(
          `[blog] skipping ${BLOG_CONTENT_DIR}/${name}: ${(error as Error).message}`,
        );
        return null;
      }
      return toPost(name, raw);
    })
    .filter((post): post is BlogPost => post !== null);
}

/**
 * One scan per build, instead of one per caller.
 *
 * `generateStaticParams`, `generateMetadata`, the page body, the index,
 * sitemap.xml and llms.txt each ask for the list, and the per-post calls ask
 * once per post — so an N-post site did on the order of N² file reads, worst
 * on exactly the sites with the most posts. The cache is keyed on the content
 * root so a test that moves `cwd` gets its own, and it is only enabled for a
 * production build: in `next dev` the files are edited while the server runs,
 * and serving a stale post would be its own bug.
 */
const cacheEnabled = process.env.NODE_ENV === "production";
let cachedPosts: { root: string; posts: BlogPost[] } | null = null;

function allPosts(): BlogPost[] {
  const root = blogRoot();
  if (cacheEnabled && cachedPosts?.root === root) return cachedPosts.posts;
  const posts = readPostFiles();
  cachedPosts = { root, posts };
  return posts;
}

export function listPublishedPosts(): BlogPost[] {
  // Ordered by the INSTANT each date denotes, not by its text. The parser
  // accepts offset datetimes, and those do not sort chronologically as
  // strings: "2026-03-15T09:30:00+02:00" is 07:30Z, older than
  // "2026-03-15T08:00:00Z", yet it sorts after it character by character. That
  // put the index in the wrong order and, since getPublishedPost takes the
  // first match, could serve the older of two posts sharing a slug.
  //
  // Parsed once per post rather than inside the comparator, and mapped into a
  // new array so sorting cannot reorder the memoized list in place.
  return allPosts()
    .map((post) => ({ post, at: publishedDate(post)?.getTime() ?? null }))
    .sort((left, right) => {
      // A post whose date is missing OR unusable sorts last: an undated post
      // and one dated "sometime last spring" are equally unplaceable in time.
      if (left.at === null || right.at === null) {
        if (left.at !== null) return -1;
        if (right.at !== null) return 1;
      } else if (left.at !== right.at) {
        return right.at - left.at;
      }
      // Title breaks ties, so the order does not depend on readdir order.
      return left.post.title.localeCompare(right.post.title);
    })
    .map((entry) => entry.post);
}

export function getPublishedPost(slug: string): BlogPost | null {
  return listPublishedPosts().find((post) => post.slug === slug) ?? null;
}
