import {
  existsSync,
  readdirSync,
  readFileSync,
  realpathSync,
  statSync,
  type Dirent,
} from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

import ts from "typescript";

import type { SourceLocation } from "./report.js";

import { unwrapTransparent } from "./jsx-facts.js";

/**
 * Route discovery reads the Next.js App Router convention, which is a framework
 * contract rather than a file-name guess: `app/<segments>/page.tsx` *defines*
 * the route. Route groups and parallel slots are transparent to the URL.
 */

export interface RouteModule {
  readonly routePath: string;
  readonly file: string;
}

export interface ParsedModule {
  readonly file: string;
  readonly source: ts.SourceFile;
}

const PAGE_BASENAMES = Object.freeze([
  "page.tsx",
  "page.jsx",
  "page.ts",
  "page.js",
]);
const LAYOUT_BASENAMES = Object.freeze([
  "layout.tsx",
  "layout.jsx",
  "layout.ts",
  "layout.js",
]);
const MODULE_EXTENSIONS = Object.freeze([".tsx", ".ts", ".jsx", ".js"]);

/**
 * Extensions the repository WALK considers, which is deliberately wider than
 * the ones a specifier resolves to.
 *
 * The two lists answer different questions. Resolution asks "what does this
 * specifier name", and this codebase writes extensionless specifiers, so the
 * short list is right there. The walk asks "what could contain a write", and
 * an answer that is too short reports a mutation as absent — the direction that
 * publishes a stale value as a customer's content. So the walk is a superset.
 */
const WALKED_EXTENSIONS = Object.freeze([
  ".tsx",
  ".ts",
  ".jsx",
  ".js",
  ".mts",
  ".cts",
  ".mjs",
  ".cjs",
]);
const IGNORED_DIRECTORIES = new Set([
  "node_modules",
  ".git",
  ".next",
  "dist",
  "build",
  "coverage",
]);

function isTransparentSegment(segment: string): boolean {
  return (
    segment.startsWith("(") ||
    segment.startsWith("@") ||
    segment.startsWith("_")
  );
}

function findAppDirectory(repositoryRoot: string): string | null {
  for (const candidate of ["app", join("src", "app")]) {
    const absolute = join(repositoryRoot, candidate);
    if (existsSync(absolute) && statSync(absolute).isDirectory())
      return absolute;
  }
  return null;
}

function firstExisting(
  directory: string,
  basenames: readonly string[],
): string | null {
  for (const basename of basenames) {
    const candidate = join(directory, basename);
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

function routePathFor(appDirectory: string, directory: string): string {
  const segments = relative(appDirectory, directory)
    .split(/[\\/]/u)
    .filter((segment) => segment.length > 0 && !isTransparentSegment(segment));
  return segments.length === 0 ? "/" : `/${segments.join("/")}`;
}

function walkDirectories(root: string): readonly string[] {
  const found: string[] = [root];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory() || IGNORED_DIRECTORIES.has(entry.name)) continue;
    found.push(...walkDirectories(join(root, entry.name)));
  }
  return found;
}

export function discoverRoutes(repositoryRoot: string): readonly RouteModule[] {
  const appDirectory = findAppDirectory(repositoryRoot);
  if (appDirectory === null) {
    throw new Error(`No Next.js app directory found under ${repositoryRoot}`);
  }
  return walkDirectories(appDirectory)
    .map((directory) => {
      const file = firstExisting(directory, PAGE_BASENAMES);
      return file === null
        ? null
        : { routePath: routePathFor(appDirectory, directory), file };
    })
    .filter((route): route is RouteModule => route !== null)
    .sort((left, right) => left.routePath.localeCompare(right.routePath));
}

/**
 * Whether `child` is `parent` or sits underneath it.
 *
 * A textual prefix is NOT containment: `/repo/app` would swallow
 * `/repo/apples`, attaching a sibling directory's layout to a route that is not
 * under `app/` at all. Containment needs a path-component boundary. Both sides
 * go through `realPathOf` because a scratch root is `/var/...` before
 * resolution and `/private/var/...` after, and comparing the two spellings
 * matches nothing while looking like it works.
 */
export function containsPath(parent: string, child: string): boolean {
  const top = realPathOf(parent);
  const under = (path: string): boolean =>
    path === top || path.startsWith(top + sep);
  return under(child) || under(realPathOf(child));
}

/**
 * Every layout between a route and the app root wraps that route, and only that
 * branch of the tree. Nearest first, because Next.js resolves the nearest
 * declaration and lets it fall back outwards.
 */
