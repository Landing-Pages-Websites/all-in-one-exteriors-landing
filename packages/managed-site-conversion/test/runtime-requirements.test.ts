import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { run as runCli } from "../src/cli.js";
import { runtimeModule } from "../src/runtime-module.js";
import {
  importedNames,
  importedPackages,
  importFloor,
  runtimeRequirementRefusals,
  verifiedContractVersion,
} from "../src/runtime-requirements.js";
import { configFor, run, workspace } from "./support/proposals.js";

/**
 * The converter writes a runtime but never touches a site's dependencies, so
 * it must refuse, before writing anything, a site whose packages cannot build
 * what it would write. All Points Media pins the contract at 0.6.0.
 */

const CONTRACT = "@landing-pages-websites/managed-site-contract";
/**
 * Versions relative to the pin: V() is it, V(1) the next minor, V(-1) the one
 * before. The pin may be a patch release (0.16.1), and the window starts at
 * it, so the pin's own minor defaults to the pin's patch.
 */
const PINNED = verifiedContractVersion().split(".").map(Number) as [number, number, number];
const V = (minorOffset = 0, patch = minorOffset === 0 ? PINNED[2] : 0): string =>
  `0.${String(PINNED[1] + minorOffset)}.${String(patch)}`;
const WINDOW = `0.${String(PINNED[1])}.x`;
const runtimeText = runtimeModule(run(workspace("clientcollection", configFor(["/"]))), "src/content").text;

/**
 * The react typings every declared test site carries, since the generated
 * runtime is TypeScript; the type requirement's own test leaves them out.
 */
const REACT_TYPES = { "@types/react": "^19" };

function repoWith(
  dependencies: Readonly<Record<string, string>> | null,
  installed: Readonly<Record<string, string>> = {},
  devDependencies: Readonly<Record<string, string>> = REACT_TYPES,
): string {
  const root = mkdtempSync(join(tmpdir(), "runtime-requirements-"));
  if (dependencies !== null) writeFileSync(join(root, "package.json"), JSON.stringify({ dependencies, devDependencies }));
  for (const [name, version] of Object.entries(installed)) {
    mkdirSync(join(root, "node_modules", name), { recursive: true });
    writeFileSync(join(root, "node_modules", name, "package.json"), JSON.stringify({ name, version }));
  }
  return root;
}

test("the packages checked are read off the generated module's own imports", () => {
  assert.deepEqual(importedPackages(runtimeText), [CONTRACT, "next", "react"]);
  assert.deepEqual(
    importedPackages('import a from "next/navigation";\nimport b from "@scope/pkg/sub";\nimport c from "./local";\n'),
    ["@scope/pkg", "next"],
    "a subpath import is checked as its package",
  );
  const workspaceContract = JSON.parse(
    readFileSync(new URL("../../managed-site-contract/package.json", import.meta.url), "utf8"),
  ) as { readonly version: string };
  assert.equal(verifiedContractVersion(), workspaceContract.version, "the pin is the contract the tests run against");
});

test("the contract must lie in the verified minor, however it is declared or installed", () => {
  const ok = { next: "16.2.10", react: "19.2.4" };
  const cases: readonly [string, Readonly<Record<string, string>> | null, Readonly<Record<string, string>>, boolean][] = [
    ["All Points Media's pin", { ...ok, [CONTRACT]: "0.6.0" }, {}, false],
    ["the release before", { ...ok, [CONTRACT]: `^${V(-1)}` }, {}, false],
    ["the verified version", { ...ok, [CONTRACT]: V() }, {}, true],
    ["a later patch", { ...ok, [CONTRACT]: V(0, PINNED[2] + 3) }, {}, true],
    ["a caret on it", { ...ok, [CONTRACT]: `^${V()}` }, {}, true],
    ["a tilde on it", { ...ok, [CONTRACT]: `~${V()}` }, {}, true],
    ["the next minor, breaking in 0.x", { ...ok, [CONTRACT]: V(1) }, {}, false],
    ["a tilde on the next minor", { ...ok, [CONTRACT]: `~${V(1, 2)}` }, {}, false],
    ["an open floor", { ...ok, [CONTRACT]: `>=${V()}` }, {}, false],
    ["a tag nobody can judge", { ...ok, [CONTRACT]: "latest" }, {}, false],
    ["a workspace alias", { ...ok, [CONTRACT]: "workspace:*" }, {}, false],
    ["an npm alias", { ...ok, [CONTRACT]: `npm:${CONTRACT}@${V()}` }, {}, false],
    ["declared in window, installed old", { ...ok, [CONTRACT]: V() }, { [CONTRACT]: "0.6.0" }, false],
    ["declared in window, installed next minor", { ...ok, [CONTRACT]: V() }, { [CONTRACT]: V(1) }, false],
    ["only installed, in window", ok, { [CONTRACT]: V() }, false],
    ["only installed, and old", ok, { [CONTRACT]: V(-1) }, false],
    ["absent everywhere", ok, {}, false],
    ["no package.json, all installed", null, { [CONTRACT]: V(), next: "16.2.10", react: "19.2.4" }, false],
    ["react missing", { next: "16.2.10", [CONTRACT]: V() }, {}, false],
  ];
  for (const [name, declared, installed, builds] of cases) {
    const refusals = runtimeRequirementRefusals(repoWith(declared, installed), runtimeText);
    assert.equal(refusals.length === 0, builds, `${name}: ${refusals.join("; ")}`);
  }
  const alias = runtimeRequirementRefusals(repoWith({ ...ok, [CONTRACT]: `npm:${CONTRACT}@${V()}` }), runtimeText);
  assert.match(alias.join(" "), /aliases are not supported/u);
  const nextMinor = runtimeRequirementRefusals(repoWith({ ...ok, [CONTRACT]: V(1) }), runtimeText);
  assert.match(nextMinor.join(" "), new RegExp(`verified against .* ${WINDOW.replace(/\./gu, "\\.")}.*update the converter`, "u"));
});

