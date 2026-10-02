import ts from "typescript";

import type { ModuleReference, ParsedModule } from "./scan.js";
import { nearestBinding } from "./scopes.js";

/**
 * Whether a function answers 404 rather than rendering anything.
 *
 * `notFound()` is declared `never`, so a call the function is guaranteed to
 * reach means it never completes and never hands React markup. That is the one
 * reading here, and deliberately the only one: a route this tool merely failed
 * to read could be anything, while a route PROVEN to 404 is not a page.
 *
 * Every step fails towards "cannot prove it". A gated page — `if (hidden)
 * notFound();` above a `return <section/>` — renders, and a rule keyed on the
 * call appearing anywhere in the body would condemn every one of them.
 */

const NEXT_NAVIGATION = "next/navigation";
const NOT_FOUND = "notFound";

export interface NotFoundNames {
  /** Local names bound to the import itself, `notFound` and any alias. */
  readonly direct: ReadonlySet<string>;
  /** Local names bound to the whole module, for `nav.notFound()`. */
  readonly namespaces: ReadonlySet<string>;
}

const NAMES = new WeakMap<ts.SourceFile, NotFoundNames | null>();

/**
 * What this module calls Next's `notFound`, or null when it never imports it.
 *
 * Read from `importedBindingsOf`, the package's one reading of "which local
 * name does this module bind to an imported symbol", rather than from the
 * spelling: a repository is free to declare a local function of that name, and
 * it is not the framework's. A second walk of the import statements would be a
 * second answer to a question already answered, and this is the only one of
 * them whose answer decides a refusal.
 */
export function notFoundNamesIn(
  module: ParsedModule,
  imports: ReadonlyMap<string, ModuleReference>,
): NotFoundNames | null {
  const cached = NAMES.get(module.source);
  if (cached !== undefined) return cached;
  const direct = new Set<string>();
  const namespaces = new Set<string>();
  for (const [local, reference] of imports) {
    if (reference.specifier !== NEXT_NAVIGATION) continue;
    if (reference.importedName === null) namespaces.add(local);
    else if (reference.importedName === NOT_FOUND) direct.add(local);
  }
  const found = direct.size === 0 && namespaces.size === 0 ? null : { direct, namespaces };
  // Cached because this is now asked of every name a tag resolves, and a
  // module's imports do not change once parsed.
  NAMES.set(module.source, found);
  return found;
}

/**
 * Whether this call is the framework's, by the name it is written under AND by
 * what that name is bound to where it is written.
 *
 * A name declared nearer than the import is not the import, exactly as the
 * language reads it: `const notFound = () => undefined;` inside the component
 * shadows it, and taking the spelling alone would condemn the route on the
 * strength of a local function. The nearest-binding rule is the one the render
 * walk already uses to resolve a tag.
 */
function isNotFoundCall(node: ts.Node, names: NotFoundNames): boolean {
  if (!ts.isCallExpression(node)) return false;
  const callee = node.expression;
  if (ts.isIdentifier(callee)) {
    return (
      names.direct.has(callee.text) && nearestBinding(callee, callee.text) === null
    );
  }
  return (
    ts.isPropertyAccessExpression(callee) &&
    callee.name.text === NOT_FOUND &&
    ts.isIdentifier(callee.expression) &&
    names.namespaces.has(callee.expression.text) &&
    nearestBinding(callee.expression, callee.expression.text) === null
  );
}

/** The call a statement makes on its own, which is the only unconditional one. */
function unconditionalCall(
  statement: ts.Statement,
  names: NotFoundNames,
): ts.Node | null {
  const expression = ts.isExpressionStatement(statement)
    ? statement.expression
    : ts.isReturnStatement(statement)
      ? statement.expression
      : undefined;
  return expression !== undefined && isNotFoundCall(expression, names)
    ? expression
    : null;
}

/**
 * Whether anything in this statement could hand a value back.
 *
 * A `return` anywhere above the call — inside an `if`, a loop, a callback —
 * means the function may complete before reaching it, so the proof is off. A
 * `return` is the whole question: markup can only reach React through one, so a
 * body that writes JSX and never returns it renders nothing either way.
 *
 * It counts a `return` written inside a nested function too, which cannot
 * actually return from the outer one. Erring towards "cannot prove it" costs a
 * refusal this tool was never entitled to make.
 */
function mayReturn(statement: ts.Statement): boolean {
  let found = false;
  const visit = (node: ts.Node): void => {
    if (found) return;
    if (ts.isReturnStatement(node)) {
      found = true;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(statement);
  return found;
}

/**
 * The `notFound()` call this function is guaranteed to reach, or null.
 *
 * `body` is whatever `namedFunctionsOf` recorded: a block, or the expression of
 * a concise arrow.
 */
export function notFoundCallIn(
  body: ts.Node,
  names: NotFoundNames,
): ts.Node | null {
  if (!ts.isBlock(body)) return isNotFoundCall(body, names) ? body : null;
  for (const statement of body.statements) {
    const call = unconditionalCall(statement, names);
    if (call !== null) return call;
    if (mayReturn(statement)) return null;
  }
  return null;
}