export function discoverLayoutChain(
  repositoryRoot: string,
  routeFile: string,
): readonly string[] {
  const appDirectory = findAppDirectory(repositoryRoot);
  if (appDirectory === null) return [];
  const chain: string[] = [];
  let directory = dirname(routeFile);
  while (containsPath(appDirectory, directory)) {
    const layout = firstExisting(directory, LAYOUT_BASENAMES);
    if (layout !== null) chain.push(layout);
    if (directory === appDirectory) break;
    directory = dirname(directory);
  }
  return chain;
}

/**
 * Parses a module under its REAL path.
 *
 * A module's file is its identity: escapes, declaration keys and the ledger all
 * key on it. Two names for one file — an in-repository symlink and its target,
 * or a path through a symlinked parent directory — would otherwise be two
 * modules, and a write through one would not invalidate a read through the
 * other. Canonicalising here covers every route into a `ParsedModule`.
 */
export function parseModule(file: string): ParsedModule {
  const real = realPathOf(file);
  const text = readFileSync(real, "utf8");
  const source = ts.createSourceFile(
    real,
    text,
    ts.ScriptTarget.ES2022,
    true,
    ts.ScriptKind.TSX,
  );
  return { file: real, source };
}

/**
 * Directories that never hold the repository's own source.
 *
 * `.managed-site-proposal` is this tool's own default output, which lands
 * INSIDE the repository it is reading. The name scan already excludes whatever
 * `--out` a run was given, but only that scan and only for that run; every
 * other walk here -- render sites, metadata, the proposer's own -- would read a
 * previous run's report as repository source. Nothing breaks today, and the
 * reason is an accident: the report file that quotes `id="ms-..."` evidence is
 * a `.txt`, and `.txt` is not a searched extension. Skipping the directory
 * makes that a rule instead of a coincidence.
 */
const SKIPPED_DIRECTORIES: ReadonlySet<string> = new Set([
  "node_modules",
  ".git",
  ".next",
  ".turbo",
  "dist",
  "build",
  "out",
  "coverage",
  ".managed-site-proposal",
]);

/**
 * Every module in the repository.
 *
 * Some questions cannot be answered from the modules a route reaches. Whether a
 * `const` object is ever mutated is one: the write may sit in a third module
 * that neither declares nor renders it, and reading only the render graph would
 * report the value as unchanged when the site shows something else.
 */
export function repositoryModuleFiles(root: string): readonly string[] {
  return repositoryFiles(root, WALKED_EXTENSIONS);
}

/** Every file in the repository with one of these extensions. */
export function repositoryFiles(
  root: string,
  extensions: readonly string[],
): readonly string[] {
  const files: string[] = [];
  const visit = (directory: string): void => {
    let entries: readonly Dirent[];
    try {
      entries = readdirSync(directory, {
        withFileTypes: true,
        encoding: "utf8",
      });
    } catch {
      return;
    }
    for (const entry of entries) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        if (SKIPPED_DIRECTORIES.has(entry.name)) continue;
        visit(path);
        continue;
      }
      if (entry.isSymbolicLink()) {
        const real = realPathOf(path);
        if (
          isInsideRepository(real, root) &&
          extensions.some((extension) => real.endsWith(extension))
        ) {
          files.push(real);
        }
        continue;
      }
      if (!entry.isFile()) continue;
      if (extensions.some((extension) => entry.name.endsWith(extension))) {
        files.push(realPathOf(path));
      }
    }
  };
  visit(root);
  return [...new Set(files)];
}

/**
 * The major React version a repository PINS, or null when it does not pin one.
 *
 * A fact about the site being CONVERTED, not about this tool: `ref` reaches a
 * function component as a prop from React 19 and is consumed before it, so a
 * reader that assumed either would be wrong on half the fleet.
 *
 * This does not parse semver ranges, and three attempts to say what a range
 * permits each got a different spelling wrong — the first number of
 * `^19 || ^18`, then the lowest of each clause, then `<19`, whose only number
 * is a major the range EXCLUDES. Deciding a range needs a semver
 * implementation, and guessing at operators is how each of those happened.
 *
 * So the question asked is narrower and answerable: does this declaration pin
 * ONE major? A bare version, optionally with `^` or `~`, does. Every operator,
 * alternation, hyphen range and wildcard does not, and answers null — which
 * the caller fails closed on. The cost is a field for a component that renders
 * its own `ref` on a site pinned with `>=19`, which nothing does; the cost of
 * the other direction is offering a customer a field that edits nothing.
 */
const PINNED_MAJOR = /^[\^~]?(\d+)(?:\.\d+){0,2}(?:-[\w.-]+)?$/u;

const REACT_MAJOR = new Map<string, number | null>();

export function reactMajorOf(repositoryRoot: string): number | null {
  const cached = REACT_MAJOR.get(repositoryRoot);
  if (cached !== undefined) return cached;
  const major = readReactMajor(repositoryRoot);
  REACT_MAJOR.set(repositoryRoot, major);
  return major;
}

