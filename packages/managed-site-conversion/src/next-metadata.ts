import ts from "typescript";

import { resolveStaticValue } from "./evaluate.js";
import { stringValueOf } from "./literals.js";
import {
  importedBindingsOf,
  reExportsOf,
  repositoryFileForSpecifier,
  repositoryModuleFiles,
  type ModuleCache,
  type ParsedModule,
} from "./scan.js";

/**
 * Next.js declares page metadata through an exported `metadata` object. That
 * export IS the SEO contract for the route, so reading it is a framework fact
 * rather than an inference — and everything it holds is internal-protected.
 *
 * A route resolves its metadata along its OWN segment chain: its page module
 * first, then each layout that wraps it, nearest outwards. A field the route
 * does not declare falls back to a layout, which is genuine framework
 * inheritance. Nothing from a sibling route can ever reach it.
 */

export interface IndexingDirectives {
  readonly index: boolean;
  readonly follow: boolean;
  readonly archive: boolean;
  readonly imageIndex: boolean;
  readonly maxSnippet: number;
  readonly maxImagePreview: "none" | "standard" | "large";
  readonly maxVideoPreview: number;
}

export interface NextMetadata {
  readonly title: string | null;
  readonly description: string | null;
  /**
   * `null` when a route DECLARED robots this reader could not read.
   *
   * Absent everywhere is a different answer and resolves to the default, which
   * is what Next.js renders. Collapsing the two would let an unreadable
   * `robots: { index: INDEX }` be emitted as `index: true` -- a noindex route
   * published as an indexable one, silently.
   */
  readonly indexing: IndexingDirectives | null;
}

export const DEFAULT_INDEXING: IndexingDirectives = {
  index: true,
  follow: true,
  archive: true,
  imageIndex: true,
  maxSnippet: -1,
  maxImagePreview: "large",
  maxVideoPreview: -1,
};

/**
 * A metadata object, and what its own parameter names stand for.
 *
 * `export const metadata = seo({ description: "..." })` is how a real site keeps
 * one metadata shape across every route, and the value IS a literal -- it is
 * just written at the call site rather than in the object the route exports. So
 * the object this reader works on carries the substitution that turns the
 * helper's parameter names back into the expressions the call supplied.
 */
interface MetadataObject {
  readonly object: ts.ObjectLiteralExpression;
  /** Where the object literal is written, which is the helper for a helper call. */
  readonly objectModule: ParsedModule;
  readonly substitution: ReadonlyMap<string, Located>;
  /** Where the call's ARGUMENTS are written, so a substituted value resolves there. */
  readonly callModule: ParsedModule;
  /** The helper's body, so one field can ask whether ITS value stays unreached. */
  readonly body: ts.Block | null;
  /** The object the helper RETURNS, which is the one place a parameter may appear. */
  readonly returned: ts.ObjectLiteralExpression;
  /**
   * What the module ASSIGNED to the exported object after building it, keyed by
   * property, in the order the assignments run -- so the last one to a key is
   * the one held here, and it stands in for whatever the initializer wrote.
   */
  readonly overrides: ReadonlyMap<string, Located>;
}

/**
 * An expression, and the environment its names resolve in: the module whose
 * imports and constants it can see, and what a helper's parameter names stand
 * for inside it.
 *
 * The substitution belongs HERE rather than on the object the value was read
 * from, because the two can differ. `metadata.robots = { index }` is written in
 * the route, where a helper parameter called `index` means nothing; the same
 * object written in the helper resolves it. Keeping them together is what stops
 * a second reader having to re-derive which of the two it is holding.
 */
interface Located {
  readonly expression: ts.Expression;
  readonly module: ParsedModule;
  readonly substitution: ReadonlyMap<string, Located>;
}

/**
 * `"unreadable"` is not the same answer as `null`.
 *
 * A route that writes `export const metadata = seo({...})` HAS declared its
 * metadata, so a helper this reader cannot prove must be reported rather than
 * treated as an absent declaration -- README:174-180: a field a route declares
 * but the tool cannot read does not fall back to a layout, or an ancestor's
 * value is attributed to a route that overrode it.
 *
 * Every refusal below therefore returns `"unreadable"`, which also makes the
 * proof safe by construction: anything it cannot see through is reported, never
 * inherited.
 */
type FoundMetadata = MetadataObject | "unreadable" | null;

function findMetadataObject(
  module: ParsedModule,
  cache: ModuleCache,
  repositoryRoot: string,
): FoundMetadata {
  const declaration = metadataDeclarationIn(module.source);
  if (declaration === null || declaration === "unreadable") return declaration;
  // What Next serves is the module object AFTER the module finishes running,
  // so a value read at the declaration is only the value Next sees once every
  // write the module makes has been applied to it -- and only if no OTHER
  // module can reach the binding to write one this reader never sees.
  const overrides = finalValueOverrides(module, declaration);
  if (overrides === null) return "unreadable";
  if (isReachableFromAnotherModule(module, cache, repositoryRoot)) return "unreadable";
  const initializer = declaration.initializer;
  if (initializer === undefined) return "unreadable";
  if (ts.isObjectLiteralExpression(initializer)) {
    // The same validation the helper's returned object gets. Only that path
    // had it, so a direct `{ title, ...defaults }` let a later spread
    // overwrite the shorthand this reader had already taken -- a spread,
    // computed key, accessor or duplicate key means the first matching
    // property is not the one Next uses.
    if (!isPlainDataObject(initializer)) return "unreadable";
    return {
      object: initializer,
      objectModule: module,
      substitution: NO_SUBSTITUTION,
      callModule: module,
      body: null,
      returned: initializer,
      overrides,
    };
  }
  if (ts.isCallExpression(initializer)) {
    return throughHelper(initializer, module, cache, repositoryRoot, overrides) ?? "unreadable";
  }
  // Declared as something else entirely -- a name, a conditional, a spread
  // of two objects. Declared, and not read.
  return "unreadable";
}

