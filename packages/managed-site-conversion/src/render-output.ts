import ts from "typescript";

import {
  containsJsx,
  isComponentName,
  isProvablyHostTag,
  isTransparentWrapper,
  unwrapTransparent,
} from "./jsx-facts.js";
import { namedFunctionsOf } from "./scan.js";
import { declarationOfName } from "./scopes.js";

/**
 * Which JSX belongs to a component's own render output. This module is the one
 * statement of that boundary; every reading of a component defers to it.
 *
 * Running a function is not the same as rendering what it returns, and the
 * difference is the whole of this file. `useEffect(() => <Row />)` runs its
 * function and throws the result away; so does `setTimeout`, and so does
 * `forEach`. Reading `Row` out of any of them would hand a customer an editor
 * for markup no visitor can reach. So the question is never "is this function
 * run" but "does what it returns reach the browser as markup".
 *
 * One answer says yes: a call runs the function AND the call's own result lands
 * in rendered output — `{ITEMS.map((item) => <Card />)}`, `{(() => <Row />)()}`,
 * `return wrap(() => <Row />)`. Which call it is never matters, so no list of
 * method or hook names appears anywhere here.
 *
 * Being written as an element's attribute is NOT such an answer, though it once
 * was here. An attribute's function renders only if the element it is given to
 * renders what that function returns, and the attribute says nothing about
 * whether it does: `<button onClick={() => <Row />}>` runs the handler and
 * hands its result to the DOM, which discards it, and a component is as free to
 * take a callback it never renders — `onConfirm`, `onSelect` — as one it does.
 * Attribute spelling cannot tell those from `renderItem`, so nothing is crossed
 * on the strength of it. Where the answer is knowable it is knowable from the
 * receiving element alone, and it is always no:
 *
 *   - a host element renders no function's return value, ever. That is the JSX
 *     language rule, read through the one predicate that decides host from
 *     component, so it is derived rather than a list of handler names;
 *   - a component might, but only its own declaration says, and this reading is
 *     given one node and no way to resolve a tag to it.
 *
 * A call may run its function any number of times and in any order, so JSX
 * inside has no position of its own and only a reader that models the
 * repetition can place it. A reading that cannot model repetition takes
 * `NO_TRIGGERS` and leaves every crossing to the reader that can.
 *
 * Two answers say no, and they are not the same no:
 *
 *   - `resolved` — it provably renders nothing HERE. The result was discarded
 *     as a statement, or the call built a component out of the function
 *     (`const Card = memo(() => <div />)`), which React reaches only through a
 *     capitalized tag, or the function is a host element's attribute. Either
 *     way the answer is settled, so it is left out in silence rather than filed
 *     as a decision for a human;
 *   - `unreadable` — where it renders goes somewhere this reading cannot
 *     follow: the call's result is bound to a name, or a component was handed
 *     the function. Nothing inside is read AND the site is named, because a
 *     silent drop hides the same coverage gap as a silent inclusion.
 *
 * Component wrappers are told apart by what the call's RESULT becomes, never by
 * the callee's name, which no list of names could keep up with: a result bound
 * to a component-shaped name is a component declaration, and the tag that names
 * it is the edge. Crossing into the declaration as well would read the same
 * markup a second time, under whichever component happens to enclose it.
 *
 * One limit is worth stating plainly. `{ITEMS.filter((item) => <Row />)}` puts
 * the call's result in rendered output, but `filter` passes the items through
 * rather than what the function returned, so `Row` is read when nothing renders
 * it. Nothing in the syntax separates `filter` from `map`, and separating them
 * by name is the enumeration this module refuses. A filter written that way is
 * already broken — every item is truthy, so it filters nothing — so the cost
 * falls on code that is wrong before this tool reads it.
 */

/** A reason a function's JSX renders, and therefore a boundary a reading may cross. */
export type RenderTrigger = "call";

/** What becomes of a nested function's JSX, including the reasons it is not read. */
export type RenderVerdict = RenderTrigger | "resolved" | "unreadable" | "unrun";

