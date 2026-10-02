import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import ts from "typescript";
import test from "node:test";

/**
 * `src/` is copied into customer site repositories. `packages/` is not.
 *
 * Measured across all 300 org repos on 2026-08-24: 282 carry a `package.json`,
 * and **276 of those have no `workspaces` field and no dependency on any
 * workspace package.** They are plain Next apps whose dependencies are
 * next/react/react-dom plus the occasional posthog-js and lucide-react.
 *
 * So a file under `src/` that reaches a workspace package resolves here and
 * resolves NOWHERE ELSE. The failure is silent until a customer site runs its
 * own build, and it lands when the template files are synced rather than when
 * the import is written — which is why a test has to say it.
 *
 * REACHES, not imports. `src/app/llms.txt/route.ts` imports
 * `@/content/managed-site`, which imports the contract package; the route
 * itself names no workspace package at all. A guard that inspected files one
 * at a time passed it, so this walks the module graph instead: every local
 * import is followed, and a file is at fault when anything in its closure
 * imports workspace code.
 */

/**
 * Files known not to be copied into a customer site, with the reason.
 *
 * No customer site carries `src/content/managed-site.ts`, a
 * `src/components/home/` directory, or `src/app/llms.txt/` — verified against
 * `maid-ok-website` and `all-points-media-website`, both descendants of this
 * template. Anything NOT listed fails, because the safe answer for a file
 * nobody has checked is "no".
 */
const EXEMPT_BECAUSE_THE_SUBSYSTEM_DOES_NOT_PROPAGATE = new Set([
  "src/app/page.tsx",
  "src/app/llms.txt/route.ts",
  "src/components/home/ManagedContact.tsx",
  "src/components/home/ManagedFaq.tsx",
  "src/components/home/ManagedHero.tsx",
  "src/content/managed-site.ts",
]);

const SOURCE_EXTENSIONS = [".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"];

