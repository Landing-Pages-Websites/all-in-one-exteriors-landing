import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

import {
  canonicalizeJson,
  deriveManagedSiteGuardContractFactsV1,
  digestCanonicalJson,
  parseManagedSiteContractV1,
  projectManagedSiteContentDocumentV1,
  type ManagedSiteContentDocument,
  type ManagedSiteSourceDocumentV1,
} from "@landing-pages-websites/managed-site-contract";

import { run as runCli } from "../src/cli.js";
import { sourceDocumentsFor, type Proposal } from "../src/propose.js";
import { configFor, run, workspace, type Workspace } from "./support/proposals.js";

/**
 * The platform never reads a content document a converter wrote. It derives one
 * by projecting the contract over the source files in the repository, both when
 * it records a site's first revision and on every later candidate check, and it
 * digests that projection.
 *
 * So a content document the proposer states a second time is a document nothing
 * will ever agree with. On All Points Media the two were content identical --
 * 475 values each, no address in only one, no shared address whose value
 * differed, identical asset manifests -- and still digested differently, because
 * the proposer emitted each collection's 98 item values beside that collection
 * while the projection emits every collection value after every other one.
 * Filtering either document to its non-item values gives byte-identical order,
 * and so does filtering to item values, so that interleaving was the whole of it.
 */

interface ProjectionCase {
  readonly why: string;
  readonly fixture: string;
  /** `null` supplies no conversion config file at all. */
  readonly config: unknown;
  /** Whether the platform's parsers accept this proposal, so a projection exists. */
  readonly projects: boolean;
}

/** Collection items, an asset slot and internal SEO: the case that diverged. */
const SITE: ProjectionCase = {
  why: "collection items, an asset slot and internal SEO in one page",
  fixture: "site",
  config: configFor(["/"]),
  projects: true,
};

/**
 * Site-scoped chrome, internal SEO and two asset slots over three routes, and no
 * collection anywhere -- the shape whose two producers already agreed, so the
 * change is held to not introducing a difference either.
 */
const APM_SHAPED: ProjectionCase = {
  why: "site-scoped chrome, internal SEO and assets across three routes, no collection",
  fixture: "apmshaped",
  config: configFor(["/", "/services", "/contact"]),
  projects: true,
};

/** A rendered route with no page config leaves internal SEO incomplete. */
const SITE_UNDECLARED: ProjectionCase = {
  why: "a config declaring no page, so internal SEO cannot complete",
  fixture: "site",
  config: configFor([]),
  projects: false,
};

const SITE_NO_CONFIG: ProjectionCase = {
  why: "no conversion config at all, so there is no bridge and no identity",
  fixture: "site",
  config: null,
  projects: false,
};

/**
 * Both outcomes in one table, so neither branch can be quietly lost. The
 * `routes` fixture cannot reach the projecting branch at all: every route needs
 * a resolvable title, description and robots, and 79 of its 80 declare no
 * metadata, so it is a refusal by construction rather than by configuration.
 */
const CASES: readonly ProjectionCase[] = [
  SITE,
  APM_SHAPED,
  SITE_UNDECLARED,
  SITE_NO_CONFIG,
  {
    why: "eighty routes declaring no metadata at all",
    fixture: "routes",
    config: configFor(["/"]),
    projects: false,
  },
];

const PROJECTED = CASES.filter((entry) => entry.projects);
const WITHHELD = CASES.filter((entry) => !entry.projects);

function spaceFor(entry: ProjectionCase): Workspace {
  return workspace(entry.fixture, entry.config);
}

/**
 * The projection, derived the way the platform derives it: from the contract and
 * the source documents, with nothing carried over from the run that produced
 * them.
 */
function projectionOf(proposal: Proposal): ManagedSiteContentDocument {
  assert.ok(proposal.contract !== null, "the case was expected to validate");
  return projectManagedSiteContentDocumentV1(
    proposal.contract,
    sourceDocumentsFor(proposal.sourceDocuments),
  );
}

/** Every value keyed on the address that identifies it, so order cannot hide. */
function valuesByAddress(document: ManagedSiteContentDocument): ReadonlyMap<string, string> {
  return new Map(
    document.values.map((value) => [
      canonicalizeJson({ fieldId: value.fieldId, owner: value.owner }),
      canonicalizeJson(value),
    ]),
  );
}

