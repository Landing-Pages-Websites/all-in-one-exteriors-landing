import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { run } from "../src/cli.js";
import { configFor, workspace } from "./support/proposals.js";

/**
 * The claim under test: the ledger lands somewhere that gets committed.
 *
 * Field ids are how the CMS addresses a customer's edits, and the ledger is the
 * only thing that keeps one the same across conversions. Its old default put it
 * under `--out`, a report folder nobody commits, so a re-run minted a fresh id
 * for every field and orphaned every edit -- and remembering `--ledger` was all
 * that stood between a site and that. A safeguard nobody can forget beats one
 * everybody must remember.
 */
function convert(space: ReturnType<typeof workspace>, extra: readonly string[] = []): number {
  return run([
    "--repo",
    space.repositoryRoot,
    "--out",
    join(space.repositoryRoot, "..", "report"),
    "--config",
    space.configPath ?? "",
    ...extra,
  ]);
}

test("the ledger defaults into the repository, beside the content it mints ids for", () => {
  const space = workspace("apmshaped", configFor(["/", "/services", "/contact"]));

  convert(space);

  const ledger = join(space.repositoryRoot, "src/content/managed-site.idmap.json");
  assert.ok(existsSync(ledger), "written where a conversion's output is committed");
  const entries = (JSON.parse(readFileSync(ledger, "utf8")) as {
    readonly entries: Readonly<Record<string, string>>;
  }).entries;
  assert.ok(Object.keys(entries).length > 0, "and it carries the run's anchors");
});

/** It follows `contentRoot`, rather than restating where the documents live. */
test("the default ledger moves with the content root", () => {
  const base = configFor(["/", "/services", "/contact"]) as { contentRoot: string };
  const space = workspace("apmshaped", { ...base, contentRoot: "content/managed" });

  convert(space);

  assert.ok(
    existsSync(join(space.repositoryRoot, "content/managed/managed-site.idmap.json")),
    "the ledger follows the documents",
  );
  assert.equal(
    existsSync(join(space.repositoryRoot, "src/content/managed-site.idmap.json")),
    false,
    "and is not also left at the old spelling",
  );
});

/** An explicit --ledger still wins, or the flag is decoration. */
test("an explicit --ledger is still honoured", () => {
  const space = workspace("apmshaped", configFor(["/", "/services", "/contact"]));
  const chosen = join(space.repositoryRoot, "somewhere-else.json");

  convert(space, ["--ledger", chosen]);

  assert.ok(existsSync(chosen));
  assert.equal(
    existsSync(join(space.repositoryRoot, "src/content/managed-site.idmap.json")),
    false,
  );
});

/**
 * The ids a run mints must not depend on whether a previous run's ledger is
 * sitting in the tree.
 *
 * This is the whole reason the ledger is excluded from the name scan, stated
 * the way an operator meets it. The flow is the real one: `--apply-anchors`
 * writes an `id` for each value the confidence gate could not tell apart, and
 * the pass after it records that anchor in the ledger. Convert a fresh copy
 * again with that ledger in place and the names must come out the same.
 *
 * Unexcluded, the ledger reserves the names it is the record of, so the second
 * site gets `ms-home-start-anywhere-2` -- a different anchor for a value that
 * has not moved, and therefore a different field id. A third run would say
 * `-3`.
 */
function namedIds(root: string): readonly string[] {
  const page = readFileSync(join(root, "app/page.tsx"), "utf8");
  return [...new Set(page.match(/ms-[a-z0-9-]+/gu) ?? [])].sort();
}

/** The two-pass flow: name the ambiguous anchors, then record them. */
function convertTwice(space: ReturnType<typeof workspace>): string {
  convert(space, ["--apply-anchors"]);
  convert(space);
  return readFileSync(join(space.repositoryRoot, "src/content/managed-site.idmap.json"), "utf8");
}

test("a ledger left in the tree does not change the names the next site gets", () => {
  const first = workspace("twinvalues", configFor(["/"]));
  const ledger = convertTwice(first);
  const minted = namedIds(first.repositoryRoot);

  assert.deepEqual(
    minted,
    ["ms-home-finish-anywhere", "ms-home-start-anywhere"],
    "the fixture does mint names, or nothing below can drift",
  );
  assert.ok(
    minted.every((id) => ledger.includes(id)),
    "and the ledger records them, which is what makes it a hazard",
  );

  const second = workspace("twinvalues", configFor(["/"]));
  mkdirSync(join(second.repositoryRoot, "src/content"), { recursive: true });
  writeFileSync(
    join(second.repositoryRoot, "src/content/managed-site.idmap.json"),
    ledger,
    "utf8",
  );
  convert(second, ["--apply-anchors"]);

  assert.deepEqual(namedIds(second.repositoryRoot), minted, "no name drifted to a suffix");
});