function readReactMajor(repositoryRoot: string): number | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(
      readFileSync(join(repositoryRoot, "package.json"), "utf8"),
    );
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const manifest = parsed as Record<string, unknown>;
  for (const field of [
    "dependencies",
    "devDependencies",
    "peerDependencies",
  ] as const) {
    const group = manifest[field];
    if (typeof group !== "object" || group === null) continue;
    const range = (group as Record<string, unknown>)["react"];
    if (typeof range !== "string") continue;
    const major = PINNED_MAJOR.exec(range.trim())?.[1];
    if (major !== undefined) return Number(major);
  }
  return null;
}

/** Parses each module once. Routes overlap heavily, and layouts wrap every one. */
export class ModuleCache {
  readonly #modules = new Map<string, ParsedModule>();

  read(file: string): ParsedModule {
    const existing = this.#modules.get(file);
    if (existing !== undefined) return existing;
    const parsed = parseModule(file);
    // Keyed under BOTH the requested name and the real one, so a second route
    // to the same file returns the same module rather than a second identity.
    this.#modules.set(file, parsed);
    this.#modules.set(parsed.file, parsed);
    return parsed;
  }
}

/**
 * Whether a resolved file is inside the repository.
 *
 * A specifier's PREFIX says it is repository-local; it does not say where it
 * lands. `../../outside/content` and an `@/` alias pointing through a symlink
 * both start local and end somewhere else, and every reader here goes on to
 * publish what it finds as the customer's own site content. So containment is
 * checked against the real path, after symlinks, and anything outside is not
 * ours to read.
 */
function isInsideRepository(file: string, repositoryRoot: string): boolean {
  const realFile = realPathOf(file);
  const realRoot = realPathOf(repositoryRoot);
  const inside = relative(realRoot, realFile);
  return inside !== "" && !inside.startsWith("..") && !isAbsolute(inside);
}

export function realPathOf(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return resolve(path);
  }
}

/**
 * The repository file a specifier names, or null when it is not ours to read.
 *
 * Exposed because a specifier does not only appear in an import statement:
 * `import("./m")` and `require("./m")` name a module too, and a reading that
 * only knows about import statements cannot see them.
 */
export function repositoryFileForSpecifier(
  specifier: string,
  fromFile: string,
  repositoryRoot: string,
): string | null {
  if (!isRepositoryLocalSpecifier(specifier)) return null;
  return resolveSpecifierToFile(specifier, fromFile, repositoryRoot);
}

function resolveSpecifierToFile(
  specifier: string,
  fromFile: string,
  repositoryRoot: string,
): string | null {
  const base = specifier.startsWith("@/")
    ? resolve(repositoryRoot, specifier.slice(2))
    : specifier.startsWith(".")
      ? resolve(dirname(fromFile), specifier)
      : null;
  if (base === null) return null;
  const candidate = ((): string | null => {
    for (const extension of MODULE_EXTENSIONS) {
      if (existsSync(`${base}${extension}`)) return `${base}${extension}`;
      const indexFile = join(base, `index${extension}`);
      if (existsSync(indexFile)) return indexFile;
    }
    return existsSync(base) && statSync(base).isFile() ? base : null;
  })();
  if (candidate === null) return null;
  if (!isInsideRepository(candidate, repositoryRoot)) return null;
  // The REAL path is returned, not the one written. Two names for one file —
  // an in-repository symlink and its target — would otherwise be two modules
  // with two declaration identities, and a write through one would not
  // invalidate a read through the other.
  return realPathOf(candidate);
}

/** Where one name in a module comes from. `null` names cover the whole module. */
export interface ModuleReference {
  readonly specifier: string;
  /** The name inside the target module: an export name, `default`, or null for all of it. */
  readonly importedName: string | null;
  /** Only repository-local specifiers are followed; packages are not ours to read. */
  readonly isRepositoryLocal: boolean;
  readonly resolvedFile: string | null;
  readonly line: number;
  readonly offset: number;
}

/** A name a module re-exports. `exportedName` is null for `export * from`. */
export interface ReExport extends ModuleReference {
  readonly exportedName: string | null;
}

function isRepositoryLocalSpecifier(specifier: string): boolean {
  return specifier.startsWith(".") || specifier.startsWith("@/");
}

function referenceTo(
  module: ParsedModule,
  repositoryRoot: string,
  specifier: string,
  importedName: string | null,
  node: ts.Node,
): ModuleReference {
  const isRepositoryLocal = isRepositoryLocalSpecifier(specifier);
  return {
    specifier,
    importedName,
    isRepositoryLocal,
    resolvedFile: isRepositoryLocal
      ? resolveSpecifierToFile(specifier, module.file, repositoryRoot)
      : null,
    line: lineOf(module.source, node),
    offset: node.getStart(module.source),
  };
}