describe("a proposal states content only when the platform can project it", () => {
  for (const entry of PROJECTED) {
    it(`${entry.fixture}: ${entry.why}`, () => {
      const proposal = run(spaceFor(entry));

      assert.equal(proposal.validationError, null);
      assert.notEqual(proposal.content, null);
    });
  }

  for (const entry of WITHHELD) {
    it(`${entry.fixture}: ${entry.why}, so content is withheld`, () => {
      const proposal = run(spaceFor(entry));

      assert.equal(proposal.contract, null);
      assert.notEqual(proposal.validationError, null);
      assert.equal(
        proposal.content,
        null,
        "content was stated for a contract the platform refused",
      );
      assert.ok(
        proposal.contentDraft.values.length > 0,
        "the values the walker read are not visible for inspection",
      );
    });
  }
});

/**
 * Adopting the projection is only safe if it carries every value the walk found.
 * This is the one comparison with two genuinely independent producers -- the
 * emitter's own document against a projection of the sources it wrote -- and it
 * compares by address rather than by position, because position is the one thing
 * the two were already known to disagree about.
 */
describe("the projection carries every value the emitter read", () => {
  for (const entry of PROJECTED) {
    it(`${entry.fixture}: same values, same asset manifest`, () => {
      const proposal = run(spaceFor(entry));
      const projection = projectionOf(proposal);
      const emitted = valuesByAddress(proposal.contentDraft);
      const projected = valuesByAddress(projection);

      assert.ok(emitted.size > 0, "the emitter read nothing, so nothing is proven");
      assert.deepEqual(
        [...projected.keys()].filter((address) => !emitted.has(address)),
        [],
        "the projection invents values the emitter never read",
      );
      assert.deepEqual(
        [...emitted].filter(([address, value]) => projected.get(address) !== value),
        [],
        "the projection drops a value the emitter read, or disagrees about one",
      );
      assert.equal(
        canonicalizeJson(proposal.contentDraft.assetManifest),
        canonicalizeJson(projection.assetManifest),
        "the asset manifests differ",
      );
    });
  }
});

/**
 * The digests below only constrain anything if they can see the order of the
 * values. Proven on a real projection rather than assumed of the digest, because
 * a digest blind to order would let every comparison here pass against a
 * document in any order at all.
 */
describe("the digest the platform compares sees the order of the values", () => {
  it("moving one value to the end changes the digest", () => {
    const projection = projectionOf(run(spaceFor(SITE)));
    assert.ok(projection.values.length > 1, "one value cannot be reordered");
    const [first, ...rest] = projection.values;
    const reordered = { ...projection, values: [...rest, first!] };

    assert.notEqual(
      digestCanonicalJson(reordered),
      digestCanonicalJson(projection),
      "content order is invisible to the digest, so the regression proves nothing",
    );
  });
});

/**
 * The regression this change exists for. A proposal is checked the way the
 * platform checks a repository: read the contract, read the sources, project one
 * over the other, and require the result to digest as the content beside them.
 *
 * Everything crosses JSON and is re-parsed, so this compares two independently
 * produced documents. An in-process comparison against `proposal.content` would
 * not: now that `proposal.content` IS the projection, calling the projection
 * again with the same arguments only asserts that a pure function is
 * deterministic.
 */