export const EVERY_TRIGGER: ReadonlySet<RenderTrigger> = new Set<RenderTrigger>(["call"]);

/**
 * For a reading that must place what it finds, so repetition it cannot model is
 * left alone. Every trigger is a call and a call may run its function any
 * number of times, so such a reading crosses nothing; it still walks through
 * here so that it refuses the same boundaries the crossing reader crosses,
 * rather than inventing its own and drifting from them.
 */
export const NO_TRIGGERS: ReadonlySet<RenderTrigger> = new Set<RenderTrigger>();

/** The outermost node that still stands for the same value as `node`. */
function outermostValue(node: ts.Node): ts.Node {
  const parent: ts.Node | undefined = node.parent;
  if (parent !== undefined && isTransparentWrapper(parent) && parent.expression === node) {
    return outermostValue(parent);
  }
  return node;
}

function isArgumentOf(call: ts.CallExpression, node: ts.Node): boolean {
  return call.arguments.some((argument) => argument === node);
}

function isShortCircuit(operator: ts.BinaryOperatorToken): boolean {
  return (
    operator.kind === ts.SyntaxKind.AmpersandAmpersandToken ||
    operator.kind === ts.SyntaxKind.BarBarToken ||
    operator.kind === ts.SyntaxKind.QuestionQuestionToken
  );
}

/**
 * Does this value reach the browser as markup?
 *
 * Only the positions the syntax can prove count: written as a child of an
 * element or fragment, or handed back by the function it is written in. The
 * steps between are the ones that choose a value without changing where it
 * goes — a conditional, a short circuit, a further call reading this one.
 *
 * A value bound to a name is deliberately NOT followed. Tracking it to the
 * places that name is read is the dataflow this proposer does not do, and
 * guessing that a binding must be rendered is how markup gets proposed for
 * something a visitor never sees. Such a call is `unreadable`, and named.
 */
function landsInRenderedOutput(node: ts.Node): boolean {
  const value = outermostValue(node);
  const parent: ts.Node | undefined = value.parent;
  if (parent === undefined) return false;
  if (ts.isJsxExpression(parent)) {
    const holder: ts.Node | undefined = parent.parent;
    return holder !== undefined && (ts.isJsxElement(holder) || ts.isJsxFragment(holder));
  }
  if (ts.isReturnStatement(parent)) return true;
  if (ts.isArrowFunction(parent) && parent.body === value) return true;
  if (ts.isConditionalExpression(parent) && parent.condition !== value) {
    return landsInRenderedOutput(parent);
  }
  if (ts.isBinaryExpression(parent) && parent.right === value && isShortCircuit(parent.operatorToken)) {
    return landsInRenderedOutput(parent);
  }
  if (ts.isPropertyAccessExpression(parent) && parent.expression === value) {
    return landsInRenderedOutput(parent);
  }
  if (ts.isCallExpression(parent) && parent.expression === value) {
    return landsInRenderedOutput(parent);
  }
  return false;
}

/** A call written as a statement throws its result away, so nothing it returns renders. */
function isDiscarded(call: ts.CallExpression): boolean {
  const value = outermostValue(call);
  const parent: ts.Node | undefined = value.parent;
  return parent !== undefined && ts.isExpressionStatement(parent);
}

/**
 * A call whose result becomes a component declaration built a component out of
 * the function it was handed rather than rendering what it returns. Composition
 * is followed outwards, so `memo(forwardRef(...))` reads the same as either one.
 */
function buildsComponentDeclaration(call: ts.CallExpression): boolean {
  const value = outermostValue(call);
  const parent: ts.Node | undefined = value.parent;
  if (parent === undefined) return false;
  if (ts.isCallExpression(parent) && isArgumentOf(parent, value)) {
    return buildsComponentDeclaration(parent);
  }
  return (
    ts.isVariableDeclaration(parent) &&
    parent.initializer === value &&
    ts.isIdentifier(parent.name) &&
    isComponentName(parent.name.text)
  );
}