/**
 * The ids themselves, not just the names.
 *
 * `save` keeps the anchors a run used and tombstones the rest. That is right
 * for a run that saw the site's final anchor set, and wrong for the pass that
 * WRITES the names: applying a name changes the anchor of the value it names,
 * so every anchor that pass resolved is stale by the time it finishes. Saving
 * recorded the pre-naming anchors, dropped the post-naming ones the next pass
 * needs, and tombstoned their ids so they could never come back.
 *
 * The site still built and still rendered identically, so nothing downstream
 * noticed: 182 of All Points Media's 366 fields were silently re-minted on a
 * second conversion, with the ledger sitting right there, and every edit a
 * customer had made against those ids would have been orphaned.
 */
function convertFully(space: ReturnType<typeof workspace>): {
  readonly ledger: string;
  readonly page: string;
} {
  convert(space, ["--apply-anchors"]);
  convert(space, ["--write-sources"]);
  return {
    ledger: readFileSync(
      join(space.repositoryRoot, "src/content/managed-site.idmap.json"),
      "utf8",
    ),
    page: readFileSync(join(space.repositoryRoot, "app/page.tsx"), "utf8"),
  };
}

test("a second conversion with the ledger in place re-mints nothing", () => {
  const first = convertFully(workspace("twinvalues", configFor(["/"])));
  const entries = (JSON.parse(first.ledger) as {
    readonly entries: readonly { readonly anchor: string }[];
  }).entries;

  assert.ok(
    entries.some((entry) => entry.anchor.includes("ms-home-")),
    "the ledger records the post-naming anchors, or there is nothing to lose",
  );

  const second = workspace("twinvalues", configFor(["/"]));
  mkdirSync(join(second.repositoryRoot, "src/content"), { recursive: true });
  writeFileSync(
    join(second.repositoryRoot, "src/content/managed-site.idmap.json"),
    first.ledger,
    "utf8",
  );
  const again = convertFully(second);

  assert.equal(again.ledger, first.ledger, "same anchors, same ids, same tombstones");
  assert.equal(again.page, first.page, "and the rewritten source is identical");
});

/**
 * Withholding the ledger is about what a run DID, not what it was asked to do.
 *
 * `--apply-anchors` withholds it because applying a name moves the anchor of
 * the value it names, so the ledger the run is holding describes anchors the
 * repository no longer has. A run that writes NOTHING has moved nothing: its
 * anchors are still the repository's, and withholding then loses every id it
 * minted -- on a first conversion, the entire ledger, so the next run mints
 * everything fresh and orphans every edit made against the old ids.
 *
 * Three ways a run asked to apply names writes nothing: it proposes none, the
 * parser refuses every edited file, and verification puts them all back. They
 * converge on one fact -- whether any edit was written and kept -- which is
 * what the save is gated on, set false again in the revert branch.
 */
test("a run that applies no name still writes the ledger", () => {
  // Every value here is distinguishable, so nothing is ambiguous and there is
  // no name to apply.
  const space = workspace("unmanagedroute", configFor(["/", "/admin"]));

  convert(space, ["--apply-anchors"]);

  const ledger = join(space.repositoryRoot, "src/content/managed-site.idmap.json");
  assert.ok(existsSync(ledger), "nothing moved, so this ledger is the current one");
  const entries = (JSON.parse(readFileSync(ledger, "utf8")) as {
    readonly entries: readonly unknown[];
  }).entries;
  assert.ok(entries.length > 0, "and it carries the ids the run minted");
});

/** The other half: a run that DOES apply names withholds it, or the gate is inert. */
test("a run that applies a name withholds the ledger", () => {
  const space = workspace("twinvalues", configFor(["/"]));

  convert(space, ["--apply-anchors"]);

  assert.equal(
    existsSync(join(space.repositoryRoot, "src/content/managed-site.idmap.json")),
    false,
    "the anchors moved, so the ledger this run holds describes anchors that are gone",
  );
});
