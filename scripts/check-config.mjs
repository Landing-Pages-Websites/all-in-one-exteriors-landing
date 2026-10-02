#!/usr/bin/env node
/**
 * Verifies operational config and authored managed content before a production build.
 *
 * - Fails (exit 1) if any `TODO_` sentinel or empty required value remains.
 * - `ALLOW_TODO=1 npm run build` downgrades failures to warnings — useful
 *   for CI builds of the template itself and early previews.
 *
 * Runs automatically via the `prebuild` npm script.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
// The one statement of which files are posts, shared with src/lib/blog.ts.
// Counting README.md or a _draft.md as a post would let a site with no real
// content pass this gate and ship an empty blog.
import {
  listPostFilenames,
  postId,
  servablePost,
} from "../src/lib/post-file.mjs";
// The one statement of how frontmatter is read, shared with src/lib/blog.ts,
// so this gate sees exactly the values the site will render.
import { parseFrontmatter } from "../src/lib/frontmatter.mjs";
import { collectFormIdentityProblems } from "./form-identity.mjs";

import { collectPlaceholderAssetProblems } from "./placeholder-assets.mjs";

const repositoryRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

function jsonFiles(relativeDirectory) {
  const directory = join(repositoryRoot, relativeDirectory);
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const relativePath = join(relativeDirectory, entry.name);
    if (entry.isDirectory()) return jsonFiles(relativePath);
    return entry.isFile() && entry.name.endsWith(".json") ? [relativePath] : [];
  });
}

const configFiles = ["src/site.config.ts", ...jsonFiles("src/content").sort()];

function collectProblems(source, relativePath) {
  const problems = [];
  const lines = source.split("\n");

  lines.forEach((line, index) => {
    // Skip pure comment lines so docs may mention the sentinel convention.
    if (/^\s*(\/\/|\*|\/\*)/.test(line)) {
      return;
    }
    const todoMatch = line.match(/TODO_[A-Z0-9_]+/);
    if (todoMatch) {
      problems.push(
        `${relativePath}:${index + 1}: sentinel ${todoMatch[0]} still present -> ${line.trim()}`,
      );
    }
    const emptyMatch = line.match(/^\s*"?([A-Za-z0-9_]+)"?\s*:\s*(""|'')/);
    if (emptyMatch) {
      problems.push(
        `${relativePath}:${index + 1}: required field "${emptyMatch[1]}" is empty`,
      );
    }
  });

  return problems;
}

function readConfig(relativePath) {
  const path = join(repositoryRoot, relativePath);
  try {
    return readFileSync(path, "utf8");
  } catch (error) {
    console.error(`check-config: cannot read ${path}: ${error.message}`);
    process.exit(1);
  }
}

/**
 * The id shipped in the starter's own `content/blog/welcome.md`.
 *
 * It is a placeholder in the same sense as a `TODO_` sentinel: every clone of
 * this template starts out carrying it, and provisioning re-mints it so two
 * customer sites never share one identity. Reported through the sentinel path
 * rather than as a blog-contract failure, so `ALLOW_TODO=1` downgrades it to a
 * warning exactly as it does for every other unreplaced placeholder. That
 * keeps this template green in its own CI, which sets `ALLOW_TODO=1`, while a
 * real site's build fails until the id is re-minted.
 */
const STARTER_SEED_POST_ID = "item_wadhs7hh3d4012vwfq8k7n7pxg";

/**
 * Reads a post's declared id and the slug it will actually be served at.
 *
 * Both the entry enumeration and the slug rule come from the module the
 * runtime loader uses, so this gate cannot judge a post differently from the
 * site that renders it. A read that fails anyway is reported, never thrown: an
 * unreadable post is a problem to name, not a stack trace that aborts the
 * build before the other problems are collected.
 */
function postIdentity(postsDirectory, filename) {
  let raw;
  try {
    raw = readFileSync(join(postsDirectory, filename), "utf8");
  } catch (error) {
    return { filename, unreadable: error.message };
  }
  const { data } = parseFrontmatter(raw);
  // Eligibility comes from the shared rule, never from a second reading of the
  // frontmatter here: this gate exists to judge the posts the site serves, and
  // a file the loader drops is not one of them in either direction — it cannot
  // satisfy "at least one post", and it cannot collide with one that is.
  const served = servablePost(filename, data);
  return {
    filename,
    served,
    id: postId(data),
    slug: served === null ? "" : served.slug,
  };
}

/** Every readable post in the directory, plus a problem per unreadable one. */
function readIdentities(postsDirectory) {
  const identities = listPostFilenames(postsDirectory).map((name) =>
    postIdentity(postsDirectory, name),
  );
  return {
    // Anything the loader will not serve is excluded — a draft, and a file
    // with no usable title or slug — so this gate can never fail a build over
    // a post nobody can reach, nor pass one whose blog is empty.
    identities: identities.filter(
      (post) => !post.unreadable && post.served !== null,
    ),
    problems: identities
      .filter((post) => post.unreadable)
      .map(
        (post) =>
          `content/blog/${post.filename}: cannot be read — ${post.unreadable}`,
      ),
  };
}

function groupBy(items, key) {
  const groups = new Map();
  for (const item of items) {
    if (!item[key]) continue;
    groups.set(item[key], [...(groups.get(item[key]) ?? []), item.filename]);
  }
  return groups;
}

