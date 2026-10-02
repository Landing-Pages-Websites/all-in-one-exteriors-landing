import ts from "typescript";

import { type AnchorPath, type AnchorSegment } from "./anchors.js";
import { isComponentName } from "./jsx-facts.js";
import { stringValueOf } from "./literals.js";
import {
  bindingNames,
  isBoundBetween,
  isFunctionLike,
  isValueReference,
  scopeOfDeclaration,
} from "./scopes.js";
import {
  importedBindingsOf,
  reExportsOf,
  repositoryFileForSpecifier,
  repositoryModuleFiles,
  type ModuleCache,
  type ParsedModule,
} from "./scan.js";

/**
 * Reads the string a JSX expression renders, when — and only when — every step
 * from the expression to a string literal is a NAMED source fact decided by
 * syntax alone: a module-level `const`, an object-literal property name, an
 * export name, an import specifier.
 *
 * This is the same identity doctrine `anchors.ts` states, applied one layer
 * deeper. A value read here is anchored on the chain of names that produced it
 * (`each:ctas/prop:primary/prop:label`), never on where it happened to appear
 * in the markup — so moving the paragraph, restyling it or reordering its
 * siblings cannot move the field, and renaming the data can.
 *
 * Everything else resolves to `null` and is reported to a human instead. The
 * failure this guards against is not missing a value; it is writing a
 * customer's page from a string the site never actually rendered. Refusals are
 * therefore deliberate and listed one by one:
 *
 *   - array indexing        position is not identity (`anchors.ts`)
 *   - computed keys         the key is not a name until it is a literal
 *   - object spreads        a later spread silently overwrites an earlier key
 *   - calls, conditionals,
 *     concatenation, `??`   the result depends on evaluation, not on syntax
 *   - `let` / `var`         a reassignment elsewhere is invisible from here
 *   - shadowed names        the nearest binding wins, and it is not the module's
 *   - `?.` and `!`          the author is saying the value may be absent
 *   - default exports       the only name is the importer's alias, per import
 *   - non-string leaves     a number renders, but it is not customer text
 */

const MAX_PROPERTY_DEPTH = 8;
const MAX_RESOLUTION_DEPTH = 8;
const MAX_MODULE_HOPS = 8;

export interface ResolutionContext {
  readonly module: ParsedModule;
  readonly repositoryRoot: string;
  readonly cache: ModuleCache;
}

export interface ValueResolution {
  readonly value: string;
  /** The chain of names the value lives under, in `anchors.ts` segments. */
  readonly path: AnchorPath;
  /** The module the root binding is declared in. */
  readonly declaredIn: string;
  /**
   * Whether the root binding is exported. An exported name is a name other
   * modules can read, so every reader of it names the same value and the anchor
   * stands alone. A module-private name is scoped to its module — two modules
   * may each declare `LAST_UPDATED` and mean different dates — so the caller
   * must qualify it with the component that reads it.
   */
  readonly shared: boolean;
}

/** A resolved expression stays paired with the module whose scope reads it. */
interface Bound {
  readonly expression: ts.Expression;
  readonly module: ParsedModule;
}

/** Wrappers that change a type and never a value. `!` is deliberately absent. */
function unwrap(expression: ts.Expression): ts.Expression {
  let current = expression;
  for (;;) {
    if (ts.isParenthesizedExpression(current)) {
      current = current.expression;
      continue;
    }
    if (ts.isAsExpression(current) || ts.isSatisfiesExpression(current)) {
      current = current.expression;
      continue;
    }
    if (ts.isTypeAssertionExpression(current)) {
      current = current.expression;
      continue;
    }
    return current;
  }
}

interface PathRead {
  readonly root: ts.Identifier;
  readonly properties: readonly string[];
}

/**
 * Decomposes `a.b["c"]` into its root and its property names. Any link that is
 * not a written name — an index, a computed key, an optional link — refuses the
 * whole read rather than the one link, because a partial path names nothing.
 */
export function readPath(expression: ts.Expression): PathRead | null {
  const properties: string[] = [];
  let current = unwrap(expression);
  while (properties.length <= MAX_PROPERTY_DEPTH) {
    if (ts.isIdentifier(current)) {
      return { root: current, properties: properties.reverse() };
    }
    if (ts.isPropertyAccessExpression(current)) {
      if (current.questionDotToken !== undefined) return null;
      if (!ts.isIdentifier(current.name)) return null;
      properties.push(current.name.text);
      current = unwrap(current.expression);
      continue;
    }
    if (ts.isElementAccessExpression(current)) {
      if (current.questionDotToken !== undefined) return null;
      const argument = unwrap(current.argumentExpression);
      if (!ts.isStringLiteral(argument)) return null;
      properties.push(argument.text);
      current = unwrap(current.expression);
      continue;
    }
    return null;
  }
  return null;
}

/**
 * Whether a nearer binding than the module's owns this name at this position.
 * A component prop named `copy` makes the module's `copy` unreadable here, and
 * reading the module's anyway would publish a value the page never rendered.
 */
export function isShadowed(node: ts.Node, name: string): boolean {
  return isBoundBetween(node, null, name);
}

/**
 * The module-level `const` a name refers to. A name declared twice at module
 * level refuses: two declarations cannot both be the answer, and picking one is
 * the kind of guess this tool exists not to make.
 */
function moduleConstOf(
  module: ParsedModule,
  name: string,
): { readonly expression: ts.Expression; readonly exported: boolean } | null {
  let found: { readonly expression: ts.Expression; readonly exported: boolean } | null = null;
  let seen = 0;
  for (const statement of module.source.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    const isConst = (statement.declarationList.flags & ts.NodeFlags.Const) !== 0;
    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name) || declaration.name.text !== name) continue;
      seen += 1;
      if (!isConst || declaration.initializer === undefined) return null;
      found = {
        expression: declaration.initializer,
        exported: isExported(statement) || isExportedByList(module, name),
      };
    }
  }
  return seen === 1 ? found : null;
}

function isExported(statement: ts.VariableStatement): boolean {
  return (
    statement.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword) === true
  );
}

function exportedConstOf(module: ParsedModule, name: string): ts.Expression | null {
  const declared = moduleConstOf(module, name);
  if (declared === null || !declared.exported) return null;
  return declared.expression;
}

/**
 * Whether an export list carries this local name out of the module.
 *
 * `export { copy }` makes `copy` exactly as shared as `export const copy` does,
 * so a reader in the declaring module must reach the same conclusion an
 * importing reader does — otherwise the two produce different anchors for one
 * value and it never merges.
 */
function isExportedByList(module: ParsedModule, localName: string): boolean {
  for (const statement of module.source.statements) {
    if (!ts.isExportDeclaration(statement)) continue;
    if (statement.moduleSpecifier !== undefined) continue;
    const clause = statement.exportClause;
    if (clause === undefined || !ts.isNamedExports(clause)) continue;
    for (const element of clause.elements) {
      // `export { copy as default }` exports it under a name this tool refuses
      // everywhere else, because a default has no durable declared name.
      if (element.name.text === "default") continue;
      if ((element.propertyName ?? element.name).text === localName) return true;
    }
  }
  return false;
}

/** A declaration reached through an export, under the name it was DECLARED with. */
interface ExportedDeclaration extends Bound {
  readonly declaredName: string;
}

function sameDeclaration(a: ExportedDeclaration, b: ExportedDeclaration): boolean {
  return a.module.file === b.module.file && a.declaredName === b.declaredName;
}

/** Names a module exports through an export list with no module specifier. */
function localExportAliases(module: ParsedModule, exportName: string): readonly string[] {
  const locals: string[] = [];
  for (const statement of module.source.statements) {
    if (!ts.isExportDeclaration(statement)) continue;
    if (statement.moduleSpecifier !== undefined) continue;
    const clause = statement.exportClause;
    if (clause === undefined || !ts.isNamedExports(clause)) continue;
    for (const element of clause.elements) {
      if (element.name.text !== exportName) continue;
      locals.push((element.propertyName ?? element.name).text);
    }
  }
  return locals;
}

/**
 * EVERY declaration an export name could resolve to.
 *
 * Returning the first match would let two `export *` barrels be settled by the
 * order the statements happen to appear in, which is the ambiguity this tool
 * exists to refuse. The caller rejects anything that resolves to more than one
 * declaration.
 *
 * The name each result carries is the one at the END of the chain, so an alias
 * introduced on the way through — `export { ctas as actions }` — does not
 * become a second identity for a value that already has one.
 */
function findExports(
  module: ParsedModule,
  name: string,
  context: ResolutionContext,
  visited: ReadonlySet<string>,
  hops: number,
): readonly ExportedDeclaration[] {
  if (hops > MAX_MODULE_HOPS) return [];
  const key = `${module.file}#${name}`;
  if (visited.has(key)) return [];
  const nextVisited = new Set(visited).add(key);
  const found: ExportedDeclaration[] = [];

  const inline = exportedConstOf(module, name);
  if (inline !== null) found.push({ expression: inline, module, declaredName: name });

  for (const local of localExportAliases(module, name)) {
    const declared = moduleConstOf(module, local);
    if (declared !== null) {
      found.push({ expression: declared.expression, module, declaredName: local });
      continue;
    }
    // `import { ctas } from "./content"; export { ctas };`
    const imported = importedBindingsOf(module, context.repositoryRoot).get(local);
    if (imported === undefined) continue;
    found.push(...followImport(imported, local, context, nextVisited, hops));
  }

  for (const reExport of reExportsOf(module, context.repositoryRoot)) {
    if (!reExport.isRepositoryLocal || reExport.resolvedFile === null) continue;
    const matchesName = reExport.exportedName === name;
    const isStar = reExport.exportedName === null && reExport.importedName === null;
    if (!matchesName && !isStar) continue;
    const wanted = matchesName ? (reExport.importedName ?? name) : name;
    const target = context.cache.read(reExport.resolvedFile);
    found.push(...findExports(target, wanted, context, nextVisited, hops + 1));
  }

  return dedupeDeclarations(found);
}