function install(root: string, packages: Readonly<Record<string, string>>): void {
  for (const [name, version] of Object.entries(packages)) {
    mkdirSync(join(root, "node_modules", name), { recursive: true });
    writeFileSync(join(root, "node_modules", name, "package.json"), JSON.stringify({ name, version }));
  }
}

function siteWithManifest(manifest: Readonly<Record<string, unknown>>): string {
  const root = mkdtempSync(join(tmpdir(), "runtime-requirements-"));
  const devDependencies = { ...REACT_TYPES, ...(manifest.devDependencies as Record<string, string> | undefined) };
  writeFileSync(join(root, "package.json"), JSON.stringify({ ...manifest, devDependencies }));
  return root;
}

/**
 * Every package the generated module imports must be declared by the site
 * itself, in dependencies or devDependencies -- what a clean deploy install
 * provides. An installed copy is checked in addition, never instead.
 */
test("every imported package is declared in the site's own dependencies or devDependencies", () => {
  const all = { [CONTRACT]: V(), next: "16.2.10", react: "19.2.4" };
  const accepted: readonly [string, Readonly<Record<string, unknown>>][] = [
    ["all in dependencies", { dependencies: all }],
    ["all in devDependencies (a Next build installs them)", { devDependencies: all }],
    ["split across both", { dependencies: { [CONTRACT]: V(), next: "16.2.10" }, devDependencies: { react: "19.2.4" } }],
  ];
  for (const [name, manifest] of accepted) {
    assert.deepEqual(runtimeRequirementRefusals(siteWithManifest(manifest), runtimeText), [], name);
  }
  const refused: readonly [string, Readonly<Record<string, unknown>>, string, RegExp][] = [
    ["react only in peerDependencies", { dependencies: { [CONTRACT]: V(), next: "16.2.10" }, peerDependencies: { react: "19.2.4" } }, "react", /declare react in package\.json.*only in peerDependencies/u],
    ["next only in optionalDependencies", { dependencies: { [CONTRACT]: V(), react: "19.2.4" }, optionalDependencies: { next: "16.2.10" } }, "next", /declare next in package\.json.*only in optionalDependencies/u],
    ["next as workspace:", { dependencies: { ...all, next: "workspace:*" } }, "next", /declares next as "workspace:\*", which a deploy cannot install/u],
    ["react as file:", { dependencies: { ...all, react: "file:../react" } }, "react", /declares react as "file:\.\.\/react"/u],
    ["the contract as link:", { dependencies: { ...all, [CONTRACT]: "link:../contract" } }, CONTRACT, /which a deploy cannot install/u],
  ];
  for (const [name, manifest, pkg, message] of refused) {
    const refusals = runtimeRequirementRefusals(siteWithManifest(manifest), runtimeText);
    assert.equal(refusals.length, 1, `${name}: ${refusals.join("; ")}`);
    assert.match(refusals[0] ?? "", message, name);
    assert.ok((refusals[0] ?? "").includes(pkg), name);
  }
  // Installed but not declared, for each package: refused, naming what to declare.
  for (const missing of [CONTRACT, "next", "react"]) {
    const declared = Object.fromEntries(Object.entries(all).filter(([name]) => name !== missing));
    const root = siteWithManifest({ dependencies: declared });
    install(root, all);
    const refusals = runtimeRequirementRefusals(root, runtimeText);
    assert.equal(refusals.length, 1, `${missing}: ${refusals.join("; ")}`);
    assert.match(refusals[0] ?? "", new RegExp(`declare ${missing.replace(/[/.]/gu, "\\$&")} in package\\.json.*installed .* but not declared`, "u"));
  }
});

