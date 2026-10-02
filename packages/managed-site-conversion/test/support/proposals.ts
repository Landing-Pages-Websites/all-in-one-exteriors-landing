import assert from "node:assert/strict";
import { cpSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  CURRENT_BRIDGE_SRC,
  CURRENT_BRIDGE_VERSION,
} from "@landing-pages-websites/managed-site-contract";

import type { Candidate } from "../../src/candidates.js";
import { callSiteIndex, tagResolver } from "../../src/reachability.js";
import {
  extractComponent,
  findComponentDeclarations,
  resolveTagRoles,
} from "../../src/extract.js";
import { isJsonObject, type JsonObject } from "../../src/json-write.js";
import { propose, type Proposal } from "../../src/propose.js";
import type { Finding, FindingCode } from "../../src/report.js";
import { ModuleCache } from "../../src/scan.js";

/** Shared plumbing for the fixture-driven proposal tests. */

const FIXTURE_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures");

/**
 * The bridge delivery block the loader accepts, taken from the contract
 * package's own constants rather than restated. Promoting the next bridge
 * version must not need an edit in this repository's tests.
 */
export const VALID_BRIDGE = {
  version: CURRENT_BRIDGE_VERSION,
  src: CURRENT_BRIDGE_SRC,
  integrity: "sha384-/+5J7l1l8JNgnIgvgOqEHDgx92NrGmbjezpRb/MZb2y0RildsCcaOVu8+mLZbrmF",
  crossOrigin: "anonymous",
  load: "head_defer",
};

const PERFORMANCE_BUDGET = {
  maxLcpMilliseconds: 2500,
  maxCls: 0.1,
  maxInpMilliseconds: 200,
  maxPageBytes: 2097152,
};

const BUSINESS_IDENTITY = {
  legalName: "Fixture Ltd",
  displayName: "Fixture",
  telephone: "+15555550100",
  email: "hello@example.com",
  description: "A fixture business.",
  sameAs: ["https://example.com/"],
};

/**
 * Everything the proposer refuses to invent, declared for exactly the routes
 * named here. A route a fixture renders but this omits leaves internal SEO
 * incomplete, which is how a fixture is made to produce a refused contract.
 *
 * `overrideFor` supplies the keys a test varies, merged over the declaration
 * below per route. Every suite that needed one was spreading `pages` back apart
 * itself and restating the page shape in a cast to do it, which is three
 * statements of a schema `config.ts` owns.
 */
export function configFor(
  routePaths: readonly string[],
  overrideFor: (routePath: string) => Readonly<Record<string, unknown>> = () => ({}),
): unknown {
  return {
    contentRoot: "src/content",
    assetRoot: "public",
    bridge: VALID_BRIDGE,
    businessIdentity: BUSINESS_IDENTITY,
    pages: Object.fromEntries(
      routePaths.map((routePath) => [
        routePath,
        {
          purpose: "landing",
          canonical: `https://example.com${routePath}`,
          sitemap: { included: true, changeFrequency: "monthly", priority: 0.5 },
          performanceBudget: PERFORMANCE_BUDGET,
          ...overrideFor(routePath),
        },
      ]),
    ),
  };
}

export interface Workspace {
  readonly repositoryRoot: string;
  readonly ledgerPath: string;
  readonly configPath: string | null;
}

/** Copies a fixture site into a scratch directory so a run may rewrite it. */
export function workspace(fixture: string, config: unknown | null): Workspace {
  const directory = mkdtempSync(join(tmpdir(), "managed-site-proposal-"));
  const repositoryRoot = join(directory, "repo");
  cpSync(join(FIXTURE_ROOT, fixture), repositoryRoot, { recursive: true });
  if (config === null) {
    return { repositoryRoot, ledgerPath: join(directory, "idmap.json"), configPath: null };
  }
  const configPath = join(directory, "conversion.json");
  writeFileSync(configPath, JSON.stringify(config), "utf8");
  return { repositoryRoot, ledgerPath: join(directory, "idmap.json"), configPath };
}

export function run(space: Workspace): Proposal {
  return propose({
    repositoryRoot: space.repositoryRoot,
    configPath: space.configPath,
    ledgerPath: space.ledgerPath,
  });
}

export interface ComponentExtraction {
  readonly candidates: readonly Candidate[];
  readonly findings: readonly Finding[];
}

/**
 * Extracts every component the named entry modules declare, exactly as the
 * proposer does, with the whole file set on disk beside them so imports
 * resolve.
 *
 * This is the ONLY statement of that prelude. Seven copies of it were spread
 * over six files, which pinned `extractComponent`'s signature in as many places
 * as there were copies and let the copies drift apart.
 *
 * Every entry shares one scratch root and one `ModuleCache`, and that sharing
 * is load-bearing rather than a saving: a candidate's identity carries the
 * absolute path of the module it was DECLARED in, so writing the fixture out
 * once per entry would give one declaration two identities and the gate would
 * refuse the pair it is supposed to merge.
 */
export function extractEntries(
  files: Readonly<Record<string, string>>,
  entries: readonly string[],
): ComponentExtraction {
  const directory = mkdtempSync(join(tmpdir(), "managed-site-extract-"));
  for (const [relative, text] of Object.entries(files)) {
    const file = join(directory, relative);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, text, "utf8");
  }
  const cache = new ModuleCache();
  const tags = tagResolver(directory, cache);
  const declared = entries.flatMap((entry) =>
    findComponentDeclarations(cache.read(join(directory, entry))),
  );
  // The proposer builds this once over every declaration a route reaches, and
  // a reading that asks what a prop can BE needs it. Without it here, a
  // dynamic tag stays unread and any test of that reading passes vacuously.
  // These fixtures have no routes, so the entries' own declarations stand in.
  const callSites = callSiteIndex(declared, tags);
  const extractions = entries.flatMap((entry) => {
    const sourceModule = cache.read(join(directory, entry));
    const roles = resolveTagRoles(sourceModule);
    return findComponentDeclarations(sourceModule).map((declaration) =>
      extractComponent(declaration, roles, directory, cache, tags, callSites),
    );
  });
  return {
    candidates: extractions.flatMap((one) => one.candidates),
    findings: extractions.flatMap((one) => one.findings),
  };
}

/** Extracts every component one entry module declares, the file set beside it. */
export function extractFiles(
  files: Readonly<Record<string, string>>,
  entry: string,
): ComponentExtraction {
  return extractEntries(files, [entry]);
}

/** Extracts every component one module declares, exactly as the proposer does. */
export function extractModule(source: string): ComponentExtraction {
  return extractFiles({ "Component.tsx": source }, "Component.tsx");
}

export function findingsOf(proposal: Proposal, code: FindingCode): readonly Finding[] {
  return proposal.report.findings.filter((finding) => finding.code === code);
}

export function sourceDocumentOf(proposal: Proposal, path: string): JsonObject {
  const document = proposal.sourceDocuments.get(path);
  assert.ok(isJsonObject(document), `no source document at ${path}`);
  return document;
}

/** The internal-SEO values a route resolved, as they are written to its source. */
export function seoOf(proposal: Proposal, slug: string): JsonObject {
  const document = sourceDocumentOf(proposal, `src/content/pages/${slug}.json`);
  const seo = document["seo"];
  return isJsonObject(seo) ? seo : {};
}