/** What a call does with whatever the functions it is handed return. */
function callResultOf(call: ts.CallExpression): "call" | "resolved" | "unreadable" {
  if (buildsComponentDeclaration(call) || isDiscarded(call)) return "resolved";
  return landsInRenderedOutput(call) ? "call" : "unreadable";
}

/**
 * The attribute this value is written as the value of, if it is one.
 *
 * One statement of the shape, because two readings need it: the verdict below,
 * and the walk, which reports an attribute it could not read while leaving an
 * unreadable call to be reported at the call. Spelling it twice is what let
 * `renderItem={(() => <Row />) as ItemRenderer}` be seen by one reading and
 * missed by the other.
 */
function owningAttribute(node: ts.Node): ts.JsxAttribute | null {
  const expression: ts.Node | undefined = outermostValue(node).parent;
  if (expression === undefined || !ts.isJsxExpression(expression)) return null;
  const attribute: ts.Node | undefined = expression.parent;
  return attribute !== undefined && ts.isJsxAttribute(attribute) ? attribute : null;
}

/**
 * What an element does with a function it is handed, which is never to render
 * what the function returns on any evidence available here.
 *
 * A host element is settled: the DOM is given the value and no return of it is
 * ever markup, so JSX inside is dead where it is written. A component is not
 * settled by anything at this site — the same spelling carries `renderItem`,
 * which renders, and `onSelect`, which does not — and the declaration that
 * would say lives in a module this reading cannot resolve.
 */
function attributeResultOf(attribute: ts.JsxAttribute): "resolved" | "unreadable" {
  const element: ts.Node | undefined = attribute.parent?.parent;
  if (
    element === undefined ||
    !(ts.isJsxOpeningElement(element) || ts.isJsxSelfClosingElement(element))
  ) {
    return "unreadable";
  }
  return isProvablyHostElement(element) ? "resolved" : "unreadable";
}

/**
 * Is the DOM knowably on the other side of this element's attributes?
 *
 * Deliberately stronger than "not a component name", and not a second answer to
 * the question that predicate settles. `isComponentName` reads which of two
 * things JSX treats a NAME as; this reads whether the browser is provably what
 * receives the value, and only a bare lowercase name settles that. A dotted tag
 * is a member expression, which JSX resolves as a component whatever its case —
 * `<motion.div />` is not a `div` — so it is left unreadable rather than called
 * settled. Silence is the dangerous answer to be wrong with, since it drops
 * markup without telling anyone, so it is spent only where the case is proven.
 */
function isProvablyHostElement(
  element: ts.JsxOpeningElement | ts.JsxSelfClosingElement,
): boolean {
  const tag = element.tagName;
  return ts.isIdentifier(tag) && isProvablyHostTag(tag.text);
}

/** What becomes of this function's JSX, as part of the enclosing component's render. */
export function renderVerdictOf(node: ts.Node): RenderVerdict {
  const value = outermostValue(node);
  const parent: ts.Node | undefined = value.parent;
  if (parent === undefined) return "unrun";
  if (ts.isCallExpression(parent)) {
    const runs = parent.expression === value || isArgumentOf(parent, value);
    return runs ? callResultOf(parent) : "unrun";
  }
  const attribute = owningAttribute(value);
  return attribute === null ? "unrun" : attributeResultOf(attribute);
}

const SOLE_FUNCTION_BODIES = new WeakMap<ts.SourceFile, ReadonlyMap<string, ts.Node | null>>();

/**
 * The body of every function a module declares, by name, read from the one
 * enumeration every reading shares. A name the module declares twice maps to
 * null: which of them a call reaches is a scope question the syntax alone
 * cannot settle, and a wrong answer attributes one function's markup to another.
 */
