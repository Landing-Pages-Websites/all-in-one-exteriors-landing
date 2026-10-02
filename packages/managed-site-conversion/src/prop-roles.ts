import ts from "typescript";

import { isWriteTarget } from "./evaluate.js";

import type { ComponentDeclaration } from "./extract.js";
import {
  CALLER_CONSUMED_ATTRIBUTES,
  OPAQUE_TAGS,
  STRUCTURAL_ATTRIBUTES,
  bindingPropertyName,
  findAttribute,
  isAriaAttribute,
  isComponentName,
  isWalkedElement,
  literalAttributeValue,
  overriddenByLaterSpread,
  tagNameOf,
  type JsxElementNode,
} from "./jsx-facts.js";
import {
  declarationKey,
  resolveTagAt,
  type CallSite,
  type TagResolver,
} from "./reachability.js";
import { renderVerdictOf } from "./render-output.js";
import {
  declarationOfName,
  isBoundBetween,
  isFunctionLike,
  isScopeNode,
  isValueReference,
  type FunctionLike,
} from "./scopes.js";

/**
 * What a prop passed to a component in this repository actually is.
 *
 * A host element's attributes are a fixed vocabulary, so a list can classify
 * them. A component's props are not: `title` is customer copy on one component
 * and a tooltip on another, and `as` is never copy anywhere. The role is not a
 * property of the NAME — it is a property of what the receiving component does
 * with the value, which is written down in that component.
 *
 * So this reads it there. A prop rendered as text is content; a prop that ends
 * up in an `aria-*` or `alt` attribute is an accessibility interface; a prop
 * that is tested, used as a tag, or lands in a structural attribute is code.
 *
 * Nothing is guessed. A prop whose uses disagree, whose component cannot be
 * read, that reaches a call this cannot see through, or that could arrive by
 * spread, returns null and is reported to a human exactly as before.
 */

export type PropRole = "content" | "accessibility" | "code";

/**
 * A reading that carries no evidence about what the value is.
 *
 * Checking whether a value is PRESENT — `x ? a : b`, `!x`, `x && <p/>` — is a
 * question about absence, not about meaning, and a React `key` or `ref` is
 * bookkeeping that accepts any value at all. Counting those as evidence would
 * make `{title ? title : "Untitled"}` self-contradictory: tested once, shown
 * once, and therefore refused, when it is plainly copy.
 *
 * Comparing a value to something else is different. `tone === "invert"` uses it
 * as an enum the component switches on, which is exactly what code looks like.
 */
const INERT = "inert";
/**
 * A settled reading, and — when the value is content — the host tags it
 * renders inside.
 *
 * The tag is what decides whether the text is a paragraph of prose or a short
 * label, and only the RECEIVER knows it. Reporting the role without it left
 * `extract.ts` hardcoding `semantic: "label"` for every component prop, which
 * capped body copy at the label length.
 */
interface RoleReading {
  readonly role: PropRole;
  /** Empty unless the role is `content`; a `null` entry is a site whose tag could not be read. */
  readonly renderTags: readonly (string | null)[];
}

type Reading = RoleReading | typeof INERT | null;

const CODE: RoleReading = { role: "code", renderTags: [] };
const ACCESSIBILITY: RoleReading = { role: "accessibility", renderTags: [] };

/** Content rendered inside one host element, or inside something unreadable. */
function contentIn(tag: string | null): RoleReading {
  return { role: "content", renderTags: [tag] };
}

/** What a component does with one prop, and where it shows it. */
export interface PropReading {
  readonly role: PropRole;
  readonly renderTags: readonly (string | null)[];
}

const MAX_COMPONENT_DEPTH = 6;

const CHILDREN_PROP = "children";

export interface PropRoleContext {
  readonly resolver: TagResolver;
  /**
   * Whether `ref` written on a component in THIS repository reaches it. React
   * 19 passes it like any other prop; React 18 consumes it first. The same
   * fact decides the caller side in `extract.ts`, so it is read once from the
   * repository and handed to both rather than asked twice.
   */
  readonly refReachesComponents: boolean;
  /**
   * Where each component is rendered, so a reading can ask what a prop can BE.
   * Absent when the caller has no index, and then a dynamic tag stays unread —
   * the whole point is that observed sites are the evidence.
   */
  readonly callSitesOf?: (declaration: ComponentDeclaration) => readonly CallSite[];
  /**
   * Reachable component-shaped sites the reader could not attribute.
   *
   * `callSitesOf` answers "every call of this component I could identify". Any
   * proof that needs "every call, full stop" must also refuse when an
   * unattributable site could be one of them.
   */
  readonly opaqueCallSites?: () => readonly CallSite[];
  /**
   * How many rendered calls this reader could not follow.
   *
   * Any at all means the set of call sites is incomplete in a way no element
   * can be interrogated about, so a proof about "every call" refuses.
   */
  readonly unknownRenders?: () => number;
}

/** How a component names the prop inside its own body. */
type PropBinding =
  /** Destructured: `{ title }` or `{ title: heading }`, possibly several. */
  | { readonly kind: "names"; readonly names: readonly string[] }
  /**
   * Whole-props parameter: references are `props.title`. The PROPERTY is part
   * of the binding — matching any `props.*` would report `variant` as content
   * because the component happens to render `props.label` somewhere else.
   */
  | { readonly kind: "member"; readonly object: string; readonly property: string };

