import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  canonicalizeJson,
  normalizeManagedSiteArtifactsV1,
  parseManagedSiteContentDocument,
  parseManagedSiteContractV1,
} from "../src/index.js";
import {
  MANAGED_SITE_CONFORMANCE_USAGE,
  runManagedSiteConformanceCli,
  type ManagedSiteConformanceCliIo,
} from "../src/conformance-cli-runner.js";
import { contentSemanticsFixture } from "./content-semantics-fixture.js";

type JsonObject = Record<string, unknown>;

interface CliCapture {
  readonly io: ManagedSiteConformanceCliIo;
  readonly reads: string[];
  readonly stdout: string[];
  readonly stderr: string[];
}

function conformingFiles(): ReadonlyMap<string, string> {
  const fixture = contentSemanticsFixture();
  return new Map([
    ["contract.json", JSON.stringify(fixture.contract)],
    ["content.json", JSON.stringify(fixture.content)],
  ]);
}

function capture(
  files: ReadonlyMap<string, string> = conformingFiles(),
): CliCapture {
  const reads: string[] = [];
  const stdout: string[] = [];
  const stderr: string[] = [];
  return {
    reads,
    stdout,
    stderr,
    io: {
      readUtf8File(path) {
        reads.push(path);
        const value = files.get(path);
        if (value === undefined) throw new Error("private filesystem detail");
        return value;
      },
      writeStdout(value) {
        stdout.push(value);
      },
      writeStderr(value) {
        stderr.push(value);
      },
    },
  };
}

function validArgs(): string[] {
  return ["--contract", "contract.json", "--content", "content.json"];
}

function parseErrorLine(value: string): JsonObject {
  assert.equal(value.endsWith("\n"), true);
  const parsed = JSON.parse(value) as JsonObject;
  assert.equal(value, `${canonicalizeJson(parsed)}\n`);
  return parsed;
}

function brokenRelationshipFiles(): ReadonlyMap<string, string> {
  const fixture = contentSemanticsFixture();
  fixture.content.assetManifest = [];
  return new Map([
    ["contract.json", JSON.stringify(fixture.contract)],
    ["content.json", JSON.stringify(fixture.content)],
  ]);
}