function soleFunctionBodies(source: ts.SourceFile): ReadonlyMap<string, ts.Node | null> {
  const cached = SOLE_FUNCTION_BODIES.get(source);
  if (cached !== undefined) return cached;
  const bodies = new Map<string, ts.Node | null>();
  for (const entry of namedFunctionsOf(source)) {
    bodies.set(entry.name, bodies.has(entry.name) ? null : entry.body);
  }
  SOLE_FUNCTION_BODIES.set(source, bodies);
  return bodies;
}

/**
 * A call may be handed its function by name rather than in place:
 * `ITEMS.map(renderCard)`. The call runs it exactly as it runs one written
 * inline, so what it returns goes exactly where the call's result goes.
 *
 * A component-shaped name is not followed. A component is reached through the
 * tag that names it, so following the reference too would read its markup a
 * second time, under the caller.
 */
function namedCallbackBodies(call: ts.CallExpression, source: ts.SourceFile): readonly ts.Node[] {
  const declared = soleFunctionBodies(source);
  const bodies: ts.Node[] = [];
  // The CALLEE, not only the arguments. `{renderHeading()}` puts whatever
  // `renderHeading` writes into rendered output, and following arguments alone
  // meant that JSX was never walked -- so `<Heading as={Card} />` written
  // inside it was invisible to the call-site index and an all-host proof was
  // built from the sites that WERE seen. A component-shaped callee is left
  // alone for the same reason a component-shaped argument is: a component is
  // reached through the tag that names it, and following the reference too
  // would read its markup twice.
  const callee = call.expression;
  if (ts.isIdentifier(callee) && !isComponentName(callee.text)) {
    const body = declared.get(callee.text);
    // By BINDING, not by spelling. `soleFunctionBodies` is a module-wide map
    // keyed on the name, so a parameter or import called `renderHeading` would
    // have handed us an unrelated module function's body -- and its JSX would
    // have entered the call-site index as evidence about a call that never
    // happens. `scopes.ts` answers which declaration a name means where it is
    // written; that lesson cost three rounds in `prop-roles.ts` and I wrote the
    // same defect here an hour later.
    if (body !== undefined && body !== null && bindsAt(call, callee.text, body)) {
      bodies.push(body);
    }
  }
  for (const argument of call.arguments) {
    if (!ts.isIdentifier(argument) || isComponentName(argument.text)) continue;
    const body = declared.get(argument.text);
    if (body === undefined || body === null) continue;
    if (!bindsAt(call, argument.text, body)) continue;
    bodies.push(body);
  }
  return bodies;
}


/**
 * Whether the name, read at this call, is the function whose body this is.
 *
 * Walks out from the call the way the language reads a name and stops at the
 * FIRST binding. A nearer one -- a parameter, an import, a local -- means the
 * module function of the same spelling is not what runs, so its markup is not
 * evidence about this call.
 */
function bindsAt(call: ts.CallExpression, name: string, body: ts.Node): boolean {
  let current: ts.Node | undefined = call.parent;
  while (current !== undefined && !ts.isSourceFile(current)) {
    const declaration = declarationOfName(current, name);
    // A binding NEARER than the module shadows it: a parameter, an import
    // bound in a block, a local. The module function of this spelling is then
    // not what runs, unless this is the very declaration reported -- the
    // binding site differs by shape (a variable declaration for
    // `const f = () => …`, the function itself for `function f() {}`), so the
    // question asked is containment.
    if (declaration !== null) return contains(declaration, body);
    current = current.parent;
  }
  // No nearer binding, so the name means what the MODULE declares -- which is
  // the map `soleFunctionBodies` was built from. `declarationOfName` stops at
  // the source file on purpose; module scope is answered separately.
  return true;
}

/** Whether `outer` encloses `inner`, or is it. */
function contains(outer: ts.Node, inner: ts.Node): boolean {
  let current: ts.Node | undefined = inner;
  while (current !== undefined) {
    if (current === outer) return true;
    current = current.parent;
  }
  return false;
}


