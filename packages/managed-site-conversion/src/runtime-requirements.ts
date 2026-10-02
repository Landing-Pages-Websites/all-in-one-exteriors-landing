import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import ts from "typescript";

import { RUNTIME_FILE } from "./runtime-module.js";

/**
 * What a site must have installed for the generated runtime to build.
 *
 * The converter writes the runtime but never touches a site's dependencies, so
 * without this a conversion can hand a site a module its installed packages
 * cannot compile: the runtime imports names and TYPE SHAPES from the contract
 * package that an older release does not have (All Points Media pins 0.6.0;
 * `resolveManagedImageAltText` arrived in 0.8.0, `metadata.social.imageFieldId`
 * in 0.10.0). A table of names alone would under-state it, because a name that
 * exists in an older release can still have a narrower type there (the
 * rich-text block union gained `heading` and `blockquote` in 0.7.0).
 *
 * So the requirement is the version the runtime is VERIFIED against: the
 * contract version this package itself depends on, which its type check and
 * its tests run the generated module against, up to its next minor (for 0.x a
 * minor is breaking, so the next one needs this package moved and retested
 * first). Which packages to check is read off the generated module's own
 * imports, so a new import cannot be missed.
 */

const CONTRACT_PACKAGE = "@landing-pages-websites/managed-site-contract";

interface PackageJson {
  readonly version?: string;
  readonly dependencies?: Readonly<Record<string, string>>;
  readonly devDependencies?: Readonly<Record<string, string>>;
  readonly peerDependencies?: Readonly<Record<string, string>>;
}

function readPackageJson(path: string): PackageJson | null {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as PackageJson;
  } catch {
    return null;
  }
}

/** The contract version the generated runtime is verified against. */
export function verifiedContractVersion(): string {
  const own = readPackageJson(fileURLToPath(new URL("../package.json", import.meta.url)));
  const pinned = own?.dependencies?.[CONTRACT_PACKAGE];
  if (pinned === undefined || parseVersion(pinned) === null) {
    throw new Error(`managed-site-conversion does not pin an exact ${CONTRACT_PACKAGE} version`);
  }
  return pinned;
}

/**
 * A reference that names no importable binding: a side-effect import, or a
 * reference whose names cannot be read statically (a namespace, a whole-module
 * re-export, require(), import(), an import type). Neither has an entry in
 * API_FLOORS, so a package referenced this way is refused rather than floored
 * at 0.0.0.
 */
const SIDE_EFFECT = "(side effect)";
const WHOLE_MODULE = "*";
/** The package a non-literal module specifier names: none that can be judged. */
const UNRESOLVED = "(unresolved)";

/** The string a module reference names, if it is a literal. */
function literalSpecifier(node: ts.Node | undefined): string | null {
  return node !== undefined && ts.isStringLiteralLike(node) ? node.text : null;
}

function namesOfImport(declaration: ts.ImportDeclaration): readonly string[] {
  const clause = declaration.importClause;
  if (clause === undefined) return [SIDE_EFFECT];
  const names: string[] = clause.name === undefined ? [] : ["default"];
  const bindings = clause.namedBindings;
  if (bindings !== undefined && ts.isNamespaceImport(bindings)) names.push(WHOLE_MODULE);
  if (bindings !== undefined && ts.isNamedImports(bindings)) {
    for (const element of bindings.elements) names.push((element.propertyName ?? element.name).text);
  }
  return names.length === 0 ? [SIDE_EFFECT] : names;
}

function namesOfExport(declaration: ts.ExportDeclaration): readonly string[] {
  const clause = declaration.exportClause;
  if (clause === undefined || ts.isNamespaceExport(clause)) return [WHOLE_MODULE];
  const names = clause.elements.map((element) => (element.propertyName ?? element.name).text);
  return names.length === 0 ? [SIDE_EFFECT] : names;
}