describe("managed-site conformance CLI", () => {
  it("emits one deterministic canonical C3C artifact line", () => {
    const files = conformingFiles();
    const result = capture(files);
    const exitCode = runManagedSiteConformanceCli(validArgs(), result.io);
    const contract = parseManagedSiteContractV1(
      JSON.parse(files.get("contract.json") ?? "null"),
    );
    const content = parseManagedSiteContentDocument(
      JSON.parse(files.get("content.json") ?? "null"),
    );
    const expected = normalizeManagedSiteArtifactsV1(contract, content);

    assert.equal(exitCode, 0);
    assert.deepEqual(result.reads, ["contract.json", "content.json"]);
    assert.deepEqual(result.stderr, []);
    assert.deepEqual(result.stdout, [`${canonicalizeJson(expected)}\n`]);
    assert.deepEqual(JSON.parse(result.stdout[0]), expected);
  });

  it("accepts the two required flags in either order", () => {
    const result = capture();
    const exitCode = runManagedSiteConformanceCli(
      ["--content", "content.json", "--contract", "contract.json"],
      result.io,
    );

    assert.equal(exitCode, 0);
    assert.deepEqual(result.reads, ["contract.json", "content.json"]);
  });

  it("prints exact help without reading inputs", () => {
    const result = capture();

    assert.equal(runManagedSiteConformanceCli(["--help"], result.io), 0);
    assert.deepEqual(result.reads, []);
    assert.deepEqual(result.stdout, [MANAGED_SITE_CONFORMANCE_USAGE]);
    assert.deepEqual(result.stderr, []);
  });

  for (const testCase of [
    { name: "empty arguments", args: [] },
    { name: "missing contract value", args: ["--contract"] },
    {
      name: "missing content flag",
      args: ["--contract", "contract.json"],
    },
    {
      name: "duplicate contract flag",
      args: [
        "--contract",
        "contract.json",
        "--contract",
        "other.json",
        "--content",
        "content.json",
      ],
    },
    {
      name: "duplicate content flag",
      args: [
        "--contract",
        "contract.json",
        "--content",
        "content.json",
        "--content",
        "other.json",
      ],
    },
    {
      name: "empty contract path",
      args: ["--contract", "", "--content", "content.json"],
    },
    {
      name: "unknown flag",
      args: [
        "--contract",
        "contract.json",
        "--content",
        "content.json",
        "--output",
        "result.json",
      ],
    },
    {
      name: "positional argument",
      args: [
        "--contract",
        "contract.json",
        "--content",
        "content.json",
        "extra",
      ],
    },
    {
      name: "flag-shaped value",
      args: ["--contract", "--content", "content.json"],
    },
    {
      name: "help mixed with work",
      args: ["--help", "--contract", "contract.json"],
    },
  ]) {
    it(`rejects ${testCase.name} before reading`, () => {
      const result = capture();
      const exitCode = runManagedSiteConformanceCli(testCase.args, result.io);

      assert.equal(exitCode, 2);
      assert.deepEqual(result.reads, []);
      assert.deepEqual(result.stdout, []);
      const error = parseErrorLine(result.stderr[0]);
      assert.equal(error.code, "CONFORMANCE_USAGE");
      assert.equal(error.message, MANAGED_SITE_CONFORMANCE_USAGE.trim());
    });
  }

  it("redacts filesystem failures", () => {
    const result = capture(new Map());
    const exitCode = runManagedSiteConformanceCli(validArgs(), result.io);

    assert.equal(exitCode, 3);
    assert.deepEqual(result.stdout, []);
    const error = parseErrorLine(result.stderr[0]);
    assert.deepEqual(error, {
      code: "CONFORMANCE_INPUT_IO",
      message: "Unable to read contract input",
    });
    assert.equal(result.stderr[0].includes("private filesystem detail"), false);
    assert.equal(result.stderr[0].includes("stack"), false);
  });

  it("identifies content reads without exposing filesystem details", () => {
    const files = new Map([
      ["contract.json", conformingFiles().get("contract.json") ?? ""],
    ]);
    const result = capture(files);
    const exitCode = runManagedSiteConformanceCli(validArgs(), result.io);

    assert.equal(exitCode, 3);
    assert.deepEqual(result.reads, ["contract.json", "content.json"]);
    assert.deepEqual(result.stdout, []);
    assert.deepEqual(parseErrorLine(result.stderr[0]), {
      code: "CONFORMANCE_INPUT_IO",
      message: "Unable to read content input",
    });
    assert.equal(result.stderr[0].includes("private filesystem detail"), false);
  });

  for (const testCase of [
    {
      name: "duplicate raw keys",
      files: new Map([
        ["contract.json", '{"schemaVersion":"1.0","schemaVersion":"1.0"}'],
        ["content.json", '{"schemaVersion":"1.0","values":[],"assetManifest":[]}'],
      ]),
      code: "JSON_DUPLICATE_KEY",
    },
    {
      name: "schema-invalid contract",
      files: new Map([
        ["contract.json", "{}"],
        ["content.json", '{"schemaVersion":"1.0","values":[],"assetManifest":[]}'],
      ]),
      code: "SCHEMA_VALIDATION",
    },
    {
      name: "schema-invalid content",
      files: new Map([
        ["contract.json", conformingFiles().get("contract.json") ?? ""],
        ["content.json", "{}"],
      ]),
      code: "SCHEMA_VALIDATION",
    },
    {
      name: "broken contract-content relationship",
      files: brokenRelationshipFiles(),
      code: "CONTENT_ASSET_MANIFEST_MISSING",
    },
  ]) {
    it(`reports ${testCase.name} as conformance failure`, () => {
      const result = capture(testCase.files);
      const exitCode = runManagedSiteConformanceCli(validArgs(), result.io);

      assert.equal(exitCode, 4);
      assert.deepEqual(result.stdout, []);
      const error = parseErrorLine(result.stderr[0]);
      assert.equal(error.code, testCase.code);
      assert.equal(result.stderr[0].includes("stack"), false);
    });
  }

  it("maps unexpected output failures without exposing details", () => {
    const base = capture();
    const io: ManagedSiteConformanceCliIo = {
      ...base.io,
      writeStdout() {
        throw new Error("private output detail");
      },
    };
    const exitCode = runManagedSiteConformanceCli(validArgs(), io);

    assert.equal(exitCode, 1);
    assert.deepEqual(base.stdout, []);
    assert.deepEqual(parseErrorLine(base.stderr[0]), {
      code: "CONFORMANCE_INTERNAL",
      message: "Managed-site conformance failed unexpectedly",
    });
  });
});