/**
 * A rendered call this module CANNOT follow, though it declares the name.
 *
 * `{renderHeading()}` where a parameter shadows a module `renderHeading` runs a
 * body nobody here can read, and whatever JSX it writes is a render this walk
 * never sees. Following the module function of that spelling would be worse
 * than missing it -- that is evidence about a call which never happens -- so
 * the call is reported instead and any proof that needs a complete picture
 * refuses.
 *
 * A callee this module does NOT declare is not reported: an import or a hook
 * (`cn`, `useMemo`, `usePathname`) cannot render one of our components except
 * through a tag, which the walk sees anyway. On All Points Media that is the
 * difference between 218 calls and none.
 */
export function isUnfollowableRenderedCallee(node: ts.Node, source: ts.SourceFile): boolean {
  if (!ts.isCallExpression(node)) return false;
  if (callResultOf(node) !== "call") return false;
  const callee = node.expression;
  if (!ts.isIdentifier(callee) || isComponentName(callee.text)) return false;
  const body = soleFunctionBodies(source).get(callee.text);
  if (body === undefined || body === null) return false;
  return !bindsAt(node, callee.text, body);
}

/** Is this call handed a function that writes JSX, so refusing it costs a human something? */
function runsJsx(call: ts.CallExpression, source: ts.SourceFile): boolean {
  for (const argument of call.arguments) {
    const value = unwrapTransparent(argument);
    if (ts.isFunctionLike(value) && containsJsx(value)) return true;
  }
  return namedCallbackBodies(call, source).some(containsJsx);
}

/** Returns true for a node the caller has taken over, so the walk leaves its subtree alone. */
type RenderOutputVisitor = (node: ts.Node) => boolean;

/**
 * A place a function writing JSX is given to something whose rendering could
 * not be read. `kind` is what was given, because the two are answered
 * differently by whoever fixes them: a call renders its result where the call
 * is written, a component renders a prop wherever its own declaration says.
 */
export interface UnreadableRender {
  readonly node: ts.Node;
  readonly kind: "call" | "attribute";
}

export interface RenderOutputWalk {
  /**
   * Every place a function that writes JSX was handed off and where its result
   * renders could not be read. Nothing inside them was read, so each is a
   * decision left for a human.
   */
  readonly unreadable: readonly UnreadableRender[];
}

/**
 * Visits `root` and every node whose JSX is part of the same render output,
 * crossing into a nested function only where `triggers` admits its verdict.
 *
 * Every reading of a component walks through here, so none can invent a
 * boundary of its own. A reading that admits fewer triggers than another still
 * agrees with it about what renders; it has only declared which of those it can
 * place, and it leaves the rest to the reading that can.
 */
export function walkRenderOutput(
  root: ts.Node,
  triggers: ReadonlySet<RenderTrigger>,
  handled: RenderOutputVisitor,
): RenderOutputWalk {
  const source = root.getSourceFile();
  const entered = new Set<ts.Node>([root]);
  const unreadable: UnreadableRender[] = [];
  function descend(child: ts.Node): void {
    if (!ts.isFunctionLike(child)) {
      visit(child);
      return;
    }
    const verdict = renderVerdictOf(child);
    const attribute = owningAttribute(child);
    if (verdict === "unreadable" && attribute !== null) {
      // The attribute, not the function: which prop was handed over is the half
      // of this a reader needs, and the function is written inside it anyway.
      if (containsJsx(child)) unreadable.push({ node: attribute, kind: "attribute" });
      return;
    }
    if (verdict !== "call" || !triggers.has(verdict)) return;
    visit(child);
  }
  function visit(node: ts.Node): void {
    if (handled(node)) return;
    ts.forEachChild(node, descend);
    if (!triggers.has("call") || !ts.isCallExpression(node)) return;
    const result = callResultOf(node);
    if (result === "unreadable") {
      if (runsJsx(node, source)) unreadable.push({ node, kind: "call" });
      return;
    }
    if (result === "resolved") return;
    for (const body of namedCallbackBodies(node, source)) {
      if (entered.has(body)) continue;
      entered.add(body);
      visit(body);
    }
  }
  visit(root);
  return { unreadable };
}