function followImport(
  reference: ReturnType<typeof importedBindingsOf> extends ReadonlyMap<string, infer R>
    ? R
    : never,
  _local: string,
  context: ResolutionContext,
  visited: ReadonlySet<string>,
  hops: number,
): readonly ExportedDeclaration[] {
  if (!reference.isRepositoryLocal || reference.resolvedFile === null) return [];
  // A default export has no declared name, so the only name available is the
  // importer's alias — which differs per import site and is not durable.
  if (reference.importedName === null || reference.importedName === "default") return [];
  const target = context.cache.read(reference.resolvedFile);
  return findExports(target, reference.importedName, context, visited, hops + 1);
}

function dedupeDeclarations(
  declarations: readonly ExportedDeclaration[],
): readonly ExportedDeclaration[] {
  const unique: ExportedDeclaration[] = [];
  for (const declaration of declarations) {
    if (!unique.some((entry) => sameDeclaration(entry, declaration))) unique.push(declaration);
  }
  return unique;
}

/** The declaration a root name resolves to, and the name it is DECLARED under. */
interface RootBinding extends Bound {
  readonly declaredName: string;
  readonly shared: boolean;
}

function resolveRoot(
  root: ts.Identifier,
  module: ParsedModule,
  context: ResolutionContext,
): RootBinding | null {
  const local = moduleConstOf(module, root.text);
  if (local !== null) {
    return {
      expression: local.expression,
      module,
      declaredName: root.text,
      shared: local.exported,
    };
  }

  const imported = importedBindingsOf(module, context.repositoryRoot).get(root.text);
  if (imported === undefined) return null;
  const found = followImport(imported, root.text, context, new Set(), 0);
  const only = found.length === 1 ? found[0] : undefined;
  return only === undefined ? null : { ...only, shared: true };
}

/**
 * Reads one property off an object literal. A spread anywhere refuses the whole
 * object: a spread before the key may be the only source of it, and a spread
 * after the key overwrites it. Neither is visible without evaluating.
 */
const PROTOTYPE_KEY = "__proto__";

function propertyOf(bound: Bound, name: string): Bound | null {
  const object = unwrap(bound.expression);
  if (!ts.isObjectLiteralExpression(object)) return null;
  // `{ __proto__: "x" }` sets the prototype; it does not create a property
  // named `__proto__`, so `copy["__proto__"]` does not read that string.
  if (name === PROTOTYPE_KEY) return null;
  let found: ts.Expression | null = null;
  for (const property of object.properties) {
    if (ts.isSpreadAssignment(property)) return null;
    if (ts.isShorthandPropertyAssignment(property)) {
      if (property.name.text === name) found = property.name;
      continue;
    }
    if (!ts.isPropertyAssignment(property)) {
      // A getter, setter or method is computed, not a written value.
      const key = property.name;
      if (key !== undefined && (ts.isIdentifier(key) || ts.isStringLiteral(key))) {
        if (key.text === name) return null;
      }
      continue;
    }
    const key = property.name;
    const keyText = ts.isIdentifier(key) || ts.isStringLiteral(key) ? key.text : null;
    if (keyText === null) {
      // A computed key could be this name; the object can no longer be read.
      return null;
    }
    if (keyText === name) found = property.initializer;
  }
  return found === null ? null : { expression: found, module: bound.module };
}

/**
 * The string an expression denotes, read in its own module's scope. Identifiers
 * resolve through module-level `const`s and repository-local imports; template
 * literals resolve when every substitution does.
 */
interface WalkedPath {
  readonly leaf: Bound;
  readonly root: RootBinding;
  readonly properties: readonly string[];
}

/**
 * Follows a path expression to the declaration it names and then down through
 * the object literals its property names select. This is the one walk; both the
 * anchor and the string are read off its result.
 */
function walkPath(
  expression: ts.Expression,
  module: ParsedModule,
  context: ResolutionContext,
  checkEscapes = true,
): WalkedPath | null {
  const path = readPath(expression);
  if (path === null) return null;
  if (isShadowed(expression, path.root.text)) return null;
  const root = resolveRoot(path.root, module, context);
  if (root === null) return null;

  if (checkEscapes && hasEscaped(root, path.properties, context)) return null;

  let leaf: Bound = { expression: root.expression, module: root.module };
  for (const property of path.properties) {
    const next = propertyOf(leaf, property);
    if (next === null) return null;
    leaf = next;
  }
  return { leaf, root, properties: path.properties };
}

function stringOf(bound: Bound, context: ResolutionContext, depth: number): string | null {
  if (depth > MAX_RESOLUTION_DEPTH) return null;
  const expression = unwrap(bound.expression);

  const literal = stringValueOf(expression);
  if (literal !== null) return literal;

  if (ts.isTemplateExpression(expression)) {
    let text = expression.head.text;
    for (const span of expression.templateSpans) {
      const part = stringOf({ expression: span.expression, module: bound.module }, context, depth + 1);
      if (part === null) return null;
      text += part + span.literal.text;
    }
    return text;
  }

  const walked = walkPath(expression, bound.module, context);
  return walked === null ? null : stringOf(walked.leaf, context, depth + 1);
}

/**
 * Where a declaration's object graph stops being provably readable.
 *
 * `const` freezes the BINDING, not the object, so the question is whether
 * anything can change what a path reads. Hunting for WRITES cannot answer it:
 * a write may be made through an alias, a namespace, a parameter, or a
 * function this reading cannot follow, and an unresolved write silently looked
 * like no write at all — which is the wrong direction to fail in.
 *
 * So the question is inverted. A reference is safe when the chain of property
 * names written on it resolves, right there, to a STRING — a string cannot be
 * mutated by whoever receives it. Anything else hands out an OBJECT, and
 * whoever holds an object can write through it, so the path handed out is
 * recorded as escaped. Reading a path refuses if an escaped path is a prefix
 * of it, which keeps `ctas.rfp.label` readable when only `ctas.primary` was
 * handed to a component.
 *
 * The whole declaration escapes when a bare reference is handed out, when it
 * is written to directly, or when the reference cannot be classified at all.
 */
const ESCAPE_INDEX = new WeakMap<ModuleCache, ReadonlyMap<string, readonly string[]>>();

const ESCAPE_SEPARATOR = "\u0000";

function escapeKey(properties: readonly string[]): string {
  return properties.join(ESCAPE_SEPARATOR);
}

function declarationKeyOf(
  module: ParsedModule,
  name: string,
  context: ResolutionContext,
  depth = 0,
): readonly string[] {
  if (depth > MAX_RESOLUTION_DEPTH) return [];
  const local = moduleConstOf(module, name);
  if (local !== null) {
    const keys = [`${module.file}#${name}`];
    const aliased = readPath(local.expression);
    if (aliased !== null && aliased.properties.length === 0) {
      keys.push(...declarationKeyOf(module, aliased.root.text, context, depth + 1));
    }
    return keys;
  }
  const imported = importedBindingsOf(module, context.repositoryRoot).get(name);
  if (imported === undefined) return [];
  return followImport(imported, name, context, new Set(), 0).map(
    (entry) => `${entry.module.file}#${entry.declaredName}`,
  );
}

/**
 * Whether a namespace chain lands on a string.
 *
 * The value resolver deliberately refuses a namespace root, because the local
 * alias is not a durable name for a FIELD. That says nothing about whether the
 * read hands an object out, which is what the escape index needs to know, so
 * the chain is followed here through the same export resolution every other
 * reader uses.
 */
function namespaceChainIsText(
  target: ParsedModule,
  head: string,
  rest: readonly string[],
  context: ResolutionContext,
): boolean {
  const exported = findExports(target, head, context, new Set(), 0);
  if (exported.length !== 1) return false;
  const root = exported[0];
  if (root === undefined) return false;
  let leaf: Bound = { expression: root.expression, module: root.module };
  for (const property of rest) {
    const next = propertyOf(leaf, property);
    if (next === null) return false;
    leaf = next;
  }
  return stringOf(leaf, context, 0) !== null;
}

/**
 * The module a name stands for, when that name is a MODULE rather than a value.
 *
 * A namespace can be forwarded any number of ways and they all mean the same
 * thing, so this follows the name rather than recognising shapes:
 *
 *   export * as content from "./m"          — bound here
 *   import * as content from "./m"; export { content }
 *   export { content } from "./barrel"      — and under a new name
 *
 * Ambiguity and cycles refuse, the same way `findExports` does, because a name
 * that stands for two modules stands for neither.
 */