/** Every imported binding by the local name it is known under in this module. */
export function importedBindingsOf(
  module: ParsedModule,
  repositoryRoot: string,
): ReadonlyMap<string, ModuleReference> {
  const bindings = new Map<string, ModuleReference>();
  for (const statement of module.source.statements) {
    if (!ts.isImportDeclaration(statement)) continue;
    if (!ts.isStringLiteral(statement.moduleSpecifier)) continue;
    const specifier = statement.moduleSpecifier.text;
    const clause = statement.importClause;
    if (clause === undefined) continue;
    const record = (localName: string, importedName: string | null): void => {
      bindings.set(
        localName,
        referenceTo(module, repositoryRoot, specifier, importedName, statement),
      );
    };
    if (clause.name !== undefined) record(clause.name.text, "default");
    const named = clause.namedBindings;
    if (named === undefined) continue;
    if (ts.isNamespaceImport(named)) {
      record(named.name.text, null);
      continue;
    }
    for (const element of named.elements) {
      record(element.name.text, (element.propertyName ?? element.name).text);
    }
  }
  return bindings;
}

/** Barrel files are ordinary in this codebase, so re-exports are followed too. */
export function reExportsOf(
  module: ParsedModule,
  repositoryRoot: string,
): readonly ReExport[] {
  const exports: ReExport[] = [];
  for (const statement of module.source.statements) {
    if (!ts.isExportDeclaration(statement)) continue;
    const specifier = statement.moduleSpecifier;
    if (specifier === undefined || !ts.isStringLiteral(specifier)) continue;
    const clause = statement.exportClause;
    if (clause === undefined) {
      exports.push({
        exportedName: null,
        ...referenceTo(module, repositoryRoot, specifier.text, null, statement),
      });
      continue;
    }
    // `export * as content from "./m"` exports the whole MODULE under a name.
    // Skipping it made the barrel look as if it forwarded nothing.
    if (ts.isNamespaceExport(clause)) {
      exports.push({
        exportedName: clause.name.text,
        ...referenceTo(module, repositoryRoot, specifier.text, null, statement),
      });
      continue;
    }
    if (!ts.isNamedExports(clause)) continue;
    for (const element of clause.elements) {
      exports.push({
        exportedName: element.name.text,
        ...referenceTo(
          module,
          repositoryRoot,
          specifier.text,
          (element.propertyName ?? element.name).text,
          statement,
        ),
      });
    }
  }
  return exports;
}

export interface NamedFunction {
  readonly name: string;
  readonly body: ts.Node;
  readonly parameters: readonly ts.ParameterDeclaration[];
}

const NAMED_FUNCTIONS = new WeakMap<ts.SourceFile, readonly NamedFunction[]>();

/**
 * Every function a module declares under a name, at any depth and in source
 * order: a function declaration, or a name bound to a function expression.
 *
 * One enumeration answers both "which components does this module declare" and
 * "which function can a call name", because two walks reading different shapes
 * is the silent drop each exists to prevent, wearing the other's clothes: a
 * body followed into that no declaration answers for, or a declaration whose
 * markup nothing collects. Teaching this one a new shape teaches both.
 */
export function namedFunctionsOf(
  source: ts.SourceFile,
): readonly NamedFunction[] {
  const cached = NAMED_FUNCTIONS.get(source);
  if (cached !== undefined) return cached;
  const found: NamedFunction[] = [];
  const visit = (node: ts.Node): void => {
    if (
      ts.isFunctionDeclaration(node) &&
      node.name !== undefined &&
      node.body !== undefined
    ) {
      found.push({
        name: node.name.text,
        body: node.body,
        parameters: node.parameters,
      });
    }
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer !== undefined
    ) {
      const initializer = unwrapTransparent(node.initializer);
      if (
        ts.isArrowFunction(initializer) ||
        ts.isFunctionExpression(initializer)
      ) {
        found.push({
          name: node.name.text,
          body: initializer.body,
          parameters: initializer.parameters,
        });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  NAMED_FUNCTIONS.set(source, found);
  return found;
}

export function lineOf(source: ts.SourceFile, node: ts.Node): number {
  return source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
}

/** Where a node is, precisely enough for a reader AND for an editor. */
export function locationOf(
  source: ts.SourceFile,
  file: string,
  node: ts.Node,
): SourceLocation {
  return { file, line: lineOf(source, node), offset: node.getStart(source) };
}

const MAX_EVIDENCE_LENGTH = 160;

/** The literal source a finding points at, on one line, so a human can act on it. */
export function evidenceOf(source: ts.SourceFile, node: ts.Node): string {
  const text = node.getText(source).replace(/\s+/gu, " ");
  return text.length > MAX_EVIDENCE_LENGTH
    ? `${text.slice(0, MAX_EVIDENCE_LENGTH - 3)}...`
    : text;
}