/**
 * Decision: a declaration in a parent or workspace-root manifest does not
 * count. It is installed only when the site is built as that workspace's
 * member, which the site's own deploy does not promise; the site declares what
 * its runtime imports.
 */
test("a declaration only in a parent or workspace-root package.json is refused", () => {
  const all = { [CONTRACT]: V(), next: "16.2.10", react: "19.2.4" };
  const monorepo = mkdtempSync(join(tmpdir(), "runtime-requirements-"));
  mkdirSync(join(monorepo, ".git"));
  writeFileSync(join(monorepo, "package.json"), JSON.stringify({ workspaces: ["apps/*"], dependencies: { ...all, ...REACT_TYPES } }));
  install(monorepo, all);
  const site = join(monorepo, "apps", "web");
  mkdirSync(site, { recursive: true });
  writeFileSync(join(site, "package.json"), JSON.stringify({ name: "web" }));
  const refusals = runtimeRequirementRefusals(site, runtimeText);
  assert.equal(refusals.length, 4, refusals.join("; "));
  for (const refusal of refusals) assert.match(refusal, /declared only in .*package\.json, not the site's own package\.json/u);
  // Declared by the site itself, the root's hoisted install is its install.
  writeFileSync(join(site, "package.json"), JSON.stringify({ name: "web", dependencies: all, devDependencies: REACT_TYPES }));
  assert.deepEqual(runtimeRequirementRefusals(site, runtimeText), []);
});

test("an installed copy is found no higher than the site's git root, and checked in addition", () => {
  const all = { [CONTRACT]: V(), next: "16.2.10", react: "19.2.4" };
  const outer = mkdtempSync(join(tmpdir(), "runtime-requirements-"));
  install(outer, { ...all, [CONTRACT]: "0.6.0" });
  const site = join(outer, "site");
  mkdirSync(join(site, ".git"), { recursive: true });
  writeFileSync(join(site, "package.json"), JSON.stringify({ dependencies: all, devDependencies: REACT_TYPES }));
  assert.deepEqual(runtimeRequirementRefusals(site, runtimeText), [], "the old copy above the git root is not the site's");
  install(site, { ...all, [CONTRACT]: "0.6.0" });
  assert.match(
    runtimeRequirementRefusals(site, runtimeText).join(" "),
    /0\.6\.0 is installed/u,
    "an old copy the site would build with is refused though the declaration is right",
  );
});

/**
 * next and react are gated by the API the generated module imports from them:
 * the floor is derived from the imported names, and a declared range's lower
 * bound, or an installed copy, below it is refused before anything is written.
 */
test("next and react must be at least the version their imported names need", () => {
  const names = importedNames(runtimeText);
  assert.deepEqual([...(names.get("next") ?? [])], ["Metadata"]);
  assert.deepEqual([...(names.get("react") ?? [])].sort(), ["Fragment", "ReactNode", "createElement"]);
  assert.deepEqual(importFloor("next", names.get("next") ?? new Set()), { floor: "13.2.0" });
  assert.deepEqual(importFloor("react", names.get("react") ?? new Set()), { floor: "16.2.0" });
  assert.deepEqual(importFloor("next", new Set(["Metadata", "unstable_cache"])), { unknown: ["unstable_cache"] }, "an unknown name has no floor");

  const base = { [CONTRACT]: V(), next: "16.2.10", react: "19.2.4" };
  const cases: readonly [string, Readonly<Record<string, string>>, RegExp | null][] = [
    ["next 13.1.6", { ...base, next: "13.1.6" }, /declares next "13\.1\.6".*needs next 13\.2\.0 or later/u],
    ["next ^13.1.0", { ...base, next: "^13.1.0" }, /needs next 13\.2\.0/u],
    ["next 13.2.0", { ...base, next: "13.2.0" }, null],
    ["next ^14", { ...base, next: "^14" }, null],
    ["next 13.2.x", { ...base, next: "13.2.x" }, null],
    ["next >=13.2.0", { ...base, next: ">=13.2.0" }, null],
    ["next latest", { ...base, next: "latest" }, /declares next "latest"/u],
    ["next <15", { ...base, next: "<15" }, /declares next "<15"/u],
    ["next as a canary", { ...base, next: "15.0.0-canary.1" }, /declares next "15\.0\.0-canary\.1"/u],
    ["react 16.1.1", { ...base, react: "16.1.1" }, /declares react "16\.1\.1".*needs react 16\.2\.0 or later/u],
    ["react 16.2.0", { ...base, react: "16.2.0" }, null],
    ["the Next reference site (16.2.10 / 19.2.4)", base, null],
    ["All Points Media (next 14.2.15, react ^18.3.1)", { ...base, next: "14.2.15", react: "^18.3.1" }, null],
  ];
  for (const [name, dependencies, refused] of cases) {
    const refusals = runtimeRequirementRefusals(repoWith(dependencies), runtimeText);
    if (refused === null) assert.deepEqual(refusals, [], name);
    else {
      assert.equal(refusals.length, 1, `${name}: ${refusals.join("; ")}`);
      assert.match(refusals[0] ?? "", refused, name);
    }
  }
  // An installed copy is held to the same floor, in addition to the declaration.
  const oldCopy = repoWith(base, { next: "13.1.6", react: "19.2.4", [CONTRACT]: V() });
  assert.match(runtimeRequirementRefusals(oldCopy, runtimeText).join(" "), /next 13\.1\.6 is installed.*needs next 13\.2\.0/u);
  const canaryAtFloor = repoWith(base, { next: "13.2.0-canary.3", react: "19.2.4", [CONTRACT]: V() });
  assert.match(runtimeRequirementRefusals(canaryAtFloor, runtimeText).join(" "), /13\.2\.0-canary\.3 is installed/u, "a prerelease precedes its release");
});

/**
 * Every module-reference form is read, and one whose names cannot be floored
 * fails closed: a side-effect import names nothing, a whole-module reference
 * names "*", and neither is in the table, so the package is refused rather
 * than floored at 0.0.0.
 */
test("every module-reference form is read, and one with no known floor is refused", () => {
  const base = { [CONTRACT]: V(), next: "16.2.10", react: "19.2.4" };
  const forms: readonly [string, string, string][] = [
    ["a side-effect import", 'import "next";', "next"],
    ["a type-only import of an unlisted name", 'import type { Viewport } from "next";', "next"],
    ["a named re-export", 'export { unstable_cache } from "next/cache";', "next"],
    ["a whole-module re-export", 'export * from "react";', "react"],
    ["a namespace re-export", 'export * as R from "react";', "react"],
    ["a dynamic import()", 'export async function load() { return import("next/headers"); }', "next"],
    ["an import type", 'export type M = import("next").Metadata;', "next"],
    ["import = require()", 'import R = require("react");', "react"],
    ["a require() call", 'export const r = require("react");', "react"],
  ];
  for (const [name, line, pkg] of forms) {
    const text = runtimeText + "\n" + line + "\n";
    assert.ok(importedPackages(text).includes(pkg), `${name}: ${pkg} is a referenced package`);
    const refusals = runtimeRequirementRefusals(repoWith(base), text);
    assert.equal(refusals.length, 1, `${name}: ${refusals.join("; ")}`);
    assert.match(refusals[0] ?? "", new RegExp(`from ${pkg}, which has no known minimum version; update the converter`, "u"), name);
  }
  // References that are not imports still name a package, and fail closed.
  const escapes: readonly [string, string, string][] = [
    ["a /// <reference types> directive", '/// <reference types="next" />', "next"],
    ["an import() type in JSDoc", '/** @type {import("next").Metadata} */\nexport const jsdoc = {};', "next"],
    ["require.resolve()", 'export const resolved = require.resolve("react");', "react"],
  ];
  for (const [name, line, pkg] of escapes) {
    const text = line + "\n" + runtimeText;
    assert.ok(importedPackages(text).includes(pkg), `${name}: ${pkg} is a referenced package`);
    assert.match(
      runtimeRequirementRefusals(repoWith(base), text).join(" "),
      new RegExp(`from ${pkg}, which has no known minimum version`, "u"),
      name,
    );
  }
  // A loader built at runtime cannot be read at all.
  for (const line of [
    'import { createRequire } from "node:module";\nexport const loaded = createRequire(import.meta.url)("react");',
    "export const indirect = (load: () => (name: string) => unknown) => load()(\"react\");",
  ]) {
    assert.ok(importedPackages(line).includes("(unresolved)"), line);
    assert.match(runtimeRequirementRefusals(repoWith(base), runtimeText + "\n" + line).join(" "), /non-literal specifier or through a loader built at runtime/u, line);
  }
  // A new package named only by a re-export is still a package to declare.
  assert.deepEqual(importedPackages('export { z } from "zod";'), ["zod"]);
  // A specifier that is not a literal cannot be judged at all.
  const dynamic = "export const m = (name: string) => import(name);";
  assert.deepEqual(importedPackages(dynamic), ["(unresolved)"]);
  assert.match(
    runtimeRequirementRefusals(repoWith(base), runtimeText + "\n" + dynamic).join(" "),
    /non-literal specifier or through a loader built at runtime, which has no known minimum version; update the converter/u,
  );
  // Relative references are the site's own files.
  assert.deepEqual(importedPackages('import "./styles.css"; export * from "./other";'), []);
  // No names at all is not a floor of 0.0.0.
  assert.deepEqual(importFloor("next", new Set()), { unknown: ["(side effect)"] });
  // The generated runtime itself still passes.
  assert.deepEqual(runtimeRequirementRefusals(repoWith(base), runtimeText), []);
});

/**
 * The generated runtime is TypeScript and imports a type (ReactNode) from
 * react, which ships no declarations: they come from @types/react, which the
 * site must declare at the React release the imported names need. next ships
 * its own declarations and needs nothing more.
 */
test("the types the runtime imports resolve from a package the site declares", () => {
  const packages = { [CONTRACT]: V(), next: "16.2.10", react: "19.2.4" };
  const refusalsWith = (devDependencies: Readonly<Record<string, string>>, installed: Readonly<Record<string, string>> = {}) =>
    runtimeRequirementRefusals(repoWith(packages, installed, devDependencies), runtimeText);
  const missing = refusalsWith({});
  assert.equal(missing.length, 1, missing.join("; "));
  assert.match(missing[0] ?? "", /^declare @types\/react in package\.json dependencies or devDependencies at \^16\.2\.0 or later/u);
  assert.deepEqual(refusalsWith({ "@types/react": "^19" }), [], "declared in devDependencies");
  assert.deepEqual(refusalsWith({ "@types/react": "^18.3.5" }), [], "All Points Media's typings");
  assert.deepEqual(runtimeRequirementRefusals(repoWith({ ...packages, "@types/react": "16.2.0" }, {}, {}), runtimeText), [], "declared in dependencies, at the floor");
  assert.match(refusalsWith({ "@types/react": "16.0.40" }).join(" "), /declares @types\/react "16\.0\.40".*describe react 16\.2\.0 or later/u, "below the floor");
  assert.match(refusalsWith({ "@types/react": "latest" }).join(" "), /declares @types\/react "latest"/u);
  assert.match(refusalsWith({ "@types/react": "^19" }, { "@types/react": "16.0.40" }).join(" "), /@types\/react 16\.0\.40 is installed/u, "an old installed copy");
  // A react that ships its own declarations needs no @types/react.
  const root = mkdtempSync(join(tmpdir(), "runtime-requirements-"));
  writeFileSync(join(root, "package.json"), JSON.stringify({ dependencies: packages }));
  mkdirSync(join(root, "node_modules", "react"), { recursive: true });
  writeFileSync(join(root, "node_modules", "react", "package.json"), JSON.stringify({ name: "react", version: "19.2.4", types: "index.d.ts" }));
  assert.deepEqual(runtimeRequirementRefusals(root, runtimeText), [], "react with its own types");
});

test("the CLI refuses an old contract pin before writing anything, naming the version", () => {
  const space = workspace("apmshaped", configFor(["/", "/services", "/contact"]));
  writeFileSync(
    join(space.repositoryRoot, "package.json"),
    JSON.stringify({ dependencies: { [CONTRACT]: "0.6.0", next: "16.2.10", react: "19.2.4" } }),
  );
  const page = join(space.repositoryRoot, "app/page.tsx");
  const before = readFileSync(page, "utf8");
  const out = join(space.repositoryRoot, "..", "out");
  const written: string[] = [];
  const write = process.stdout.write.bind(process.stdout);
  process.stdout.write = ((chunk: string | Uint8Array) => {
    written.push(String(chunk));
    return true;
  }) as typeof process.stdout.write;
  let status: number;
  try {
    status = runCli(["--repo", space.repositoryRoot, "--out", out, "--config", space.configPath ?? "", "--rewire", "@/src/content/managed-site"]);
  } finally {
    process.stdout.write = write;
  }
  assert.equal(status, 1);
  assert.match(written.join(""), new RegExp(`verified against @landing-pages-websites/managed-site-contract ${WINDOW.replace(/\./gu, "\\.")}`, "u"));
  assert.equal(readFileSync(page, "utf8"), before, "no source is rewritten");
  assert.equal(existsSync(join(space.repositoryRoot, "src/content/managed-site.ts")), false, "no runtime is written");
  assert.equal(existsSync(out), false, "not even the report");
});