function namespaceExportTarget(
  module: ParsedModule,
  name: string,
  context: ResolutionContext,
  visited: ReadonlySet<string> = new Set(),
  hops = 0,
): ParsedModule | null {
  if (hops > MAX_MODULE_HOPS) return null;
  const key = `${module.file}#${name}`;
  if (visited.has(key)) return null;
  const nextVisited = new Set(visited).add(key);
  const found: ParsedModule[] = [];

  for (const reExport of reExportsOf(module, context.repositoryRoot)) {
    if (!reExport.isRepositoryLocal || reExport.resolvedFile === null) continue;
    const target = context.cache.read(reExport.resolvedFile);
    // `export * from "./ns"` spells no name at all, yet forwards every name
    // `ns` exports — including a namespace `ns` bound with `export * as`.
    if (reExport.exportedName === null && reExport.importedName === null) {
      const through = namespaceExportTarget(target, name, context, nextVisited, hops + 1);
      if (through !== null) found.push(through);
      continue;
    }
    if (reExport.exportedName !== name) continue;
    // `export * as name from "./m"` binds the module here.
    if (reExport.importedName === null) {
      found.push(target);
      continue;
    }
    // `export { x as name } from "./barrel"` forwards whatever `x` is there.
    const onward = namespaceExportTarget(
      target,
      reExport.importedName,
      context,
      nextVisited,
      hops + 1,
    );
    if (onward !== null) found.push(onward);
  }

  // `import * as name from "./m"; export { name }` — an export list carrying a
  // namespace binding this module happens to hold.
  for (const local of localExportAliases(module, name)) {
    const imported = importedBindingsOf(module, context.repositoryRoot).get(local);
    if (imported === undefined) continue;
    if (!imported.isRepositoryLocal || imported.resolvedFile === null) continue;
    const target = context.cache.read(imported.resolvedFile);
    if (imported.importedName === null) {
      found.push(target);
      continue;
    }
    const onward = namespaceExportTarget(
      target,
      imported.importedName,
      context,
      nextVisited,
      hops + 1,
    );
    if (onward !== null) found.push(onward);
  }

  const unique = found.filter(
    (entry, index) => found.findIndex((other) => other.file === entry.file) === index,
  );
  return unique.length === 1 ? (unique[0] ?? null) : null;
}

/** The expression a reference's receiver path resolves to, for a call check. */
function receiverExpressionOf(
  node: ts.Identifier,
  module: ParsedModule,
  context: ResolutionContext,
  properties: readonly string[],
): ts.Expression {
  const root = resolveRoot(node, module, context);
  if (root === null) return node;
  let leaf: Bound = { expression: root.expression, module: root.module };
  for (const property of properties) {
    const next = propertyOf(leaf, property);
    if (next === null) return node;
    leaf = next;
  }
  return leaf.expression;
}

/** The module a namespace import names, when it is one of ours. */
function namespaceModuleOf(
  module: ParsedModule,
  name: string,
  context: ResolutionContext,
): ParsedModule | null {
  const imported = importedBindingsOf(module, context.repositoryRoot).get(name);
  if (imported === undefined) return null;
  if (!imported.isRepositoryLocal || imported.resolvedFile === null) return null;
  const target = context.cache.read(imported.resolvedFile);
  // `import * as content from "./m"` names the module directly.
  if (imported.importedName === null) return target;
  // `import { content } from "./barrel"` names one too, when the barrel got it
  // from `export * as content from "./m"`. The local alias is irrelevant; the
  // EXPORTED name is what the barrel bound the module to.
  return namespaceExportTarget(target, imported.importedName, context);
}

/**
 * Whether the chain is being CALLED, which hands its receiver to the callee.
 *
 * `copy.inner.mutate()` runs a method with `this` bound to `copy.inner`, so it
 * is `inner` that escapes, not `inner/mutate`. Recording the method path would
 * leave `copy.inner.title` readable next to a method free to rewrite it.
 */
function isCalledMember(outer: ts.Expression): boolean {
  const parent = outer.parent;
  return parent !== undefined && ts.isCallExpression(parent) && parent.expression === outer;
}

/**
 * Array methods that do not modify the array.
 *
 * This is an enumeration, which is usually the shape that causes repeat
 * findings — but of the JavaScript LANGUAGE rather than of a codebase. The list
 * is closed, published and stable, and the alternative is refusing every
 * `rows.map(...)`, which is how a real site writes every repeated region it
 * has. Anything not named here is treated as modifying.
 */
const READONLY_ARRAY_METHODS: ReadonlySet<string> = new Set([
  "at", "concat", "entries", "every", "filter", "find", "findIndex", "findLast",
  "findLastIndex", "flat", "flatMap", "forEach", "includes", "indexOf", "keys",
  "lastIndexOf", "map", "reduce", "reduceRight", "slice", "some", "values",
  "join", "toString",
]);

/**
 * Whether every item is plain DATA — nothing that runs when it is read or
 * converted, and no way to inherit something that does.
 *
 * One question rather than two, because the two answers were the same shape and
 * a partial version of it produced this round's findings: a `get meta()` runs on
 * a property read, an inherited `toString` runs on conversion, and both are
 * "this member is not data". So the proof is stated once and both the callback
 * reading and the converting methods ask it.
 *
 * A data property is a `PropertyAssignment` or its shorthand. An accessor runs,
 * a method can be called, a spread and a computed key are members this reader
 * cannot enumerate, and `__proto__` hands the whole lookup elsewhere. Each
 * fails closed, because what they hold is exactly what is unknown.
 */
function itemsArePlainData(array: ts.ArrayLiteralExpression): boolean {
  return array.elements.every((element) => {
    const item = unwrap(element);
    // A nested array is asked the same question one level down: converting one
    // converts its items in turn.
    if (ts.isArrayLiteralExpression(item)) return itemsArePlainData(item);
    if (isLiteralValue(item) && !ts.isObjectLiteralExpression(item)) return true;
    if (!ts.isObjectLiteralExpression(item)) return false;
    return item.properties.every((property) => {
      if (
        !ts.isPropertyAssignment(property) &&
        !ts.isShorthandPropertyAssignment(property)
      ) {
        return false;
      }
      const name = property.name;
      if (ts.isComputedPropertyName(name)) return false;
      const text = ts.isIdentifier(name) || ts.isStringLiteral(name) ? name.text : null;
      if (text === null) return false;
      if (text === PROTOTYPE_KEY) return false;
      // A data property can still HOLD a function, and `{ toString: function
      // () { this.title = "x" } }` runs on conversion exactly as a declared
      // `toString()` would -- being a property assignment says where the member
      // sits, not what it is. Only the members the language CALLS on its own
      // are asked about their value: a property the template never renders
      // cannot make a collection unreadable, and an `icon` holding a component
      // is never invoked by touching the item.
      if (!CONVERSION_MEMBERS.has(text)) return true;
      if (ts.isShorthandPropertyAssignment(property)) return false;
      return isNonFunctionValue(property.initializer);
    });
  });
}

/**
 * Whether calling a method on this receiver leaves it unchanged.
 *
 * Two things have to hold. The receiver must be an array LITERAL that does not
 * declare the called name itself, so the method really is the one the language
 * provides. And every function handed to it must be written inline and must not
 * write through its own parameter — because a callback receives the ELEMENTS,
 * and `rows.forEach(r => { r.title = "x" })` changes them without ever naming
 * the array.
 */
/**
 * Where each Array method puts a NUMBER in its callback's parameter list.
 *
 * Every other parameter can carry a reference into the collection, so this is
 * the one position it is safe not to track — and it is method-specific, not a
 * constant. `forEach` passes `(element, index, array)`, but `reduce` passes
 * `(accumulator, currentValue, currentIndex, array)`, where position 1 is a
 * SOURCE ITEM. Treating it as the index there let a callback write through it.
 *
 * A method absent from this map is not modelled, and a callback handed to one
 * refuses rather than guessing at its signature.
 */
const CALLBACK_INDEX_POSITION: ReadonlyMap<string, number> = new Map([
  ["every", 1],
  ["filter", 1],
  ["find", 1],
  ["findIndex", 1],
  ["findLast", 1],
  ["findLastIndex", 1],
  ["flatMap", 1],
  ["forEach", 1],
  ["map", 1],
  ["some", 1],
  // `reduce` and `reduceRight` are deliberately absent, so their callbacks
  // refuse. Their number sits at position 2 — position 1 is `currentValue`, a
  // source item — but modelling that would still leave the ACCUMULATOR, which
  // holds whatever the callback last returned and is an element the moment it
  // returns one. Tracking the accumulator refuses `acc + row.title`, which is
  // every reduce worth writing, so the entry would never have let one pass.
]);

function isReadOnlyArrayCall(
  receiver: ts.Expression,
  method: string,
  call: ts.CallExpression,
): boolean {
  const array = unwrap(receiver);
  if (!ts.isArrayLiteralExpression(array)) return false;
  if (!READONLY_ARRAY_METHODS.has(method)) return false;
  // Reading an item and converting an item both run whatever the item declares,
  // so neither is proven until the items are proven data.
  if (!itemsArePlainData(array)) return false;
  // The method not changing the array is only half of it. `at`, `find`,
  // `filter` and `slice` HAND BACK the source elements, so `rows.at(0).title =
  // "x"` rewrites a rendered item through a call this list calls harmless.
  // Where the result goes is the other half, and it is the same question.
  if (!valueIsConfined(call)) return false;
  return call.arguments.every((argument) => argumentIsSafe(argument, method, array));
}

/**
 * Whether the value this call produces can reach a write.
 *
 * Asked of the RESULT rather than of the method name, because the method name
 * cannot answer it: `filter` returns source elements and `map` usually does
 * not, and both are non-mutating. So this follows the value one step at a time
 * and fails closed the moment it lands somewhere this reader cannot see
 * through — bound to a name, passed as an argument, returned, spread.
 *
 * The two shapes a rendered collection actually uses are the ones that pass:
 * a result consumed by JSX, and a result handed straight to another non-
 * mutating call, which is `posts.filter(f).slice(0, 3).map(render)`.
 */
