/**
 * The brand artwork this template ships, and the sweep that finds it still in
 * place on a site that should have replaced it.
 *
 * README step 3 tells you to replace all five, but nothing enforced it, so a
 * site could go live still serving them. It did: an audit of the 397 repos in
 * this org found 35 customer sites shipping the favicon below, which is the
 * Next/Vercel default triangle, and several were confirmed serving those exact
 * bytes in production.
 *
 * Its own module rather than inline in check-config.mjs so the test can import
 * these tables instead of parsing them back out of the script's source, which
 * breaks the moment the formatting changes.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const repositoryRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Keyed by digest, and matched against every candidate file rather than a fixed
 * list of paths, because the defect is "this artwork is still ours" and the file
 * it lives in is not fixed: managed images may point at any `public/` path and
 * siteConfig's logo/OG fields accept any public path, so `public/logo.png` can
 * be renamed to `public/brand.png` and referenced from there. A path-keyed check
 * passes that site while it serves the starter's logo.
 *
 * `logo.png` and `icon-512.png` ship byte-identical, so one digest covers both;
 * the label names the pair rather than pretending to know which was copied.
 *
 * If a placeholder is re-cut, update its digest here in the same commit, or the
 * gate silently stops recognising it. placeholder-assets.test.mjs fails then.
 */
export const PLACEHOLDER_ASSET_DIGESTS = new Map([
  [
    "2b8ad2d33455a8f736fc3a8ebf8f0bdea8848ad4c0db48a2833bd0f9cd775932",
    "the template's favicon (the Next/Vercel default triangle)",
  ],
  ["d9621ededf649b0b601cc7a4d35100a362c04fb1d1332437d4f2c3a088cdac75", "the template's icon-192.png"],
  [
    "5e58b0624d7929f62df00080310d6c929ff390d371eb20c219ba9fb52890a4a7",
    "the template's logo.png / icon-512.png",
  ],
  ["19f7bbba46be1131a8f9ae1079c223fd78da6968170276fd78d5e1f316b3897e", "the template's og-image.png"],
]);

/** The paths this template ships them at, for the test that keeps digests fresh. */
export const PLACEHOLDER_ASSET_PATHS = [
  "src/app/favicon.ico",
  "public/icon-192.png",
  "public/icon-512.png",
  "public/logo.png",
  "public/og-image.png",
];

/**
 * Byte sizes of the known placeholders.
 *
 * Identical content implies identical size, so this is an exact pre-filter, not
 * a heuristic: anything of another size cannot be a placeholder and never gets
 * hashed. It keeps the sweep cheap on sites whose `public/` holds real
 * photography.
 *
 * Written out rather than measured from PLACEHOLDER_ASSET_PATHS at load. Those
 * files are exactly the ones a site is supposed to replace or remove, so
 * measuring them means deleting `og-image.png` drops 3633 from this set and a
 * copy of it saved elsewhere stops being hashed at all. The constants are held
 * to the shipped files by placeholder-assets.test.mjs.
 */
export const PLACEHOLDER_ASSET_SIZES = new Set([25931, 547, 1881, 3633]);

/** Directories a placeholder can plausibly be served from. */
const ASSET_SEARCH_ROOTS = ["public", "src/app"];

/** sha256 of a file, or null when it is absent or unreadable. */
function fileDigest(absolutePath) {
  try {
    return createHash("sha256").update(readFileSync(absolutePath)).digest("hex");
  } catch {
    return null;
  }
}

/** Every file under `relativeRoot`, depth-first. */
function walkFiles(relativeRoot) {
  const absoluteRoot = join(repositoryRoot, relativeRoot);
  if (!existsSync(absoluteRoot)) return [];
  const found = [];
  for (const entry of readdirSync(absoluteRoot, { withFileTypes: true })) {
    const childRelative = `${relativeRoot}/${entry.name}`;
    if (entry.isDirectory()) found.push(...walkFiles(childRelative));
    else if (entry.isFile()) found.push(childRelative);
  }
  return found;
}

/**
 * Any file still byte-identical to artwork this template ships, wherever it now
 * lives and whatever it is now called.
 *
 * A missing asset is deliberately not reported: a missing import already fails
 * the build, and unreferenced files under `public/` are the site's own business.
 * What this catches is the file that is present, looks fine in a directory
 * listing, and is still ours.
 */
export function collectPlaceholderAssetProblems() {
  const problems = [];
  for (const relativeRoot of ASSET_SEARCH_ROOTS) {
    for (const relativePath of walkFiles(relativeRoot)) {
      const absolutePath = join(repositoryRoot, relativePath);
      let size;
      try {
        size = statSync(absolutePath).size;
      } catch {
        continue;
      }
      if (!PLACEHOLDER_ASSET_SIZES.has(size)) continue;

      const what = PLACEHOLDER_ASSET_DIGESTS.get(fileDigest(absolutePath));
      if (what) {
        problems.push(`${relativePath}: still ${what} — replace it with this site's own artwork`);
      }
    }
  }
  return problems.sort();
}