function bindingFor(
  declaration: ComponentDeclaration,
  propName: string,
): PropBinding | null {
  const parameters = parametersOf(declaration);
  if (parameters === null || parameters.length !== 1) return null;
  const parameter = parameters[0];
  if (parameter === undefined) return null;

  // A REST parameter holds the argument list, so `props.title` on one is
  // `undefined` — a field built from a caller's literal there edits text the
  // page never shows.
  if (parameter.dotDotDotToken !== undefined) return null;
  if (ts.isIdentifier(parameter.name)) {
    return { kind: "member", object: parameter.name.text, property: propName };
  }
  if (!ts.isObjectBindingPattern(parameter.name)) return null;

  const names: string[] = [];
  for (const element of parameter.name.elements) {
    // `{ ...rest }` can carry this prop onward invisibly, so the pattern can no
    // longer say where the value goes.
    if (element.dotDotDotToken !== undefined) return null;
    const declared = bindingPropertyName(element);
    if (declared === null) return null;
    if (declared !== propName) continue;
    if (!ts.isIdentifier(element.name)) return null;
    names.push(element.name.text);
  }
  return { kind: "names", names };
}

function parametersOf(
  declaration: ComponentDeclaration,
): readonly ts.ParameterDeclaration[] | null {
  const owner = declaration.jsxRoot.parent;
  if (owner === undefined) return null;
  // `scopes.js` owns what counts as a function body. A private list of three
  // kinds here meant a method, a constructor and an accessor were not seen as
  // function boundaries at all, so a value discarded inside one read as though
  // the page rendered it.
  return isFunctionLike(owner) ? owner.parameters : null;
}

/**
 * The object and property a member access names.
 *
 * Deliberately NOT `readPath` in `evaluate.js`, which refuses optional
 * chaining: that reader asks what string a path DENOTES, and `a?.b` may denote
 * nothing, so resolving it could publish a value the page does not render.
 * This one asks whether a prop is USED, and `props?.value` uses it — refusing
 * here would make a prop read only that way look unread, and classify a
 * component's copy as code.
 *
 * Two readers of one syntax, asking two questions, is the one case where two
 * implementations are right; a comment says so because the next reader will
 * otherwise consolidate them.
 */
function propertyRead(
  node: ts.Node,
): { readonly object: ts.Expression; readonly property: string } | null {
  if (ts.isPropertyAccessExpression(node)) {
    return { object: node.expression, property: node.name.text };
  }
  if (ts.isElementAccessExpression(node) && ts.isStringLiteral(node.argumentExpression)) {
    return { object: node.expression, property: node.argumentExpression.text };
  }
  return null;
}

type Reachability = "renders" | "discarded" | "unreadable";

/**
 * Whether what happens at `node` reaches the page.
 *
 * Running a function is not the same as rendering what it returns, and
 * `render-output.ts` is this repository's one statement of that boundary. A
 * reading has to pass it BEFORE its JSX position is believed:
 * `<button onClick={() => <p>{value}</p>} />` puts `value` in child position
 * inside a handler whose result the DOM throws away.
 */
function reachabilityOf(node: ts.Node, root: ts.Node): Reachability {
  let current: ts.Node | undefined = node;
  while (current !== undefined && current !== root) {
    // The extractor never enters a hidden or opaque subtree, so text found
    // there is not content a customer can edit. A reading that disagreed with
    // the walk proposed a field for markup the model deliberately excludes.
    if (
      (ts.isJsxElement(current) || ts.isJsxSelfClosingElement(current)) &&
      !isWalkedElement(current)
    ) {
      return "discarded";
    }
    if (isFunctionLike(current)) {
      const verdict = renderVerdictOf(current);
      if (verdict === "resolved") return "discarded";
      if (verdict !== "call") return "unreadable";
    }
    current = current.parent;
  }
  return "renders";
}

/**
 * The local names a whole-props object is destructured into, for ONE property.
 *
 * `const { value } = props` and `const { value: shown } = alias` bind the prop
 * to a name, and a reference to that name is a reference to the prop. Reading
 * only `props.value` counted those as zero references and answered `code` —
 * "this prop renders nothing" — for a prop the component visibly renders.
 *
 * A pattern this cannot read exactly (a rest element, a nested pattern, a
 * computed key) contributes no name, and `propsEscape` refuses the whole
 * reading for the same reason: a binding the reader cannot follow is one it
 * cannot vouch for.
 */
/**
 * Whether every binding this pattern creates can be named AND followed.
 *
 * The predicate that ACCEPTS a destructuring as a property read and the one
 * that FOLLOWS its names must be the same, or the object is vouched for while
 * a binding out of it goes unwatched. A rest element binds keys that cannot be
 * named; so does a computed key; and a nested or array pattern binds something
 * that is not a name this reader can follow to its uses.
 */
function isFollowable(pattern: ts.ObjectBindingPattern): boolean {
  return pattern.elements.every(
    (element) =>
      element.dotDotDotToken === undefined &&
      bindingPropertyName(element) !== null &&
      ts.isIdentifier(element.name),
  );
}

