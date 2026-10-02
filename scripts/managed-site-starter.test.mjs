import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

const BRIDGE_SOURCE = "https://app.gomega.ai/review-bridge/v10/review-bridge.js";
const BRIDGE_INTEGRITY =
  "sha384-/+5J7l1l8JNgnIgvgOqEHDgx92NrGmbjezpRb/MZb2y0RildsCcaOVu8+mLZbrmF";

function repositoryFile(path) {
  return new URL(`../${path}`, import.meta.url);
}

async function readSource(path) {
  return readFile(repositoryFile(path), "utf8");
}

async function readBinary(path) {
  return readFile(repositoryFile(path));
}

async function readJson(path) {
  return JSON.parse(await readSource(path));
}

function collectResolverPaths(value, paths = new Set()) {
  if (value === null || typeof value !== "object") return paths;
  if (!Array.isArray(value) && value.kind === "json_pointer") {
    paths.add(value.path);
  }
  for (const child of Object.values(value)) collectResolverPaths(child, paths);
  return paths;
}

test("defines the exact structured starter contract and source documents", async () => {
  const [contract, site, home, managedSource] = await Promise.all([
    readJson("src/content/managed-site.contract.json"),
    readJson("src/content/site.json"),
    readJson("src/content/pages/home.json"),
    readSource("src/content/managed-site.ts"),
  ]);

  assert.deepEqual(contract.adapter, { kind: "nextjs", adapterVersion: "1.0" });
  assert.deepEqual(contract.bridge, {
    reviewProtocol: 1,
    editProtocol: 2,
    annotationVersion: 1,
    delivery: {
      version: "v10",
      src: BRIDGE_SOURCE,
      integrity: BRIDGE_INTEGRITY,
      crossOrigin: "anonymous",
      load: "head_defer",
    },
    framing: "authenticated_preview_gateway",
  });
  assert.deepEqual([...collectResolverPaths(contract)].sort(), [
    "src/content/pages/home.json",
    "src/content/site.json",
  ]);
  assert.equal(contract.pages.some((page) => page.route?.path === "/"), true);
  assert.equal(Array.isArray(home.faq?.items), true);
  assert.equal(typeof home.hero?.image?.sha256, "string");
  assert.equal(typeof site.identity?.displayName, "string");
  assert.match(managedSource, /createManagedSiteNextV1/u);
  assert.match(managedSource, /managed-site\.contract\.json/u);
  assert.match(managedSource, /pages\/home\.json/u);
  assert.match(managedSource, /site\.json/u);
});

test("renders the managed home without code-owned copy", async () => {
  const [page, ...components] = await Promise.all([
    readSource("src/app/page.tsx"),
    readSource("src/components/home/ManagedHero.tsx"),
    readSource("src/components/home/ManagedFaq.tsx"),
    readSource("src/components/home/ManagedContact.tsx"),
  ]);
  const renderedSource = [page, ...components].join("\n");

  assert.match(page, /from "@\/content\/managed-site"/u);
  assert.match(page, /managedSitePageAttributesV1/u);
  assert.match(renderedSource, /managedSiteFieldAttributesV1/u);
  // A collection renders one declared field once per item, so the field id names
  // a column. Without the item the markup cannot name the cell, and an editor
  // reading the page can say what was clicked but not which one.
  assert.match(
    renderedSource,
    /managedSiteFieldAttributesV1\(\s*item\.question\.fieldId,\s*item\.itemId,?\s*\)/u,
  );
  assert.match(
    renderedSource,
    /managedSiteFieldAttributesV1\(\s*item\.answer\.fieldId,\s*item\.itemId,?\s*\)/u,
  );
  assert.match(renderedSource, /<Image/u);
  assert.match(renderedSource, /\bunoptimized\b/u);
  assert.doesNotMatch(renderedSource, /const demoFaqs/u);
  assert.doesNotMatch(renderedSource, /PLACEHOLDER —/u);
  assert.doesNotMatch(renderedSource, /siteConfig\.(businessName|description)/u);
});

test("binds the image manifest facts to the checked-in hero asset", async () => {
  // Read the asset the manifest names rather than a fixed starter path: a
  // customer site points the hero at its own artwork, and the contract is that
  // the declared facts describe whichever file is actually served.
  const home = await readJson("src/content/pages/home.json");
  const asset = await readBinary(home.hero.image.path);

  assert.equal(home.hero.image.bytes, asset.byteLength);
  assert.equal(
    home.hero.image.sha256,
    createHash("sha256").update(asset).digest("hex"),
  );
});

test("checks operational and structured configuration sentinels", async () => {
  const [checker, packageDocument, siteConfig] = await Promise.all([
    readSource("scripts/check-config.mjs"),
    readJson("package.json"),
    readSource("src/site.config.ts"),
  ]);

  for (const path of ["src/site.config.ts", "src/content"]) {
    assert.ok(checker.includes(path));
  }
  assert.match(checker, /readdirSync/u);
  assert.match(
    packageDocument.scripts.prebuild,
    /check-config.*@landing-pages-websites\/managed-site-contract run build/u,
  );
  assert.match(siteConfig, /import siteContent from "\.\/content\/site\.json"/u);
  assert.doesNotMatch(siteConfig, /businessName:\s*"TODO_/u);
});