/**
 * The declaration behind the module's `metadata` export, however it is spelled.
 *
 * `export const metadata` and `const metadata; export { metadata }` are the
 * same export, and `export { seoFor as metadata }` exports a binding under a
 * name it was not declared with. Reading only the first spelling made the other
 * two look like routes that declare NOTHING, which is the one answer this
 * reader must never give by accident: an undeclared route inherits the layout's
 * metadata, so a route overriding `robots` would be published with the
 * layout's.
 */
function metadataDeclarationIn(
  source: ts.SourceFile,
): ts.VariableDeclaration | "unreadable" | null {
  const local = localNameExportedAsMetadata(source);
  if (local === null || local === "unreadable") return local;
  for (const statement of source.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (ts.isIdentifier(declaration.name) && declaration.name.text === local) {
        return declaration;
      }
    }
  }
  // Exported under a name nothing in this module declares. The route publishes
  // metadata; this reader cannot say what it is.
  return "unreadable";
}

/** Which local binding this module publishes as `metadata`, if any. */
function localNameExportedAsMetadata(source: ts.SourceFile): string | "unreadable" | null {
  for (const statement of source.statements) {
    if (ts.isVariableStatement(statement)) {
      const exported = statement.modifiers?.some(
        (modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword,
      );
      if (exported !== true) continue;
      for (const declaration of statement.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name)) {
          if (declaration.name.text === METADATA_EXPORT) return METADATA_EXPORT;
          continue;
        }
        // `export const { metadata } = seoPair()` exports metadata without ever
        // writing an initializer for it. Read as a route declaring nothing, it
        // would be handed the layout's robots; it declares its own.
        if (bindsMetadata(declaration.name)) return "unreadable";
      }
      continue;
    }
    if (!ts.isExportDeclaration(statement)) continue;
    const clause = statement.exportClause;
    // `export * from "./metadata"` validly re-exports a named `metadata`
    // binding, and `export * as metadata from "./m"` publishes a whole module
    // under that name. Reading neither made the route look UNDECLARED, which is
    // the one wrong answer here: an undeclared route inherits the layout's
    // robots, so a re-exported `{ index: false }` became an indexable
    // descriptor. Following the chain is not needed to be safe -- saying "this
    // route declares metadata I cannot read" is.
    if (clause === undefined && statement.moduleSpecifier !== undefined) return "unreadable";
    if (clause !== undefined && ts.isNamespaceExport(clause)) {
      if (clause.name.text === METADATA_EXPORT) return "unreadable";
      continue;
    }
    if (clause === undefined || !ts.isNamedExports(clause)) continue;
    for (const specifier of clause.elements) {
      if (specifier.name.text !== METADATA_EXPORT) continue;
      // `export { x as metadata } from "./other"` publishes a binding this
      // module never holds. Reading the local `x` that happens to sit beside
      // it would attribute a different object entirely, and treating the route
      // as declaring nothing would hand it the layout's robots. It declares
      // metadata and this reader cannot follow it, which is the third answer.
      if (statement.moduleSpecifier !== undefined) return "unreadable";
      return (specifier.propertyName ?? specifier.name).text;
    }
  }
  return null;
}

const METADATA_EXPORT = "metadata";

/**
 * Whether any other module in this repository can reach this route module.
 *
 * A local scan proves nothing about a write it cannot see. A route can call a
 * helper that imports the page's own live `metadata` binding and assigns
 * through it, and module evaluation finishes with Next observing the assigned
 * value while this reader still holds the literal.
 *
 * Enumerating how a reachable module might write is the non-terminating half of
 * this problem, so the question asked is REACHABILITY, which is finite: nothing
 * outside this file may import this file at all. Next imports a route module
 * itself, but that is the framework, not code in this repository.
 *
 * Deliberately not narrowed to "imports the `metadata` binding": `import * as
 * page` and `await import("./page")` reach it without naming it, and a route
 * module imported by other repository code is rare enough that refusing costs
 * nothing measurable.
 */
function isReachableFromAnotherModule(
  module: ParsedModule,
  cache: ModuleCache,
  repositoryRoot: string,
): boolean {
  for (const file of repositoryModuleFiles(repositoryRoot)) {
    if (file === module.file) continue;
    let other: ParsedModule;
    try {
      other = cache.read(file);
    } catch {
      // A module that cannot be parsed cannot be shown harmless.
      return true;
    }
    for (const reference of importedBindingsOf(other, repositoryRoot).values()) {
      if (reference.resolvedFile === module.file) return true;
    }
    // A barrel that re-exports the page is itself a reference to it, and
    // whoever imports the barrel reaches the binding. Catching the barrel is
    // enough; the chain behind it need not be walked, because the barrel is a
    // module in this repository and this refuses on it.
    for (const reExport of reExportsOf(other, repositoryRoot)) {
      if (reExport.resolvedFile === module.file) return true;
    }
    if (mentionsLoadOf(other, module.file, repositoryRoot)) return true;
  }
  return false;
}

/**
 * `import("./page")` and `require("./page")` name no binding, so the import
 * scan does not see either. The pair is what `evaluate.ts` already treats as
 * one thing.
 */
