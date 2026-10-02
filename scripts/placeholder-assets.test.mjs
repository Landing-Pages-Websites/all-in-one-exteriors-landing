import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFile, mkdtemp, readFile, rm, writeFile, mkdir, cp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { promisify } from "node:util";

import {
  PLACEHOLDER_ASSET_DIGESTS,
  PLACEHOLDER_ASSET_PATHS,
  PLACEHOLDER_ASSET_SIZES,
} from "./placeholder-assets.mjs";

const run = promisify(execFile);
const repositoryRoot = new URL("../", import.meta.url);
const repositoryDir = repositoryRoot.pathname;

async function sha256(absolutePath) {
  return createHash("sha256").update(await readFile(absolutePath)).digest("hex");
}

/**
 * Runs the gate against a throwaway copy of the repo's asset roots.
 *
 * `check-config.mjs` resolves everything from its own location, so the copy
 * carries the real script and the real config; only the asset trees are ours
 * to mutate. Returns the reported problems, whatever the exit status.
 */
async function runGateOn(mutate) {
  const dir = await mkdtemp(join(tmpdir(), "placeholder-gate-"));
  try {
    // The whole repo minus the heavy, irrelevant trees: check-config reads
    // several root config files, so a hand-picked subset silently fails on the
    // first one missed rather than on the assets under test.
    const skip = new Set(["node_modules", ".git", ".next", "packages"]);
    await cp(repositoryDir, dir, {
      recursive: true,
      force: true,
      filter: (source) => {
        const relative = source.slice(repositoryDir.length);
        return !relative.split("/").some((segment) => skip.has(segment));
      },
    });
    await mutate(dir);
    let stdout = "";
    let stderr = "";
    try {
      ({ stdout, stderr } = await run(process.execPath, [join(dir, "scripts/check-config.mjs")]));
    } catch (error) {
      stdout = error.stdout ?? "";
      stderr = error.stderr ?? "";
    }
    return `${stdout}\n${stderr}`;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("the placeholder tables are not empty", () => {
  assert.ok(PLACEHOLDER_ASSET_DIGESTS.size > 0, "no placeholder digests declared");
  assert.ok(PLACEHOLDER_ASSET_PATHS.length > 0, "no placeholder paths declared");
});

/**
 * The gate recognises a placeholder by content, so a re-cut asset whose digest
 * is not updated in the same commit silently stops being recognised: the gate
 * keeps passing and sites go back to shipping template artwork. Nothing inside
 * a customer repo can catch that, because there a mismatch legitimately means
 * "replaced". Here in the template it always means the table is stale.
 */
test("every shipped placeholder is still covered by a declared digest", async () => {
  const uncovered = [];
  for (const relativePath of PLACEHOLDER_ASSET_PATHS) {
    const actual = await sha256(join(repositoryDir, relativePath));
    if (!PLACEHOLDER_ASSET_DIGESTS.has(actual)) uncovered.push(`${relativePath} (${actual})`);
  }
  assert.deepEqual(
    uncovered,
    [],
    "check-config.mjs placeholder digests are stale. Update them in the same commit that re-cut the asset.",
  );
});

/**
 * The size pre-filter must admit every shipped placeholder, or the sweep skips
 * it before hashing. Re-cutting an asset changes its size as well as its
 * digest, so both tables have to move together.
 */
test("every shipped placeholder's size is in the pre-filter", async () => {
  for (const relativePath of PLACEHOLDER_ASSET_PATHS) {
    const { length } = await readFile(join(repositoryDir, relativePath));
    assert.ok(
      PLACEHOLDER_ASSET_SIZES.has(length),
      `${relativePath} is ${length} bytes, which PLACEHOLDER_ASSET_SIZES does not contain — the sweep would skip it`,
    );
  }
});

test("every declared placeholder path exists", async () => {
  for (const relativePath of PLACEHOLDER_ASSET_PATHS) {
    await assert.doesNotReject(
      readFile(join(repositoryDir, relativePath)),
      `${relativePath} is listed in PLACEHOLDER_ASSET_PATHS but is not in the repo`,
    );
  }
});

test("the template's own assets trip the gate", async () => {
  const output = await runGateOn(async () => {});
  assert.match(output, /public\/logo\.png: still the template's logo\.png/);
  assert.match(output, /favicon\.ico: still the template's favicon/);
});

/**
 * The reachable path the first version of this gate missed.
 *
 * Managed images may point at any `public/` path and siteConfig's logo/OG
 * fields accept any public path, so a site can rename the starter's logo,
 * reference it from its new name, and delete the original. A gate that checks
 * a fixed list of paths finds nothing while the site serves starter artwork.
 */
test("a renamed placeholder is still caught", async () => {
  const output = await runGateOn(async (dir) => {
    await copyFile(join(dir, "public/logo.png"), join(dir, "public/brand.png"));
    await rm(join(dir, "public/logo.png"));
  });
  assert.match(
    output,
    /public\/brand\.png: still the template's logo\.png/,
    "renaming the placeholder hid it from the gate",
  );
  assert.doesNotMatch(output, /public\/logo\.png:/, "the deleted original should not be reported");
});

/** Nested is the same defect as renamed; the sweep is recursive. */
test("a placeholder moved into a subdirectory is still caught", async () => {
  const output = await runGateOn(async (dir) => {
    await mkdir(join(dir, "public/brand"), { recursive: true });
    await copyFile(join(dir, "public/og-image.png"), join(dir, "public/brand/social.png"));
    await rm(join(dir, "public/og-image.png"));
  });
  assert.match(output, /public\/brand\/social\.png: still the template's og-image\.png/);
});

/** Replacing the artwork for real must clear that asset, and only that one. */
test("replacing an asset clears it and leaves the others reported", async () => {
  const output = await runGateOn(async (dir) => {
    await writeFile(join(dir, "public/og-image.png"), Buffer.alloc(4096, 7));
  });
  assert.doesNotMatch(output, /og-image/, "a replaced asset should not be reported");
  assert.match(output, /public\/logo\.png: still the template's logo\.png/);
});

/**
 * The size pre-filter is an optimisation, and an optimisation that changes the
 * answer is a bug: a file of a different size cannot be byte-identical, but a
 * file of a *matching* size that is not a placeholder must not be reported.
 */
test("a same-size file that is not a placeholder is not reported", async () => {
  const placeholderSize = (await readFile(join(repositoryDir, "public/og-image.png"))).length;
  const output = await runGateOn(async (dir) => {
    await writeFile(join(dir, "public/decoy.png"), Buffer.alloc(placeholderSize, 3));
  });
  assert.doesNotMatch(output, /decoy\.png/, "a same-size non-placeholder must not be flagged");
});
