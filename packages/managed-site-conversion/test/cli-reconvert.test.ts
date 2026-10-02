import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";

import { run } from "../src/cli.js";
import { configFor, workspace } from "./support/proposals.js";

/**
 * The claim under test: a repository that is already converted is refused, and
 * refused before anything is written.
 *
 * Converting is not idempotent and cannot be. Once a value is a contract READ
 * rather than a literal, the proposer cannot see it: a second pass over the
 * converted All Points Media finds 92 of its 286 fields. Writing that contract
 * into the repository -- which is what `--rewire` does, and must -- would
 * replace a complete contract with a partial one and leave the site reading
 * ids nothing declares. The rewrite is refused today because the contract is,
 * but that is a consequence of this site's shape rather than a rule; a site
 * whose remainder happened to validate would have been converted over itself.
 *
 * The existing contract is the evidence, because it is the thing that would be
 * destroyed and the one artifact a converted repository always has.
 */
/**
 * `--out` is caller-supplied and may legitimately be the content root itself.
 * The guard therefore has to run before the FIRST write, not beside the rewrite
 * it protects: writing the report first replaces the real contract with a
 * proposal covering a fraction of its fields, and refusing afterwards is too
 * late to matter.
 */
test("--out aimed at the content root cannot overwrite the contract first", () => {
  const space = workspace(
    "apmshaped",
    configFor(["/", "/services", "/contact"]),
  );
  const contentRoot = join(space.repositoryRoot, "src/content");
  const contract = join(contentRoot, "managed-site.contract.json");
  mkdirSync(contentRoot, { recursive: true });
  const kept = '{"schemaVersion":"1.0","marker":"the run before"}';
  writeFileSync(contract, kept, "utf8");

  const status = run([
    "--repo",
    space.repositoryRoot,
    "--out",
    contentRoot,
    "--config",
    space.configPath ?? "",
    "--rewire",
    "@/src/content/managed-site",
  ]);

  assert.equal(status, 1);
  assert.equal(
    readFileSync(contract, "utf8"),
    kept,
    "the contract must survive a run whose output directory is its own",
  );
});

test("a converted repository is refused, and nothing is written", () => {
  const space = workspace(
    "apmshaped",
    configFor(["/", "/services", "/contact"]),
  );
  const contract = join(
    space.repositoryRoot,
    "src/content/managed-site.contract.json",
  );
  mkdirSync(dirname(contract), { recursive: true });
  writeFileSync(
    contract,
    '{"schemaVersion":"1.0","marker":"the run before"}',
    "utf8",
  );
  const page = join(space.repositoryRoot, "app/page.tsx");
  const before = readFileSync(page, "utf8");

  const status = run([
    "--repo",
    space.repositoryRoot,
    "--out",
    join(space.repositoryRoot, "..", "out"),
    "--config",
    space.configPath ?? "",
    "--rewire",
    "@/src/content/managed-site",
  ]);

  assert.equal(status, 1, "a refused conversion is not a success");
  assert.equal(
    readFileSync(contract, "utf8"),
    '{"schemaVersion":"1.0","marker":"the run before"}',
    "the contract that is already there must survive",
  );
  assert.equal(
    readFileSync(page, "utf8"),
    before,
    "and no source may be rewritten",
  );
});