function mentionsLoadOf(
  other: ParsedModule,
  target: string,
  repositoryRoot: string,
): boolean {
  let found = false;
  const visit = (node: ts.Node): void => {
    if (found) return;
    const callee = ts.isCallExpression(node) ? node.expression : null;
    const loads =
      callee !== null &&
      (callee.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(callee) && callee.text === "require"));
    if (loads && ts.isCallExpression(node) && node.arguments.length > 0) {
      const [specifier] = node.arguments;
      if (specifier !== undefined && ts.isStringLiteral(specifier)) {
        const resolved = repositoryFileForSpecifier(specifier.text, other.file, repositoryRoot);
        if (resolved === target) found = true;
        return;
      }
      // A specifier this reader cannot read may be any module.
      found = true;
      return;
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(other.source, visit);
  return found;
}

/** Whether a destructuring pattern binds the name `metadata`, at any depth. */
function bindsMetadata(pattern: ts.BindingName): boolean {
  if (ts.isIdentifier(pattern)) return pattern.text === METADATA_EXPORT;
  return pattern.elements.some(
    (element) =>
      ts.isBindingElement(element) &&
      (bindsMetadata(element.name) ||
        (element.propertyName !== undefined &&
          ts.isIdentifier(element.propertyName) &&
          element.propertyName.text === METADATA_EXPORT)),
  );
}

/**
 * What the module ASSIGNS to the exported object after building it, or null
 * where the value Next serves cannot be resolved at all.
 *
 * The value this reader takes is the initializer; the value Next serves is the
 * module object once the module has finished running. `Object.assign(metadata,
 * { robots: { index: false } })` after the declaration makes those two
 * different, and the difference is published as an indexing instruction.
 *
 * Enumerating the ways to WRITE -- assignment, `Object.assign`, `Reflect.set`,
 * a setter reached through an alias -- does not terminate; there is always
 * another spelling. So the question is inverted, as it is for the helper's own
 * scope: the binding must be MENTIONED nowhere but its declaration, the export
 * that publishes it, and the one write shape below. Everything else, a READ
 * included, refuses -- a read is how the object reaches a mutator this reader
 * would then have to follow, which is the non-terminating question again.
 *
 * The one shape read here is `metadata.<key> = <plain data>` in statement
 * position at the top level of the module. It is a real site's way of hiding
 * one route out of a shared helper's shape, and it is resolvable rather than
 * merely recognisable: the module runs top to bottom with nothing in between
 * to observe, so the value Next serves for that key is simply the last such
 * assignment. A refusal here is reported, never inherited.
 */
function finalValueOverrides(
  module: ParsedModule,
  declaration: ts.VariableDeclaration,
): ReadonlyMap<string, Located> | null {
  // `eval("metadata.robots = ...")` writes to the object while holding no AST
  // reference to it, so the walk below cannot see it -- nor can it see which
  // key the write lands on, which is what makes it unresolvable rather than
  // merely unseen. `with` is the other scope escape and is a syntax error in an
  // ES module, so it is not checked here -- a route module that contains one
  // never runs at all.
  if (SCOPE_ESCAPES.some((name) => mentions(module.source, name))) return null;
  const name = ts.isIdentifier(declaration.name) ? declaration.name.text : null;
  if (name === null) return null;
  // Insertion order IS source order, because `forEachChild` walks the module in
  // it -- so a second assignment to a key replaces the first, which is what the
  // runtime does.
  const overrides = new Map<string, Located>();
  let resolvable = true;
  const visit = (node: ts.Node): void => {
    if (!resolvable) return;
    if (ts.isIdentifier(node) && node.text === name && node !== declaration.name) {
      const written = assignedAt(node, declaration, module);
      if (written === null) {
        resolvable = false;
        return;
      }
      if (written !== EXPORTS_THE_BINDING) overrides.set(written.key, written.value);
      return;
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(module.source, visit);
  return resolvable ? overrides : null;
}

/** An occurrence that publishes the binding rather than writing to it. */
const EXPORTS_THE_BINDING = "exported";

/** One resolved write: the key it lands on, and the value it puts there. */
interface AssignedProperty {
  readonly key: string;
  readonly value: Located;
}

/**
 * What this occurrence of the binding does, or null where this reader cannot
 * say -- which is every occurrence but the two it models.
 *
 * The write it models is deliberately ONE shape rather than a list of them,
 * because a list is the thing that never terminates. Each condition below
 * removes a way the assignment could fail to be the whole story:
 *
 * - a plain `=` only, since `??=` and its siblings read the existing value;
 * - a DIRECT property of the binding, named the one way this reader reads a key,
 *   since `metadata.robots.index = false` writes INTO an object read from
 *   somewhere else and `metadata[key] = v` names a key it does not evaluate;
 * - a statement the MODULE ITSELF runs, since an assignment inside a branch, a
 *   loop or a function may not run, or may run more than once;
 * - AFTER the declaration, since a `const` written above it is in its temporal
 *   dead zone and the module throws rather than serving anything;
 * - a plain data value, since anything else is decided somewhere this reader is
 *   not looking.
 */
function assignedAt(
  node: ts.Identifier,
  declaration: ts.VariableDeclaration,
  module: ParsedModule,
): AssignedProperty | typeof EXPORTS_THE_BINDING | null {
  const parent = node.parent as ts.Node | undefined;
  if (parent === undefined) return null;
  if (ts.isExportSpecifier(parent)) return EXPORTS_THE_BINDING;
  if (!ts.isPropertyAccessExpression(parent) || parent.expression !== node) return null;
  const assignment = parent.parent as ts.Node | undefined;
  if (assignment === undefined || !ts.isBinaryExpression(assignment)) return null;
  if (assignment.operatorToken.kind !== ts.SyntaxKind.EqualsToken) return null;
  if (assignment.left !== parent) return null;
  const statement = topLevelStatementOf(assignment, module.source);
  if (statement === null) return null;
  if (statement.pos < declaration.end) return null;
  // Not every member name is a key: `metadata.__proto__ = { robots: ... }`
  // replaces the PROTOTYPE, so the value would be INHERITED and a map keyed by
  // property could not answer for `robots` at all.
  const key = dataPropertyKey(parent.name);
  if (key === null) return null;
  if (!isPlainDataValue(assignment.right)) return null;
  return {
    key,
    // The assignment is written in the route's own module, so that is where its
    // value resolves -- never the helper's, whose parameter names mean nothing
    // here.
    value: { expression: assignment.right, module, substitution: NO_SUBSTITUTION },
  };
}

/**
 * The statement this expression IS, when the module runs it directly.
 *
 * An expression statement whose parent is the module is a step that runs
 * exactly once, in written order, with nothing between it and the next one.
 * Anything else -- a branch, a loop, a function body, or an assignment nested
 * inside a larger expression -- runs on terms this reader does not evaluate.
 */
function topLevelStatementOf(
  expression: ts.Expression,
  source: ts.SourceFile,
): ts.ExpressionStatement | null {
  const statement = expression.parent as ts.Node | undefined;
  if (statement === undefined || !ts.isExpressionStatement(statement)) return null;
  return statement.parent === source ? statement : null;
}

/**
 * A value written out in full at the point it is assigned: a literal, or an
 * object literal that is plain data all the way down.
 *
 * The same standard `isPlainDataObject` sets for an object's own members, asked
 * one level up. Anything else -- a call, a name, a spread, a template -- is
 * decided somewhere this reader is not looking, so the write is one it cannot
 * resolve and the whole export refuses.
 */
function isPlainDataValue(expression: ts.Expression): boolean {
  if (ts.isObjectLiteralExpression(expression)) return isPlainDataObject(expression);
  return (
    ts.isStringLiteral(expression) ||
    ts.isNumericLiteral(expression) ||
    expression.kind === ts.SyntaxKind.TrueKeyword ||
    expression.kind === ts.SyntaxKind.FalseKeyword ||
    expression.kind === ts.SyntaxKind.NullKeyword
  );
}

/** A substitution with nothing in it, shared rather than rebuilt per read. */
const NO_SUBSTITUTION: ReadonlyMap<string, Located> = new Map();

/** The same empty map, under the name that reads where writes are meant. */
const NO_OVERRIDES = NO_SUBSTITUTION;


function throughHelper(
  call: ts.CallExpression,
  module: ParsedModule,
  cache: ModuleCache,
  repositoryRoot: string,
  overrides: ReadonlyMap<string, Located>,
): MetadataObject | null {
  if (!ts.isIdentifier(call.expression)) return null;
  const helper = helperDeclaration(call.expression.text, module, cache, repositoryRoot);
  if (helper === null) return null;
  const helperOwner = helperModule(helper, module);
  const substitution = substitutionFor(helper, call, helperOwner, module);
  if (substitution === null) return null;
  const returned = soleReturnedObject(helper);
  if (returned === null) return null;
  return {
    object: returned,
    objectModule: helperOwner,
    substitution,
    callModule: module,
    body: helper.body ?? null,
    returned: returned,
    overrides,
  };
}

/** The function a name refers to, declared here or imported from this repository. */
function helperDeclaration(
  name: string,
  module: ParsedModule,
  cache: ModuleCache,
  repositoryRoot: string,
): ts.FunctionDeclaration | null {
  const local = module.source.statements.find(
    (statement): statement is ts.FunctionDeclaration =>
      ts.isFunctionDeclaration(statement) && statement.name?.text === name,
  );
  if (local !== undefined) return local;
  const imported = importedBindingsOf(module, repositoryRoot).get(name);
  // `resolvedFile` is null for a package, which is not ours to read.
  if (imported === undefined || imported.resolvedFile === null) return null;
  const target = cache.read(imported.resolvedFile);
  const exportedName = imported.importedName ?? name;
  return exportedFunction(target, exportedName);
}

/**
 * The one object literal a function returns, or null if it does anything else.
 *
 * Statements BEFORE the return are allowed, because a real metadata helper
 * builds a local or two on the way -- `const images = [...]` then the object.
 * They cost nothing: a returned property that names a local is not in the
 * substitution, so it reads as absent rather than as the wrong value.
 *
 * With one exception, which is why the names are collected: a local that SHADOWS
 * a parameter would make `{ description }` mean the local while the substitution
 * still answered with the argument. That is the one way this could report a
 * value the page does not have, so it refuses.
 */
/**
 * The function a module exports under this name.
 *
 * `export { actual as seo }` means an importer's `seo(...)` runs `actual`, so
 * searching for a declaration NAMED `seo` can find a private function that is
 * never called -- and read its body instead of the one that runs. The export
 * clause is consulted first for exactly that reason, and a name exported more
 * than once, or re-exported from elsewhere, is not resolved at all.
 */
function exportedFunction(
  module: ParsedModule,
  exportedName: string,
): ts.FunctionDeclaration | null {
  const aliases: string[] = [];
  for (const statement of module.source.statements) {
    if (!ts.isExportDeclaration(statement)) continue;
    // `export { x } from "./elsewhere"` exports someone else's binding.
    if (statement.moduleSpecifier !== undefined) return null;
    const clause = statement.exportClause;
    if (clause === undefined || !ts.isNamedExports(clause)) continue;
    for (const element of clause.elements) {
      if (element.name.text !== exportedName) continue;
      aliases.push((element.propertyName ?? element.name).text);
    }
  }
  if (aliases.length > 1) return null;
  const localName = aliases[0] ?? exportedName;
  const found = module.source.statements.filter(
    (statement): statement is ts.FunctionDeclaration =>
      ts.isFunctionDeclaration(statement) && statement.name?.text === localName,
  );
  if (found.length !== 1) return null;
  const only = found[0];
  if (only === undefined) return null;
  // Reached by its own name: it must actually be exported, or the importer is
  // getting something else.
  if (aliases.length === 0 && !hasExportModifier(only)) return null;
  return only;
}

function hasExportModifier(node: ts.Node): boolean {
  const modifiers = ts.canHaveModifiers(node) ? ts.getModifiers(node) : undefined;
  return modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword) === true;
}

function soleReturnedObject(
  helper: ts.FunctionDeclaration,
): ts.ObjectLiteralExpression | null {
  const body = helper.body;
  if (body === undefined) return null;
  const returns = body.statements.filter(ts.isReturnStatement);
  if (returns.length !== 1) return null;
  const returned = returns[0]?.expression;
  if (returned === undefined || !ts.isObjectLiteralExpression(returned)) return null;
  // A return anywhere other than the top level means a branch this reader has
  // not followed decides the answer.
  if (countReturns(body) !== 1) return null;
  // A spread or a computed key AFTER a key overwrites it, and reading the first
  // matching property would report a value the runtime replaced. Deciding which
  // computed key equals "description" is an evaluation this reader does not do.
  if (!isPlainDataObject(returned)) return null;
  // A metadata helper has no reason to write anything, so ANY write refuses
  // rather than this reader deciding which writes reach a substituted binding.
  // That question kept producing another shape -- a bare assignment, then a
  // destructuring assignment, then a mutation THROUGH the binding
  // (`robots.index = false`), then a `var` in a nested block.
  if (writesAnything(body)) return null;
  // `arguments` IS the object the call supplied, under a name no parameter list
  // mentions -- `Object.assign(arguments[0].robots, ...)` reaches it while the
  // per-field scan sees `robots` only as a property NAME. A helper that names it
  // has nothing this reader can prove, so none of its fields are read.
  if (SCOPE_ESCAPES.some((name) => mentions(body, name))) return null;
  if (containsWith(body)) return null;
  return returned;
}

/** Assignment and every compound form of it. */
const ASSIGNMENT_OPERATORS: ReadonlySet<ts.SyntaxKind> = new Set(
  Object.values(ts.SyntaxKind).filter(
    (kind): kind is ts.SyntaxKind =>
      typeof kind === "number" &&
      kind >= ts.SyntaxKind.FirstAssignment &&
      kind <= ts.SyntaxKind.LastAssignment,
  ),
);

/**
 * Whether every member of this object, at every level, is plain unique data.
 *
 * Three ways it is not, and each made the reader report a value the runtime
 * replaced:
 *
 * - an ACCESSOR or method is a member `propertyOf` skips, so the field read as
 *   ABSENT and a layout answered for a route that declares one;
 * - a DUPLICATE key means JavaScript uses the LAST and this reader took the
 *   first;
 * - a spread or computed key can overwrite anything.
 *
 * Nested objects are checked too, because `robots` is read the same way and had
 * the same gaps one level down.
 */
function isPlainDataObject(object: ts.ObjectLiteralExpression): boolean {
  const seen = new Set<string>();
  for (const property of object.properties) {
    if (!ts.isPropertyAssignment(property) && !ts.isShorthandPropertyAssignment(property)) {
      return false;
    }
    // `{ robots: { __proto__: { index: false } } }` reads as absent and takes
    // the default, publishing an indexable route that declared otherwise, so
    // that name yields no key at all.
    const key = dataPropertyKey(property.name);
    if (key === null || seen.has(key)) return false;
    seen.add(key);
    if (ts.isPropertyAssignment(property)) {
      const value = property.initializer;
      if (ts.isObjectLiteralExpression(value) && !isPlainDataObject(value)) return false;
    }
  }
  return true;
}

/**
 * Whether the body writes anything at all.
 *
 * Nested functions are NOT skipped: a closure can write a parameter and be
 * invoked before the return, so that boundary is one the hazard crosses freely.
 * A metadata helper has no reason to write, and refusing every write costs
 * nothing on a real one.
 */
function writesAnything(body: ts.Block): boolean {
  let unsafe = false;
  const visit = (node: ts.Node): void => {
    if (unsafe) return;
    if (
      (ts.isBinaryExpression(node) && ASSIGNMENT_OPERATORS.has(node.operatorToken.kind)) ||
      ts.isPostfixUnaryExpression(node) ||
      ts.isPrefixUnaryExpression(node) ||
      ts.isDeleteExpression(node) ||
      (ts.isVariableStatement(node) &&
        (node.declarationList.flags & ts.NodeFlags.BlockScoped) === 0)
    ) {
      unsafe = true;
      return;
    }

    ts.forEachChild(node, visit);
  };
  ts.forEachChild(body, visit);
  return unsafe;
}

/**
 * The key that replaces an object's PROTOTYPE.
 *
 * Only some spellings do it -- `{ __proto__: v }` and `object.__proto__ = v`,
 * but not `{ ["__proto__"]: v }` or the shorthand -- and every spelling is
 * refused anyway, because which one it is decides what the object holds.
 */
const PROTOTYPE_KEY = "__proto__";

/**
 * The key a source property name stands for, or null where it stands for no key
 * this reader may record.
 *
 * `__proto__` is the reason this is one function rather than a check repeated at
 * each site. Written as a member name it replaces the object's PROTOTYPE, so
 * what it puts there is INHERITED -- and every structure here, an object's own
 * members, a call's arguments and the writes an override map holds, is a scan of
 * OWN members that cannot see it. A route whose final `robots` arrives that way
 * would be published with the value it overrode.
 *
 * A computed, numeric or private name yields no key either: which one it is
 * decides what the object holds, and this reader does not evaluate it.
 */
function dataPropertyKey(name: ts.PropertyName | ts.MemberName): string | null {
  if (!ts.isIdentifier(name) && !ts.isStringLiteral(name)) return null;
  return name.text === PROTOTYPE_KEY ? null : name.text;
}

/**
 * Names that reach this function's own scope without naming anything in it.
 *
 * `arguments` IS the object the call supplied, under a name no parameter list
 * mentions. Direct `eval` runs source this reader never parses --
 * `eval("robots.index = false")` holds no `robots` identifier for any AST scan
 * to find, and mutates the supplied object anyway. A `with` statement puts an
 * object into the scope chain, deciding what a later name means.
 *
 * A metadata helper needs none of them, and a helper naming one has nothing
 * this reader can prove about any of its fields.
 */
const SCOPE_ESCAPES: readonly string[] = ["arguments", "eval"];

/** Whether a `with` statement puts an object into the scope chain. */
function containsWith(body: ts.Node): boolean {
  let found = false;
  const visit = (node: ts.Node): void => {
    if (found) return;
    if (ts.isWithStatement(node)) {
      found = true;
      return;
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(body, visit);
  return found;
}

/** Whether this name is referenced anywhere in the body. */
function mentions(body: ts.Node, name: string): boolean {
  let found = false;
  const visit = (node: ts.Node): void => {
    if (found) return;
    if (ts.isIdentifier(node) && node.text === name) {
      found = true;
      return;
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(body, visit);
  return found;
}

/**
 * Whether this substituted name occurs anywhere OUTSIDE the object the helper
 * returns.
 *
 * This replaces six rounds of asking which constructs could reach the value.
 * That question does not terminate: a bare write, a destructuring assignment, a
 * mutation through the binding, a `var` in a nested block, a closure that
 * writes and is invoked, a call naming the binding, a `const` alias, a member
 * chain, a container holding it, a `for...of` target -- ten routes, each found
 * one round after the last, because the language has unboundedly many ways to
 * pass a reference around.
 *
 * So the rule is positive and bounded instead. The value the call supplied is
 * what the page renders exactly when the helper does nothing with that name but
 * put it in the object it returns. Every one of those ten routes mentions the
 * name somewhere else, whatever its syntax, and so does the eleventh.
 *
 * Asked per field, so a helper may still compute freely with parameters this
 * reader is not reading -- which is what keeps a real one readable.
 */
function usedOutsideReturn(
  body: ts.Block,
  returned: ts.ObjectLiteralExpression,
  name: string,
): boolean {
  let outside = false;
  const visit = (node: ts.Node): void => {
    if (outside) return;
    if (ts.isIdentifier(node) && node.text === name && isValueOccurrence(node)) {
      // Being inside the returned object is not enough: a property value may be
      // any expression, so `description: (Object.assign(robots, ...), "x")`
      // mutates before the object is ever returned. The occurrence has to BE a
      // plain value in that object, at any depth.
      if (!isPlainValueWithin(node, returned)) outside = true;
      return;
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(body, visit);
  return outside;
}

/**
 * Whether this occurrence is a plain property VALUE inside the returned object.
 *
 * A shorthand, a bare initializer, or a property-read chain used as one -- at
 * any nesting depth, because a real helper puts the same value in `openGraph`
 * and `twitter` as well as at the top.
 *
 * Anything else refuses, including an occurrence inside a call or an operator
 * that happens to sit in the returned object. That distinction is the whole
 * point: the object is returned AFTER its property expressions are evaluated,
 * so a mutation written there runs first.
 */
function isPlainValueWithin(node: ts.Identifier, returned: ts.ObjectLiteralExpression): boolean {
  // Climb the property-read chain the occurrence roots, and its type wrappers.
  let current: ts.Node = node;
  for (let step = 0; step <= MAX_VALUE_DEPTH; step += 1) {
    const parent: ts.Node | undefined = current.parent;
    if (parent === undefined) return false;
    if (
      (ts.isPropertyAccessExpression(parent) || ts.isElementAccessExpression(parent)) &&
      parent.expression === current
    ) {
      current = parent;
      continue;
    }
    if (
      ts.isParenthesizedExpression(parent) ||
      ts.isAsExpression(parent) ||
      ts.isSatisfiesExpression(parent) ||
      ts.isNonNullExpression(parent)
    ) {
      current = parent;
      continue;
    }
    // The chain must END as a property's value, or as a shorthand's own name.
    const isValue =
      (ts.isPropertyAssignment(parent) && parent.initializer === current) ||
      (ts.isShorthandPropertyAssignment(parent) && parent.name === current);
    if (!isValue) return false;
    return enclosedBy(parent, returned);
  }
  return false;
}

/** Whether this property sits inside that object, through object literals only. */
function enclosedBy(property: ts.Node, returned: ts.ObjectLiteralExpression): boolean {
  let current: ts.Node | undefined = property;
  for (let step = 0; step <= MAX_VALUE_DEPTH; step += 1) {
    if (current === undefined) return false;
    if (current === returned) return true;
    // Only object literals and their properties on the way up: an array or a
    // call in between means the value is not simply held.
    if (
      !ts.isObjectLiteralExpression(current) &&
      !ts.isPropertyAssignment(current) &&
      !ts.isShorthandPropertyAssignment(current)
    ) {
      return false;
    }
    current = current.parent;
  }
  return false;
}

/** How deep a plain value may be nested before this reader gives up. */
const MAX_VALUE_DEPTH = 12;

/**
 * Whether this identifier is the name being USED, rather than a property key or
 * a binding being introduced.
 *
 * `{ description: 1 }` and `x.description` mention no `description` variable,
 * and a parameter or declaration name is where the binding comes FROM.
 */
function isValueOccurrence(node: ts.Identifier): boolean {
  const parent = node.parent;
  if (parent === undefined) return false;
  if (ts.isPropertyAccessExpression(parent) && parent.name === node) return false;
  if (ts.isPropertyAssignment(parent) && parent.name === node) return false;
  if (ts.isBindingElement(parent) && parent.name !== node) return false;
  if (ts.isParameter(parent) && parent.name === node) return false;
  if (ts.isVariableDeclaration(parent) && parent.name === node) return false;
  return true;
}



function countReturns(body: ts.Block): number {
  let found = 0;
  const visit = (node: ts.Node): void => {
    // A nested function's returns are its own.
    if (node !== body && (ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) ||
        ts.isArrowFunction(node))) {
      return;
    }
    if (ts.isReturnStatement(node)) found += 1;
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(body, visit);
  return found;
}


/**
 * What each of the helper's destructured names stands for at this call site.
 *
 * Only the shape a metadata helper actually has: one parameter destructured
 * from one object literal argument. A default in the parameter list is kept
 * when the call omits the key, because that default is a literal the helper
 * declares. Anything else -- a rest element, a nested pattern, a spread in the
 * argument, a second argument -- is refused.
 */
function substitutionFor(
  helper: ts.FunctionDeclaration,
  call: ts.CallExpression,
  helperOwner: ParsedModule,
  callOwner: ParsedModule,
): ReadonlyMap<string, Located> | null {
  if (helper.parameters.length !== 1 || call.arguments.length !== 1) return null;
  const parameter = helper.parameters[0];
  const argument = call.arguments[0];
  if (parameter === undefined || argument === undefined) return null;
  if (!ts.isObjectBindingPattern(parameter.name)) return null;
  if (!ts.isObjectLiteralExpression(argument)) return null;
  const supplied = new Map<string, ts.Expression>();
  for (const property of argument.properties) {
    if (!ts.isPropertyAssignment(property)) return null;
    // A `__proto__` key here sets the argument's PROTOTYPE, so destructuring
    // reads inherited values this map never saw -- and the parameter default
    // would be substituted for a key the call did supply, inherited.
    const text = dataPropertyKey(property.name);
    if (text === null) return null;
    supplied.set(text, property.initializer);
  }
  const substitution = new Map<string, Located>();
  for (const element of parameter.name.elements) {
    if (element.dotDotDotToken !== undefined) return null;
    if (!ts.isIdentifier(element.name)) return null;
    const key = element.propertyName;
    const keyText = key === undefined ? dataPropertyKey(element.name) : dataPropertyKey(key);
    if (keyText === null) return null;
    const given = supplied.get(keyText);
    if (given !== undefined) {
      substitution.set(element.name.text, {
        expression: given,
        module: callOwner,
        // An argument is written at the CALL, outside the parameter list it
        // feeds, so no parameter name stands for anything inside it.
        substitution: NO_SUBSTITUTION,
      });
      continue;
    }
    // A DEFAULT is written in the helper, so the names it uses are the helper's
    // to resolve. Reading it in the route's module would reach a different
    // constant, or none at all.
    if (element.initializer !== undefined) {
      substitution.set(element.name.text, {
        expression: element.initializer,
        module: helperOwner,
        substitution: NO_SUBSTITUTION,
      });
    }
  }
  return substitution;
}

/**
 * `"unreadable"` again, for the same reason it exists at the top: a property
 * that EXISTS but whose value cannot be trusted is not a property that is
 * missing. Returning null for it let `robots` read as absent and take the
 * default -- publishing `index: true` for a route that declared otherwise.
 */
function propertyOf(metadata: MetadataObject, name: string): Located | "unreadable" | null {
  // A top-level assignment runs AFTER the object is built, so it is the value
  // Next serves for that key whatever the object literal wrote.
  const assigned = metadata.overrides.get(name);
  if (assigned !== undefined) return assigned;
  for (const property of metadata.object.properties) {
    // `{ title, description }` is how a helper hands its parameters straight
    // through, and it is the commonest shape there is. The shorthand's name IS
    // the identifier it stands for.
    if (ts.isShorthandPropertyAssignment(property)) {
      if (property.name.text !== name) continue;
      if (metadata.substitution.has(property.name.text)) {
        return substituted(metadata, property.name.text) ?? "unreadable";
      }
      // `{ description }` outside a helper names a local in the object's own
      // module, which is a declared value this reader may fail to resolve --
      // never an absent one.
      return {
        expression: property.name,
        module: metadata.objectModule,
        substitution: metadata.substitution,
      };
    }
    if (!ts.isPropertyAssignment(property)) continue;
    if (dataPropertyKey(property.name) !== name) continue;
    const initializer = property.initializer;
    // `description: description` inside the helper is the helper's own
    // parameter, so what it stands for is whatever the call supplied.
    // Only a name the helper's parameter list bound goes through the
    // substitution. A direct `{ description: DESCRIPTION }` names a constant in
    // the module that wrote it, and routing it through an empty map turned a
    // DECLARED value into an absent one -- which then inherited an ancestor's,
    // the one thing the README says a declared unreadable value must not do.
    if (ts.isIdentifier(initializer) && metadata.substitution.has(initializer.text)) {
      return substituted(metadata, initializer.text) ?? "unreadable";
    }
    return {
      expression: initializer,
      module: metadata.objectModule,
      substitution: metadata.substitution,
    };
  }
  return null;
}

/**
 * A substituted value, with the module that WROTE it.
 *
 * A value the call supplied belongs to the route's module; a parameter default
 * belongs to the helper's. `substitutionFor` recorded which, because resolving a
 * default in the route's module would reach a different constant, or none.
 */
function substituted(metadata: MetadataObject, name: string): Located | null {
  const located = metadata.substitution.get(name);
  if (located === undefined) return null;
  // The value the call supplied is what the page renders exactly when the
  // helper does nothing with that name but put it in the object it returns.
  // Asked per field, so a helper may still compute with parameters this reader
  // is not reading.
  if (metadata.body !== null && usedOutsideReturn(metadata.body, metadata.returned, name)) {
    return null;
  }
  return located;
}

/** The module a helper is declared in. */
function helperModule(helper: ts.FunctionDeclaration, fallback: ParsedModule): ParsedModule {
  const source = helper.getSourceFile();
  return source === fallback.source ? fallback : { file: source.fileName, source };
}

/**
 * A declared flag, or null when it is written as something this reader cannot
 * read.
 *
 * ABSENT and UNREADABLE are different answers here for a reason with teeth: a
 * flag nobody wrote takes the default, but `robots: { index: INDEX }` where
 * `INDEX` is `false` would have taken the default `true` and turned a noindex
 * route into an indexable one, silently, in the protected page descriptor.
 */
function booleanOf(expression: ts.Expression | null): boolean | "unreadable" | null {
  if (expression === null) return null;
  if (expression.kind === ts.SyntaxKind.TrueKeyword) return true;
  if (expression.kind === ts.SyntaxKind.FalseKeyword) return false;
  return "unreadable";
}

/**
 * A field is either absent — in which case an outer layout still supplies it —
 * or declared here. A declaration the tool cannot read is NOT absent: inheriting
 * over it would attribute an ancestor's value to a route that overrode it, so it
 * resolves to nothing and is reported as missing.
 */
type Declared<Value> =
  | { readonly kind: "absent" }
  | { readonly kind: "unreadable" }
  | { readonly kind: "value"; readonly value: Value };

const ABSENT = { kind: "absent" } as const;

interface DeclaredMetadata {
  readonly title: Declared<string>;
  readonly description: Declared<string>;
  readonly indexing: Declared<IndexingDirectives>;
}

/** A route that declared metadata this reader could not read at all. */
const DECLARED_UNREADABLE: DeclaredMetadata = {
  title: { kind: "unreadable" },
  description: { kind: "unreadable" },
  indexing: { kind: "unreadable" },
};

const NOTHING_DECLARED: DeclaredMetadata = {
  title: ABSENT,
  description: ABSENT,
  indexing: ABSENT,
};

/** What a route resolves to when nothing on its chain declares metadata. */
export const UNDECLARED_METADATA: NextMetadata = {
  title: null,
  description: null,
  indexing: DEFAULT_INDEXING,
};

function declaredString(
  object: MetadataObject,
  name: string,
  repositoryRoot: string,
  cache: ModuleCache,
): Declared<string> {
  const located = propertyOf(object, name);
  if (located === null) return ABSENT;
  if (located === "unreadable") return { kind: "unreadable" };
  // A literal answers directly. Anything else -- `company.metaDescription` is
  // the shape a real site uses -- is resolved the same way a content value is,
  // in the module that WROTE the expression rather than the one that returned
  // the object.
  const value =
    stringValueOf(located.expression) ??
    resolveStaticValue(located.expression, {
      module: located.module,
      repositoryRoot,
      cache,
    })?.value ??
    null;
  return value === null ? { kind: "unreadable" } : { kind: "value", value };
}

/** The only `robots` keys this reader models. Anything else fails closed. */
const MODELLED_ROBOTS_KEYS: ReadonlySet<string> = new Set(["index", "follow"]);

/** `robots` is a nested object, which Next.js overwrites whole rather than merges. */
function declaredRobots(object: MetadataObject): Declared<IndexingDirectives> {
  const robots = propertyOf(object, "robots");
  if (robots === null) return ABSENT;
  if (robots === "unreadable") return { kind: "unreadable" };
  if (!ts.isObjectLiteralExpression(robots.expression)) return { kind: "unreadable" };
  // The nested object is read the same way, under the same substitution: a
  // helper may hand `robots` its own parameter just as it hands `description`.
  // A nested object the CALL supplied has already been proven unreachable by
  // `propertyOf`; one written in the helper is checked here for the same
  // members the outer object is.
  if (!isPlainDataObject(robots.expression)) return { kind: "unreadable" };
  const nested: MetadataObject = {
    object: robots.expression,
    objectModule: robots.module,
    // The environment comes with the value: an ASSIGNED object is the route's
    // own, where a helper parameter of the same name means nothing, while one
    // written in the helper resolves against the call's arguments.
    substitution: robots.substitution,
    callModule: object.callModule,
    body: object.body,
    returned: object.returned,
    // An assignment to `robots` is not an assignment to anything INSIDE it, and
    // a nested path is refused outright, so this object has no writes of its own.
    overrides: NO_OVERRIDES,
  };
  // Every key this reader does not model is a directive the route declared and
  // the descriptor would contradict: `{ index: true, noarchive: true }` emitted
  // as `archive: true` publishes the opposite of what the route says. So an
  // unmodelled key makes the block unreadable rather than partly read.
  for (const property of nested.object.properties) {
    const name = property.name;
    const key = name === undefined ? null : dataPropertyKey(name);
    if (key === null || !MODELLED_ROBOTS_KEYS.has(key)) return { kind: "unreadable" };
  }
  const indexRead = propertyOf(nested, "index");
  const followRead = propertyOf(nested, "follow");
  if (indexRead === "unreadable" || followRead === "unreadable") return { kind: "unreadable" };
  const index = booleanOf(indexRead?.expression ?? null);
  const follow = booleanOf(followRead?.expression ?? null);
  // One unreadable flag makes the whole block unreadable, because a descriptor
  // built from a default this reader invented is worse than a reported refusal.
  if (index === "unreadable" || follow === "unreadable") return { kind: "unreadable" };
  return {
    kind: "value",
    value: {
      ...DEFAULT_INDEXING,
      index: index ?? DEFAULT_INDEXING.index,
      follow: follow ?? DEFAULT_INDEXING.follow,
    },
  };
}

/** What one module declares, with no inheritance applied. */
function readDeclaredMetadata(
  module: ParsedModule,
  cache: ModuleCache,
  repositoryRoot: string,
): DeclaredMetadata {
  const object = findMetadataObject(module, cache, repositoryRoot);
  if (object === null) return NOTHING_DECLARED;
  // Declared, and not read. Every field is reported rather than absent, so none
  // of them inherits an ancestor's value.
  if (object === "unreadable") return DECLARED_UNREADABLE;
  return {
    title: declaredString(object, "title", repositoryRoot, cache),
    description: declaredString(object, "description", repositoryRoot, cache),
    indexing: declaredRobots(object),
  };
}

/**
 * The nearest DECLARED answer in the chain, keeping absent and unreadable
 * apart. `resolveField` collapses them, which is right where both must be
 * reported and wrong where absence has a legitimate default.
 */
function resolveDeclared<Value>(
  chain: readonly DeclaredMetadata[],
  select: (declared: DeclaredMetadata) => Declared<Value>,
): Declared<Value> {
  for (const declared of chain) {
    const field = select(declared);
    if (field.kind === "absent") continue;
    return field;
  }
  return ABSENT;
}

function resolveField<Value>(
  chain: readonly DeclaredMetadata[],
  select: (declared: DeclaredMetadata) => Declared<Value>,
): Value | null {
  for (const declared of chain) {
    const field = select(declared);
    if (field.kind === "absent") continue;
    return field.kind === "value" ? field.value : null;
  }
  return null;
}

/**
 * Resolves one route's metadata from its own fallback chain, nearest first.
 * The caller decides what the chain is; this never reaches for a module the
 * caller did not name.
 */
/**
 * Absent everywhere means the default Next.js renders. Declared-but-unreadable
 * means report it, so a descriptor is never built from a flag this reader
 * invented.
 */
function resolveIndexing(chain: readonly DeclaredMetadata[]): IndexingDirectives | null {
  const declared = resolveDeclared(chain, (entry) => entry.indexing);
  if (declared.kind === "absent") return DEFAULT_INDEXING;
  return declared.kind === "value" ? declared.value : null;
}

export function readNextMetadata(
  chain: readonly ParsedModule[],
  cache: ModuleCache,
  repositoryRoot: string,
): NextMetadata {
  const declared = chain.map((module) => readDeclaredMetadata(module, cache, repositoryRoot));
  return {
    title: resolveField(declared, (entry) => entry.title),
    description: resolveField(declared, (entry) => entry.description),
    indexing: resolveIndexing(declared),
  };
}
