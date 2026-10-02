import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { pathToFileURL } from "node:url";

import { configFor, run, workspace } from "./support/proposals.js";
import { runtimeSite, writeRuntimeSite, type JsonObject, type RuntimeSite } from "./support/runtime-site.js";

/**
 * Two statements of whose a value is live in the runtime: main's selectorFor,
 * read off the raw contract JSON, which managedText and managedItem use, and
 * the readers' ownerOf, read off the parsed contract. Both restate the
 * projection's rule (source-projection-values.ts). For every field of every
 * fixture contract they must name the same owner, and site.readValue under it
 * must find the value the projection stored.
 */

const MAIN = JSON.parse(
  readFileSync(new URL("./support/main-runtime-sha256.json", import.meta.url), "utf8"),
) as { readonly digests: Readonly<Record<string, string>> };

const PROBE = "\nexport const __probe = { ownerOf, selectorFor, site };\n";

interface Probe {
  readonly ownerOf: (fieldId: string) => unknown;
  readonly selectorFor: (fieldId: string) => { readonly owner: unknown };
  readonly site: {
    readonly contract: {
      readonly pages: readonly { readonly sections: readonly { readonly fields: readonly { readonly id: string; readonly type: string }[] }[] }[];
      readonly internalSeo: { readonly protectedFields: readonly { readonly id: string }[] };
    };
    readonly readValue: (selector: { fieldId: string; owner: unknown; type: string }) => { readonly value: unknown };
  };
}

interface Loaded {
  readonly __probe: Probe;
  readonly managedText: (fieldId: string) => { readonly value: string };
}

async function probe(site: RuntimeSite): Promise<Loaded> {
  return (await import(pathToFileURL(writeRuntimeSite(site, PROBE)).href)) as Loaded;
}

function fixtureSites(): readonly [string, RuntimeSite][] {
  const sites: [string, RuntimeSite][] = [["runtimereaders", runtimeSite()]];
  for (const fixture of Object.keys(MAIN.digests)) {
    const proposal = run(workspace(fixture, configFor(["/"])));
    if (proposal.contract === null) continue;
    sites.push([
      fixture,
      {
        contract: structuredClone(proposal.contract) as unknown as JsonObject,
        documents: new Map([...proposal.sourceDocuments].map(([path, value]) => [path, value as JsonObject])),
      },
    ]);
  }
  return sites;
}

test("ownerOf and selectorFor agree, and readValue finds every field under that owner", async (t) => {
  let fields = 0;
  const sites = fixtureSites();
  for (const [fixture, site] of sites) {
    const loaded = await probe(site);
    const { ownerOf, selectorFor, site: managed } = loaded.__probe;
    const rendered = managed.contract.pages.flatMap((page) => page.sections.flatMap((section) => section.fields));
    for (const field of rendered) {
      const owner = ownerOf(field.id);
      assert.deepEqual(selectorFor(field.id).owner, owner, `${fixture} ${field.id}: the two owner rules agree`);
      const { value } = managed.readValue({ fieldId: field.id, owner, type: field.type });
      if (field.type === "plain_text" || field.type === "heading_text") {
        assert.equal(loaded.managedText(field.id).value, value, `${fixture} ${field.id}: managedText reads the same value`);
      }
      fields += 1;
    }
    for (const field of managed.contract.internalSeo.protectedFields) {
      managed.readValue({ fieldId: field.id, owner: ownerOf(field.id), type: "internal_protected" });
      fields += 1;
    }
  }
  t.diagnostic(`${String(sites.length)} contracts, ${String(fields)} fields`);
  assert.ok(sites.length > 10 && fields > 100, "the agreement is checked over real contracts");
});