/**
 * Two posts must never share an id or a slug.
 *
 * The loader deliberately does not enforce this: it lists both and lets the
 * site render, because dropping one silently is how a post goes missing. So
 * the detection lives here, at build time, where a builder sees it and the
 * live site is never the thing that reports it. Duplicating a post file is the
 * obvious way to write a new one, and it yields two posts with one identity,
 * which is as bad as a malformed id given the id IS the identity. A duplicate
 * slug is just as bad in a different way: both posts appear in sitemap.xml and
 * llms.txt, and only the first is reachable.
 */
function collectDuplicateIdentityProblems(postsDirectory) {
  const { identities, problems } = readIdentities(postsDirectory);
  for (const [field, hint] of [
    [
      "id",
      "one identity for two posts means a CMS edit lands on the wrong one; re-mint one of them",
    ],
    [
      "slug",
      "both appear in sitemap.xml and llms.txt, and only the first is reachable",
    ],
  ]) {
    for (const [value, filenames] of groupBy(identities, field)) {
      if (filenames.length < 2) continue;
      problems.push(
        `content/blog: ${filenames.join(", ")} share ${field} "${value}" — ${hint}`,
      );
    }
  }
  return problems;
}

/**
 * Placeholders a clone must replace that no `TODO_` sentinel covers.
 *
 * `configFiles` scans src/site.config.ts and src/content/**, and never
 * content/blog, so a post's frontmatter is outside the sentinel sweep
 * entirely. The seed id is the one per-site-unique literal that lives there.
 */
function collectPlaceholderProblems() {
  const postsDirectory = join(repositoryRoot, "content/blog");
  if (!existsSync(postsDirectory)) return [];
  return readIdentities(postsDirectory)
    .identities.filter((post) => post.id === STARTER_SEED_POST_ID)
    .map(
      (post) =>
        `content/blog/${post.filename}: still carries the starter template's seed post id ` +
        `${STARTER_SEED_POST_ID} — re-mint it so this site's posts are not identified as another site's`,
    );
}

function collectBlogContractProblems() {
  const requiredFiles = [
    "src/app/blog/page.tsx",
    "src/app/blog/[slug]/page.tsx",
    "src/lib/blog.ts",
  ];
  const problems = requiredFiles
    .filter((relativePath) => !existsSync(join(repositoryRoot, relativePath)))
    .map(
      (relativePath) =>
        `${relativePath}: missing — every site needs a blog index and post template`,
    );
  const routes = readConfig("src/lib/routes.ts");
  if (!/path:\s*"\/blog"/.test(routes)) {
    problems.push(
      'src/lib/routes.ts: missing { path: "/blog" } — sitemap and 404 key pages will hide the blog',
    );
  }
  const postsDirectory = join(repositoryRoot, "content/blog");
  if (!existsSync(postsDirectory)) {
    problems.push(
      "content/blog: directory missing — MEGA git-as-CMS publishes markdown here",
    );
    return problems;
  }
  const posts = readIdentities(postsDirectory).identities;
  if (posts.length === 0) {
    problems.push(
      "content/blog: no markdown posts — add at least one so /blog/<slug> proves the post template",
    );
  }
  problems.push(...collectDuplicateIdentityProblems(postsDirectory));
  if (!existsSync(join(repositoryRoot, "src/lib/blog-images.ts"))) {
    problems.push(
      "src/lib/blog-images.ts: missing — MEGA writes article images as S3 URLs that next/image must allow",
    );
  } else if (
    !/zleague-public-prod\.s3\.us-east-2\.amazonaws\.com/.test(
      readConfig("src/lib/blog-images.ts"),
    )
  ) {
    problems.push(
      "src/lib/blog-images.ts: missing MEGA article image host zleague-public-prod.s3.us-east-2.amazonaws.com",
    );
  }
  const nextConfig = readConfig("next.config.ts");
  if (!/megaArticleImageRemotePatterns/.test(nextConfig)) {
    problems.push(
      "next.config.ts: images.remotePatterns must use megaArticleImageRemotePatterns so MEGA S3 article images load",
    );
  }
  return problems;
}

const todoProblems = [
  ...configFiles.flatMap((relativePath) =>
    collectProblems(readConfig(relativePath), relativePath),
  ),
  ...collectPlaceholderProblems(),
  ...collectPlaceholderAssetProblems(),
];
const blogProblems = collectBlogContractProblems();
// Form identity blocks even a preview build: ALLOW_TODO exists so a clone with
// unfilled copy can be previewed, and two forms sharing a key is a wiring fault
// rather than unfilled copy.
const formIdentityProblems = await collectFormIdentityProblems(repositoryRoot);
const problems = [...todoProblems, ...blogProblems, ...formIdentityProblems];

if (problems.length === 0) {
  console.log(
    "check-config: operational config, managed content, and blog contract look complete.",
  );
  process.exit(0);
}

const allowTodo = process.env.ALLOW_TODO === "1";
const blocking = allowTodo
  ? [...blogProblems, ...formIdentityProblems]
  : problems;
const label =
  allowTodo && todoProblems.length > 0 && blocking.length === 0
    ? "WARNING"
    : "ERROR";

console[label === "WARNING" ? "warn" : "error"](
  `check-config ${label}: site configuration is not filled in:\n` +
    problems.map((p) => `  - ${p}`).join("\n"),
);

if (allowTodo && blocking.length === 0) {
  console.warn("check-config: continuing because ALLOW_TODO=1.");
  process.exit(0);
}

if (blogProblems.length > 0) {
  console.error(
    "\nRestore the blog index, post template, and at least one markdown file under content/blog.",
  );
}

if (todoProblems.length > 0 && blocking === problems) {
  console.error(
    "\nFill in the listed files (or set ALLOW_TODO=1 for a preview build).",
  );
}
process.exit(1);