/**
 * Every module reference in the text, as the compiler parses it, with the
 * names it takes: import declarations (side-effect and type-only included),
 * export-from, `import x = require()`, `require()`, `require.resolve()` and
 * `import()` calls, import types (in code and in JSDoc), and
 * `/// <reference types>` directives. A loader built at runtime
 * (createRequire, or any call of a call's result) cannot be read and is
 * recorded as unresolved. Relative references are the site's own files and are skipped;
 * a reference whose specifier is not a string literal is kept as the package
 * "(unresolved)", which no table knows, so it is refused.
 */
function moduleReferences(runtimeText: string): ReadonlyMap<string, ReadonlySet<string>> {
  const source = ts.createSourceFile("managed-site.ts", runtimeText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const references = new Map<string, Set<string>>();
  const record = (specifier: string | null, names: readonly string[]): void => {
    if (specifier !== null && specifier.startsWith(".")) return;
    const pkg = specifier === null ? UNRESOLVED : packageNameOf(specifier);
    const bucket = references.get(pkg) ?? new Set<string>();
    references.set(pkg, bucket);
    for (const name of names) bucket.add(name);
  };
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node)) record(literalSpecifier(node.moduleSpecifier), namesOfImport(node));
    else if (ts.isExportDeclaration(node) && node.moduleSpecifier !== undefined) {
      record(literalSpecifier(node.moduleSpecifier), namesOfExport(node));
    } else if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) {
      record(literalSpecifier(node.moduleReference.expression), [WHOLE_MODULE]);
    } else if (ts.isImportTypeNode(node)) {
      const argument = node.argument;
      record(ts.isLiteralTypeNode(argument) ? literalSpecifier(argument.literal) : null, [WHOLE_MODULE]);
    } else if (ts.isCallExpression(node) && isModuleLoadingCall(node.expression)) {
      record(literalSpecifier(node.arguments[0]), [WHOLE_MODULE]);
    } else if (ts.isCallExpression(node) && ts.isCallExpression(node.expression)) {
      // A loader built at runtime, createRequire(import.meta.url)("pkg"): what
      // it loads, and from where, is not a declaration this can read.
      record(null, [WHOLE_MODULE]);
    } else if (ts.isIdentifier(node) && node.text === "createRequire") {
      record(null, [WHOLE_MODULE]);
    }
    // JSDoc is not a child in the AST, but an import() type written in it is
    // still a type the file names.
    for (const doc of (node as { readonly jsDoc?: readonly ts.Node[] }).jsDoc ?? []) visit(doc);
    ts.forEachChild(node, visit);
  };
  visit(source);
  // `/// <reference types="pkg" />` names a package's types without an import.
  for (const directive of source.typeReferenceDirectives) record(directive.fileName, [WHOLE_MODULE]);
  return references;
}

/** import(), require(), and require.resolve(): each names a module by its first argument. */
function isModuleLoadingCall(callee: ts.Expression): boolean {
  if (callee.kind === ts.SyntaxKind.ImportKeyword) return true;
  if (ts.isIdentifier(callee)) return callee.text === "require";
  return (
    ts.isPropertyAccessExpression(callee) &&
    ts.isIdentifier(callee.expression) &&
    callee.expression.text === "require" &&
    callee.name.text === "resolve"
  );
}

/**
 * Every name the generated text takes from each bare module: named imports and
 * re-exports by their exported name (type-only ones included, since a type the
 * site's copy lacks fails its type-check just the same), a default import as
 * "default", and "(side effect)" or "*" for a reference whose names cannot be
 * read -- which API_FLOORS never lists, so it fails closed.
 */
export function importedNames(runtimeText: string): ReadonlyMap<string, ReadonlySet<string>> {
  return moduleReferences(runtimeText);
}