function valueIsConfined(value: ts.Node, seen: Set<ts.Node> = new Set()): boolean {
  let current: ts.Node = value;
  for (let step = 0; step <= MAX_PROPERTY_DEPTH; step += 1) {
    const parent: ts.Node | undefined = current.parent;
    if (parent === undefined) return false;
    // A wrapper that changes only the type is not a step.
    if (
      ts.isParenthesizedExpression(parent) ||
      ts.isAsExpression(parent) ||
      ts.isSatisfiesExpression(parent) ||
      ts.isNonNullExpression(parent)
    ) {
      current = parent;
      continue;
    }
    // Rendered by a HOST element. JSX reads such a value and has no way to
    // write back through it — but an attribute is a PROP, and a child of a
    // component is its `children` prop, and either hands the value to code this
    // reader has not opened. `<Mutator rows={rows.filter(f)} />` renders
    // nothing; it passes the source items to `Mutator`.
    if (ts.isJsxExpression(parent)) {
      if (isRenderedByHostElement(parent)) return true;
      // Handed to a component. That is only safe when the value cannot contain
      // anything from the source, which a `map` building JSX guarantees: each
      // entry is a fresh element, so there is nothing of the item left to
      // write through.
      return producesOnlyFreshElements(current);
    }
    // `rows.forEach(cb);` — the value is discarded.
    if (ts.isExpressionStatement(parent)) return true;
    // A property or index read off the result.
    if (
      (ts.isPropertyAccessExpression(parent) || ts.isElementAccessExpression(parent)) &&
      parent.expression === current
    ) {
      // `rows.at(0).title = "x"` — the read is the target of a write.
      if (isWriteTarget(parent)) return false;
      const outer = parent.parent;
      if (outer !== undefined && ts.isCallExpression(outer) && outer.expression === parent) {
        // A method called ON the result. Non-mutating, and its own result
        // confined too — the same question, one link along the chain.
        const next = ts.isPropertyAccessExpression(parent) ? parent.name.text : null;
        if (next === null || !READONLY_ARRAY_METHODS.has(next)) return false;
        // The items behind a chained result are not in hand here, so a call on
        // a value read from one cannot be proven and refuses.
        if (!outer.arguments.every((each) => argumentIsSafe(each, next, null))) return false;
        current = outer;
        continue;
      }
      current = parent;
      continue;
    }
    // An operator that yields a PRIMITIVE cannot carry the array anywhere:
    // `!rows.includes(x)` is a boolean. The trap is that `&&`, `||`, `??` and
    // `,` yield an OPERAND rather than a primitive, so they are absent from
    // both lists below and refuse here.
    if (ts.isPrefixUnaryExpression(parent) && PRIMITIVE_PREFIX_OPERATORS.has(parent.operator)) {
      return true;
    }
    if (ts.isTypeOfExpression(parent) || ts.isVoidExpression(parent)) return true;
    if (
      ts.isBinaryExpression(parent) &&
      PRIMITIVE_BINARY_OPERATORS.has(parent.operatorToken.kind)
    ) {
      return true;
    }
    // Bound to a name. That is not an answer by itself — a write through the
    // NAME never marks the array, which is the same defect one step removed —
    // so the question passes to every reference the name has.
    if (ts.isVariableDeclaration(parent) && parent.initializer === current) {
      return bindingIsConfined(parent, seen);
    }
    // Anything else — returned, passed to a call, spread, put in an object or
    // array — is a place this cannot follow.
    return false;
  }
  return false;
}

/**
 * Whether this declaration's name leaves the module, by ANY of the ways the
 * language has of exporting one.
 *
 * The keyword on the statement is only the first: `export { picked }`,
 * `export { picked as selected }` and `export default picked` all hand the
 * same binding to importers, and none of them puts a modifier on the
 * declaration. An exported name's references cannot be enumerated from the
 * declaring module, so any of these refuses.
 */