function destructuredNames(
  root: ts.Node,
  objects: readonly AliasBinding[],
  property: string,
): readonly AliasBinding[] {
  const names: AliasBinding[] = [];
  const visit = (node: ts.Node): void => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isObjectBindingPattern(node.name) &&
      node.initializer !== undefined &&
      ts.isIdentifier(node.initializer) &&
      bindingAt(objects, node.initializer) !== null &&
      isFollowable(node.name)
    ) {
      for (const element of node.name.elements) {
        if (bindingPropertyName(element) !== property) continue;
        if (ts.isIdentifier(element.name)) {
          names.push({ name: element.name.text, scope: declaringScope(node) });
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(root);
  return names;
}

function referencesTo(root: ts.Node, binding: PropBinding): readonly ts.Node[] {
  if (binding.kind === "member") {
    const objects = aliasesOf(root, binding.object);
    const names = destructuredNames(root, objects, binding.property);
    const reads: ts.Node[] = [];
    const visit = (node: ts.Node): void => {
      const read = propertyRead(node);
      if (
        read !== null &&
        ts.isIdentifier(read.object) &&
        read.property === binding.property &&
        bindingAt(objects, read.object) !== null
      ) {
        reads.push(node);
      }
      if (
        ts.isIdentifier(node) &&
        isValueReference(node) &&
        bindingAt(names, node) !== null
      ) {
        reads.push(node);
      }
      ts.forEachChild(node, visit);
    };
    visit(root);
    return reads;
  }
  const found: ts.Node[] = [];
  const visit = (node: ts.Node): void => {
    if (binding.kind === "names" && ts.isIdentifier(node)) {
      // What counts as a USE rather than a mention is `scopes.js`'s predicate,
      // not a list kept here. A list missed JSX attribute names, so a host
      // `title="tooltip"` read as a rival reading of the `title` PROP and made
      // the component disagree with itself.
      const isReference = binding.names.includes(node.text) && isValueReference(node);
      if (isReference && !isBoundBetween(node, root, node.text)) found.push(node);
    }
    ts.forEachChild(node, visit);
  };
  visit(root);
  return found;
}

/**
 * The single role every informative reading agrees on. Inert readings are
 * skipped; a value read only inertly is never rendered, so it is code.
 */
function agreedReading(readings: readonly Reading[]): PropReading | null {
  if (readings.some((reading) => reading === null)) return null;
  const informative = readings.filter(
    (reading): reading is RoleReading => reading !== null && reading !== INERT,
  );
  const first = informative[0];
  if (first === undefined) return readings.length === 0 ? null : CODE;
  if (!informative.every((reading) => reading.role === first.role)) return null;
  // Every site that renders it, so the caller can require them to agree before
  // it calls the text a paragraph.
  return {
    role: first.role,
    renderTags: informative.flatMap((reading) => reading.renderTags),
  };
}

function attributeOwnerTag(attribute: ts.JsxAttribute): string | null {
  const attributes = attribute.parent;
  const element = attributes.parent;
  if (ts.isJsxSelfClosingElement(element)) return element.tagName.getText();
  if (ts.isJsxOpeningElement(element)) return element.tagName.getText();
  return null;
}

function roleOfAttribute(
  attribute: ts.JsxAttribute,
  context: PropRoleContext,
  from: ComponentDeclaration,
  depth: number,
): Reading {
  const name = attribute.name.getText();
  if (CALLER_CONSUMED_ATTRIBUTES.has(name)) return INERT;

  const tag = attributeOwnerTag(attribute);
  if (tag === null) return null;

  // A spread AFTER this attribute may replace it, so what the element actually
  // receives is not decided here. `extract.ts` has refused a caller's literal
  // on this ground since it was written; the same fact applies to a value
  // being classified by where it lands.
  if (overriddenByLaterSpread(attribute)) return null;

  // `alt` and `aria-*` mean something fixed on a HOST element. On a component
  // they are ordinary prop names, and a component is free to render `alt` as
  // visible copy — so the receiver is asked before the name is trusted.
  // A capitalised tag that is provably a host element at every site takes host
  // semantics, which is the whole reason to establish it: `className` on it is
  // code, not a prop some component might render as copy. Asked before the
  // component branch, because that branch would try to resolve a tag that
  // names no component and give up.
  const provenAttributeHost = isComponentName(tag)
    ? provenHostTagsOf(tag, attribute, from, context)
    : null;
  if (provenAttributeHost !== null) {
    // Nothing on a `<script>` or `<style>` renders, its `aria-label` included,
    // so the accessibility and structural readings below do not apply.
    if (provenAttributeHost.kind === "opaque") return INERT;
    if (isAriaAttribute(name) || name === "alt") return ACCESSIBILITY;
    if (STRUCTURAL_ATTRIBUTES.has(name)) return CODE;
    return null;
  }
  if (isComponentName(tag)) {
    // A `ref` React consumes never reaches the component, so what that
    // component does with a prop of that name says nothing about this value.
    if (name === "ref" && !context.refReachesComponents) return INERT;
    const target = resolveTagAt(context.resolver, tag, attribute, from);
    if (target === null) return null;
    return propReadingOf(target, name, context, depth + 1);
  }

  if (isAriaAttribute(name) || name === "alt") return ACCESSIBILITY;
  if (STRUCTURAL_ATTRIBUTES.has(name)) return CODE;
  // A host attribute this far is neither structural nor accessible —
  // `jsx-facts` does not classify it, and neither can this.
  return null;
}

/**
 * What a value in CHILD position is.
 *
 * Being written between an element's tags does not mean it is shown. A host
 * element renders its children as markup, but `extract.ts` skips `OPAQUE_TAGS`
 * because a `<script>` body is executable text rather than prose — and this
 * reading has to agree with it, or a prop used only there becomes editable.
 *
 * A COMPONENT is different again: the child fills its `children` prop, and only
 * that component says whether it renders it. `<Sink>{value}</Sink>` shows
 * nothing when `Sink` drops its children, so the question is answered where the
 * answer lives.
 */
/** A lowercase name is an HTML element; React reserves capitals for components. */
function isHostTagName(value: string): boolean {
  return /^[a-z][a-z0-9-]*$/u.test(value);
}

/**
 * Whether a capitalised tag is really a HOST element every time it renders.
 *
 * `const Tag = as; <Tag className={…}>` reads as a component, resolves to
 * nothing, and every prop landing on it became undecided — 26 of the 49
 * `UNKNOWN_ATTRIBUTE_ROLE` findings on a real site, 22 of them one component.
 *
 * WHICH element it is need not be known to know WHAT it is. The values the prop
 * can take are the ones the observed call sites supply, plus the declared
 * default wherever a site omits it. When all of those are lowercase host-tag
 * literals, `<Tag>` is a host element at every site, and host semantics —
 * `className` is code, a child is content — are exactly the ones that apply.
 *
 * It refuses on anything it has not seen: a capitalised value, a value that is
 * not a literal, a site that omits the prop with no default, or no observed
 * site at all. A default alone is not evidence about what callers pass.
 */
/**
 * The host tag names a dynamic tag was proven to take, or null if unproven.
 *
 * Returning the NAMES rather than a boolean is what lets child position use
 * this: `renderTags` decides `body` against `label`, and the honest answer
 * there is the set of host tags callers actually pass -- never the alias's own
 * name, which is no host tag at all.
 *
 * Exported because three readers decide a role from a tag and only one was
 * asking. `roleOfAttribute` had it, `roleOfChild` silently dropped a
 * forwarded `children`, and `extract.ts#collectAttributes` reported an
 * attribute written directly on the alias as unclassifiable. Each was a
 * separate review round of one omission.
 *
 * `opaque` is its own answer rather than a host tag like any other. A proven
 * `<Tag>` where every caller passes `script`, `style`, `svg` or `template`
 * renders no prose at all, and `OPAQUE_TAGS` was only ever consulted against
 * the SYNTACTIC name -- `Tag` is in no such set -- so `<Heading as="script">`
 * had its prop proposed as page copy. A MIXED set refuses outright: nothing
 * true of both a `<p>` and a `<script>` is worth saying.
 */
export type ProvenHost =
  | { readonly kind: "prose"; readonly tags: readonly string[] }
  | { readonly kind: "opaque" };

export function provenHostTagsOf(
  tagName: string,
  at: ts.Node,
  from: ComponentDeclaration,
  context: PropRoleContext,
): ProvenHost | null {
  const aliased = aliasedPropOf(tagName, at, from);
  if (aliased === null) return null;
  const fallback = propDefaultOf(from, aliased);
  // A render nobody could follow may be a call of this component supplying
  // anything. There is no element to ask, so the only sound answer is to
  // refuse. Measured on All Points Media: zero, because a callee this module
  // does not declare is not counted -- an import or a hook cannot render one
  // of our components except through a tag the walk already sees.
  if ((context.unknownRenders?.() ?? 0) > 0) return null;
  // Opaque sites are folded into the SAME loop rather than checked after it.
  // Two loops disagreed about the omitting case: this one pushes the default
  // into `values`, the separate opaque one only checked that a default existed,
  // so a default of `"Card"` left `values` all-host and proved a tag that
  // renders a component. A site cannot be treated as a call of this component
  // for one purpose and not the other.
  const sites = [
    ...(context.callSitesOf?.(from) ?? []).map((site) => ({ site, opaque: false })),
    ...(context.opaqueCallSites?.() ?? []).map((site) => ({ site, opaque: true })),
  ];
  const values: string[] = [];
  for (const { site, opaque } of sites) {
    // A site the resolver could not identify may be a call of THIS component
    // under another name -- `const Alias = Heading` resolves to no
    // declaration, so it was silently absent from the index and the gap read
    // as agreement. A value it SUPPLIES is one no reading observed, so it
    // refuses; carrying nothing makes it an omitting call like any other.
    if (opaque && findAttribute(site.element, aliased) !== null) return null;
    // A component's OWN unresolved render is not a call of it. It is in the
    // opaque list because the resolver could not identify `<Tag>`, and letting
    // it contribute the declared default meant a component with NO observed
    // caller proved itself: `values` came out as `["h2"]` from its own markup,
    // which is exactly the "no site observed is not proof" contract this file
    // states two comments below. It keeps its VETO -- a recursive render is
    // possible, and refusing costs nothing -- but gives no positive evidence.
    // 92 of the 552 opaque checks on All Points Media are these.
    if (opaque && declarationKey(site.from) === declarationKey(from)) continue;
    const attribute = opaque ? null : findAttribute(site.element, aliased);
    if (attribute === null) {
      // With no explicit attribute the default renders -- but only if nothing
      // ELSE could supply the prop. A spread anywhere on the element may carry
      // it, and its value is not written here to read.
      if (fallback === null || hasSpread(site.element)) return null;
      values.push(fallback);
      continue;
    }
    // JSX applies props left to right, so a spread after the literal replaces
    // it and what the element receives is not decided at this site.
    if (overriddenByLaterSpread(attribute)) return null;
    const supplied = literalAttributeValue(attribute);
    if (supplied === null) return null;
    values.push(supplied);
  }
  // No site observed is NOT the same as having seen that every site is a host
  // tag. The default alone says nothing about what callers pass.
  if (values.length === 0 || !values.every(isHostTagName)) return null;
  const opaque = values.filter((value) => OPAQUE_TAGS.has(value));
  if (opaque.length === values.length) return { kind: "opaque" };
  if (opaque.length > 0) return null;
  return { kind: "prose", tags: values };
}

/** Whether this element carries a spread, which may supply or replace anything. */
function hasSpread(element: JsxElementNode): boolean {
  const opening = ts.isJsxElement(element) ? element.openingElement : element;
  return opening.attributes.properties.some((property: ts.JsxAttributeLike) =>
    ts.isJsxSpreadAttribute(property),
  );
}

/**
 * The PROPERTY a dynamic tag's value comes from, if it provably comes from one.
 *
 * Scope is `scopes.ts`'s job, not this file's. Three rounds of review here were
 * each a scope case a hand-written walk missed -- a callback parameter, a
 * renamed destructuring, a nested binding -- so the walk is gone and
 * `declarationOfName` answers instead: it already knows parameters,
 * destructured names, hoisted `var`s, catch clauses and switch scopes.
 *
 * The rule, stated once: walking outward from the JSX site, the FIRST thing
 * that binds the tag name must be either the component's own parameter (a tag
 * destructured straight from a prop) or a `const` in the component whose
 * initializer is a name the component's own parameter binds. Anything else --
 * a callback's parameter, an enclosing block's variable, a `let`, a name
 * written to -- is a value the call sites say nothing about.
 *
 * What is returned is the DECLARED PROPERTY name, never the local one:
 * `{ kind: as }` binds the local `as` to the property `kind`, and reading
 * callers' `as` attribute would be reading an unrelated prop.
 *
 * A parameter is as writable as a `let`. `{ as: Tag }` followed by `Tag = Card`
 * renders `Card` however uniform the call sites are, so the write check is not
 * per-branch: `aliasChainOf` reports EVERY name its conclusion depends on and
 * one check here covers the chain, so a new alias form cannot be added without
 * one.
 */
function aliasedPropOf(
  tagName: string,
  at: ts.Node,
  from: ComponentDeclaration,
): string | null {
  const component = from.jsxRoot.parent;
  if (component === undefined || !isFunctionLike(component)) return null;
  const chain = aliasChainOf(tagName, at, component);
  if (chain === null) return null;
  // A name written anywhere in the component holds a value no call site
  // supplied, whether it is a parameter, a `const` the parser let through, or
  // a link added later.
  if (chain.reliesOn.some((name) => isWrittenWithin(component, name))) return null;
  return chain.property;
}

/**
 * The property a dynamic tag reads, and every local name that answer rests on.
 *
 * Reporting the names rather than vetting them here is what keeps the write
 * rule in one place: this function decides WHERE the value comes from, and
 * `aliasedPropOf` decides whether the value can still be trusted at render.
 */
function aliasChainOf(
  tagName: string,
  at: ts.Node,
  component: FunctionLike,
): { readonly reliesOn: readonly string[]; readonly property: string } | null {
  const bound = firstBindingOf(at, tagName, component);
  if (bound === null || bound.owner !== "the component") return null;

  // `function Heading({ as: Tag })` — the tag IS the parameter binding.
  if (ts.isParameter(bound.declaration)) {
    const property = declaredPropertyFor(component, tagName);
    return property === null ? null : { reliesOn: [tagName], property };
  }

  if (!ts.isVariableDeclaration(bound.declaration)) return null;
  const list = bound.declaration.parent;
  if (!ts.isVariableDeclarationList(list)) return null;
  if ((list.flags & ts.NodeFlags.Const) === 0) return null;
  const initializer = bound.declaration.initializer;
  if (initializer === undefined || !ts.isIdentifier(initializer)) return null;

  // The initializer must itself resolve to the component's own parameter.
  const source = firstBindingOf(at, initializer.text, component);
  if (source === null || source.owner !== "the component") return null;
  if (!ts.isParameter(source.declaration)) return null;
  const property = declaredPropertyFor(component, initializer.text);
  return property === null ? null : { reliesOn: [tagName, initializer.text], property };
}

/**
 * The first declaration of this name walking out from a node, and whether it
 * belongs to the component itself or to something nearer.
 */
function firstBindingOf(
  at: ts.Node,
  name: string,
  component: FunctionLike,
): { readonly declaration: ts.Node; readonly owner: "the component" | "nearer" } | null {
  let current: ts.Node | undefined = at.parent;
  while (current !== undefined && !ts.isSourceFile(current)) {
    const declaration = declarationOfName(current, name);
    if (declaration !== null) {
      // The component's own scope is the function-like AND its body block: a
      // `const` written at the top of the component is found on the block, not
      // on the function. Any OTHER block on the way out is a nested scope, and
      // a binding there is not the component's.
      const own = current === component || current === component.body;
      return { declaration, owner: own ? "the component" : "nearer" };
    }
    current = current.parent;
  }
  return null;
}

/** The property name the component's parameter binds to this local name. */
function declaredPropertyFor(component: FunctionLike, local: string): string | null {
  const parameter = component.parameters[0];
  if (parameter === undefined || !ts.isObjectBindingPattern(parameter.name)) return null;
  for (const element of parameter.name.elements) {
    if (!ts.isIdentifier(element.name) || element.name.text !== local) continue;
    // `{ kind: as }` binds the local `as` to the property `kind`; reading
    // callers' `as` would be an unrelated prop.
    return bindingPropertyName(element);
  }
  return null;
}

/**
 * Whether anything writes to this name inside the component.
 *
 * `isWriteTarget` is `evaluate.ts`'s, so `for (as of …)` and `as++` count too.
 */
function isWrittenWithin(component: FunctionLike, name: string): boolean {
  let found = false;
  const visit = (node: ts.Node): void => {
    if (found) return;
    if (ts.isIdentifier(node) && node.text === name && isWriteTarget(node)) {
      found = true;
      return;
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(component, visit);
  return found;
}

/** A prop's declared default, when the destructuring states one as a literal. */
function propDefaultOf(from: ComponentDeclaration, propName: string): string | null {
  const owner = from.jsxRoot.parent;
  if (owner === undefined || !isFunctionLike(owner)) return null;
  const parameter = owner.parameters[0];
  if (parameter === undefined || !ts.isObjectBindingPattern(parameter.name)) return null;
  for (const element of parameter.name.elements) {
    if (bindingPropertyName(element) !== propName) continue;
    const initializer = element.initializer;
    if (initializer === undefined) return null;
    return ts.isStringLiteral(initializer) || ts.isNoSubstitutionTemplateLiteral(initializer)
      ? initializer.text
      : null;
  }
  return null;
}

function roleOfChild(
  host: ts.JsxElement,
  context: PropRoleContext,
  from: ComponentDeclaration,
  depth: number,
): Reading {
  const tag = tagNameOf(host);
  if (OPAQUE_TAGS.has(tag)) return INERT;
  if (!isComponentName(tag)) return contentIn(tag);
  // A dynamic tag proven to be a host element is one in child position too, and
  // the children it wraps are content. The comment that used to sit here said
  // this branch "changed nothing on a real site and no test could reach it" --
  // that was my claim, and it was wrong: `<Tag>{children}</Tag>` dropped the
  // caller's text with NO finding, which is the worst direction available.
  //
  // The render sites are the host names callers were observed to pass, so the
  // body-or-label reading is decided by real tags rather than by the alias.
  const provenHosts = provenHostTagsOf(tag, host, from, context);
  if (provenHosts !== null) {
    // `OPAQUE_TAGS.has(tag)` above tested the SYNTACTIC name, and `Tag` is in no
    // such set. A tag proven to be `script` every time it renders holds
    // executable text, not prose.
    if (provenHosts.kind === "opaque") return INERT;
    return { role: "content", renderTags: provenHosts.tags };
  }
  const target = resolveTagAt(context.resolver, tag, host, from);
  if (target === null) return null;
  return propReadingOf(target, CHILDREN_PROP, context, depth + 1);
}

/**
 * Walks up from a reference to the JSX position it reaches, deciding on the
 * way whether the value is still the thing being rendered. Crossing a test —
 * a comparison, a negation, a condition, the left of `&&` — means the value is
 * being consulted rather than shown, which makes it code.
 */
function roleOfReference(
  reference: ts.Node,
  context: PropRoleContext,
  from: ComponentDeclaration,
  depth: number,
): Reading {
  const reachability = reachabilityOf(reference, from.jsxRoot);
  if (reachability === "discarded") return INERT;
  if (reachability === "unreadable") return null;

  let current: ts.Node = reference;
  for (;;) {
    const parent: ts.Node | undefined = current.parent;
    if (parent === undefined) return null;


    if (ts.isJsxExpression(parent)) {
      const host = parent.parent;
      // A fragment shows the value with no element of its own to read.
      if (ts.isJsxFragment(host)) return contentIn(null);
      if (ts.isJsxElement(host)) return roleOfChild(host, context, from, depth);
      if (ts.isJsxAttribute(host)) return roleOfAttribute(host, context, from, depth);
      return null;
    }
    if (ts.isJsxAttribute(parent)) {
      return roleOfAttribute(parent, context, from, depth);
    }
    if (
      ts.isJsxOpeningElement(parent) ||
      ts.isJsxSelfClosingElement(parent) ||
      ts.isJsxClosingElement(parent)
    ) {
      // The value names the element being rendered, not anything shown in it.
      // The closing tag repeats the same name, so it is read the same way.
      return parent.tagName === current ? CODE : null;
    }

    if (ts.isBinaryExpression(parent)) {
      const operator = parent.operatorToken.kind;
      if (COMPARISONS.has(operator)) return CODE;
      // `a && b` shows b, so its left side is only ever a predicate. `a || b`
      // and `a ?? b` show A whenever it is present, so their left side is the
      // value and must be followed like any other.
      if (operator === ts.SyntaxKind.AmpersandAmpersandToken) {
        if (parent.left === current) return INERT;
        current = parent;
        continue;
      }
      if (FALLBACK_OPERATORS.has(operator)) {
        current = parent;
        continue;
      }
      return null;
    }
    // A value that SELECTS something is being consulted, not shown.
    // `variants[variant]` reads the value's identity to pick a different value,
    // exactly as `variant === "primary"` does; what gets rendered is the
    // table's entry, never the key.
    if (ts.isElementAccessExpression(parent) && parent.argumentExpression === current) {
      return CODE;
    }
    if (ts.isComputedPropertyName(parent) && parent.expression === current) return CODE;

    if (ts.isPrefixUnaryExpression(parent)) {
      return parent.operator === ts.SyntaxKind.ExclamationToken ? INERT : null;
    }
    if (ts.isConditionalExpression(parent)) {
      if (parent.condition === current) return INERT;
      current = parent;
      continue;
    }
    if (ts.isVariableDeclaration(parent) && ts.isIdentifier(parent.name)) {
      // `const Tag = as;` — the alias carries the value, so read ITS uses,
      // scoped to the block that declares it. Reading them against the whole
      // component would see that very declaration as a rebinding and find none.
      return roleOfAlias(parent.name.text, declaringScope(parent), context, from, depth);
    }
    if (ts.isCallExpression(parent)) {
      // The callee is not the value being passed.
      if (parent.expression === current) return null;
      // An argument FLOWS INTO the call's result, so where that result lands
      // still bounds what the value can be — but only downwards. `cn(value)`
      // in a `className` can only ever contribute to a class name, so `code`
      // is safe to conclude. `format(value)` shown as text is NOT safe to call
      // content: the value may be a key the helper looks up, and offering a
      // customer a key to edit as if it were their copy is the failure this
      // whole reading exists to avoid.
      const beyond = roleOfReference(parent, context, from, depth);
      if (beyond === INERT) return beyond;
      return beyond !== null && beyond.role === "code" ? beyond : null;
    }
    if (
      ts.isPropertyAccessExpression(parent) &&
      parent.expression === current &&
      parent.name.text === "map"
    ) {
      // `lines.map(...)` — the callback renders the elements, so the list holds
      // whatever the callback's parameter turns out to be.
      const call = parent.parent;
      if (!ts.isCallExpression(call)) return null;
      return roleOfMapCallback(call, context, from, depth);
    }
    if (
      ts.isParenthesizedExpression(parent) ||
      ts.isAsExpression(parent) ||
      ts.isTemplateSpan(parent) ||
      ts.isTemplateExpression(parent) ||
      ts.isArrayLiteralExpression(parent)
    ) {
      current = parent;
      continue;
    }
    return null;
  }
}

const FALLBACK_OPERATORS: ReadonlySet<ts.SyntaxKind> = new Set([
  ts.SyntaxKind.BarBarToken,
  ts.SyntaxKind.QuestionQuestionToken,
]);

const COMPARISONS: ReadonlySet<ts.SyntaxKind> = new Set([
  ts.SyntaxKind.EqualsEqualsToken,
  ts.SyntaxKind.EqualsEqualsEqualsToken,
  ts.SyntaxKind.ExclamationEqualsToken,
  ts.SyntaxKind.ExclamationEqualsEqualsToken,
  ts.SyntaxKind.LessThanToken,
  ts.SyntaxKind.GreaterThanToken,
  ts.SyntaxKind.LessThanEqualsToken,
  ts.SyntaxKind.GreaterThanEqualsToken,
]);

function roleOfMapCallback(
  call: ts.CallExpression,
  context: PropRoleContext,
  from: ComponentDeclaration,
  depth: number,
): Reading {
  const [callback] = call.arguments;
  if (callback === undefined) return null;
  if (!ts.isArrowFunction(callback) && !ts.isFunctionExpression(callback)) return null;
  const [item] = callback.parameters;
  if (item === undefined || !ts.isIdentifier(item.name)) return null;
  const references = referencesTo(callback.body, {
    kind: "names",
    names: [item.name.text],
  });
  return agreedReading(
    references.map((reference) => roleOfReference(reference, context, from, depth)),
  );
}

/** The nearest enclosing block or function body a declaration lives in. */
/**
 * The scope a declaration governs.
 *
 * Its nearest SCOPE, not its nearest block: a `for` initializer binds to the
 * loop, condition included, and recording it against the surrounding block put
 * the condition outside its own alias's scope. `isScopeNode` is the one
 * statement of what introduces a binding, so this asks that.
 */
function declaringScope(declaration: ts.VariableDeclaration): ts.Node {
  let current: ts.Node = declaration;
  while (current.parent !== undefined && !isScopeNode(current.parent)) {
    current = current.parent;
  }
  return current.parent ?? declaration;
}

function roleOfAlias(
  name: string,
  scope: ts.Node,
  context: PropRoleContext,
  from: ComponentDeclaration,
  depth: number,
): Reading {
  const references = referencesTo(scope, { kind: "names", names: [name] }).filter(
    (reference) => !ts.isVariableDeclaration(reference.parent),
  );
  return agreedReading(
    references.map((reference) => roleOfReference(reference, context, from, depth)),
  );
}

/**
 * Whether a component's props object gets anywhere other than a property read.
 *
 * Enumerating the ways to forward it does not terminate: a JSX spread, an
 * object spread, `Object.assign`, a call argument, a return, an array element,
 * a shorthand property. Each one hands the whole object to something this
 * reader cannot see, and a child is then free to consume `title` as behaviour
 * while the local `props.title` renders as text.
 *
 * The question that DOES terminate is the inverse: every reference to the
 * object must resolve right there to one of its properties. Reading `props.x`,
 * destructuring `const { x } = props`, and naming an alias this walk already
 * follows are the whole list; anything else escapes and the prop's role is no
 * longer decided here.
 */
function propsEscape(root: ts.Node, object: string): boolean {
  const bindings = aliasesOf(root, object);
  let escaped = false;
  const visit = (node: ts.Node): void => {
    if (escaped) return;
    if (ts.isIdentifier(node) && isValueReference(node) && bindingAt(bindings, node) !== null) {
      if (!isPropertyRead(node, bindings)) {
        escaped = true;
        return;
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(root);
  return escaped;
}

/** Whether this reference resolves, right there, to a property of the object. */
function isPropertyRead(node: ts.Identifier, bindings: readonly AliasBinding[]): boolean {
  const parent = node.parent;
  if (parent === undefined) return false;
  if (ts.isPropertyAccessExpression(parent)) return parent.expression === node;
  // `alias[key]` hands out a property this reader cannot name, so it cannot
  // say where that property goes. Only a written key is a named read.
  if (ts.isElementAccessExpression(parent)) {
    return parent.expression === node && ts.isStringLiteral(parent.argumentExpression);
  }
  // `const { title } = props` reads properties; `const alias = props` is a
  // name this walk already treats as the same object.
  //
  // A REST element is neither. `const { known, ...rest } = props` binds every
  // key this reader did not name, and `<Child {...rest} />` then hands them on
  // while the local `props.value` still reads as text. The keys it carries
  // cannot be enumerated from here, so the object has escaped.
  if (ts.isVariableDeclaration(parent) && parent.initializer === node) {
    if (ts.isObjectBindingPattern(parent.name)) return isFollowable(parent.name);
    return (
      ts.isIdentifier(parent.name) &&
      bindings.some(
        (binding) =>
          binding.name === (parent.name as ts.Identifier).text &&
          binding.scope === declaringScope(parent),
      )
    );
  }
  return false;
}

/** Every name that stands for the same object, following `const b = a` chains. */
/**
 * A binding this reader is following: a name AND the scope it governs.
 *
 * Matching by spelling and then asking whether anything between the use and
 * the component root rebinds that spelling is wrong in both directions. The
 * block that declares an alias lies between its own use and the root, so a
 * valid read reads as shadowed; and an unrelated nested binding of the same
 * spelling is accepted, lending its name to a reference that never read the
 * prop. A binding is its declaration, so it is carried as one.
 */
interface AliasBinding {
  readonly name: string;
  readonly scope: ts.Node;
}

/** The binding a reference resolves to, or null when it resolves to none. */
function bindingAt(
  bindings: readonly AliasBinding[],
  reference: ts.Identifier,
): AliasBinding | null {
  // At most one binding can survive both tests: a nested one shadows the outer,
  // and a sibling one does not reach the reference at all. So there is nothing
  // to rank — a tie-break here would be a decision no program can exercise.
  return (
    bindings.find(
      (binding) =>
        binding.name === reference.text &&
        encloses(binding.scope, reference) &&
        // Nothing NEARER than the binding's own scope may rebind the name.
        !isBoundBetween(reference, binding.scope, binding.name),
    ) ?? null
  );
}

function encloses(outer: ts.Node, inner: ts.Node): boolean {
  let current: ts.Node | undefined = inner;
  while (current !== undefined) {
    if (current === outer) return true;
    current = current.parent;
  }
  return false;
}

/** Every binding that stands for the same object, followed through `const b = a`. */
function aliasesOf(root: ts.Node, object: string): readonly AliasBinding[] {
  const bindings: AliasBinding[] = [{ name: object, scope: root }];
  // Unbounded, and it terminates: the set only GROWS and is bounded by the
  // variable declarations in the subtree, so the saturation break below is the
  // real end. A pass budget here truncated a long `const b = a` chain and
  // returned an incomplete alias set, which is a write through the missed name
  // that nothing sees -- the same fail-open shape as a capped parent walk.
  for (;;) {
    const before = bindings.length;
    const visit = (node: ts.Node): void => {
      if (
        ts.isVariableDeclaration(node) &&
        ts.isIdentifier(node.name) &&
        node.initializer !== undefined &&
        ts.isIdentifier(node.initializer) &&
        bindingAt(bindings, node.initializer) !== null &&
        !bindings.some(
          (binding) =>
            binding.name === (node.name as ts.Identifier).text &&
            binding.scope === declaringScope(node),
        )
      ) {
        bindings.push({ name: node.name.text, scope: declaringScope(node) });
      }
      ts.forEachChild(node, visit);
    };
    visit(root);
    if (bindings.length === before) break;
  }
  return bindings;
}

/**
 * The role a component gives one of its props, read from that component's own
 * body. Returns null whenever the answer is not decided by the source.
 */
export function propReadingOf(
  declaration: ComponentDeclaration,
  propName: string,
  context: PropRoleContext,
  depth = 0,
): PropReading | null {
  if (depth > MAX_COMPONENT_DEPTH) return null;
  const binding = bindingFor(declaration, propName);
  if (binding === null) return null;

  // A receiver whose props object escapes hands this one onward too, and the
  // child is free to use it as behaviour. What it does with `props.title` here
  // is then only half the answer.
  if (binding.kind === "member" && propsEscape(declaration.jsxRoot, binding.object)) {
    return null;
  }

  const references = referencesTo(declaration.jsxRoot, binding);
  // A prop the component never reads renders nothing. It is part of the
  // component's interface, not of the page's copy.
  if (references.length === 0) return CODE;

  return agreedReading(
    references.map((reference) => roleOfReference(reference, context, declaration, depth)),
  );
}