/**
 * The first release of every name the generated module imports from a
 * framework package. A package's floor is the highest over the names it
 * actually imports, so it follows the code; a name missing here has no known
 * floor and is refused, so a new import cannot pass unexamined.
 *
 * next -- Metadata: the Metadata API (the `metadata` export, its `Metadata`
 *   type, `title.absolute`/`title.template`, `openGraph` and `twitter`, all of
 *   which managedMetadata produces) arrived in Next.js 13.2
 *   (https://nextjs.org/blog/next-13-2, "Built-in SEO Support with new
 *   Metadata API").
 * react -- Fragment: React 16.2 (https://legacy.reactjs.org/blog/2017/11/28/
 *   react-v16.2.0-fragment-support.html). createElement is older (React 0.12)
 *   and the type ReactNode is in the typings of every release since, so each
 *   is floored at 16.2.0, the release that has them all; Fragment sets it.
 *
 * No ceiling: every name here is still exported by the current majors (Next
 * 16, React 19) with no documented removal, and a ceiling would refuse a site
 * for upgrading. The contract, whose shapes the runtime reads, keeps its
 * minor window instead.
 */
const API_FLOORS: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  next: { Metadata: "13.2.0" },
  react: { createElement: "16.2.0", Fragment: "16.2.0", ReactNode: "16.2.0" },
};

/** The floor a package's imports need, or the names with no known floor. */
export function importFloor(pkg: string, names: ReadonlySet<string>): { readonly floor: string } | { readonly unknown: readonly string[] } {
  const table = API_FLOORS[pkg] ?? {};
  if (names.size === 0) return { unknown: [SIDE_EFFECT] };
  const unknown = [...names].filter((name) => table[name] === undefined).sort();
  if (unknown.length > 0) return { unknown };
  const floors = [...names].map((name) => parseVersion(table[name] as string) as Version);
  const highest = floors.reduce((top, one) => (compare(one, top) > 0 ? one : top), [0, 0, 0] as Version);
  return { floor: highest.join(".") };
}

/** Every bare module the generated text references, in any form, as the compiler reads it. */
export function importedPackages(runtimeText: string): readonly string[] {
  return [...moduleReferences(runtimeText).keys()].sort();
}

/** The package a bare specifier resolves in: "next/navigation" is next, "@a/b/c" is @a/b. */
function packageNameOf(specifier: string): string {
  const parts = specifier.split("/");
  return (specifier.startsWith("@") ? parts.slice(0, 2) : parts.slice(0, 1)).join("/");
}

type Version = readonly [number, number, number];

function parseVersion(text: string): Version | null {
  const match = /^(\d+)\.(\d+)\.(\d+)$/u.exec(text);
  return match === null ? null : [Number(match[1]), Number(match[2]), Number(match[3])];
}

/**
 * The versions the runtime is verified against: the pinned one up to its next
 * minor. For 0.x a minor bump is a breaking change, so 0.11.0 is as foreign as
 * 0.9.0 until this package is moved to it and its tests rerun.
 */
interface Window {
  readonly floor: Version;
  readonly ceiling: Version;
  readonly label: string;
}

function windowOf(pinned: string): Window {
  const floor = parseVersion(pinned) as Version;
  const ceiling: Version = floor[0] === 0 ? [0, floor[1] + 1, 0] : [floor[0] + 1, 0, 0];
  return { floor, ceiling, label: floor[0] === 0 ? `0.${String(floor[1])}.x` : `${String(floor[0])}.x` };
}