/** Every specifier a module names, by any spelling that resolves at build time. */
const SPECIFIER_PATTERNS = [
  /\bfrom\s*["'`]([^"'`]+)["'`]/gu,
  /\bimport\s*\(\s*["'`]([^"'`]+)["'`]/gu,
  /\brequire\s*\(\s*["'`]([^"'`]+)["'`]/gu,
  /\bimport\s+["'`]([^"'`]+)["'`]/gu,
];

function repositoryFile(path) {
  return new URL(`../${path}`, import.meta.url);
}

async function readJson(path) {
  return JSON.parse(await readFile(repositoryFile(path), "utf8"));
}

/**
 * Comments removed by SCANNING, not by regex.
 *
 * A regex cannot tell a comment from a `//` inside a string, so
 * `const url = "https://example.test";` truncated the line and hid every
 * import after it — a real `require` of workspace code became invisible and
 * the file passed. The scanner copies string and template bodies through
 * verbatim, so a `//` inside one is never a comment.
 *
 * A regex literal holding a quote can still confuse it, and that direction is
 * deliberate: the worst outcome is treating regex contents as a string and
 * over-reporting, which fails a build loudly, rather than under-reporting,
 * which is the silent failure this guard exists to prevent.
 */
function withoutComments(source) {
  let out = "";
  let at = 0;
  while (at < source.length) {
    const here = source[at];
    const next = source[at + 1];
    if (here === '"' || here === "'" || here === "`") {
      out += here;
      at += 1;
      while (at < source.length) {
        if (source[at] === "\\") {
          out += source[at] + (source[at + 1] ?? "");
          at += 2;
          continue;
        }
        out += source[at];
        at += 1;
        if (source[at - 1] === here) break;
      }
      continue;
    }
    if (here === "/" && next === "/") {
      while (at < source.length && source[at] !== "\n") at += 1;
      continue;
    }
    if (here === "/" && next === "*") {
      at += 2;
      while (at < source.length && !(source[at] === "*" && source[at + 1] === "/")) at += 1;
      at += 2;
      out += " ";
      continue;
    }
    out += here;
    at += 1;
  }
  return out;
}

function specifiersIn(source) {
  const code = withoutComments(source);
  const found = new Set();
  for (const pattern of SPECIFIER_PATTERNS) {
    for (const match of code.matchAll(pattern)) found.add(match[1]);
  }
  return found;
}

/**
 * The workspace package names AND the directories they live in, both read from
 * the manifests rather than restated, so a package or a whole new workspace
 * glob added tomorrow is covered with no edit here.
 */
async function workspaces() {
  const root = await readJson("package.json");
  const names = new Set();
  const directories = new Set();
  for (const pattern of root.workspaces ?? []) {
    const directory = pattern.replace(/\/\*$/u, "");
    directories.add(directory);
    let entries;
    try {
      entries = await readdir(repositoryFile(directory), { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      try {
        const manifest = await readJson(`${directory}/${entry.name}/package.json`);
        if (typeof manifest.name === "string") names.add(manifest.name);
      } catch {
        continue;
      }
    }
  }
  return { names, directories };
}

/**
 * The compiler options this repository actually resolves with.
 *
 * Read once from `tsconfig.json` through TypeScript's own parser, so `paths`,
 * `baseUrl` and `moduleResolution` are whatever the repository says rather than
 * whatever this file guessed.
 */
function compilerOptions() {
  const configPath = new URL("../tsconfig.json", import.meta.url).pathname;
  const read = ts.readConfigFile(configPath, ts.sys.readFile);
  const parsed = ts.parseJsonConfigFileContent(
    read.config ?? {},
    ts.sys,
    new URL("..", import.meta.url).pathname,
  );
  return parsed.options;
}

/**
 * Where a specifier lands, answered by TYPESCRIPT rather than modelled here.
 *
 * This started as a hand-written resolver and drew four review rounds, each a
 * rule discovered one at a time: `@/*` aliases, then `.js` standing for `.ts`,
 * then declaration files, then the order declarations are probed in relative to
 * JavaScript. That list is finite but it is not mine to enumerate — the
 * compiler already answers it, including every extension substitution, `index`
 * lookup and probe order, and it cannot drift from what the build does.
 *
 * A resolution is workspace code when it lands inside a declared workspace
 * directory (a relative or aliased path into `packages/` or `fixtures/`) or
 * when the package it came from is a workspace package (a bare specifier, which
 * resolves through a `node_modules` link). Both are checked because they are
 * different facts.
 */
function resolveSpecifier(specifier, fromFile, { names, directories }, options, host) {
  const resolved = ts.resolveModuleName(
    specifier,
    new URL(`../${fromFile}`, import.meta.url).pathname,
    options,
    host,
  ).resolvedModule;
  if (resolved === undefined) {
    // Unresolvable here, but a bare workspace name still names workspace code:
    // a synthetic host has no `node_modules`, and neither does a customer site.
    return names.has(specifier) || [...names].some((name) => specifier.startsWith(`${name}/`))
      ? { kind: "workspace", detail: specifier }
      : { kind: "external" };
  }
  if (resolved.packageId !== undefined && names.has(resolved.packageId.name)) {
    return { kind: "workspace", detail: resolved.packageId.name };
  }
  const root = new URL("..", import.meta.url).pathname.replace(/\/$/u, "");
  // Canonicalize through the host that RESOLVED it. Reaching for `ts.sys` here
  // asked the real filesystem to realpath a synthetic path, so the rows below
  // were touching the checkout for files that exist only in their own map.
  const real = host.realpath === undefined
    ? resolved.resolvedFileName
    : host.realpath(resolved.resolvedFileName);
  const relative = real.startsWith(`${root}/`) ? real.slice(root.length + 1) : real;
  for (const directory of directories) {
    if (relative === directory || relative.startsWith(`${directory}/`)) {
      return { kind: "workspace", detail: relative };
    }
  }
  return relative.startsWith("src/")
    ? { kind: "repository", detail: relative }
    : { kind: "external" };
}

async function readIfPresent(path) {
  try {
    return await readFile(repositoryFile(path), "utf8");
  } catch {
    return null;
  }
}

async function sourceFilesUnder(directory) {
  const found = [];
  const walk = async (relative) => {
    let entries;
    try {
      entries = await readdir(repositoryFile(relative), { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const next = `${relative}/${entry.name}`;
      if (entry.isDirectory()) {
        await walk(next);
        continue;
      }
      if (SOURCE_EXTENSIONS.some((extension) => entry.name.endsWith(extension))) {
        found.push(next);
      }
    }
  };
  await walk(directory);
  return found.sort();
}

/**
 * The shortest chain from this file to workspace code, or null.
 *
 * Breadth-first so the reported chain is the shortest one, which is the one a
 * person can act on. Following a local import into a file that is itself
 * exempt is still a fault: the exemption says that FILE is not copied, not
 * that its dependency is available to whoever imports it.
 */
async function chainToWorkspace(entry, spaces, options, files = null) {
  const host = files === null ? ts.sys : hostFor(files);
  const read = files === null
    ? readIfPresent
    : async (path) => (Object.hasOwn(files, path) ? files[path] : null);
  const queue = [[entry]];
  const seen = new Set([entry]);
  while (queue.length > 0) {
    const chain = queue.shift();
    const file = chain[chain.length - 1];
    const source = await read(file);
    if (source === null) continue;
    for (const specifier of specifiersIn(source)) {
      const resolved = resolveSpecifier(specifier, file, spaces, options, host);
      if (resolved.kind === "workspace") return [...chain, resolved.detail];
      if (resolved.kind !== "repository" || seen.has(resolved.detail)) continue;
      seen.add(resolved.detail);
      queue.push([...chain, resolved.detail]);
    }
  }
  return null;
}

/**
 * A resolution host over a literal file map.
 *
 * `ts.sys` serves the real tree; this serves the synthetic rows, which is what
 * lets them exercise the REAL resolver against a made-up graph instead of a
 * second implementation of one.
 */
function hostFor(files) {
  const root = new URL("..", import.meta.url).pathname.replace(/\/$/u, "");
  const keyOf = (path) => (path.startsWith(`${root}/`) ? path.slice(root.length + 1) : path);
  return {
    fileExists: (path) => Object.hasOwn(files, keyOf(path)),
    readFile: (path) => (Object.hasOwn(files, keyOf(path)) ? files[keyOf(path)] : undefined),
    realpath: (path) => path,
    directoryExists: (path) => {
      const prefix = `${keyOf(path)}/`;
      return Object.keys(files).some((name) => name.startsWith(prefix));
    },
  };
}

test("no file under src/ reaches workspace code unless it is known not to propagate", async () => {
  const spaces = await workspaces();
  const options = compilerOptions();
  assert.ok(spaces.names.size > 0, "no workspace package names were found to check against");
  assert.ok(spaces.directories.size > 0, "no workspace directories were found to check against");
  assert.ok(
    options.paths !== undefined,
    "tsconfig declared no path aliases, so `@/…` would not resolve and this guard sees less than the build",
  );

  const offenders = {};
  for (const file of await sourceFilesUnder("src")) {
    if (EXEMPT_BECAUSE_THE_SUBSYSTEM_DOES_NOT_PROPAGATE.has(file)) continue;
    const chain = await chainToWorkspace(file, spaces, options);
    if (chain !== null) offenders[file] = chain.join(" -> ");
  }

  assert.deepEqual(
    offenders,
    {},
    "These files are under src/, which is copied into ~276 customer site repos that have no " +
      "packages/ directory and no workspace dependency, so the chain shown resolves here and " +
      "nowhere else and their build fails silently after the next template sync. Move the " +
      "shared code into src/lib/ as dependency-free source and have the package import it, or " +
      "add the file to EXEMPT_BECAUSE_THE_SUBSYSTEM_DOES_NOT_PROPAGATE with evidence that no " +
      "customer site carries it.",
  );
});

test("the exempt list names only files that exist and actually reach workspace code", async () => {
  const spaces = await workspaces();
  const options = compilerOptions();
  const stale = [];
  for (const file of EXEMPT_BECAUSE_THE_SUBSYSTEM_DOES_NOT_PROPAGATE) {
    if ((await readIfPresent(file)) === null) {
      stale.push(`${file} (no such file)`);
      continue;
    }
    if ((await chainToWorkspace(file, spaces, options)) === null) {
      stale.push(`${file} (no longer reaches workspace code)`);
    }
  }
  // An exemption that outlives its reason is how an allowlist stops being read.
  assert.deepEqual(stale, [], "Remove these from the exempt list.");
});

/**
 * The graph walk, exercised on synthetic module sets.
 *
 * The repository-wide tests above are an assertion about THIS tree, so they go
 * green the moment the tree is clean and prove nothing about what the guard can
 * see. These rows are the guard's own coverage, and each is a spelling that
 * reached workspace code while the first version of this file passed it.
 */
const SPACES = {
  names: new Set(["@landing-pages-websites/managed-site-contract"]),
  directories: new Set(["packages", "fixtures"]),
};
const OPTIONS = compilerOptions();

const GRAPH_CASES = [
  {
    why: "a direct bare import",
    files: { "src/a.ts": 'import { x } from "@landing-pages-websites/managed-site-contract";' },
    reaches: true,
  },
  {
    why: "a subpath of a workspace package",
    files: {
      "src/a.ts": 'import { x } from "@landing-pages-websites/managed-site-contract/dist/seo";',
    },
    reaches: true,
  },
  {
    why: "a local wrapper, one hop away",
    files: {
      "src/a.ts": 'import { x } from "@/b";',
      "src/b.ts": 'import { y } from "@landing-pages-websites/managed-site-contract";',
    },
    reaches: true,
  },
  {
    why: "a local wrapper, three hops away",
    files: {
      "src/a.ts": 'import { x } from "./b";',
      "src/b.ts": 'import { x } from "./c";',
      "src/c.ts": 'import { x } from "./d";',
      "src/d.ts": 'import { y } from "@landing-pages-websites/managed-site-contract";',
    },
    reaches: true,
  },
  {
    why: "an alias that climbs out of src into packages",
    files: {
      "src/a.ts": 'import { x } from "@/../packages/managed-site-contract/src/index";',
      "packages/managed-site-contract/src/index.ts": "export const x = 1;",
    },
    reaches: true,
  },
  {
    why: "a relative path into the fixtures workspace",
    files: {
      "src/a.ts": 'import { x } from "../fixtures/astro-reference/thing";',
      "fixtures/astro-reference/thing.ts": "export const x = 1;",
    },
    reaches: true,
  },
  {
    why: "a dynamic import of workspace code",
    files: { "src/a.ts": 'const m = await import("@landing-pages-websites/managed-site-contract");' },
    reaches: true,
  },
  {
    why: "a require of workspace code",
    files: { "src/a.ts": 'const m = require("@landing-pages-websites/managed-site-contract");' },
    reaches: true,
  },
  {
    why: "a directory import resolved through index",
    files: {
      "src/a.ts": 'import { x } from "@/thing";',
      "src/thing/index.ts": 'import { y } from "@landing-pages-websites/managed-site-contract";',
    },
    reaches: true,
  },
  {
    why: "a cycle that never reaches workspace code",
    files: {
      "src/a.ts": 'import { x } from "./b";',
      "src/b.ts": 'import { x } from "./a"; import { readFile } from "node:fs";',
    },
    reaches: false,
  },
  {
    why: "a specifier that only appears in a line comment",
    files: { "src/a.ts": '// import { x } from "@landing-pages-websites/managed-site-contract";' },
    reaches: false,
  },
  {
    // The commented-out import must carry the `import` keyword, or the pattern
    // finds nothing whether the comment is stripped or not and the row proves
    // nothing — which is how it was written first.
    why: "a commented-out import inside a block comment",
    files: {
      "src/a.ts":
        '/* import { x } from "@landing-pages-websites/managed-site-contract"; */\n' +
        "export const x = 1;",
    },
    reaches: false,
  },
  {
    why: "an ordinary external dependency",
    files: { "src/a.ts": 'import Link from "next/link"; import { readFile } from "node:fs";' },
    reaches: false,
  },
  {
    why: "a wrapper imported with a .js extension that is really TypeScript",
    files: {
      "src/a.ts": 'import { x } from "./b.js";',
      "src/b.ts": 'import { y } from "@landing-pages-websites/managed-site-contract";',
    },
    reaches: true,
  },
  {
    why: "a .mjs specifier resolving to .mts",
    files: {
      "src/a.ts": 'import { x } from "./b.mjs";',
      "src/b.mts": 'import { y } from "@landing-pages-websites/managed-site-contract";',
    },
    reaches: true,
  },
  {
    why: "a .cjs specifier resolving to .cts",
    files: {
      "src/a.ts": 'import { x } from "./b.cjs";',
      "src/b.cts": 'import { y } from "@landing-pages-websites/managed-site-contract";',
    },
    reaches: true,
  },
  {
    why: "a .js specifier resolving to a .d.ts declaration",
    files: {
      "src/a.ts": 'import type { X } from "./types.js";',
      "src/types.d.ts": 'import type { Y } from "@landing-pages-websites/managed-site-contract";',
    },
    reaches: true,
  },
  {
    why: "a .mjs specifier resolving to a .d.mts declaration",
    files: {
      "src/a.ts": 'import type { X } from "./types.mjs";',
      "src/types.d.mts": 'import type { Y } from "@landing-pages-websites/managed-site-contract";',
    },
    reaches: true,
  },
  {
    why: "a .cjs specifier resolving to a .d.cts declaration",
    files: {
      "src/a.ts": 'import type { X } from "./types.cjs";',
      "src/types.d.cts": 'import type { Y } from "@landing-pages-websites/managed-site-contract";',
    },
    reaches: true,
  },
  {
    why: "an extensionless specifier resolving to a declaration",
    files: {
      "src/a.ts": 'import type { X } from "./types";',
      "src/types.d.ts": 'import type { Y } from "@landing-pages-websites/managed-site-contract";',
    },
    reaches: true,
  },
  {
    why: "a directory index that is a declaration",
    files: {
      "src/a.ts": 'import type { X } from "./shapes";',
      "src/shapes/index.d.ts":
        'import type { Y } from "@landing-pages-websites/managed-site-contract";',
    },
    reaches: true,
  },
  {
    // The implementation wins where both exist, which is TypeScript's order.
    why: "an implementation preferred over a declaration beside it",
    files: {
      "src/a.ts": 'import { x } from "./both.js";',
      "src/both.ts": 'import { readFile } from "node:fs"; export const x = readFile;',
      "src/both.d.ts": 'import type { Y } from "@landing-pages-websites/managed-site-contract";',
    },
    reaches: false,
  },
  {
    // TypeScript picks the DECLARATION here — verified by asking it directly,
    // not assumed. A hand-written probe order got this backwards, which is why
    // the resolver is no longer hand-written.
    why: "extensionless, where only the declaration reaches workspace code",
    files: {
      "src/a.ts": 'import type { X } from "./types";',
      "src/types.js": "export const x = 1;",
      "src/types.d.ts": 'import type { Y } from "@landing-pages-websites/managed-site-contract";',
    },
    reaches: true,
  },
  {
    why: "extensionless, where the implementation beside it wins",
    files: {
      "src/a.ts": 'import { x } from "./types";',
      "src/types.ts": "import { readFile } from 'node:fs'; export const x = readFile;",
      "src/types.js": "export const x = 1;",
      "src/types.d.ts": 'import type { Y } from "@landing-pages-websites/managed-site-contract";',
    },
    reaches: false,
  },
  {
    why: "a directory index collision, where the declaration wins",
    files: {
      "src/a.ts": 'import type { X } from "./shapes";',
      "src/shapes/index.js": "export const x = 1;",
      "src/shapes/index.d.ts":
        'import type { Y } from "@landing-pages-websites/managed-site-contract";',
    },
    reaches: true,
  },
  {
    why: "a .js specifier where the declaration beside it wins",
    files: {
      "src/a.ts": 'import type { X } from "./types.js";',
      "src/types.js": "export const x = 1;",
      "src/types.d.ts": 'import type { Y } from "@landing-pages-websites/managed-site-contract";',
    },
    reaches: true,
  },
  {
    why: "a .js specifier that really is JavaScript",
    files: {
      "src/a.ts": 'import { x } from "./b.js";',
      "src/b.js": 'import { y } from "@landing-pages-websites/managed-site-contract";',
    },
    reaches: true,
  },
  {
    // A `//` inside a string is not a comment. Both halves of this row matter:
    // the URL is protocol-relative, so nothing precedes `//` that a regex could
    // use to tell it from a comment, and the require is on the SAME LINE, so a
    // line comment would swallow it. Written any other way the row passes with
    // the bug still in place — verified by mutation.
    why: "a require on the same line as a protocol-relative URL",
    files: {
      "src/a.ts":
        'const endpoint = "//example.test"; ' +
        'const contract = require("@landing-pages-websites/managed-site-contract");',
    },
    reaches: true,
  },
  {
    why: "the same line with no import at all",
    files: { "src/a.ts": 'export const endpoint = "//example.test"; export const n = 1;' },
    reaches: false,
  },
  {
    why: "a template literal holding a protocol-relative URL, same line",
    files: {
      "src/a.ts":
        "const endpoint = `//example.test`; " +
        'import { y } from "@landing-pages-websites/managed-site-contract";',
    },
    reaches: true,
  },
  {
    why: "a block comment closing before a real import on the same line",
    files: {
      "src/a.ts":
        '/* see the contract */ import { y } from "@landing-pages-websites/managed-site-contract";',
    },
    reaches: true,
  },
  {
    why: "a local import that does not exist",
    files: { "src/a.ts": 'import { x } from "@/missing";' },
    reaches: false,
  },
];

for (const { why, files, reaches } of GRAPH_CASES) {
  test(`the walk ${reaches ? "finds" : "does not find"} workspace code: ${why}`, async () => {
    const chain = await chainToWorkspace("src/a.ts", SPACES, OPTIONS, files);
    assert.equal(chain !== null, reaches, `chain was ${JSON.stringify(chain)}`);
  });
}

/**
 * The synthetic rows must not touch the checkout.
 *
 * The resolver was canonicalizing through `ts.sys.realpath` while resolving
 * through the in-memory host, so a row naming `src/b.ts` — a file that exists
 * only in its own map — asked the real filesystem about it. This asserts the
 * separation instead of trusting it: every path the host is asked about is one
 * the map declares, and `ts.sys` is never consulted.
 */
test("a synthetic graph never reaches the real filesystem", async () => {
  const files = {
    "src/a.ts": 'import { x } from "@/b";',
    "src/b.ts": 'import { y } from "@landing-pages-websites/managed-site-contract";',
  };
  const base = hostFor(files);
  assert.equal(
    typeof base.realpath,
    "function",
    "the synthetic host must offer realpath, or resolution silently falls back to ts.sys's view",
  );
  const asked = [];
  const spy = {
    ...base,
    realpath: (path) => {
      asked.push(path);
      return path;
    },
  };
  // Resolve exactly as the walk does, with the spy in place of the host.
  const resolved = resolveSpecifier("@/b", "src/a.ts", SPACES, OPTIONS, spy);
  assert.equal(resolved.kind, "repository", JSON.stringify(resolved));
  assert.equal(resolved.detail, "src/b.ts");
  assert.ok(asked.length > 0, "the host's realpath was never consulted, so ts.sys still could be");
  for (const path of asked) {
    assert.ok(
      path.endsWith("src/b.ts"),
      `realpath was asked about ${path}, which the synthetic map does not declare`,
    );
  }
});

test("the reported chain names every hop, so a person can act on it", async () => {
  const chain = await chainToWorkspace("src/a.ts", SPACES, OPTIONS, {
    "src/a.ts": 'import { x } from "@/b";',
    "src/b.ts": 'import { y } from "@landing-pages-websites/managed-site-contract";',
  });
  assert.deepEqual(chain, [
    "src/a.ts",
    "src/b.ts",
    "@landing-pages-websites/managed-site-contract",
  ]);
});
