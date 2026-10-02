import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const packageJson = JSON.parse(
  readFileSync(resolve(packageRoot, "package.json"), "utf8"),
);
const conformanceBin = "gomega-managed-site-conformance";
const conformanceUsage =
  "Usage: gomega-managed-site-conformance --contract <path> --content <path>\n" +
  "       gomega-managed-site-conformance migrate --production-contract <path> " +
  "--production-content <path> --contract <path> --content <path> " +
  "--migration <path> [--admit-bridge <version>=<integrity>]\n";

function run(command, args, env = process.env) {
  const result = spawnSync(command, args, {
    cwd: packageRoot,
    encoding: "utf8",
    env,
  });
  assert.equal(
    result.status,
    0,
    `${command} ${args.join(" ")} failed:\n${result.stderr || result.stdout}`,
  );
  return result.stdout;
}

function exportEntries() {
  assert.equal(typeof packageJson.exports, "object");
  return Object.entries(packageJson.exports);
}

function exportTargets(value) {
  assert.equal(typeof value, "object");
  assert.equal(typeof value.types, "string");
  assert.equal(typeof value.import, "string");
  assert.match(value.types, /\.d\.ts$/u);
  assert.match(value.import, /\.js$/u);
  return [value.types, value.import];
}

function packageSpecifier(subpath) {
  return subpath === "."
    ? packageJson.name
    : `${packageJson.name}${subpath.slice(1)}`;
}

const stableId = (kind, digit) => `${kind}_${digit}${"0".repeat(25)}`;

function minimalBridge() {
  return {
    reviewProtocol: 1,
    editProtocol: 2,
    annotationVersion: 1,
    delivery: {
      version: "v10",
      src: "https://app.gomega.ai/review-bridge/v10/review-bridge.js",
      integrity: `sha384-${"a".repeat(64)}`,
      crossOrigin: "anonymous",
      load: "head_defer",
    },
    framing: "authenticated_preview_gateway",
  };
}

function minimalInternalSeo(fieldId) {
  return {
    protectedFields: [],
    businessIdentity: {
      legalName: fieldId,
      displayName: fieldId,
      telephone: fieldId,
      postalAddress: fieldId,
      email: null,
      geo: null,
      openingHours: null,
      sameAs: null,
    },
    pages: [],
    generatedPages: [],
    redirects: [],
  };
}

function minimalContract() {
  const fieldId = stableId("field", "3");
  return {
    schemaVersion: "1.0",
    contractId: stableId("contract", "0"),
    adapter: { kind: "nextjs", adapterVersion: "1.0" },
    bridge: minimalBridge(),
    pages: [],
    collections: [],
    assets: [],
    internalSeo: minimalInternalSeo(fieldId),
    atomicAliasGroups: [],
    tombstonedIds: [],
  };
}

before(() => {
  run("npm", ["run", "build"]);
});

describe("packed package runtime contract", () => {
  it("ships every declared export as emitted JavaScript and declarations", () => {
    const cacheDirectory = mkdtempSync(join(tmpdir(), "managed-site-pack-"));
    try {
      const packOutput = run(
        "npm",
        ["pack", "--dry-run", "--ignore-scripts", "--json"],
        { ...process.env, npm_config_cache: cacheDirectory },
      );
      const [manifest] = JSON.parse(packOutput);
      const packedFiles = new Set(manifest.files.map(({ path }) => `./${path}`));

      assert.equal(packedFiles.has("./dist/schema.js"), false);
      assert.equal(packedFiles.has("./dist/schema.d.ts"), false);
      assert.equal(
        packedFiles.has("./schema/managed-site.v1.schema.json"),
        true,
      );
      assert.equal(
        packedFiles.has("./schema/managed-site.migration.v1.schema.json"),
        true,
      );
      const binTarget = packageJson.bin?.[conformanceBin];
      assert.equal(typeof binTarget, "string");
      assert.equal(existsSync(resolve(packageRoot, binTarget)), true);
      assert.equal(packedFiles.has(binTarget), true);

      for (const [, declaration] of exportEntries()) {
        for (const target of exportTargets(declaration)) {
          assert.equal(existsSync(resolve(packageRoot, target)), true, target);
          assert.equal(
            packedFiles.has(target),
            true,
            `${target} is absent from npm pack`,
          );
        }
      }
    } finally {
      rmSync(cacheDirectory, { force: true, recursive: true });
    }
  });

  it("imports every runtime subpath with stock Node", () => {
    const specifiers = exportEntries().map(([subpath]) =>
      packageSpecifier(subpath));
    const script =
      "const names=JSON.parse(process.argv[1]);await Promise.all(names.map((name)=>import(name)));";

    run("node", [
      "--input-type=module",
      "--eval",
      script,
      JSON.stringify(specifiers),
    ]);
  });

  it("validates both bundled roots through the packed stock-Node API", () => {
    const script = [
      "const api=await import(process.argv[1]);",
      "const inputs=JSON.parse(process.argv[2]);",
      "if(!api.validateManagedSiteContractV1JsonSchema(inputs.contract).valid)process.exit(2);",
      "if(!api.validateManagedSiteContentDocumentJsonSchema(inputs.content).valid)process.exit(3);",
    ].join("");
    run("node", [
      "--input-type=module",
      "--eval",
      script,
      packageJson.name,
      JSON.stringify({
        contract: minimalContract(),
        content: { schemaVersion: "1.0", values: [], assetManifest: [] },
      }),
    ]);
  });

  it("ships a stock-Node conformance executable with exact help", () => {
    const binTarget = packageJson.bin?.[conformanceBin];
    assert.equal(typeof binTarget, "string");
    assert.equal(
      run("node", [resolve(packageRoot, binTarget), "--help"]),
      conformanceUsage,
    );
  });
});
