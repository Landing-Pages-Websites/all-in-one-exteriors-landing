import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import {
  ALWAYS_PASS_SITE_KEYS,
  servedFilesContaining,
} from "./client-bundle-sentinel.mjs";

const SENTINEL = (
  await readFile(new URL("../src/lib/captcha/provider.ts", import.meta.url), "utf8")
).match(/STAGING_BYPASS_SITE_KEY = "([^"]+)"/u)[1];

async function buildOutput(files) {
  const root = await mkdtemp(join(tmpdir(), "bundle-sentinel-"));
  for (const [path, body] of Object.entries(files)) {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), body);
  }
  return root;
}

test("the scanned keys include the sentinel provider.ts actually declares", () => {
  assert.ok(ALWAYS_PASS_SITE_KEYS.includes(SENTINEL));
});

// [name, file path under .next, body, reported?]
//
// Reported means the go-live sweep would see it: it scans a page's HTML and
// every script the page loads, and fails production on any CONTAINED key.
const ROWS = [
  ["comparison literal in a client chunk", ".next/static/chunks/a1.js", `x===${JSON.stringify(SENTINEL)}`, true],
  ["literal inside a longer string", ".next/static/chunks/a2.js", `"prefix-${SENTINEL}-suffix"`, true],
  ["nested static directory", ".next/static/abc123/pages/b.js", SENTINEL, true],
  ["prerendered HTML", ".next/server/app/index.html", `<script>${SENTINEL}</script>`, true],
  ["prerendered RSC payload", ".next/server/app/contact.rsc", `1:${SENTINEL}`, true],
  ["prerendered body of a route handler", ".next/server/app/robots.txt.body", SENTINEL, true],
  ["Turnstile always-pass key", ".next/static/chunks/c.js", "1x00000000000000000000AA", true],
  ["server-only chunk is never served", ".next/server/chunks/ssr/d.js", SENTINEL, false],
  ["server route bundle is never served", ".next/server/app/api/lead/route.js", SENTINEL, false],
  ["prerendered 404 page (pages router)", ".next/server/pages/404.html", SENTINEL, true],
  ["file served from public/", "public/widget.js", SENTINEL, true],
  ["nested public asset", "public/embed/v1/loader.html", SENTINEL, true],
  ["pages-router server bundle is never served", ".next/server/pages/api/x.js", SENTINEL, false],
  ["build cache is never served", ".next/cache/e.js", SENTINEL, false],
  ["near miss: truncated sentinel", ".next/static/chunks/f.js", SENTINEL.slice(0, -1), false],
  ["near miss: sentinel split across concatenation", ".next/static/chunks/g.js",
    `"${SENTINEL.slice(0, 9)}"+"${SENTINEL.slice(9)}"`, false],
  ["a real reCAPTCHA key", ".next/static/chunks/h.js", `"6L${"x".repeat(38)}"`, false],
  ["the bypass TOKEN is not a site key", ".next/static/chunks/i.js", '"staging-bypass"', false],
];

for (const [name, path, body, reported] of ROWS) {
  test(`${name} -> ${reported ? "reported" : "clean"}`, async () => {
    // A clean served file beside it, so an unserved row is judged "clean"
    // rather than tripping the nothing-was-served error.
    const root = await buildOutput({ ".next/static/chunks/baseline.js": "clean", [path]: body });
    try {
      const found = await servedFilesContaining(root);
      assert.deepEqual(
        found.map((hit) => hit.file),
        reported ? [path] : [],
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
}

test("every leaking file is reported, each with the key it carries", async () => {
  const root = await buildOutput({
    ".next/static/chunks/one.js": SENTINEL,
    ".next/static/chunks/two.js": "3x00000000000000000000FF",
    ".next/server/app/page.html": SENTINEL,
    ".next/static/chunks/clean.js": "nothing here",
  });
  try {
    assert.deepEqual(await servedFilesContaining(root), [
      { file: ".next/server/app/page.html", key: SENTINEL },
      { file: ".next/static/chunks/one.js", key: SENTINEL },
      { file: ".next/static/chunks/two.js", key: "3x00000000000000000000FF" },
    ]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

// Nothing scanned is not a clean scan. Client chunks are what the sweep reads
// first, so a build whose static/ is missing or empty never checked them, even
// when prerendered HTML is present.
const UNSCANNED = [
  ["no build at all", { "public/robots.txt": "clean" }],
  ["server output only", { ".next/server/chunks/x.js": "" }],
  ["HTML but no client chunks", { ".next/server/app/index.html": "clean" }],
  ["static/ without chunks", { ".next/static/media/font.woff2": "clean" }],
];

for (const [name, files] of UNSCANNED) {
  test(`${name} is an error, not a pass`, async () => {
    const root = await buildOutput(files);
    try {
      await assert.rejects(servedFilesContaining(root), /no client chunks/u);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
}
