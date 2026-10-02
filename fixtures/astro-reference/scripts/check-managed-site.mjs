import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  canonicalizeJson,
  createManagedSiteAstroV1,
} from "@landing-pages-websites/managed-site-contract";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const FIXTURE = "fixtures/astro-reference/src/content";
const MAX_INPUT_BYTES = 16 * 1024 * 1024;
const CONFORMANCE_COMMAND = "gomega-managed-site-conformance";
const CONFORMANCE_CLI = fileURLToPath(
  new URL("../../../packages/managed-site-contract/dist/conformance-cli.js", import.meta.url),
);

const PATHS = Object.freeze({
  contract: `${FIXTURE}/managed-site.contract.json`,
  site: `${FIXTURE}/site.json`,
  home: `${FIXTURE}/pages/home.json`,
  services: `${FIXTURE}/collections/services.json`,
  content: `${FIXTURE}/managed-site.content.json`,
});

function readBoundedUtf8(path) {
  const absolutePath = `${ROOT}/${path}`;
  assert.ok(statSync(absolutePath).size <= MAX_INPUT_BYTES, `${path} is too large`);
  return readFileSync(absolutePath, "utf8");
}

function readJson(path) {
  return JSON.parse(readBoundedUtf8(path));
}

function createSite() {
  return createManagedSiteAstroV1({
    contract: readJson(PATHS.contract),
    sourceDocuments: [
      { path: PATHS.site, value: readJson(PATHS.site) },
      { path: PATHS.home, value: readJson(PATHS.home) },
      { path: PATHS.services, value: readJson(PATHS.services) },
    ],
  });
}

function conformWithCli() {
  const output = execFileSync(
    process.execPath,
    [CONFORMANCE_CLI, "--contract", PATHS.contract, "--content", PATHS.content],
    {
      cwd: ROOT,
      encoding: "utf8",
      maxBuffer: 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 30_000,
    },
  );
  const lines = output.trimEnd().split("\n");
  assert.equal(lines.length, 1, `${CONFORMANCE_COMMAND} must emit one line`);
  return JSON.parse(lines[0]);
}

const site = createSite();
const checkpoint = readJson(PATHS.content);
assert.equal(
  canonicalizeJson(site.content),
  canonicalizeJson(checkpoint),
  "Astro projected content checkpoint is stale",
);
assert.equal(
  canonicalizeJson(conformWithCli()),
  canonicalizeJson(site.artifacts),
  "Astro conformance artifact conflicts with adapter output",
);