describe("an output directory is the projection of its own sources", () => {
  function read(directory: string, name: string): unknown {
    return JSON.parse(readFileSync(join(directory, name), "utf8")) as unknown;
  }

  function proposeInto(entry: ProjectionCase): string {
    const space = spaceFor(entry);
    const directory = join(space.repositoryRoot, "..", "out");
    assert.ok(space.configPath !== null, "the CLI needs a config file to read");
    runCli([
      "--repo",
      space.repositoryRoot,
      "--out",
      directory,
      "--config",
      space.configPath,
      "--ledger",
      space.ledgerPath,
    ]);
    return directory;
  }

  function contractIn(directory: string): ReturnType<typeof parseManagedSiteContractV1> {
    return parseManagedSiteContractV1(read(directory, "managed-site.contract.json"));
  }

  for (const entry of PROJECTED) {
    it(`${entry.fixture}: its written contract, sources and content agree`, () => {
      const directory = proposeInto(entry);
      const sources = read(directory, "managed-site.sources.json");
      const content = read(directory, "managed-site.content.json");

      assert.equal(
        digestCanonicalJson(
          projectManagedSiteContentDocumentV1(
            contractIn(directory),
            sources as readonly ManagedSiteSourceDocumentV1[],
          ),
        ),
        digestCanonicalJson(content),
        "the written content is not the projection of the written sources",
      );
    });

    it(`${entry.fixture}: holds exactly the source documents the contract names`, () => {
      const directory = proposeInto(entry);
      const written = read(directory, "managed-site.sources.json") as readonly {
        readonly path: string;
      }[];

      assert.deepEqual(
        written.map((document) => document.path),
        [...deriveManagedSiteGuardContractFactsV1(contractIn(directory)).sourcePaths],
        "the written sources are not the set the platform reads, in the order it reads them",
      );
    });
  }

  /**
   * The two content names are mutually exclusive, and the output directory is
   * reused. Writing one without removing the other left a refused run standing
   * beside the previous run's content, so a consumer following the documented
   * path would package content this conversion refused — and the reverse left a
   * stale rejection beside a good one.
   *
   * Both directions, into the SAME directory, because one run cannot show it.
   */
  function runInto(entry: ProjectionCase, directory: string): void {
    const space = spaceFor(entry);
    assert.ok(space.configPath !== null, "the CLI needs a config file to read");
    runCli([
      "--repo",
      space.repositoryRoot,
      "--out",
      directory,
      "--config",
      space.configPath,
      "--ledger",
      space.ledgerPath,
    ]);
  }

  const ACCEPTED = "managed-site.content.json";
  const REJECTED = "managed-site.content.rejected.json";

  for (const [why, first, second, survivor, removed] of [
    ["a refusal after a success", PROJECTED[0]!, SITE_UNDECLARED, REJECTED, ACCEPTED],
    ["a success after a refusal", SITE_UNDECLARED, PROJECTED[0]!, ACCEPTED, REJECTED],
  ] as const) {
    it(`${why} leaves exactly one content artifact`, () => {
      const directory = join(spaceFor(PROJECTED[0]!).repositoryRoot, "..", `reused-${survivor}`);
      runInto(first, directory);
      runInto(second, directory);

      assert.equal(existsSync(join(directory, survivor)), true, `${survivor} was not written`);
      assert.equal(
        existsSync(join(directory, removed)),
        false,
        `${removed} survived the run that contradicts it, so a consumer can read stale content`,
      );
    });
  }

  it("writes no content at all for a contract the platform refused", () => {
    const directory = proposeInto(SITE_UNDECLARED);

    assert.equal(
      existsSync(join(directory, "managed-site.content.json")),
      false,
      "content nothing can project was written as content",
    );
    const rejected = read(directory, "managed-site.content.rejected.json") as {
      readonly values: readonly unknown[];
    };
    assert.ok(rejected.values.length > 0, "the values read were not kept for inspection");
  });
});

/**
 * The output directory is reused across runs, and three of its artifacts are
 * conditional. `writeExclusive` already keeps the content pair honest. The
 * anchor-naming pair had the same problem: names proposed by a `--name-anchors`
 * run stood beside a later run that proposed none, so a reader following
 * `anchor-names.txt` would write ids this conversion no longer offers.
 *
 * Both directions are covered, because a rerun that DOES name anchors must
 * still leave them behind.
 */
describe("a rerun leaves only the anchor names it proposed", () => {
  const ANCHOR_NAMES = ["anchor-names.json", "anchor-names.txt"] as const;

  function proposeInto(directory: string, flags: readonly string[]): number {
    const space = workspace(SITE.fixture, SITE.config);
    assert.ok(space.configPath !== null, "the CLI needs a config file to read");
    return runCli([
      "--repo",
      space.repositoryRoot,
      "--out",
      directory,
      "--config",
      space.configPath,
      "--ledger",
      join(directory, "managed-site.idmap.json"),
      ...flags,
    ]);
  }

  it("drops names a later run without --name-anchors did not propose", () => {
    const directory = mkdtempSync(join(tmpdir(), "managed-site-anchors-"));
    proposeInto(directory, ["--name-anchors"]);
    for (const name of ANCHOR_NAMES) {
      assert.ok(existsSync(join(directory, name)), `${name} was never written`);
    }

    proposeInto(directory, []);

    for (const name of ANCHOR_NAMES) {
      assert.equal(
        existsSync(join(directory, name)),
        false,
        `${name} survived a run that proposed no names`,
      );
    }
  });

  it("keeps the names a later run does propose", () => {
    const directory = mkdtempSync(join(tmpdir(), "managed-site-anchors-kept-"));
    proposeInto(directory, ["--name-anchors"]);

    proposeInto(directory, ["--name-anchors"]);

    for (const name of ANCHOR_NAMES) {
      assert.ok(existsSync(join(directory, name)), `${name} was removed by a naming run`);
    }
  });

  it("removes nothing else from the output directory", () => {
    const directory = mkdtempSync(join(tmpdir(), "managed-site-anchors-only-"));
    proposeInto(directory, ["--name-anchors"]);
    writeFileSync(join(directory, "notes.txt"), "mine", "utf8");

    proposeInto(directory, []);

    assert.equal(
      readFileSync(join(directory, "notes.txt"), "utf8"),
      "mine",
      "the removal reached a name this tool does not write",
    );
  });
});