function compare(left: Version, right: Version): number {
  for (let index = 0; index < 3; index += 1) {
    const difference = (left[index] ?? 0) - (right[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

function within(version: Version, window: Window): boolean {
  return compare(version, window.floor) >= 0 && compare(version, window.ceiling) < 0;
}

/**
 * Whether EVERY version a declared range admits lies in the window. An exact
 * version is itself. A caret or tilde on 0.y.z admits [0.y.z, 0.(y+1).0), as
 * does a tilde on x.y.z within its minor; a caret on x.y.z (x > 0) admits the
 * whole major. Anything open-ended (>=, *, a tag, a URL) can resolve outside.
 */
function rangeWithin(range: string, window: Window): boolean {
  const match = /^([\^~]?)(\d+\.\d+\.\d+)$/u.exec(range.trim());
  if (match === null) return false;
  const low = parseVersion(match[2] ?? "") as Version;
  if (!within(low, window)) return false;
  if (match[1] === "") return true;
  const high: Version =
    match[1] === "~" || low[0] === 0 ? [low[0], low[1] + 1, 0] : [low[0] + 1, 0, 0];
  return compare(high, window.ceiling) <= 0;
}

/**
 * The directory a site's own install lives under: its git root, or the root
 * passed in when there is none. A node_modules above it belongs to something
 * else and says nothing about what the site's build will resolve.
 */
function installBoundary(repositoryRoot: string): string {
  let directory = repositoryRoot;
  for (;;) {
    if (existsSync(join(directory, ".git"))) return directory;
    const parent = dirname(directory);
    if (parent === directory) return repositoryRoot;
    directory = parent;
  }
}

/** The installed copy a build in the repository would resolve, walking up no further than its boundary. */
function installedVersion(repositoryRoot: string, name: string): string | null {
  const boundary = installBoundary(repositoryRoot);
  let directory = repositoryRoot;
  for (;;) {
    const found = readPackageJson(join(directory, "node_modules", name, "package.json"));
    if (found?.version !== undefined) return found.version;
    if (directory === boundary) return null;
    const parent = dirname(directory);
    if (parent === directory) return null;
    directory = parent;
  }
}

/**
 * Where a site may declare a package the generated module imports: its own
 * package.json, in dependencies or devDependencies. Both are installed by a
 * clean deploy install (`npm ci`, and Next.js builds on Vercel, install
 * devDependencies for the build that compiles the runtime), and nothing else
 * is:
 * - peerDependencies of the site's own manifest name no one to satisfy them,
 *   and optionalDependencies may silently fail to install;
 * - a parent or workspace-root manifest is installed only if the site is built
 *   as that workspace's member, which a site's own deploy does not promise;
 * - an installed copy with no declaration is an accident of this machine.
 */
const DECLARING_FIELDS = ["dependencies", "devDependencies"] as const;
const NON_DECLARING_FIELDS = ["peerDependencies", "optionalDependencies"] as const;

/** Specs whose target is this machine's layout, not the registry. */
const LOCAL_SPEC = /^\s*(?:workspace|file|link|portal):/u;

type Manifest = PackageJson & {
  readonly optionalDependencies?: Readonly<Record<string, string>>;
};

function declaredRange(repositoryRoot: string, name: string): string | null {
  const manifest = readPackageJson(join(repositoryRoot, "package.json")) as Manifest | null;
  for (const field of DECLARING_FIELDS) {
    const range = manifest?.[field]?.[name];
    if (range !== undefined) return range;
  }
  return null;
}

/** Why a package the site does not declare is missing, for the message. */
function undeclaredReason(repositoryRoot: string, name: string, installed: string | null): string {
  const manifest = readPackageJson(join(repositoryRoot, "package.json")) as Manifest | null;
  const field = NON_DECLARING_FIELDS.find((one) => manifest?.[one]?.[name] !== undefined);
  if (field !== undefined) return `it is declared only in ${field}, which a deploy install does not provide`;
  const boundary = installBoundary(repositoryRoot);
  let directory = repositoryRoot;
  while (directory !== boundary && dirname(directory) !== directory) {
    directory = dirname(directory);
    const parent = readPackageJson(join(directory, "package.json")) as Manifest | null;
    if (DECLARING_FIELDS.some((one) => parent?.[one]?.[name] !== undefined)) {
      return `it is declared only in ${join(directory, "package.json")}, not the site's own package.json`;
    }
  }
  return installed === null ? "it is not declared" : `it is installed (${installed}) but not declared`;
}

function contractProblems(declared: string, installed: string | null, window: Window, pinned: string): string[] {
  const verified = `the generated runtime is verified against ${CONTRACT_PACKAGE} ${window.label}`;
  const problems: string[] = [];
  if (declared.trim().startsWith("npm:")) {
    problems.push(`package.json declares ${CONTRACT_PACKAGE} as "${declared}"; aliases are not supported, declare ${pinned} directly`);
  } else if (!rangeWithin(declared, window)) {
    problems.push(
      `package.json declares ${CONTRACT_PACKAGE} "${declared}", which can resolve outside ${window.label}; ${verified}. ` +
        `Declare ${pinned} (or ^${pinned}), or update the converter if the site needs another version`,
    );
  }
  const installedVersionParsed = installed === null ? null : parseVersion(installed);
  if (installed !== null && (installedVersionParsed === null || !within(installedVersionParsed, window))) {
    problems.push(`${CONTRACT_PACKAGE} ${installed} is installed; ${verified}. Install ${pinned}, or update the converter`);
  }
  return problems;
}

/**
 * Why the generated runtime cannot be written into this repository, one line
 * per problem, or nothing when it can. Every package the module imports must
 * be DECLARED in the site's own dependencies or devDependencies, with a
 * registry spec. The contract's declared range must lie in the verified
 * window; next's and react's must start at or above the floor the imported
 * names need (API_FLOORS). An installed copy is checked against the same bound
 * in addition, never instead.
 */
export function runtimeRequirementRefusals(repositoryRoot: string, runtimeText: string): readonly string[] {
  const pinned = verifiedContractVersion();
  const window = windowOf(pinned);
  const names = importedNames(runtimeText);
  const packages = importedPackages(runtimeText);
  return [
    ...packages.flatMap((name) => packageProblems(repositoryRoot, name, names, window, pinned)),
    ...packages.flatMap((name) => typeProblems(repositoryRoot, name, names)),
  ];
}

/**
 * Where the TYPES of an imported package come from, when not from the package
 * itself. The generated runtime is TypeScript (RUNTIME_FILE), so every type it
 * imports must resolve from a package the site declares, or its type-check
 * fails. next ships its own declarations (its package.json `types`); react does
 * not, through 19, and is typed by DefinitelyTyped's @types/react.
 *
 * The floor is the imported names' runtime floor: DefinitelyTyped versions
 * @types/react to the React major.minor it describes, so the typings that
 * describe what the runtime imports (Fragment and ReactNode, React 16.2) are
 * @types/react 16.2 or later. Derived from API_FLOORS, never stated twice.
 */
const TYPE_PACKAGES: Readonly<Record<string, string>> = { react: "@types/react" };

const RUNTIME_IS_TYPESCRIPT = /\.(?:ts|tsx|mts|cts)$/u.test(RUNTIME_FILE);

/** Whether the site's installed copy of a package carries its own declarations. */
function shipsOwnTypes(repositoryRoot: string, name: string): boolean {
  const boundary = installBoundary(repositoryRoot);
  let directory = repositoryRoot;
  for (;;) {
    const manifest = readPackageJson(join(directory, "node_modules", name, "package.json")) as
      | (PackageJson & { readonly types?: string; readonly typings?: string })
      | null;
    if (manifest !== null) return manifest.types !== undefined || manifest.typings !== undefined;
    if (directory === boundary || dirname(directory) === directory) return false;
    directory = dirname(directory);
  }
}

function typeProblems(
  repositoryRoot: string,
  name: string,
  names: ReadonlyMap<string, ReadonlySet<string>>,
): string[] {
  const typePackage = TYPE_PACKAGES[name];
  if (!RUNTIME_IS_TYPESCRIPT || typePackage === undefined || shipsOwnTypes(repositoryRoot, name)) return [];
  const needed = importFloor(name, names.get(name) ?? new Set<string>());
  if ("unknown" in needed) return [];
  const why = `the generated runtime (TypeScript) imports types from ${name}, which does not ship its own; they come from ${typePackage}`;
  const declared = declaredRange(repositoryRoot, typePackage);
  const installed = installedVersion(repositoryRoot, typePackage);
  if (declared === null) {
    return [`declare ${typePackage} in package.json dependencies or devDependencies at ^${needed.floor} or later: ${why} (${undeclaredReason(repositoryRoot, typePackage, installed)})`];
  }
  if (LOCAL_SPEC.test(declared)) {
    return [`package.json declares ${typePackage} as "${declared}", which a deploy cannot install; declare a registry version`];
  }
  return floorCheck(typePackage, needed.floor, `${why} and must describe ${name} ${needed.floor} or later`, declared, installed);
}

function packageProblems(
  repositoryRoot: string,
  name: string,
  names: ReadonlyMap<string, ReadonlySet<string>>,
  window: Window,
  pinned: string,
): string[] {
  if (name === UNRESOLVED) {
    return [
      "the generated runtime loads a module it names by a non-literal specifier or through a loader built at runtime, " +
        "which has no known minimum version; update the converter",
    ];
  }
  const declared = declaredRange(repositoryRoot, name);
  const installed = installedVersion(repositoryRoot, name);
  const at = name === CONTRACT_PACKAGE ? ` at ${pinned}` : "";
  if (declared === null) {
    return [`declare ${name} in package.json dependencies${at}: ${undeclaredReason(repositoryRoot, name, installed)}`];
  }
  if (LOCAL_SPEC.test(declared)) {
    return [`package.json declares ${name} as "${declared}", which a deploy cannot install; declare a registry version${at}`];
  }
  return name === CONTRACT_PACKAGE
    ? contractProblems(declared, installed, window, pinned)
    : floorProblems(name, names.get(name) ?? new Set<string>(), declared, installed);
}

/**
 * The lowest version a declared range for a floored package admits: an exact
 * version, a caret, a tilde or >=, over a full or partial version whose missing
 * or wildcard parts read as 0 (`^14` is 14.0.0, `13.2.x` is 13.2.0). Anything
 * else -- a tag, `*`, a URL, an upper bound, a prerelease -- cannot be judged
 * against a floor and is refused.
 */
function declaredLowerBound(range: string): Version | null {
  const match = /^(?:\^|~|>=)?\s*(\d+)(?:\.(\d+|x|\*))?(?:\.(\d+|x|\*))?$/u.exec(range.trim());
  if (match === null) return null;
  const part = (text: string | undefined): number => (text === undefined || text === "x" || text === "*" ? 0 : Number(text));
  return [Number(match[1]), part(match[2]), part(match[3])];
}

/** An installed version's release core, and whether it is a prerelease of it. */
function installedCore(version: string): { readonly core: Version; readonly prerelease: boolean } | null {
  const match = /^(\d+)\.(\d+)\.(\d+)(-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/u.exec(version);
  if (match === null) return null;
  return { core: [Number(match[1]), Number(match[2]), Number(match[3])], prerelease: match[4] !== undefined };
}

function floorProblems(
  name: string,
  names: ReadonlySet<string>,
  declared: string,
  installed: string | null,
): string[] {
  const needed = importFloor(name, names);
  if ("unknown" in needed) {
    return [`the generated runtime imports ${needed.unknown.join(", ")} from ${name}, which has no known minimum version; update the converter`];
  }
  const uses = `the generated runtime imports ${[...names].sort().join(", ")} from ${name}, which needs ${name} ${needed.floor} or later`;
  return floorCheck(name, needed.floor, uses, declared, installed);
}

/** A declared range's lower bound, and any installed copy, must reach the floor. */
function floorCheck(name: string, floorText: string, why: string, declared: string, installed: string | null): string[] {
  const floor = parseVersion(floorText) as Version;
  const problems: string[] = [];
  const lower = declaredLowerBound(declared);
  if (lower === null || compare(lower, floor) < 0) {
    problems.push(`package.json declares ${name} "${declared}"; ${why}. Declare ^${floorText} or later`);
  }
  const copy = installed === null ? null : installedCore(installed);
  if (installed !== null && (copy === null || compare(copy.core, floor) < 0 || (copy.prerelease && compare(copy.core, floor) === 0))) {
    problems.push(`${name} ${installed} is installed; ${why}. Install ${floorText} or later`);
  }
  return problems;
}
