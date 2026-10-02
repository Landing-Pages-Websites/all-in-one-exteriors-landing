import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { runManagedSiteConformanceCli } from "../src/conformance-cli-runner.js";
import { migrationCase, type Json } from "./field-migration-fixture.js";

const migration = migrationCase();
const FILES: ReadonlyMap<string, string> = new Map([
  ["prod-contract.json", JSON.stringify(migration.productionContract)],
  ["prod-content.json", JSON.stringify(migration.productionContent)],
  ["contract.json", JSON.stringify(migration.candidateContract)],
  ["content.json", JSON.stringify(migration.candidateContent)],
  ["migration.json", JSON.stringify(migration.declaration)],
]);
const INTEGRITY = ((migration.candidateContract.bridge as Json).delivery as Json).integrity as string;
const INPUTS = [
  "--production-contract", "prod-contract.json",
  "--production-content", "prod-content.json",
  "--contract", "contract.json",
  "--content", "content.json",
  "--migration", "migration.json",
];

function run(argv: readonly string[]) {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const exitCode = runManagedSiteConformanceCli(argv, {
    readUtf8File(path) {
      const value = FILES.get(path);
      if (value === undefined) throw new Error("missing");
      return value;
    },
    writeStdout: (value) => stdout.push(value),
    writeStderr: (value) => stderr.push(value),
  });
  const failure = stderr.length === 0 ? null : (JSON.parse(stderr.join("")) as Json);
  return { exitCode, stdout, failure };
}

describe("conformance CLI: migrate", () => {
  it("prints the proof when the admitted bridge is the candidate's", () => {
    const result = run(["migrate", ...INPUTS, "--admit-bridge", `v9=${INTEGRITY}`]);
    assert.equal(result.exitCode, 0, JSON.stringify(result.failure));
    const proof = JSON.parse(result.stdout.join("")) as Json;
    assert.equal((proof.steps as unknown[]).length, 34);
    assert.deepEqual(proof.accounting, { added: 0, candidateValues: 83, consumed: 69, productionValues: 118, targets: 34, unchanged: 49 });
  });

  const refusals: readonly [string, readonly string[], number, string][] = [
    ["no admitted bridge", ["migrate", ...INPUTS], 4, "MIGRATION_BRIDGE_UNSUPPORTED"],
    ["another integrity admitted", ["migrate", ...INPUTS, "--admit-bridge", `v9=sha384-${"A".repeat(64)}`], 4, "MIGRATION_BRIDGE_UNSUPPORTED"],
    ["another version admitted", ["migrate", ...INPUTS, "--admit-bridge", `v8=${INTEGRITY}`], 4, "MIGRATION_BRIDGE_UNSUPPORTED"],
    ["a malformed admission", ["migrate", ...INPUTS, "--admit-bridge", "v9"], 2, "CONFORMANCE_USAGE"],
    ["a missing input", ["migrate", ...INPUTS.slice(2)], 2, "CONFORMANCE_USAGE"],
    ["a repeated flag", ["migrate", ...INPUTS, "--contract", "contract.json"], 2, "CONFORMANCE_USAGE"],
    ["an unknown flag", ["migrate", ...INPUTS, "--force", "yes"], 2, "CONFORMANCE_USAGE"],
    ["an unreadable input", ["migrate", ...INPUTS.slice(0, -1), "absent.json"], 3, "CONFORMANCE_INPUT_IO"],
  ];
  for (const [name, argv, exitCode, code] of refusals) {
    it(`refuses ${name}`, () => {
      const result = run(argv);
      assert.equal(result.exitCode, exitCode);
      assert.equal(result.failure?.code, code);
      assert.deepEqual(result.stdout, []);
    });
  }
});
