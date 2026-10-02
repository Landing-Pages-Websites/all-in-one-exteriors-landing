import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { createContext, runInContext, runInNewContext } from "node:vm";

import { buildSync } from "esbuild";

import type { ManagedSiteFieldMigrationProofV1 } from "../src/index.js";
import { copyJsonValue, parseJsonValue, type JsonValue } from "../src/json.js";
import { migrationCase, verifyCase } from "./field-migration-fixture.js";

/**
 * The package loaded as Jest loads it: in its own vm context, handed the host's
 * Node globals (see copyJsonValue for why that matters).
 */
const TEST_DIRECTORY = dirname(fileURLToPath(import.meta.url));

function bundledPackage(): string {
  const result = buildSync({
    bundle: true,
    entryPoints: [resolve(TEST_DIRECTORY, "../src/index.ts")],
    format: "cjs",
    logLevel: "silent",
    platform: "node",
    write: false,
  });
  return result.outputFiles[0].text;
}

const hostRequire = createRequire(import.meta.url);

/**
 * Runs `script` in a fresh context holding the bundled package as `contract`.
 * The context gets every host global it lacks, as Jest's node environment does.
 */
function inIsolatedRealm(script: string, extra: Record<string, unknown> = {}): unknown {
  const loaded = { exports: {} };
  const context = createContext({ module: loaded, exports: loaded.exports, require: hostRequire, ...extra });
  const own = new Set(Object.getOwnPropertyNames(runInContext("globalThis", context)));
  for (const name of Object.getOwnPropertyNames(globalThis)) {
    if (!own.has(name)) context[name] = (globalThis as Record<string, unknown>)[name];
  }
  runInContext(bundledPackage(), context);
  return runInContext(`const contract = module.exports;\n${script}`, context);
}

describe("a vm-isolated consumer", () => {
  it("verifies All Points Media #73's field migration as the host does", () => {
    const summarize = (proof: ManagedSiteFieldMigrationProofV1) => JSON.stringify({ steps: proof.steps.length, bridge: proof.bridge });
    const isolated = inIsolatedRealm(
      `const value = JSON.parse(migration);
      const proof = contract.validateManagedSiteContractV1MigrationCompatibility(
        contract.parseManagedSiteContractV1(value.productionContract),
        contract.parseManagedSiteContentDocument(value.productionContent),
        contract.parseManagedSiteContractV1(value.candidateContract),
        contract.parseManagedSiteContentDocument(value.candidateContent),
        value.declaration,
        { admitBridge: () => true },
      );
      (${summarize.toString()})(proof);`,
      { migration: JSON.stringify(migrationCase()) },
    );
    assert.equal(isolated, summarize(verifyCase(migrationCase())));
  });
});

describe("copyJsonValue", () => {
  const foreign = runInNewContext(
    `JSON.parse('{"a":[1,{"b":null}],"__proto__":{"c":true},"d":"x"}')`,
  );

  const cases: ReadonlyArray<readonly [string, JsonValue]> = [
    ["a value from another realm", foreign],
    ["a parsed, deeply frozen value", parseJsonValue(JSON.parse('{"a":[{"b":[1,2]}],"c":"d"}'))],
    ["a __proto__ key", JSON.parse('{"__proto__":{"polluted":true}}')],
    ["nested arrays", [[[]], [1, "two", false, null]]],
    ["a primitive", "text"],
  ];

  for (const [name, value] of cases) {
    it(`copies ${name} into plain objects of this realm`, () => {
      const copy = copyJsonValue(value);
      assert.deepEqual(parseJsonValue(copy), parseJsonValue(JSON.parse(JSON.stringify(value))));
    });
  }

  it("keeps a __proto__ key a key, polluting nothing", () => {
    const copy = copyJsonValue(JSON.parse('{"__proto__":{"polluted":true}}')) as Record<string, unknown>;
    assert.equal(Object.getPrototypeOf(copy), Object.prototype);
    assert.deepEqual(Object.keys(copy), ["__proto__"]);
    assert.equal(({} as Record<string, unknown>).polluted, undefined);
  });

  it("keeps -0, which a JSON round-trip would turn into 0", () => {
    assert.ok(Object.is(copyJsonValue([-0])[0], -0));
  });

  it("returns a copy the caller can change without touching the original", () => {
    const original = parseJsonValue({ a: { b: "kept" } }) as { a: { b: string } };
    const copy = copyJsonValue(original);
    copy.a.b = "changed";
    assert.equal(original.a.b, "kept");
  });
});
