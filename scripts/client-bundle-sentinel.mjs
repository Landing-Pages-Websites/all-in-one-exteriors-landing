#!/usr/bin/env node
/**
 * Fails when a built site would serve an always-pass captcha site key.
 *
 * The go-live sweep (`form.lead-captcha`) fails a PRODUCTION run when the page
 * or any script it loads CONTAINS one of these keys, because a production
 * bundle carrying one is presumed to be using it. So the key must never reach
 * served output, not even as a comparison literal the browser never takes:
 * `ln-associates-website` served a real `6L…` key and still failed five routes
 * because the widget shipped `isStagingBypassSiteKey`.
 *
 * Run after `next build`. Read-only; exits 1 naming every leaking file.
 */
import { readFileSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Read from provider.ts rather than restated, so renaming the sentinel there
 * cannot leave this scanning for a value nothing uses any more.
 */
const SENTINEL = (() => {
  const source = readFileSync(new URL("../src/lib/captcha/provider.ts", import.meta.url), "utf8");
  const match = source.match(/STAGING_BYPASS_SITE_KEY = "([^"]+)"/u);
  if (match === null) {
    throw new Error("provider.ts no longer declares STAGING_BYPASS_SITE_KEY as a string literal");
  }
  return match[1];
})();

/** The sweep's `_PLACEHOLDER_SITE_KEYS`: Cloudflare's published test keys, then ours. */
export const ALWAYS_PASS_SITE_KEYS = Object.freeze([
  "1x00000000000000000000AA",
  "2x00000000000000000000AB",
  "3x00000000000000000000FF",
  SENTINEL,
]);

/**
 * What a browser can fetch, relative to the project root: every static asset,
 * the prerendered HTML, RSC payloads and route-handler bodies Next serves as-is
 * (app and pages router), and `public/`. `server/chunks` and the route bundles
 * run on the server and are never sent, and `cache/` is never walked at all.
 */
const HTML_LIKE = /\.(?:html|rsc|body)$/u;
const SERVED_ROOTS = [
  { root: join(".next", "static"), served: () => true },
  { root: join(".next", "server", "app"), served: (path) => HTML_LIKE.test(path) },
  { root: join(".next", "server", "pages"), served: (path) => HTML_LIKE.test(path) },
  { root: "public", served: () => true },
];
const CLIENT_CHUNKS = join(".next", "static", "chunks") + sep;

async function filesUnder(projectRoot, root) {
  let entries;
  try {
    entries = await readdir(join(projectRoot, root), { recursive: true, withFileTypes: true });
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => relative(projectRoot, join(entry.parentPath, entry.name)));
}

async function servedFiles(projectRoot) {
  const lists = await Promise.all(
    SERVED_ROOTS.map(async ({ root, served }) => (await filesUnder(projectRoot, root)).filter(served)),
  );
  return lists.flat().sort();
}

/** Every served file of a built project that carries an always-pass key. */
export async function servedFilesContaining(projectRoot) {
  const served = await servedFiles(projectRoot);
  // Nothing scanned is not a clean scan. The client chunks are what the sweep
  // reads, so a wrong path, a failed build or an emptied static/ must not
  // report that no key leaked just because prerendered HTML is present.
  if (!served.some((file) => file.startsWith(CLIENT_CHUNKS))) {
    throw new Error(`no client chunks under ${join(projectRoot, CLIENT_CHUNKS)}; run next build first`);
  }
  const scanned = await Promise.all(
    served.map(async (file) => {
      const body = await readFile(join(projectRoot, file), "utf8");
      const key = ALWAYS_PASS_SITE_KEYS.find((candidate) => body.includes(candidate));
      return { file: file.split(sep).join("/"), key };
    }),
  );
  return scanned.filter((hit) => hit.key !== undefined);
}

async function main() {
  const projectRoot = process.argv[2] ?? fileURLToPath(new URL("..", import.meta.url));
  const hits = await servedFilesContaining(projectRoot);
  if (hits.length === 0) {
    console.log("client bundle: no always-pass captcha site key is served");
    return;
  }
  for (const { file, key } of hits) console.error(`${file}: serves ${key}`);
  console.error(
    "A production go-live sweep fails any page whose scripts contain these. " +
      "Keep the comparison server-side; the browser receives only NEXT_PUBLIC_CAPTCHA_ROUTE.",
  );
  process.exitCode = 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