function isExportedDeclaration(declaration: ts.VariableDeclaration): boolean {
  const statement = declaration.parent?.parent;
  if (statement === undefined || !ts.isVariableStatement(statement)) return true;
  const exportedByKeyword =
    statement.modifiers?.some(
      (modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword,
    ) ?? false;
  if (exportedByKeyword) return true;
  if (!ts.isIdentifier(declaration.name)) return true;
  return isNamedByAnExport(declaration.getSourceFile(), declaration.name.text);
}

/** Whether any export statement in the file names this local binding. */
function isNamedByAnExport(source: ts.SourceFile, name: string): boolean {
  for (const statement of source.statements) {
    // `export default picked`
    if (
      ts.isExportAssignment(statement) &&
      ts.isIdentifier(statement.expression) &&
      statement.expression.text === name
    ) {
      return true;
    }
    if (!ts.isExportDeclaration(statement)) continue;
    const clause = statement.exportClause;
    // `export * from …` re-exports another module, not a local binding, but
    // `export * as ns from …` names nothing local either. Neither can carry
    // this one.
    if (clause === undefined || !ts.isNamedExports(clause)) continue;
    for (const element of clause.elements) {
      // `export { picked }` has no propertyName; `export { picked as
      // selected }` puts the LOCAL name in propertyName.
      const local = element.propertyName ?? element.name;
      if (local.text === name) return true;
    }
  }
  return false;
}

/**
 * Whether everything called on this reference is called on a primitive.
 *
 * The receiver is whatever the property path resolves to, and the items are in
 * hand and already proven plain data, so the path can simply be looked up in
 * each of them. A string, a number or a boolean cannot carry a write back into
 * the item it came from; an object, an array, a missing property or a path this
 * cannot follow all can, and refuse.
 */
function calledReceiverIsPrimitive(
  node: ts.Identifier,
  items: ts.ArrayLiteralExpression | null,
): boolean {
  if (items === null) return false;
  const path = calledReceiverPath(node);
  // The last name is the METHOD; everything before it is the receiver. A call
  // directly on the reference has no receiver path, so it is a call on the ITEM.
  if (path === null || path.length < 2) return false;
  const receiver = path.slice(0, -1);
  const method = path[path.length - 1] ?? "";
  return items.elements.every((element) => {
    let current: ts.Expression = unwrap(element);
    for (const step of receiver) {
      if (!ts.isObjectLiteralExpression(current)) return false;
      const property = current.properties.find(
        (each): each is ts.PropertyAssignment =>
          ts.isPropertyAssignment(each) &&
          (ts.isIdentifier(each.name) || ts.isStringLiteral(each.name)) &&
          each.name.text === step,
      );
      if (property === undefined) return false;
      current = unwrap(property.initializer);
    }
    // Nothing done to a primitive reaches the item it came from.
    if (isPrimitiveLiteral(current)) return true;
    // A nested list is how a real page holds an item's bullet points or its
    // sub-rows, and mapping over one is the same reading one level down: the
    // method must not change it, and whatever it is handed is proven against
    // the NESTED items rather than the outer ones.
    if (ts.isArrayLiteralExpression(current)) {
      if (!READONLY_ARRAY_METHODS.has(method)) return false;
      if (current.elements.every((entry) => isPrimitiveLiteral(unwrap(entry)))) return true;
      if (!itemsArePlainData(current)) return false;
      const call = firstCallOn(node);
      if (call === null) return false;
      return call.arguments.every((argument) => argumentIsSafe(argument, method, current));
    }
    return false;
  });
}

/**
 * Whether this value is an array of freshly built JSX, holding nothing of the
 * source.
 *
 * `rows.map((row) => <li>{row.title}</li>)` produces one new element per item.
 * The items themselves are not in the result, so handing it to a component
 * hands over nothing that can be written back into the collection. A callback
 * returning anything else may hand back part of an item -- `(row) => row.author`
 * is a named read this reader allows -- so only JSX qualifies.
 */
function producesOnlyFreshElements(value: ts.Node): boolean {
  if (!ts.isCallExpression(value)) return false;
  const callee = value.expression;
  if (!ts.isPropertyAccessExpression(callee)) return false;
  if (!ELEMENT_BUILDING_METHODS.has(callee.name.text)) return false;
  const callbacks = value.arguments.filter(
    (argument) => ts.isArrowFunction(argument) || ts.isFunctionExpression(argument),
  );
  if (callbacks.length === 0) return false;
  return callbacks.every((callback) => returnsOnlyJsx(callback as ts.ArrowFunction));
}

/** The methods whose result is built by their callback, entry by entry. */
const ELEMENT_BUILDING_METHODS: ReadonlySet<string> = new Set(["map", "flatMap"]);

/** Whether every value this function can produce is JSX. */
function returnsOnlyJsx(callback: ts.ArrowFunction | ts.FunctionExpression): boolean {
  const body = callback.body;
  if (!ts.isBlock(body)) return isJsxValue(body);
  let allJsx = true;
  let sawReturn = false;
  const visit = (node: ts.Node): void => {
    if (!allJsx) return;
    // A nested function has its own returns; they are not this one's.
    if (isFunctionLike(node) && node !== callback) return;
    if (ts.isReturnStatement(node)) {
      sawReturn = true;
      if (node.expression === undefined || !isJsxValue(node.expression)) allJsx = false;
      return;
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(body, visit);
  return allJsx && sawReturn;
}

/** JSX, through any wrapper that changes only its type. */
function isJsxValue(expression: ts.Expression): boolean {
  const value = unwrap(expression);
  return (
    ts.isJsxElement(value) ||
    ts.isJsxSelfClosingElement(value) ||
    ts.isJsxFragment(value)
  );
}

/** The first call made on a chain built from this reference. */
function firstCallOn(node: ts.Identifier): ts.CallExpression | null {
  let current: ts.Expression = node;
  for (let step = 0; step <= MAX_PROPERTY_DEPTH; step += 1) {
    const parent: ts.Node | undefined = current.parent;
    if (parent === undefined) return null;
    if (ts.isCallExpression(parent) && parent.expression === current) return parent;
    if (
      ts.isPropertyAccessExpression(parent) ||
      ts.isElementAccessExpression(parent) ||
      ts.isParenthesizedExpression(parent) ||
      ts.isAsExpression(parent) ||
      ts.isSatisfiesExpression(parent) ||
      ts.isNonNullExpression(parent)
    ) {
      current = parent;
      continue;
    }
    return null;
  }
  return null;
}

/** The property names read off the reference before the first call. */
function calledReceiverPath(node: ts.Identifier): readonly string[] | null {
  const path: string[] = [];
  let current: ts.Expression = node;
  for (let step = 0; step <= MAX_PROPERTY_DEPTH; step += 1) {
    const parent: ts.Node | undefined = current.parent;
    if (parent === undefined) return null;
    if (ts.isCallExpression(parent) && parent.expression === current) return path;
    if (ts.isPropertyAccessExpression(parent) && parent.expression === current) {
      path.push(parent.name.text);
      current = parent;
      continue;
    }
    if (
      ts.isElementAccessExpression(parent) &&
      parent.expression === current &&
      ts.isStringLiteral(parent.argumentExpression)
    ) {
      path.push(parent.argumentExpression.text);
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
    return null;
  }
  return null;
}

/**
 * The members the language calls on an item of its own accord.
 *
 * `String(item)` and any coercion reach these, so what they HOLD runs even
 * though nothing in the module calls them. Every other member runs only when
 * something calls it, and a call on an item is refused separately.
 */
const CONVERSION_MEMBERS: ReadonlySet<string> = new Set(["toString", "valueOf"]);

/**
 * Whether this item property holds something that cannot RUN.
 *
 * A literal cannot. A nested object or array literal cannot itself, and its own
 * members are asked separately by the proof that reached here. Everything else
 * -- an arrow, a function expression, a class, a name imported from anywhere, a
 * call -- either is a function or may be one, and a function reachable as
 * `toString` or through a getter runs when the item is touched.
 */
function isNonFunctionValue(value: ts.Expression): boolean {
  const inner = unwrap(value);
  if (ts.isObjectLiteralExpression(inner)) {
    return itemsArePlainData(
      ts.factory.createArrayLiteralExpression([inner]) as ts.ArrayLiteralExpression,
    );
  }
  if (ts.isArrayLiteralExpression(inner)) {
    return inner.elements.every((element) => isNonFunctionValue(element));
  }
  return isPrimitiveLiteral(inner) || inner.kind === ts.SyntaxKind.NullKeyword;
}

/**
 * Whether the path handed out is exactly a read of how many items there are.
 *
 * `rows.length` is a number, and nothing done to a number reaches the array --
 * the same reason the index parameter a callback receives is not tracked. It
 * has to be the WHOLE path: `rows.items.length` says nothing about `items`
 * itself having been handed out, and a called member is a different question
 * that `isReadOnlyArrayCall` has already answered.
 */
function isCountRead(escaped: readonly string[], called: boolean): boolean {
  return !called && escaped.length === 1 && escaped[0] === COUNT_PROPERTY;
}

/** The one property of an array whose value is a number. */
const COUNT_PROPERTY = "length";

/** A value nothing can be written through. */
function isPrimitiveLiteral(value: ts.Expression): boolean {
  return (
    ts.isStringLiteral(value) ||
    ts.isNumericLiteral(value) ||
    ts.isNoSubstitutionTemplateLiteral(value) ||
    value.kind === ts.SyntaxKind.TrueKeyword ||
    value.kind === ts.SyntaxKind.FalseKeyword
  );
}

/**
 * Whether any step of the chain built on this access is called.
 *
 * `row.meta.touch()` reads `meta` and then CALLS something on it, so the read is
 * one link of a chain that runs code. Following the chain is the difference
 * between asking what this access is and asking what is done with it.
 */
function chainIsCalled(access: ts.Expression): boolean {
  let current: ts.Expression = access;
  for (let step = 0; step <= MAX_PROPERTY_DEPTH; step += 1) {
    const parent: ts.Node | undefined = current.parent;
    if (parent === undefined) return false;
    if (ts.isCallExpression(parent) && parent.expression === current) return true;
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
    return false;
  }
  return true;
}

/**
 * Whether this JSX expression is rendered by a host element rather than handed
 * to a component.
 *
 * An attribute is a prop whatever it sits on. A child is the enclosing tag's
 * `children` prop when that tag is a component, and is rendered when it is a
 * host element. Anything this cannot place fails closed.
 */
function isRenderedByHostElement(expression: ts.JsxExpression): boolean {
  const parent = expression.parent;
  if (parent === undefined) return false;
  if (ts.isJsxAttribute(parent)) return false;
  if (ts.isJsxElement(parent)) return isHostTag(parent.openingElement.tagName);
  if (ts.isJsxFragment(parent)) return true;
  return false;
}

/**
 * Whether this tag names a host element.
 *
 * A dotted tag is a member expression, and so a component however its parts are
 * spelled: `<motion.div>` is `motion.div`, not a `div`. Only a bare lowercase
 * identifier is a host element.
 */
function isHostTag(tagName: ts.JsxTagNameExpression): boolean {
  return ts.isIdentifier(tagName) && !isComponentName(tagName.text);
}

/** Prefix operators whose result is a primitive, never the operand. */
const PRIMITIVE_PREFIX_OPERATORS: ReadonlySet<ts.SyntaxKind> = new Set([
  // Only `!`. ToBoolean on an object is always true and runs nothing, where
  // `-`, `+` and `~` all coerce, and coercing an array of items calls their
  // own `valueOf`/`toString`.
  ts.SyntaxKind.ExclamationToken,
]);

/**
 * Binary operators whose result is a primitive.
 *
 * Deliberately without `&&`, `||`, `??` and `,`, which evaluate to one of the
 * operands — `rows.filter(f) ?? []` IS the filtered array — and without every
 * assignment form, whose right side is being stored somewhere unknown.
 */
const PRIMITIVE_BINARY_OPERATORS: ReadonlySet<ts.SyntaxKind> = new Set([
  // Strict equality and `instanceof` compare without converting. Everything
  // else that yields a primitive gets there by COERCING its operand, and
  // coercing a collection runs each item's `valueOf`/`toString` -- the same
  // hazard `join` carries. `&&`, `||`, `??` and `,` are absent for the other
  // reason: they yield an OPERAND, so `rows.filter(f) ?? []` IS the array.
  ts.SyntaxKind.EqualsEqualsEqualsToken,
  ts.SyntaxKind.ExclamationEqualsEqualsToken,
  ts.SyntaxKind.InstanceOfKeyword,
]);

/**
 * Whether every use of a name holding a collection is itself confined.
 *
 * `const featured = posts.filter(f)` is how a real page selects a subset, and
 * refusing it costs most of the collections on a real site. What makes it safe
 * is not the `const` — that fixes the binding, not the object — but that every
 * reference to the name is a read. So each one is asked the same question the
 * call was asked, and a name this reader cannot enumerate the references of
 * fails closed.
 */
function bindingIsConfined(
  declaration: ts.VariableDeclaration,
  seen: Set<ts.Node>,
): boolean {
  // A name reached twice is a cycle; answering it needs its own answer.
  if (seen.has(declaration)) return false;
  seen.add(declaration);
  if (!ts.isIdentifier(declaration.name)) return false;
  const name = declaration.name.text;
  const scope = scopeOfDeclaration(declaration);
  if (scope === null) return false;
  // A nested binding of the same name would make some of the references below
  // a different value, so the references cannot be enumerated with confidence.
  if (isBoundBetween(declaration, scope, name)) return false;
  // An EXPORTED name is reachable from modules this walk never visits, so the
  // references below are not all of them. `export const featured =
  // rows.filter(f)` can be written through by any importer.
  if (isExportedDeclaration(declaration)) return false;
  let confined = true;
  const visit = (node: ts.Node): void => {
    if (!confined) return;
    if (
      ts.isIdentifier(node) &&
      node.text === name &&
      node !== declaration.name &&
      isValueReference(node) &&
      !valueIsConfined(node, seen)
    ) {
      confined = false;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(scope);
  return confined;
}

/**
 * Whether an argument handed to a non-mutating call can reach the elements.
 *
 * Two ways it cannot: it is an inline function this reader can prove only
 * reads, or it is a literal, which is the only thing that is provably not a
 * function at all. Everything else — `helpers.mutate`, `pick()`, a ternary, a
 * name imported from anywhere — is a function this reader cannot open, and it
 * receives each source element.
 */
function argumentIsSafe(
  argument: ts.Expression,
  method: string,
  items: ts.ArrayLiteralExpression | null,
): boolean {
  if (ts.isArrowFunction(argument) || ts.isFunctionExpression(argument)) {
    const indexPosition = CALLBACK_INDEX_POSITION.get(method);
    // A method whose callback signature is not modelled: refuse rather than
    // assume where its number sits.
    if (indexPosition === undefined) return false;
    const names = new Set<string>();
    for (const [position, parameter] of argument.parameters.entries()) {
      if (position === indexPosition) continue;
      bindingNames(parameter.name, names);
    }
    // A callback that binds nothing still has `this`, which a second argument
    // binds: `rows.forEach(function () { this.push(row) }, rows)` names the
    // array nowhere and changes it anyway.
    if (names.size === 0) return !mentionsImplicitBinding(argument);
    // And every name those are handed to: `const copy = row; copy.title = …`
    // reaches the same object under a name the parameter list never mentions.
    return onlyReadsThrough(argument.body, withAliases(argument.body, names), items);
  }
  return isLiteralValue(argument);
}

/** Whether this is a literal, and so cannot be a function. */
function isLiteralValue(argument: ts.Expression): boolean {
  if (ts.isPrefixUnaryExpression(argument)) return isLiteralValue(argument.operand);
  return (
    ts.isStringLiteral(argument) ||
    ts.isNumericLiteral(argument) ||
    ts.isNoSubstitutionTemplateLiteral(argument) ||
    ts.isObjectLiteralExpression(argument) ||
    ts.isArrayLiteralExpression(argument) ||
    argument.kind === ts.SyntaxKind.TrueKeyword ||
    argument.kind === ts.SyntaxKind.FalseKeyword ||
    argument.kind === ts.SyntaxKind.NullKeyword
  );
}

/** The implicit binding a function expression holds its arguments under. */
const ARGUMENTS_OBJECT = "arguments";

/**
 * Whether the callback names a value its parameter list does not.
 *
 * `this` is what a `thisArg` binds, and `arguments` is what every argument is
 * reachable through. Both are bindings a proof built from parameter names
 * cannot see, so a callback using either is not proven by that proof.
 */
function mentionsImplicitBinding(root: ts.Node): boolean {
  let found = false;
  const visit = (node: ts.Node): void => {
    if (found) return;
    if (
      node.kind === ts.SyntaxKind.ThisKeyword ||
      (ts.isIdentifier(node) && node.text === ARGUMENTS_OBJECT)
    ) {
      found = true;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(root);
  return found;
}

/** Whether a body assigns through any of these names. */
/**
 * The names given the same object, following `const b = a` for as long as it
 * keeps finding one. A parameter reached under an alias is reached.
 */
function withAliases(root: ts.Node, seeds: ReadonlySet<string>): ReadonlySet<string> {
  const names = new Set(seeds);
  // Unbounded, and it terminates: the set only GROWS and is bounded by the
  // variable declarations in the subtree, so the saturation break below is the
  // real end. A truncated alias set is a name this proof cannot see written.
  for (;;) {
    const before = names.size;
    const visit = (node: ts.Node): void => {
      if (
        ts.isVariableDeclaration(node) &&
        ts.isIdentifier(node.name) &&
        node.initializer !== undefined &&
        ts.isIdentifier(node.initializer) &&
        names.has(node.initializer.text)
      ) {
        names.add(node.name.text);
      }
      ts.forEachChild(node, visit);
    };
    visit(root);
    if (names.size === before) break;
  }
  return names;
}

/**
 * Whether every reference to these names is provably only READING.
 *
 * Three review rounds each named one more way a callback can change the array
 * it was handed: the third parameter, an alias, a mutating method, a computed
 * index, a call that takes the element. Enumerating them does not terminate —
 * `Object.assign(row, …)` is not a write target and not a method on `row`, and
 * the next shape will not be either.
 *
 * So the question is inverted, the way the escape index already asks it
 * elsewhere: a reference is safe only when it resolves RIGHT THERE to a value
 * being read out of the object — a named property, or a string-literal key.
 * Anything else is not proof of anything, and this fails closed on it.
 */
function onlyReadsThrough(
  root: ts.Node,
  names: ReadonlySet<string>,
  items: ts.ArrayLiteralExpression | null,
): boolean {
  let safe = true;
  const visit = (node: ts.Node): void => {
    if (!safe) return;
    // A write ANYWHERE in the body refuses, whatever it is written through.
    // Deciding which chains reach the elements is the question that kept
    // producing another shape — `all[index] = x`, `all["0"].title = x`,
    // `rows.at(0)!.title = x` — so the body simply may not write at all. A
    // callback that renders an element has no reason to.
    if (isWriteOperation(node)) {
      safe = false;
      return;
    }
    // `this` is the receiver a `thisArg` binds, and `forEach(function () {
    // this.push(row) }, rows)` reaches the array without naming it. Nothing
    // that renders needs `this` either.
    if (node.kind === ts.SyntaxKind.ThisKeyword) {
      safe = false;
      return;
    }
    // `arguments` holds exactly what the parameters do, under a name the
    // parameter list never mentions, so a proof built from that list cannot
    // see `sink(arguments[0])` handing an item to an opaque function.
    if (ts.isIdentifier(node) && node.text === ARGUMENTS_OBJECT) {
      safe = false;
      return;
    }
    if (ts.isIdentifier(node) && names.has(node.text) && isValueReference(node)) {
      if (!isReadOfNamedProperty(node, items)) {
        safe = false;
        return;
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(root);
  return safe;
}

/** Whether this node changes something, in any of the ways the language has. */
function isWriteOperation(node: ts.Node): boolean {
  if (ts.isBinaryExpression(node)) {
    return WRITE_OPERATORS.has(node.operatorToken.kind);
  }
  return (
    ts.isPostfixUnaryExpression(node) ||
    ts.isPrefixUnaryExpression(node) ||
    (ts.isDeleteExpression(node) as boolean)
  );
}

/** Assignment and every compound form of it. */
const WRITE_OPERATORS: ReadonlySet<ts.SyntaxKind> = new Set([
  ts.SyntaxKind.EqualsToken,
  ts.SyntaxKind.PlusEqualsToken,
  ts.SyntaxKind.MinusEqualsToken,
  ts.SyntaxKind.AsteriskEqualsToken,
  ts.SyntaxKind.AsteriskAsteriskEqualsToken,
  ts.SyntaxKind.SlashEqualsToken,
  ts.SyntaxKind.PercentEqualsToken,
  ts.SyntaxKind.LessThanLessThanEqualsToken,
  ts.SyntaxKind.GreaterThanGreaterThanEqualsToken,
  ts.SyntaxKind.GreaterThanGreaterThanGreaterThanEqualsToken,
  ts.SyntaxKind.AmpersandEqualsToken,
  ts.SyntaxKind.BarEqualsToken,
  ts.SyntaxKind.CaretEqualsToken,
  ts.SyntaxKind.AmpersandAmpersandEqualsToken,
  ts.SyntaxKind.BarBarEqualsToken,
  ts.SyntaxKind.QuestionQuestionEqualsToken,
]);

/** Whether this reference resolves, right there, to a named property read. */
function isReadOfNamedProperty(
  node: ts.Identifier,
  items: ts.ArrayLiteralExpression | null,
): boolean {
  const parent = node.parent;
  if (parent === undefined) return false;
  const access = ts.isPropertyAccessExpression(parent)
    ? parent
    : ts.isElementAccessExpression(parent) && ts.isStringLiteral(parent.argumentExpression)
      ? parent
      : null;
  // `all[index]`, `row[key]` — the key is not a name this reader can follow,
  // so what it reaches is unknown whether it is then read or written.
  if (access === null || access.expression !== node) return false;
  // Indexing a collection hands back a SOURCE ELEMENT, where naming a property
  // hands back that property -- and every property this reader publishes has
  // already been proven a string literal elsewhere. So an index read has to
  // answer the same question a call result does: `sink(all["0"])` reads
  // nothing this reader owns, it hands an item to a function it cannot open.
  if (isArrayIndexAccess(access) && !valueIsConfined(access)) return false;
  // `row.title = …`, and `Object.assign(row, …)` reached through no access at
  // all, are both excluded by the check above or by this one.
  if (isWriteTarget(access)) return false;
  // A call ANYWHERE along the chain proves nothing about the value. The
  // element is whatever the source array holds, so `row.map()` may be an
  // object literal's OWN method that rewrites `this.title` — the Array
  // built-ins are a fact about arrays, not about anything named `map`.
  // `row.meta.touch()` is the same call one link further out, where checking
  // only the immediate access could not see it. A call is proven only when its
  // receiver is a PRIMITIVE in every item: nothing done to a string can reach
  // the object the string came from, which is what makes
  // `row.title.toUpperCase()` a read and `row.meta.touch()` not one.
  if (!chainIsCalled(access)) return true;
  return calledReceiverIsPrimitive(node, items);
}

/**
 * Whether this access indexes a collection rather than naming a property.
 *
 * `all["0"]` is an array index and yields a source element; `row["title"]` is
 * a property name that happens to be spelled with a string literal, and is the
 * same read as `row.title`. ECMAScript draws the line at the canonical numeric
 * string, so this does too.
 */
function isArrayIndexAccess(access: ts.PropertyAccessExpression | ts.ElementAccessExpression): boolean {
  if (!ts.isElementAccessExpression(access)) return false;
  const key = access.argumentExpression;
  if (!ts.isStringLiteral(key)) return true;
  return CANONICAL_ARRAY_INDEX.test(key.text);
}

/** `"0"`, `"12"` — and not `"01"`, which is a property name, not an index. */
const CANONICAL_ARRAY_INDEX = /^(0|[1-9][0-9]*)$/u;

/** The outermost property chain written on a reference, and where it ends. */
function chainFrom(reference: ts.Node): {
  readonly outer: ts.Expression;
  readonly properties: readonly string[];
} {
  const properties: string[] = [];
  let current: ts.Expression = reference as ts.Expression;
  for (let step = 0; step <= MAX_PROPERTY_DEPTH; step += 1) {
    const parent = current.parent;
    if (parent === undefined) break;
    // `(copy).title` is the same read as `copy.title`; a wrapper that changes
    // only a type must not end the chain and report the object as handed out.
    if (
      ts.isParenthesizedExpression(parent) ||
      ts.isAsExpression(parent) ||
      ts.isSatisfiesExpression(parent) ||
      ts.isTypeAssertionExpression(parent) ||
      ts.isNonNullExpression(parent)
    ) {
      current = parent;
      continue;
    }
    if (ts.isPropertyAccessExpression(parent) && parent.expression === current) {
      properties.push(parent.name.text);
      current = parent;
      continue;
    }
    if (
      ts.isElementAccessExpression(parent) &&
      parent.expression === current &&
      ts.isStringLiteral(parent.argumentExpression)
    ) {
      properties.push(parent.argumentExpression.text);
      current = parent;
      continue;
    }
    break;
  }
  return { outer: current, properties };
}

/**
 * Whether the chain is being written rather than read.
 *
 * An assignment target is not always the immediate left of an `=`. A
 * destructuring target is written as an array or object LITERAL, and a
 * `for...of` or `for...in` head is a target too, so the position is found by
 * climbing out of those wrappers rather than by listing assignment shapes.
 */
/**
 * Whether this expression is the target of a write, by any spelling.
 *
 * Exported because `prop-roles.ts` asks it of a prop it is about to trust, and
 * a second implementation there missed `for (as of …)` and `as++`.
 */
export function isWriteTarget(outer: ts.Expression): boolean {
  let current: ts.Node = outer;
  // Unbounded on purpose. This walks the PARENT chain, which is acyclic and
  // ends at the source file, so `parent === undefined` is the natural
  // termination -- no step budget is needed and one failed OPEN: capped at
  // eight levels, `[[[[[[[[[Tag]]]]]]]]] = x` exhausted the budget and returned
  // "not written", so a reassigned alias was trusted. A limit on a walk that
  // cannot loop buys nothing and has to be right about a number nobody can
  // justify.
  for (;;) {
    const parent: ts.Node | undefined = current.parent;
    if (parent === undefined) return false;
    if (ts.isBinaryExpression(parent) && ASSIGNMENTS.has(parent.operatorToken.kind)) {
      return parent.left === current;
    }
    // `for (copy.title of […])` and `for (copy.title in …)` assign each round.
    if (ts.isForOfStatement(parent) || ts.isForInStatement(parent)) {
      return parent.initializer === current;
    }
    if (ts.isPrefixUnaryExpression(parent) || ts.isPostfixUnaryExpression(parent)) {
      return INCREMENTS.has(parent.operator) && parent.operand === current;
    }
    if (ts.isDeleteExpression(parent)) return parent.expression === current;
    // A destructuring target is written as an array or object LITERAL, so the
    // literal is climbed rather than treated as the end of the chain.
    //
    // Two ways to get this wrong, and this file has had both. Listing element
    // KINDS missed `({ Tag } = replacement)`, because
    // `ShorthandPropertyAssignment` was not among them. Climbing every
    // identifier inside an element over-reports `({ Tag: a } = x)`, where
    // `Tag` is the property NAME and `a` is the target. So the climb asks
    // which POSITION the node occupies: only a target position continues.
    if (
      ts.isArrayLiteralExpression(parent) ||
      ts.isObjectLiteralExpression(parent) ||
      ts.isParenthesizedExpression(parent)
    ) {
      current = parent;
      continue;
    }
    const target = targetPositionOf(parent);
    if (target !== undefined && target === current) {
      current = parent;
      continue;
    }
    return false;
  }
}

/**
 * The child of `node` that a destructuring assignment writes, if any.
 *
 * `{ a: Tag }` writes the initializer and only reads the name; `{ Tag }` and
 * `{ Tag = d }` write the name, and the shorthand's default sits in
 * `objectAssignmentInitializer`, which is read; a spread and a `!` write what
 * they are written around. Returning `undefined` means this node is not a
 * wrapper a write can pass through at all.
 *
 * `test/write-target.test.ts` holds this against `ts.isAssignmentTarget` over
 * every form the grammar admits, so a position missed here is a failing test
 * rather than a value the reader wrongly trusts.
 */
function targetPositionOf(node: ts.Node): ts.Node | undefined {
  if (ts.isPropertyAssignment(node)) return node.initializer;
  if (ts.isShorthandPropertyAssignment(node)) return node.name;
  if (ts.isSpreadAssignment(node) || ts.isSpreadElement(node)) return node.expression;
  if (ts.isNonNullExpression(node)) return node.expression;
  return undefined;
}

const INCREMENTS: ReadonlySet<ts.SyntaxKind> = new Set([
  ts.SyntaxKind.PlusPlusToken,
  ts.SyntaxKind.MinusMinusToken,
]);

const ASSIGNMENTS: ReadonlySet<ts.SyntaxKind> = new Set([
  ts.SyntaxKind.EqualsToken,
  ts.SyntaxKind.PlusEqualsToken,
  ts.SyntaxKind.MinusEqualsToken,
  ts.SyntaxKind.AsteriskEqualsToken,
  ts.SyntaxKind.AsteriskAsteriskEqualsToken,
  ts.SyntaxKind.SlashEqualsToken,
  ts.SyntaxKind.PercentEqualsToken,
  ts.SyntaxKind.AmpersandEqualsToken,
  ts.SyntaxKind.BarEqualsToken,
  ts.SyntaxKind.CaretEqualsToken,
  ts.SyntaxKind.LessThanLessThanEqualsToken,
  ts.SyntaxKind.GreaterThanGreaterThanEqualsToken,
  ts.SyntaxKind.GreaterThanGreaterThanGreaterThanEqualsToken,
  ts.SyntaxKind.AmpersandAmpersandEqualsToken,
  ts.SyntaxKind.BarBarEqualsToken,
  ts.SyntaxKind.QuestionQuestionEqualsToken,
]);

function recordEscape(
  into: Map<string, string[]>,
  keys: readonly string[],
  properties: readonly string[],
): void {
  for (const key of keys) {
    const paths = into.get(key) ?? [];
    paths.push(escapeKey(properties));
    into.set(key, paths);
  }
}

/**
 * Every name this module exports, as the OUTSIDE asks for it.
 *
 * Used when something obtains the whole module rather than one of its
 * exports — then no single declaration can be named, and all of them are
 * reachable by whoever holds it. The caller resolves each name back to a
 * declaration through `findExports`, which takes a public name.
 *
 * An export specifier has two names, and this wants the public one.
 * `export { copy as label }` puts `label` on the namespace; looking the
 * declaration up under `copy` found no export at all, recorded no escape, and
 * left a mutated value reading as its original source text.
 */
function exportedPublicNames(module: ParsedModule): readonly string[] {
  const names = new Set<string>();
  for (const statement of module.source.statements) {
    if (ts.isVariableStatement(statement)) {
      const isConst = (statement.declarationList.flags & ts.NodeFlags.Const) !== 0;
      if (!isConst) continue;
      for (const declaration of statement.declarationList.declarations) {
        if (!ts.isIdentifier(declaration.name)) continue;
        if (isExported(statement) || isExportedByList(module, declaration.name.text)) {
          names.add(declaration.name.text);
        }
      }
      continue;
    }
    if (!ts.isExportDeclaration(statement) || statement.moduleSpecifier !== undefined) continue;
    const clause = statement.exportClause;
    if (clause === undefined || !ts.isNamedExports(clause)) continue;
    for (const element of clause.elements) {
      names.add(element.name.text);
    }
  }
  return [...names];
}

/**
 * A declaration this module sends out as its DEFAULT export.
 *
 * A default has no durable declared name, so this tool refuses to follow it
 * everywhere — which means a write made through a default import cannot be
 * attributed back. Refusing to FOLLOW it and still trusting it would be the
 * wrong half of that decision, so the declaration escapes.
 */
function defaultExportedNames(module: ParsedModule): readonly string[] {
  const names: string[] = [];
  for (const statement of module.source.statements) {
    if (ts.isExportAssignment(statement) && !statement.isExportEquals) {
      const value = unwrap(statement.expression);
      if (ts.isIdentifier(value)) names.push(value.text);
      continue;
    }
    if (!ts.isExportDeclaration(statement) || statement.moduleSpecifier !== undefined) continue;
    const clause = statement.exportClause;
    if (clause === undefined || !ts.isNamedExports(clause)) continue;
    for (const element of clause.elements) {
      if (element.name.text === "default") names.push((element.propertyName ?? element.name).text);
    }
  }
  return names;
}

/** The module a `import("./m")` or `require("./m")` call names, when it is ours. */
function dynamicallyLoadedModule(
  node: ts.Node,
  from: ParsedModule,
  context: ResolutionContext,
): ParsedModule | null {
  if (!ts.isCallExpression(node)) return null;
  const callee = node.expression;
  const isLoad =
    callee.kind === ts.SyntaxKind.ImportKeyword ||
    (ts.isIdentifier(callee) && callee.text === "require");
  if (!isLoad) return null;
  const [specifier] = node.arguments;
  if (specifier === undefined || !ts.isStringLiteral(specifier)) return null;
  const file = repositoryFileForSpecifier(specifier.text, from.file, context.repositoryRoot);
  return file === null ? null : context.cache.read(file);
}

/**
 * Every name a module exports, INCLUDING the ones it only re-exports.
 *
 * A barrel exports nothing of its own, so enumerating direct exports alone
 * reports it as empty and a module obtained whole through it escapes nothing.
 */
function visibleExportNames(
  module: ParsedModule,
  context: ResolutionContext,
  visited: ReadonlySet<string>,
): readonly string[] {
  if (visited.has(module.file) || visited.size > MAX_MODULE_HOPS) return [];
  const nextVisited = new Set(visited).add(module.file);
  const names = new Set<string>(exportedPublicNames(module));
  for (const reExport of reExportsOf(module, context.repositoryRoot)) {
    if (!reExport.isRepositoryLocal || reExport.resolvedFile === null) continue;
    if (reExport.exportedName !== null) {
      names.add(reExport.exportedName);
      continue;
    }
    const target = context.cache.read(reExport.resolvedFile);
    for (const name of visibleExportNames(target, context, nextVisited)) names.add(name);
  }
  return [...names];
}

/**
 * Escapes every declaration a module obtained whole can reach.
 *
 * The escape is recorded against the TERMINAL declaration, not against the
 * barrel that forwarded it, because that is the identity a reader resolves to.
 */
function escapeWholeModule(
  target: ParsedModule,
  context: ResolutionContext,
  into: Map<string, string[]>,
  visited: ReadonlySet<string> = new Set(),
): void {
  if (visited.has(target.file) || visited.size > MAX_MODULE_HOPS) return;
  const nextVisited = new Set(visited).add(target.file);
  for (const name of visibleExportNames(target, context, new Set())) {
    const keys = findExports(target, name, context, new Set(), 0).map(
      (entry) => `${entry.module.file}#${entry.declaredName}`,
    );
    recordEscape(into, keys, []);
  }
  // `export * as content from "./m"` puts a whole MODULE behind a name, and
  // `findExports` cannot reduce that to one declaration — so obtaining this
  // module reaches everything that one exports too.
  for (const reExport of reExportsOf(target, context.repositoryRoot)) {
    if (!reExport.isRepositoryLocal || reExport.resolvedFile === null) continue;
    // `export * as content from "./m"` puts a whole module behind a name, and
    // `export * from "./ns"` forwards whatever names `ns` has — including one
    // of those. Both are followed, or a barrel of a barrel escapes nothing.
    const forwardsNamespace = reExport.exportedName !== null && reExport.importedName === null;
    const forwardsEverything = reExport.exportedName === null && reExport.importedName === null;
    if (!forwardsNamespace && !forwardsEverything) continue;
    escapeWholeModule(context.cache.read(reExport.resolvedFile), context, into, nextVisited);
  }

  // A module can also hold a namespace itself and export it by name:
  // `import * as content from "./m"; export { content };`. That has no module
  // specifier, so the loop above never sees it.
  for (const name of visibleExportNames(target, context, new Set())) {
    const behind = namespaceExportTarget(target, name, context);
    if (behind !== null) escapeWholeModule(behind, context, into, nextVisited);
  }
}

function indexModule(
  parsed: ParsedModule,
  context: ResolutionContext,
  into: Map<string, string[]>,
): void {
  // A declaration sent out as `default` leaves under a name nothing here can
  // follow back, so it can be written through and never attributed.
  for (const name of defaultExportedNames(parsed)) {
    recordEscape(into, declarationKeyOf(parsed, name, context), []);
  }

  const visit = (node: ts.Node): void => {
    // Obtaining a whole module — `import("./m")`, `require("./m")` — names no
    // single export, and whoever holds it can reach every one of them.
    const loaded = dynamicallyLoadedModule(node, parsed, context);
    if (loaded !== null) escapeWholeModule(loaded, context, into);

    if (ts.isIdentifier(node) && isValueReference(node) && !isShadowed(node, node.text)) {
      const { outer, properties } = chainFrom(node);
      // `import * as content` names a MODULE, so the first property is the
      // declaration and the rest is the path handed out. Without this the root
      // resolves to nothing and `content.copy.title = …` reads as no write —
      // an unresolved write must never look like an absent one.
      const namespaced = namespaceModuleOf(parsed, node.text, context);
      const [head, ...rest] = properties;
      // `barrel.copy.title` is a READ like any other. The value resolver
      // refuses a namespace root, so without evaluating the chain here every
      // namespace read would look like handing the object out.
      if (namespaced !== null && head !== undefined && !isWriteTarget(outer)) {
        if (namespaceChainIsText(namespaced, head, rest, context)) {
          ts.forEachChild(node, visit);
          return;
        }
      }
      // A namespace handed out with no property named — passed to a call,
      // destructured, returned — reaches every export it holds.
      if (namespaced !== null && head === undefined) escapeWholeModule(namespaced, context, into);
      // `barrel.content.copy` reaches a whole module behind a name, which no
      // single declaration can stand for — so everything it exports escapes.
      if (namespaced !== null && head !== undefined) {
        const behindName = namespaceExportTarget(namespaced, head, context);
        if (behindName !== null) escapeWholeModule(behindName, context, into);
      }
      const keys =
        namespaced === null
          ? declarationKeyOf(parsed, node.text, context)
          : head === undefined
            ? []
            : findExports(namespaced, head, context, new Set(), 0).map(
                (entry) => `${entry.module.file}#${entry.declaredName}`,
              );
      const handedOut = namespaced === null ? properties : rest;
      if (keys.length > 0) {
        // A called member hands its RECEIVER to the callee, so the escape is
        // one step short of the chain that was written.
        const called = isCalledMember(outer);
        const method = called ? handedOut.at(-1) : undefined;
        const receiverPath = handedOut.slice(0, -1);
        const readOnlyCall =
          called &&
          method !== undefined &&
          ts.isCallExpression(outer.parent) &&
          isReadOnlyArrayCall(
            receiverExpressionOf(node, parsed, context, receiverPath),
            method,
            outer.parent,
          );
        if (readOnlyCall) {
          ts.forEachChild(node, visit);
          return;
        }
        const escaped = called ? receiverPath : handedOut;
        const walked =
          isWriteTarget(outer) || called ? null : walkPath(outer, parsed, context, false);
        const handsOutText =
          walked !== null && stringOf(walked.leaf, context, 0) !== null;
        // A read that yields a NUMBER hands nothing out, and `length` is the
        // only property of an array that does. It is not text, so it used to be
        // recorded as a path handed out, and a collection read -- whose own path
        // is the whole object -- matched it: one `rows.length` anywhere made the
        // collection unreadable. Writing `length` truncates the array, so that
        // still records.
        const readsCount = !isWriteTarget(outer) && isCountRead(escaped, called);
        if (!handsOutText && !readsCount) recordEscape(into, keys, escaped);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(parsed.source);
}

function escapedPaths(context: ResolutionContext): ReadonlyMap<string, readonly string[]> {
  const cached = ESCAPE_INDEX.get(context.cache);
  if (cached !== undefined) return cached;
  const escaped = new Map<string, string[]>();
  // Seeded before the walk so a re-entrant resolution during indexing sees an
  // empty index rather than recursing into building one.
  ESCAPE_INDEX.set(context.cache, escaped);
  for (const file of repositoryModuleFiles(context.repositoryRoot)) {
    indexModule(context.cache.read(file), context, escaped);
  }
  return escaped;
}

function hasEscaped(
  root: RootBinding,
  properties: readonly string[],
  context: ResolutionContext,
): boolean {
  const paths = escapedPaths(context).get(`${root.module.file}#${root.declaredName}`);
  if (paths === undefined) return false;
  const read = escapeKey(properties);
  // Both directions. An escape ABOVE the read changes something containing it;
  // an escape BENEATH it changes something inside what it names — `rows.length
  // = 0` empties the array a collection reads at the empty path, and matching
  // ancestors only let the reader publish items the page has removed. A write
  // to a SIBLING path still matches neither, which is the discrimination that
  // matters.
  return paths.some(
    (path) =>
      path === "" ||
      read === path ||
      read.startsWith(path + ESCAPE_SEPARATOR) ||
      read === "" ||
      path.startsWith(read + ESCAPE_SEPARATOR),
  );
}

/** An array of object literals, and the chain of names it is read from. */
export interface ArrayResolution {
  readonly objects: readonly ts.ObjectLiteralExpression[];
  readonly path: AnchorPath;
  readonly declaredIn: string;
  readonly shared: boolean;
}

/**
 * Resolves the array a repeated region is read from.
 *
 * The same rules as a value read: the path must be a chain of written names,
 * the declaration must not have escaped, and the elements must be object
 * literals — an array whose items are computed cannot be read here. What each
 * item HOLDS is deliberately not decided at this point; only the template knows
 * which properties are fields.
 */
export function resolveArrayOfObjects(
  expression: ts.Expression,
  context: ResolutionContext,
): ArrayResolution | null {
  const walked = walkPath(expression, context.module, context);
  if (walked === null) return null;
  const array = unwrap(walked.leaf.expression);
  if (!ts.isArrayLiteralExpression(array)) return null;
  const objects: ts.ObjectLiteralExpression[] = [];
  for (const element of array.elements) {
    const item = unwrap(element);
    if (!ts.isObjectLiteralExpression(item)) return null;
    objects.push(item);
  }
  if (objects.length === 0) return null;
  return {
    objects,
    path: [
      { kind: "binding", name: walked.root.declaredName },
      ...walked.properties.map((name) => ({ kind: "property", name }) as const),
    ],
    declaredIn: walked.root.module.file,
    shared: walked.root.shared,
  };
}

/**
 * The string one item holds under a property name, read in the module that
 * declares the item. Returns null when the property is absent or is not text,
 * which the caller must treat as a refusal rather than an empty value.
 */
export function textPropertyOf(
  object: ts.ObjectLiteralExpression,
  name: string,
  declaredIn: string,
  context: ResolutionContext,
): string | null {
  const owner = context.cache.read(declaredIn);
  const property = propertyOf({ expression: object, module: owner }, name);
  if (property === null) return null;
  // An ABSENT property refuses; an empty one does not. `""` is a present
  // string literal, and a page rendering it shows nothing -- which is what the
  // editable field should then hold. Conflating the two dropped the whole
  // collection over one blank blurb.
  return stringOf(property, context, 0);
}

/**
 * Resolves a JSX value expression to the string it renders and the anchor that
 * names it, or `null` when any step is not decided by syntax alone.
 */
export function resolveStaticValue(
  expression: ts.Expression,
  context: ResolutionContext,
): ValueResolution | null {
  const walked = walkPath(expression, context.module, context);
  if (walked === null) return null;

  const value = stringOf(walked.leaf, context, 0);
  if (value === null || value.length === 0) return null;

  const segments: AnchorSegment[] = [
    { kind: "binding", name: walked.root.declaredName },
    ...walked.properties.map((name) => ({ kind: "property", name }) as const),
  ];
  return {
    value,
    path: segments,
    declaredIn: walked.root.module.file,
    shared: walked.root.shared,
  };
}
