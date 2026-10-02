import { readFileSync, writeFileSync } from "node:fs";

import ts from "typescript";

import type { Proposal } from "./propose.js";
import type { CallSite, CallSiteIndex } from "./reachability.js";
import { declarationKey } from "./reachability.js";
import type { ComponentDeclaration } from "./extract.js";
import type { FieldBinding, PageBinding } from "./bindings.js";
import { isWriteTarget } from "./evaluate.js";
import { realPathOf } from "./scan.js";
import { jsxElementAt, richTextRewrite } from "./rewire-rich-text.js";

/**
 * Turning a hardcoded literal into a contract read.
 *
 * The proposal already says, for every accepted value, which field id it was
 * given and the exact offset it was read from — `location.offset` is
 * `node.getStart()`, recorded for this. So a rewrite is a text edit at a known
 * position, not a second reading of the repository. Nothing here re-derives
 * what a value IS; it only moves where the value comes from.
 *
 * Two shapes are handled, and they are 81% of All Points Media's 317 accepted
 * fields. The rest are reported unhandled rather than guessed at: a wrong edit
 * here changes a customer's page.
 */
/**
 * The index binding added to a collection's `.map()` callback.
 *
 * Deliberately unlikely to collide with a template's own names: it is
 * introduced into somebody else's scope.
 */
const INDEX_BINDING = "managedIndex";

/**
 * A name for the index parameter that nothing in `source` already uses.
 *
 * The callback is given a parameter it did not have, and a parameter SHADOWS
 * whatever else that name meant: a module with its own `managedIndex` in scope
 * would go on compiling and quietly read the parameter instead. Every
 * identifier in the file is checked, which is broader than scope and cannot be
 * wrong in the dangerous direction.
 */
function indexBindingFor(source: ts.SourceFile): string {
  const taken = new Set<string>();
  const visit = (node: ts.Node): void => {
    if (ts.isIdentifier(node)) taken.add(node.text);
    ts.forEachChild(node, visit);
  };
  visit(source);
  if (!taken.has(INDEX_BINDING)) return INDEX_BINDING;
  let suffix = 2;
  while (taken.has(`${INDEX_BINDING}${String(suffix)}`)) suffix += 1;
  return `${INDEX_BINDING}${String(suffix)}`;
}

export interface RewriteEdit {
  readonly file: string;
  readonly start: number;
  readonly end: number;
  readonly text: string;
}

export interface RewriteRefusal {
  readonly why: string;
  readonly fieldId: string;
  readonly name: string;
  readonly file: string;
  readonly line: number;
}

export interface RewritePlan {
  readonly edits: readonly RewriteEdit[];
  readonly rewritten: number;
  readonly pagesAnnotated: number;
  readonly unhandled: ReadonlyMap<string, number>;
  /**
   * Every refusal with the value it is about.
   *
   * A count says how much is left; it does not say what to look at. Each entry
   * names the field and the line it was read from, so the next case to handle
   * is a jump away rather than a search.
   */
  readonly refusals: readonly RewriteRefusal[];
  /**
   * Customer-editable fields this pass could not rewrite.
   *
   * Distinct from the refusal COUNT, most of which is fields the contract does
   * not hand to the customer at all -- 80 of them on All Points Media -- and
   * which say nothing about whether the conversion worked. This is the number
   * a caller should refuse to ship on: the contract declares these editable and
   * the site does not render them that way.
   */
  readonly unrewired: number;
  readonly filesTouched: ReadonlySet<string>;
  /** Receiver modules that now name `ManagedSiteFieldAttributesV1` in a type. */
  readonly annotationTypeNeeded: ReadonlySet<string>;
  /** Client modules that now name `ManagedFields` in a type. */
  readonly managedFieldsTypeNeeded: ReadonlySet<string>;
  /** Files that name `ManagedItems`, which the same runtime module exports. */
  readonly managedItemsTypeNeeded: ReadonlySet<string>;
}

/**
 * Whether this module runs in the browser.
 *
 * The managed-site runtime is SERVER-ONLY: the contract package reads
 * `node:crypto` and `node:util`, so a client component importing it fails the
 * webpack build outright. Five of All Points Media's 26 rewritten files are
 * client components, and the build is what found them -- no amount of reading
 * the candidates would have.
 *
 * A value rendered by a client component has to arrive as a prop from a server
 * parent, which is a two-sided rewrite. Refused here rather than attempted.
 */
function isClientModule(source: ts.SourceFile): boolean {
  for (const statement of source.statements) {
    if (!ts.isExpressionStatement(statement)) continue;
    const expression = statement.expression;
    if (ts.isStringLiteral(expression) && expression.text === "use client")
      return true;
    // A directive can also survive as a no-substitution template in hand-edited
    // source, and the parser accepts it.
    if (
      ts.isNoSubstitutionTemplateLiteral(expression) &&
      expression.text === "use client"
    ) {
      return true;
    }
  }
  return false;
}

/**
 * The element a text candidate was read from.
 *
 * `#pushText` records `locationOf(element)` and the value is the element's
 * direct TEXT RUN — its text children concatenated. So the offset names the
 * element, never the text, and asking "what node starts here" was the wrong
 * question: it answered `JsxText` for a whitespace child and the rewrite
 * inserted the value beside the content instead of replacing it.
 */
function elementAt(
  source: ts.SourceFile,
  offset: number,
): ts.JsxOpeningElement | null {
  return jsxElementAt(source, offset)?.openingElement ?? null;
}

/**
 * The JSX a route's default export returns.
 *
 * The editor scopes field discovery to `[data-gomega-page-id]` and returns
 * NOTHING when no single element carries it, so a page without this annotation
 * has zero editable fields however many of its values were rewritten. That is
 * why this is not optional.
 */
function pageRootOf(
  source: ts.SourceFile,
): ts.JsxElement | ts.JsxFragment | ts.JsxSelfClosingElement | null {
  for (const statement of source.statements) {
    const isDefault =
      ts.canHaveModifiers(statement) &&
      (ts.getModifiers(statement) ?? []).some(
        (modifier) => modifier.kind === ts.SyntaxKind.DefaultKeyword,
      );
    if (
      !isDefault ||
      !ts.isFunctionDeclaration(statement) ||
      statement.body === undefined
    ) {
      continue;
    }
    let found:
      ts.JsxElement | ts.JsxFragment | ts.JsxSelfClosingElement | null = null;
    const visit = (node: ts.Node): void => {
      if (found !== null) return;
      if (ts.isReturnStatement(node) && node.expression !== undefined) {
        const returned = ts.isParenthesizedExpression(node.expression)
          ? node.expression.expression
          : node.expression;
        // A page whose whole body is one component -- `return <MashupHome />`
        // -- returns a SELF-CLOSING element, and accepting only the other two
        // left the home page with no root and its 22 fields undiscoverable.
        if (
          ts.isJsxElement(returned) ||
          ts.isJsxFragment(returned) ||
          ts.isJsxSelfClosingElement(returned)
        ) {
          found = returned;
          return;
        }
      }
      // Not into a nested function: an inner component's return is not the
      // page's.
      if (ts.isFunctionDeclaration(node) && node !== statement) return;
      if (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) return;
      ts.forEachChild(node, visit);
    };
    visit(statement.body);
    if (found !== null) return found;
  }
  return null;
}

/** The opening element an attribute is written on. */
function owningElement(
  attribute: ts.JsxAttribute,
): ts.JsxOpeningElement | ts.JsxSelfClosingElement | null {
  const attributes = attribute.parent;
  const element = attributes.parent;
  return ts.isJsxOpeningElement(element) || ts.isJsxSelfClosingElement(element)
    ? element
    : null;
}

/**
 * The attribute a value was read from.
 *
 * `#pushAttributeText` records `locationOf(attribute.node)`, so for these the
 * offset names the JsxAttribute itself rather than an element. Text and
 * attribute candidates are told apart by WHAT IS AT THE OFFSET, which is the
 * only thing that distinguishes them: both are `plain_text`.
 */
function attributeAt(
  source: ts.SourceFile,
  offset: number,
): ts.JsxAttribute | null {
  let hit: ts.JsxAttribute | null = null;
  const visit = (node: ts.Node): void => {
    if (hit !== null) return;
    if (ts.isJsxAttribute(node) && node.getStart(source) === offset) {
      hit = node;
      return;
    }
    if (node.getStart(source) <= offset && node.getEnd() > offset)
      ts.forEachChild(node, visit);
  };
  ts.forEachChild(source, visit);
  return hit;
}

/**
 * The JSX EXPRESSION a declared value was read from.
 *
 * `#collectDeclaredValue` records `locationOf(node)` where the node is the
 * expression child, so `{ctas.secondary.label}` is named by its `{`. A probe
 * that accepted only elements and attributes reported "no element at the
 * offset" for all 20 of these — and a naive probe finds a ZERO-WIDTH
 * whitespace `JsxText` sibling sitting at the same position first, which is
 * why they looked like two different shapes.
 */
function expressionAt(
  source: ts.SourceFile,
  offset: number,
): ts.JsxExpression | null {
  let hit: ts.JsxExpression | null = null;
  const visit = (node: ts.Node): void => {
    if (hit !== null) return;
    if (ts.isJsxExpression(node) && node.getStart(source) === offset) {
      hit = node;
      return;
    }
    if (node.getStart(source) <= offset && node.getEnd() > offset)
      ts.forEachChild(node, visit);
  };
  ts.forEachChild(source, visit);
  return hit;
}

/** Whether this child is the only thing its element renders. */
function isOnlyChild(element: ts.JsxElement, child: ts.Node): boolean {
  const siblings = element.children.filter(
    (node) => !(ts.isJsxText(node) && node.containsOnlyTriviaWhiteSpaces),
  );
  return siblings.length === 1 && siblings[0] === child;
}

/**
 * Where the value lives among an element's children, and whether the element
 * holds anything else.
 *
 * THE safety invariant of this whole rewrite: an annotated element's only
 * content may be the field's value. The editor writes an edit with
 * `element.textContent = text` (`edit-runtime.ts:249`), which replaces
 * EVERYTHING inside — so annotating `<p>© {company.legal} All rights
 * reserved.</p>` would let a customer's edit destroy the expression beside the
 * text. Where the element holds more, the annotation goes on a `<span>` around
 * the value instead, and the element keeps its other children.
 *
 * A value split across two text nodes by an element between them cannot be
 * replaced by one expression without moving content, so it is refused.
 */
interface ValuePlacement {
  readonly start: number;
  readonly end: number;
  /** True when the element holds nothing but this value. */
  readonly alone: boolean;
}

function valuePlacementOf(element: ts.JsxElement): ValuePlacement | null {
  const children = element.children.filter(
    (child) => !(ts.isJsxText(child) && child.containsOnlyTriviaWhiteSpaces),
  );
  const texts = children.filter((child) => ts.isJsxText(child));
  const only = texts.length === 1 ? texts[0] : undefined;
  if (only === undefined) return null;
  // Only the TRIMMED span of the text node is replaced. The value is trimmed
  // (`textRun.trim()`), and swapping the whole node for it ate the space JSX
  // renders between text and a following element: `Build a network, <span>`
  // became `<span>Build a network,</span><span>` and the words ran together.
  // Keeping the surrounding whitespace reproduces exactly what JSX emitted.
  const raw = only.getText();
  const leading = raw.length - raw.trimStart().length;
  const trailing = raw.length - raw.trimEnd().length;
  const start = only.getStart() + leading;
  const end = only.getEnd() - trailing;
  if (end <= start) return null;
  return { start, end, alone: children.length === 1 };
}

/**
 * Where the annotation spread goes: before the first attribute, never after.
 *
 * The inserted text carries its OWN leading space. For an element with no
 * attributes this position is flush against the tag name, and text without one
 * produced `<AgeRailmanagedFields={…}` -- a parse error the build reported
 * against the page's opening `<div`, twelve lines away from the cause.
 *
 * JSX applies attributes left to right, so a spread written at the END of the
 * list can be overwritten by an earlier one only in the other direction --
 * but a LATER spread in the source overwrites what precedes it, and appending
 * would put the annotation where any existing `{...props}` could replace it.
 * Inserting first means an existing spread can still override it; that is
 * visible in the HTML diff, which is what the gate is for.
 */
/**
 * Where an attribute this rewrite adds is inserted: straight after the tag name.
 *
 * Inserted text carries its own LEADING space, and the position is what makes
 * one enough. At the start of the attribute LIST -- which skips the whitespace
 * before the first attribute -- the text also has to supply a trailing one, and
 * without it `captionAttributes={...}src="/hero.png"` ran two attributes
 * together. After the tag name, the element's own spacing is still ahead of the
 * insertion and does the separating. (Both parse, and the second even builds,
 * so nothing but reading the output catches it.)
 */
/**
 * Whether a tag names a host element -- something the DOM will render -- rather
 * than a component.
 *
 * Every annotation must land on one. An annotation on a COMPONENT tag marks the
 * call site: the value renders wherever that component puts it, the editor
 * looks for an element carrying the id and finds the wrapper instead, and the
 * field is uneditable while looking converted. A dotted tag is a component
 * whatever its case -- `<motion.div>` is not a `div`.
 */
function isHostTag(tag: string): boolean {
  return /^[a-z][a-z0-9-]*$/u.test(tag);
}

function annotationInsertPoint(
  element: ts.JsxOpeningElement | ts.JsxSelfClosingElement,
): number {
  // The END of the attribute list, so a later spread cannot overwrite what is
  // generated here. JSX applies attributes left to right and the last one
  // wins, so `<p {...props} data-gomega-field-id="…">` keeps the generated id
  // whatever `props` carries, while the same attribute written first would be
  // silently replaced -- and the field would either point at another field's
  // id or stop being editable at all.
  //
  // It also spaces itself with one leading space, because the end of the list
  // is the character after the last attribute, not the whitespace before the
  // next thing.
  return element.attributes.getEnd();
}

function callFor(fieldId: string): string {
  return `managedText(${JSON.stringify(fieldId)})`;
}

/**
 * Every field id the CONTRACT actually declares.
 *
 * `proposal.fields` is the binding set, and it is NOT the contract's field
 * set: a bound field can still be dropped before the contract is built — an
 * over-long value, a route whose content path is unrepresentable. Rewriting
 * from the bindings alone emitted reads for ids the contract never declared,
 * and the runtime threw at build time on `field_ctd4jz…`. The intersection is
 * taken HERE rather than by the caller so that no caller can skip it.
 */
function editableFieldIds(contract: Proposal["contract"]): ReadonlySet<string> {
  const ids = new Set<string>();
  if (contract === null) return ids;
  // A collection whose ITEMS a customer may edit. The collection field itself
  // holds the order and the length, which belong to the code -- the template
  // maps the repository's own array -- so it is classified
  // `code_owned_interface`. Its items are still the customer's, and the
  // binding the rewriter walks is the collection's, so asking only about the
  // field's own classification stopped every collection being rewritten at
  // all.
  const editableCollections = new Set(
    contract.collections
      .filter((collection) =>
        collection.itemFields.some(
          (field) => field.classification === "customer_editable",
        ),
      )
      .map((collection) => collection.id),
  );
  for (const page of contract.pages) {
    for (const section of page.sections) {
      for (const field of section.fields) {
        // Only what a CUSTOMER can edit. A code-owned or internal field is
        // never written by the editor, so reading it from the contract adds
        // churn and a second place for the same string to live, with no
        // failure it prevents.
        if (field.classification === "customer_editable") ids.add(field.id);
        if (
          field.type === "collection" &&
          "collectionId" in field &&
          editableCollections.has(field.collectionId)
        ) {
          ids.add(field.id);
        }
      }
    }
  }
  return ids;
}

/**
 * The contract collection a binding names, and its item fields by property.
 *
 * The join is exact rather than by name: a binding's pointer is
 * `/hero/browseAxes/collection` and the collection's resolver names
 * `/hero/browseAxes/collection/items` in the same document.
 */
function collectionFor(
  contract: Proposal["contract"],
  sourcePath: string,
  pointer: string,
): {
  readonly id: string;
  readonly fieldByProperty: ReadonlyMap<string, string>;
} | null {
  if (contract === null) return null;
  for (const collection of contract.collections) {
    if (collection.resolver.path !== sourcePath) continue;
    if (collection.resolver.pointer !== `${pointer}/items`) continue;
    const fieldByProperty = new Map<string, string>();
    for (const field of collection.itemFields) {
      if (field.classification !== "customer_editable") continue;
      fieldByProperty.set(field.itemPointer.replace(/^\//u, ""), field.id);
    }
    return { id: collection.id, fieldByProperty };
  }
  return null;
}

export function planRewrite(
  proposal: Proposal,
  runtimeSpecifier: string,
): RewritePlan {
  const editable = editableFieldIds(proposal.contract);
  const fields = proposal.fields;
  const sources = new Map<string, ts.SourceFile>();
  const edits: RewriteEdit[] = [];
  const unhandled = new Map<string, number>();
  const refusals: RewriteRefusal[] = [];
  const annotated = new Set<string>();
  const filesTouched = new Set<string>();
  let rewritten = 0;
  let pagesAnnotated = 0;
  const receiversEdited = new Set<string>();
  const annotationTypeNeeded = new Set<string>();
  const managedFieldsTypeNeeded = new Set<string>();
  const managedItemsTypeNeeded = new Set<string>();
  /**
   * Every client component that must take threaded props, and which ones.
   *
   * Accumulated rather than emitted as each is found: a component can need more
   * than one, and one with no parameter at all needs a single parameter naming
   * all of them rather than one parameter each.
   */
  const clientPropsByComponent = new Map<
    string,
    {
      readonly file: string;
      readonly target: ClientComponentTarget;
      readonly props: ThreadedProp[];
    }
  >();
  const forwarded = new Set<string>();
  const clientFieldsBySite = new Map<
    string,
    { readonly file: string; readonly at: number; readonly fieldIds: string[] }
  >();
  const clientItemsBySite = new Map<
    string,
    {
      readonly file: string;
      readonly at: number;
      readonly collectionIds: string[];
    }
  >();

  const targets = componentTargets(proposal.callSites);
  const readSource = (path: string): ts.SourceFile => {
    let found = sources.get(path);
    if (found === undefined) {
      found = ts.createSourceFile(
        path,
        readFileSync(path, "utf8"),
        ts.ScriptTarget.Latest,
        true,
        ts.ScriptKind.TSX,
      );
      sources.set(path, found);
    }
    return found;
  };
  /**
   * Give a receiver the attributes for one prop, once.
   *
   * The receiver's own edits are made once per (component, prop), however many
   * call sites hand it a value: a second destructuring of the same name does
   * not compile.
   */
  const editReceiver = (
    receiverFile: string,
    component: string,
    prop: string,
    parts: ReceiverParts,
  ): void => {
    const attributesProp = `${prop}Attributes`;
    const pairKey = `${receiverFile}:${component}.${prop}`;
    if (receiversEdited.has(pairKey)) return;
    receiversEdited.add(pairKey);
    edits.push({
      file: receiverFile,
      start: parts.destructureAt,
      end: parts.destructureAt,
      text: `, ${attributesProp}`,
    });
    edits.push({
      file: receiverFile,
      start: parts.typeAt,
      end: parts.typeAt,
      text: `\n  ${attributesProp}?: ManagedSiteFieldAttributesV1;`,
    });
    if (parts.site.kind === "forward") {
      // One more component in the way: it takes the annotation as ITS
      // `childrenAttributes`, exactly as a caller hands one in.
      edits.push({
        file: receiverFile,
        start: parts.site.at,
        end: parts.site.at,
        text: ` ${parts.site.prop}Attributes={${attributesProp}}`,
      });
    } else if (parts.site.kind === "wrapInPlace") {
      // The value is read inside a prop that takes a node, so the annotated
      // wrapper IS the node and nothing downstream changes. Conditional for the
      // same reason as every other wrapper: a caller this pass did not rewrite
      // passes no attributes and must render exactly what it did before.
      edits.push({
        file: receiverFile,
        start: parts.site.start,
        end: parts.site.end,
        text:
          `${attributesProp} === undefined ? (\n            ${prop}\n          ) : (\n` +
          `            <span {...${attributesProp}}>{${prop}}</span>\n          )`,
      });
    } else if (parts.site.wrapAt === null) {
      edits.push({
        file: receiverFile,
        start: parts.site.renderAt,
        end: parts.site.renderAt,
        text: ` {...${attributesProp}}`,
      });
    } else {
      // CONDITIONAL, because the prop is optional: a caller this pass did not
      // rewrite passes no attributes, and an unconditional wrapper gave those
      // pages a bare `<span>` they never had. 16 pages -- all the dynamic-route
      // ones, which are excluded from the contract and so never pass anything.
      edits.push({
        file: receiverFile,
        start: parts.site.wrapAt.start,
        end: parts.site.wrapAt.end,
        text:
          `{${attributesProp} === undefined ? (\n            ${prop}\n          ) : (\n` +
          `            <span {...${attributesProp}}>{${prop}}</span>\n          )}`,
      });
    }
    annotationTypeNeeded.add(receiverFile);
    filesTouched.add(receiverFile);
  };
  /**
   * Every receiver between the caller and the host element, outermost first.
   *
   * A value handed to a component is not always rendered by it: `FeatureRow`
   * puts its `eyebrow` inside `<Eyebrow>`, which puts ITS children inside a
   * span. Each link in that chain takes the annotation as a prop and passes it
   * on, so the annotation arrives at the element the reader actually sees.
   */
  const receiverChain = (
    startFile: string,
    component: string,
    prop: string,
  ): readonly ReceiverStep[] | string => {
    const steps: ReceiverStep[] = [];
    let file = startFile;
    let name = component;
    let current = prop;
    // A bound depth rather than a `seen` set: a component that renders itself
    // is a cycle either way, and four hops is already further than any of All
    // Points Media's primitives nest.
    for (let depth = 0; depth < 4; depth += 1) {
      const parts = receiverPartsOf(
        readSource(file),
        name,
        current,
        (element) => targets.get(`${file}@${element.pos}`) ?? null,
        readSource,
      );
      if (typeof parts === "string") return parts;
      steps.push({ file, component: name, prop: current, parts });
      // `host` and `wrapInPlace` are both ends of the line: one annotates an
      // element the receiver renders, the other wraps the read where it sits.
      if (parts.site.kind !== "forward") return steps;
      const next = targets.get(`${file}@${parts.site.elementPos}`);
      if (next === undefined)
        return `${name} forwards ${current} to an unresolved component`;
      file = next.module.file;
      name = next.name;
      current = parts.site.prop;
    }
    return "the value passes through too many components";
  };
  // Built per run, not at module scope: a `Set` up there would accumulate
  // across every planRewrite in the process and hand one site's files to the
  // next.
  const MANAGED_FIELDS: ThreadedProp = {
    prop: MANAGED_FIELDS_PROP,
    type: "ManagedFields",
    typeNeeded: managedFieldsTypeNeeded,
  };
  const MANAGED_ITEMS: ThreadedProp = {
    prop: MANAGED_ITEMS_PROP,
    type: "ManagedItems",
    typeNeeded: managedItemsTypeNeeded,
  };
  /**
   * Give every client component on a route the same prop, and pass it along.
   *
   * A client module cannot read the contract -- the package reaches for
   * `node:crypto` -- so whatever it needs arrives from the nearest server
   * component that renders it and is forwarded verbatim through any client
   * components in between. Two things travel this way and differ only in their
   * names and types, so the walk is written once: the field record, and the
   * per-item records a collection needs.
   */
  const threadProp = (
    spec: ThreadedProp,
    route: ValueRoute,
    parts: ClientComponentTarget,
    file: string,
  ): void => {
    // The component that renders the value and every one that forwards it are
    // found the same way, by walking up from the node, so a file holding
    // several components gives the prop to each that needs it and to no other.
    // Recorded rather than written, because a component can need MORE than one
    // of these: `NetworkExplorer` renders both its own text and a collection,
    // and a component with no parameter at all was given a whole parameter for
    // each -- `({ managedItems }: {…}{ managedFields }: {…})`, which does not
    // parse. The props one component needs are known only once every field has
    // been walked, so the parameter is emitted after the walk, like the call
    // sites already are.
    const carry = (target: ClientComponentTarget, path: string): void => {
      const needed = clientPropsByComponent.get(target.key) ?? {
        file: path,
        target,
        props: [],
      };
      if (needed.props.some((one) => one.prop === spec.prop)) return;
      needed.props.push(spec);
      clientPropsByComponent.set(target.key, needed);
      spec.typeNeeded.add(path);
      filesTouched.add(path);
    };
    // A client-to-client call forwards what it was given, verbatim: the record
    // is keyed by id and each component picks out its own.
    for (const site of route.forwards) {
      const callerFile = site.from.module.file;
      const callerSource = site.from.module.source;
      const forwardTarget = componentPartsAt(site.element, callerSource);
      if (forwardTarget === null) continue;
      carry(forwardTarget, callerFile);
      const opening = ts.isJsxElement(site.element)
        ? site.element.openingElement
        : site.element;
      const at = annotationInsertPoint(opening);
      const forwardKey = `${spec.prop}:${callerFile}@${at}`;
      if (forwarded.has(forwardKey)) continue;
      forwarded.add(forwardKey);
      edits.push({
        file: callerFile,
        start: at,
        end: at,
        text: ` ${spec.prop}={${spec.prop}}`,
      });
      filesTouched.add(callerFile);
    }
    carry(parts, file);
  };
  let refusing: FieldBinding | null = null;
  let refusingPage: PageBinding | null = null;
  const refuse = (why: string): void => {
    unhandled.set(why, (unhandled.get(why) ?? 0) + 1);
    if (refusing !== null && editable.has(refusing.fieldId)) unrewired += 1;
    if (refusing !== null) {
      refusals.push({
        why,
        fieldId: refusing.fieldId,
        name: refusing.name,
        file: refusing.candidate.location.file,
        line: refusing.candidate.location.line,
      });
      return;
    }
    if (refusingPage === null) return;
    refusals.push({
      why,
      fieldId: refusingPage.pageId,
      name: refusingPage.slug,
      file: refusingPage.file,
      line: 0,
    });
  };

  let unrewired = 0;
  for (const field of fields) {
    refusing = field;
    if (!editable.has(field.fieldId)) {
      refuse("not a customer-editable field in the contract");
      continue;
    }
    const file = field.candidate.location.file;
    let source = sources.get(file);
    if (source === undefined) {
      source = ts.createSourceFile(
        file,
        readFileSync(file, "utf8"),
        ts.ScriptTarget.Latest,
        true,
        ts.ScriptKind.TSX,
      );
      sources.set(file, source);
    }
    // Collections are handled BEFORE the client branch, because a collection
    // in a client module is not a value that branch can thread: every item
    // carries the same field ids, so one record keyed by field id holds only
    // one item. It needs its own prop, and this block knows how to build it.
    if (field.candidate.kind === "collection") {
      const expression = expressionAt(source, field.candidate.location.offset);
      const callback = expression === null ? null : mapCallbackOf(expression);
      if (expression === null || callback === null) {
        refuse(
          "collection is not rendered by a `.map()` with a named item parameter",
        );
        continue;
      }
      const collection = collectionFor(
        proposal.contract,
        field.sourcePath,
        field.pointer,
      );
      if (collection === null) {
        refuse("collection is not in the contract");
        continue;
      }
      const onClient = isClientModule(source);
      const annotate: RewriteEdit[] = [];
      let reads = 0;
      // A collection is rewritten whole or not at all. One item field left
      // unannotated is worse than none: the contract declares it editable and
      // the editor cannot find it, which reads as a broken field rather than
      // an unconverted one.
      let unusable = false;
      for (const [property, fieldId] of collection.fieldByProperty) {
        for (const read of itemPropertyReads(
          callback.callback,
          callback.item,
          property,
          source,
        )) {
          // The element the read sits in must be a host element, for the same
          // reason as everywhere else: an annotation on a component tag marks
          // the call site rather than the value. The span branch below needs it
          // too -- wrapping a component's child turns a string child into an
          // element, which a component is free to reject.
          if (
            !ts.isJsxElement(read.parent) ||
            !isHostTag(read.parent.openingElement.tagName.getText(source))
          ) {
            unusable = true;
            break;
          }
          const owner = read.parent;
          const indexName = callback.index ?? indexBindingFor(source);
          // A client module cannot call the runtime, so it reads the record its
          // server caller resolved. Same items, same index, different source.
          const call = onClient
            ? `${MANAGED_ITEMS_PROP}?.[${JSON.stringify(collection.id)}]?.[${indexName}]`
            : `managedItem(${JSON.stringify(collection.id)}, ${indexName})`;
          // The server reads through functions the runtime exposes; the client
          // reads a plain record, and keeps the ORIGINAL read as its fallback
          // so a caller this pass does not touch renders what it did before.
          const key = JSON.stringify(fieldId);
          // The expression INSIDE the braces. `read` is the whole
          // `{slide.title}`, which the server path replaces wholesale; a
          // fallback sits inside an expression, where braces are a syntax
          // error -- `?? {slide.title}` is what the parse guard caught.
          const original = read.expression?.getText(source) ?? null;
          if (original === null) {
            unusable = true;
            break;
          }
          const valueText = onClient
            ? `${call}?.[${key}]?.value ?? ${original}`
            : `${call}.value(${key})`;
          const attributesText = onClient
            ? `(${call}?.[${key}]?.attributes ?? {})`
            : `${call}.attributes(${key})`;
          if (isOnlyChild(owner, read)) {
            annotate.push({
              file,
              start: read.getStart(source),
              end: read.getEnd(),
              text: `{${valueText}}`,
            });
            annotate.push({
              file,
              start: annotationInsertPoint(owner.openingElement),
              end: annotationInsertPoint(owner.openingElement),
              text: ` {...${attributesText}}`,
            });
          } else {
            annotate.push({
              file,
              start: read.getStart(source),
              end: read.getEnd(),
              text: `<span {...${attributesText}}>{${valueText}}</span>`,
            });
          }
          reads += 1;
        }
      }
      if (unusable) {
        refuse("collection item value is rendered by a component");
        continue;
      }
      // On the client the items arrive as a prop from the nearest server
      // caller, exactly as a field record does -- the walk is the same, only
      // the name and the type differ.
      let itemsRoute: ValueRoute | null = null;
      if (onClient) {
        const holder = componentPartsAt(expression, source);
        const owning =
          holder === null
            ? null
            : declarationOf(proposal.callSites, file, holder.fn);
        itemsRoute =
          owning === null
            ? null
            : routeToServer(proposal.callSites, owning, readSource);
        if (holder === null || itemsRoute === null) {
          refuse(
            holder === null
              ? "client component has no function declaration to give a prop"
              : "client component has no server caller to resolve its items",
          );
          continue;
        }
        threadProp(MANAGED_ITEMS, itemsRoute, holder, file);
      }
      if (reads === 0) {
        refuse(
          "collection template reads no managed item property in child position",
        );
        continue;
      }
      // The callback needs the index the item ids are ordered by. Added only
      // when the template does not already take a second parameter, whose name
      // would then be used instead -- but none of All Points Media's do, and
      // taking someone else's parameter would be a silent rename.
      if (callback.index === null) {
        const parameter = callback.callback.parameters[0];
        if (parameter === undefined) {
          refuse("collection callback has no item parameter");
          continue;
        }
        edits.push({
          file,
          start: parameter.getEnd(),
          end: parameter.getEnd(),
          text: `, ${indexBindingFor(source)}`,
        });
      }
      edits.push(...annotate);
      for (const site of itemsRoute?.origins ?? []) {
        const opening = ts.isJsxElement(site.element)
          ? site.element.openingElement
          : site.element;
        const callerFile = site.from.module.file;
        const key = `${callerFile}:${opening.getStart(site.from.module.source)}`;
        const forSite = clientItemsBySite.get(key) ?? {
          file: callerFile,
          at: annotationInsertPoint(opening),
          collectionIds: [],
        };
        forSite.collectionIds.push(collection.id);
        clientItemsBySite.set(key, forSite);
        filesTouched.add(callerFile);
      }
      filesTouched.add(file);
      rewritten += 1;
      continue;
    }
    if (field.candidate.kind === "rich_text") {
      // A client module cannot call the runtime, and threading a rendered block
      // through props is a rewrite of its own that nothing here does yet.
      const rewrite = isClientModule(source)
        ? "client component holds a rich_text"
        : richTextRewrite(source, field.candidate, field.fieldId, isHostTag);
      if (typeof rewrite === "string") {
        refuse(rewrite);
        continue;
      }
      const key = `${file}:${rewrite.elementStart}`;
      if (annotated.has(key)) {
        refuse("formatted element already carries another field's annotation");
        continue;
      }
      annotated.add(key);
      edits.push({ file, start: rewrite.start, end: rewrite.end, text: rewrite.text });
      edits.push({
        file,
        start: rewrite.annotationAt,
        end: rewrite.annotationAt,
        text: rewrite.annotation,
      });
      filesTouched.add(file);
      rewritten += 1;
      continue;
    }
    if (isClientModule(source)) {
      // The value cannot read the contract here -- this module is bundled for
      // the browser and the contract package reads `node:crypto` -- so it is
      // threaded IN from the SERVER callers, keyed by field id, with the
      // original literal as the fallback so a caller this pass does not touch
      // renders exactly what it did before.
      // Two shapes reach here, and they differ only in what the ORIGINAL was:
      // a text run, whose fallback is the literal, and an expression child --
      // `<p>{networkScale.line}</p>` -- whose fallback is the expression that
      // is already there. Handling only the first left a value dark for being
      // read through a constant rather than typed in place.
      const expression = expressionAt(source, field.candidate.location.offset);
      const expressionOwner =
        expression !== null &&
        ts.isJsxElement(expression.parent) &&
        isHostTag(expression.parent.openingElement.tagName.getText(source))
          ? expression.parent
          : null;
      const element =
        expression === null
          ? elementAt(source, field.candidate.location.offset)
          : (expressionOwner?.openingElement ?? null);
      const parts = element === null ? null : componentPartsAt(element, source);
      const owner = element === null ? null : (element.parent as ts.Node);
      const placement =
        expression !== null && expressionOwner !== null
          ? {
              start: expression.getStart(source),
              end: expression.getEnd(),
              alone: isOnlyChild(expressionOwner, expression),
            }
          : owner !== null && ts.isJsxElement(owner)
            ? valuePlacementOf(owner)
            : null;
      if (parts === null || element === null || placement === null) {
        refuse(
          expression !== null && expressionOwner === null
            ? // The value is rendered by another COMPONENT, which puts it
              // somewhere this does not see. Annotating the call site would
              // mark the wrapper and the editor would never find the value;
              // the server path threads the annotation through the receiver
              // instead, and doing that from a client component needs the
              // record it is given rather than a runtime call.
              "client component hands its value to another component"
            : element === null || placement === null
              ? "client component's value is not a single text run"
              : "client component has no function declaration to give a prop",
        );
        continue;
      }
      const owning = declarationOf(proposal.callSites, file, parts.fn);
      const route =
        owning === null
          ? null
          : routeToServer(proposal.callSites, owning, readSource);
      if (route === null) {
        refuse(
          owning === null
            ? "client component's declaration could not be identified"
            : "client component has no server caller to resolve the value",
        );
        continue;
      }
      // The original literal, kept as the fallback. Only a text candidate has
      // one, which is also the only kind this path handles.
      if (
        field.candidate.kind !== "plain_text" &&
        field.candidate.kind !== "heading_text"
      ) {
        refuse(`client component holds a ${field.candidate.kind}`);
        continue;
      }
      // What renders when no caller passes anything: the expression that is
      // already written, or the literal that was.
      const fallback =
        expression === null
          ? JSON.stringify(field.candidate.value)
          : (expression.expression?.getText(source) ??
            JSON.stringify(field.candidate.value));
      const access = `${MANAGED_FIELDS_PROP}?.[${JSON.stringify(field.fieldId)}]`;
      if (placement.alone) {
        edits.push({
          file,
          start: placement.start,
          end: placement.end,
          text: `{${access}?.value ?? ${fallback}}`,
        });
        const annotationKey = `${file}:${element.getStart(source)}`;
        if (!annotated.has(annotationKey)) {
          annotated.add(annotationKey);
          edits.push({
            file,
            start: annotationInsertPoint(element),
            end: annotationInsertPoint(element),
            text: ` {...(${access}?.attributes ?? {})}`,
          });
        }
      } else {
        // The value shares its element, so it gets its own span -- and the
        // span is CONDITIONAL, because a caller that passes nothing must render
        // the original text with no wrapper it never had.
        edits.push({
          file,
          start: placement.start,
          end: placement.end,
          text:
            `{${access} === undefined ? (\n        ${fallback}\n      ) : (\n` +
            `        <span {...${access}.attributes}>{${access}.value}</span>\n      )}`,
        });
      }
      threadProp(MANAGED_FIELDS, route, parts, file);
      // Every caller passes it, and the ids accumulate per caller element so
      // one component with three values gets one prop with three entries.
      for (const site of route.origins) {
        const opening = ts.isJsxElement(site.element)
          ? site.element.openingElement
          : site.element;
        const callerFile = site.from.module.file;
        const key = `${callerFile}:${opening.getStart(site.from.module.source)}`;
        const forSite = clientFieldsBySite.get(key) ?? {
          file: callerFile,
          at: annotationInsertPoint(opening),
          fieldIds: [],
        };
        forSite.fieldIds.push(field.fieldId);
        clientFieldsBySite.set(key, forSite);
        filesTouched.add(callerFile);
      }
      filesTouched.add(file);
      rewritten += 1;
      continue;
    }
    if (
      field.candidate.kind !== "plain_text" &&
      field.candidate.kind !== "heading_text"
    ) {
      refuse(`kind ${field.candidate.kind}`);
      continue;
    }
    // A declared value read through an expression child: `{networkScale.line}`.
    // The expression is replaced wholesale, and the same annotation invariant
    // applies -- the element carries it only when it renders nothing else.
    const expression = expressionAt(source, field.candidate.location.offset);
    if (expression !== null) {
      const owner = ts.isJsxElement(expression.parent)
        ? expression.parent
        : null;
      if (owner === null) {
        refuse("expression child is not inside an element");
        continue;
      }
      const tag = owner.openingElement.tagName.getText(source);
      if (!isHostTag(tag)) {
        // A component renders the value as its `children`, so the annotation
        // belongs on whatever host element THAT component wraps them in --
        // annotating the call site would mark the caller. It is the same
        // two-sided rewrite as a named prop, with `children` as the name.
        const target = targets.get(`${file}@${owner.pos}`);
        if (target === undefined) {
          refuse("expression child is rendered by an unresolved component");
          continue;
        }
        const chain = receiverChain(
          target.module.file,
          target.name,
          CHILDREN_PROP,
        );
        if (typeof chain === "string") {
          refuse(chain);
          continue;
        }
        for (const step of chain) {
          editReceiver(step.file, step.component, step.prop, step.parts);
        }
        edits.push({
          file,
          start: expression.getStart(source),
          end: expression.getEnd(),
          text: `{${callFor(field.fieldId)}.value}`,
        });
        const at = annotationInsertPoint(owner.openingElement);
        edits.push({
          file,
          start: at,
          end: at,
          text: ` ${CHILDREN_PROP}Attributes={${callFor(field.fieldId)}.attributes}`,
        });
        filesTouched.add(file);
        rewritten += 1;
        continue;
      }
      if (isOnlyChild(owner, expression)) {
        edits.push({
          file,
          start: expression.getStart(source),
          end: expression.getEnd(),
          text: `{${callFor(field.fieldId)}.value}`,
        });
        const key = `${file}:${owner.openingElement.getStart(source)}`;
        if (!annotated.has(key)) {
          annotated.add(key);
          edits.push({
            file,
            start: annotationInsertPoint(owner.openingElement),
            end: annotationInsertPoint(owner.openingElement),
            text: ` {...${callFor(field.fieldId)}.attributes}`,
          });
        }
      } else {
        edits.push({
          file,
          start: expression.getStart(source),
          end: expression.getEnd(),
          text:
            `<span {...${callFor(field.fieldId)}.attributes}>` +
            `{${callFor(field.fieldId)}.value}</span>`,
        });
      }
      filesTouched.add(file);
      rewritten += 1;
      continue;
    }

    const attribute = attributeAt(source, field.candidate.location.offset);
    const element =
      attribute === null
        ? elementAt(source, field.candidate.location.offset)
        : owningElement(attribute);
    if (element === null) {
      refuse("no JSX element or attribute at the recorded offset");
      continue;
    }
    const tag = element.tagName.getText(source);
    if (!isHostTag(tag)) {
      // A component receives the value as a PROP, and the annotation has to
      // land on the element the RECEIVER renders it in — annotating the call
      // site would mark the caller and the editor would highlight the wrong
      // thing. So both sides are rewritten, or neither.
      const receiver =
        field.candidate.kind === "plain_text"
          ? field.candidate.receiver
          : undefined;
      if (receiver === undefined || attribute === null) {
        refuse("rendered by a component with no recorded receiver");
        continue;
      }
      const initializer = attribute.initializer;
      if (initializer === undefined || !ts.isStringLiteral(initializer)) {
        refuse("component prop is not a plain string literal");
        continue;
      }
      // A client RECEIVER is fine. It never calls the runtime -- it takes the
      // attributes as a prop and spreads them -- and the only thing it names
      // is the TYPE, imported with `import type` and erased at build. The
      // server-only constraint applies to code that CALLS `managedText`.
      const chain = receiverChain(
        receiver.file,
        receiver.component,
        receiver.prop,
      );
      if (typeof chain === "string") {
        refuse(chain);
        continue;
      }
      for (const step of chain) {
        editReceiver(step.file, step.component, step.prop, step.parts);
      }
      const attributesProp = `${receiver.prop}Attributes`;
      // The call site: the value comes from the contract, and the annotation
      // travels with it as its own prop.
      edits.push({
        file,
        start: initializer.getStart(source),
        end: initializer.getEnd(),
        text: `{${callFor(field.fieldId)}.value}`,
      });
      edits.push({
        file,
        start: attribute.getEnd(),
        end: attribute.getEnd(),
        text: ` ${attributesProp}={${callFor(field.fieldId)}.attributes}`,
      });
      filesTouched.add(file);
      rewritten += 1;
      continue;
    }

    if (attribute !== null) {
      const initializer = attribute.initializer;
      if (initializer === undefined || !ts.isStringLiteral(initializer)) {
        refuse("attribute value is not a plain string literal");
        continue;
      }
      edits.push({
        file,
        start: initializer.getStart(source),
        end: initializer.getEnd(),
        text: `{${callFor(field.fieldId)}.value}`,
      });
    } else {
      const owner = ts.isJsxElement(element.parent) ? element.parent : null;
      const placement = owner === null ? null : valuePlacementOf(owner);
      if (placement === null) {
        refuse("value is split across text nodes by other children");
        continue;
      }
      if (placement.alone) {
        edits.push({
          file,
          start: placement.start,
          end: placement.end,
          text: `{${callFor(field.fieldId)}.value}`,
        });
      } else {
        // The element holds more than this value, so the annotation gets its
        // own `<span>`: the editor replaces an annotated element's whole
        // textContent, and it must not be allowed to reach the siblings.
        edits.push({
          file,
          start: placement.start,
          end: placement.end,
          text:
            `<span {...${callFor(field.fieldId)}.attributes}>` +
            `{${callFor(field.fieldId)}.value}</span>`,
        });
        filesTouched.add(file);
        rewritten += 1;
        // The wrapper carries the annotation, so the element must NOT also.
        continue;
      }
    }

    // One annotation per element, however many of its values are managed: a
    // second spread of the same attribute would be written twice into the DOM.
    const key = `${file}:${element.getStart(source)}`;
    if (!annotated.has(key)) {
      annotated.add(key);
      edits.push({
        file,
        start: annotationInsertPoint(element),
        end: annotationInsertPoint(element),
        text: ` {...${callFor(field.fieldId)}.attributes}`,
      });
    }
    filesTouched.add(file);
    rewritten += 1;
  }

  // One `managedFields` attribute per caller element, carrying every field the
  // client component needs. Emitted after the loop so a component with three
  // values produces one prop with three entries rather than three props.
  for (const site of clientFieldsBySite.values()) {
    const entries = [...new Set(site.fieldIds)]
      .map((fieldId) => JSON.stringify(fieldId))
      .join(", ");
    edits.push({
      file: site.file,
      start: site.at,
      end: site.at,
      text: ` ${MANAGED_FIELDS_PROP}={managedFieldsFor([${entries}])}`,
    });
  }
  // Every client component's parameter, once its whole set of props is known.
  for (const needed of clientPropsByComponent.values()) {
    const { file, target, props } = needed;
    if (target.kind === "create") {
      edits.push({
        file,
        start: target.at,
        end: target.at,
        text:
          `{ ${props.map((one) => one.prop).join(", ")} }: { ` +
          `${props.map((one) => `${one.prop}?: ${one.type}`).join("; ")} }`,
      });
      continue;
    }
    const missing = props.filter((one) => !target.has(one.prop));
    if (missing.length === 0) continue;
    edits.push({
      file,
      start: target.destructureAt,
      end: target.destructureAt,
      text: missing.map((one) => `, ${one.prop}`).join(""),
    });
    edits.push({
      file,
      start: target.typeAt,
      end: target.typeAt,
      text: missing.map((one) => `\n  ${one.prop}?: ${one.type};`).join(""),
    });
  }
  // The same for a client component's collections, accumulated per caller
  // element so one component rendering two of them gets one prop with two.
  for (const site of clientItemsBySite.values()) {
    const entries = [...new Set(site.collectionIds)]
      .map((collectionId) => JSON.stringify(collectionId))
      .join(", ");
    edits.push({
      file: site.file,
      start: site.at,
      end: site.at,
      text: ` ${MANAGED_ITEMS_PROP}={managedItemsFor([${entries}])}`,
    });
  }
  // The page ROOT, once per route. Every All Points Media page returns a
  // fragment, which cannot carry attributes, so the annotation goes on a
  // wrapper -- `display: contents`, which is the pattern the starter uses at
  // `src/app/page.tsx` and is layout-neutral. It IS a DOM addition, and the
  // rendered-markup gate reports it rather than hiding it.
  for (const page of proposal.pages) {
    // An internal screen offers none of its own words, so the wrapper would be
    // a DOM change on a route the editor is never pointed at. Its call sites
    // are still threaded where it shares a client component with a public
    // page; only the root annotation is skipped.
    if (!page.ownsContent) continue;
    // A page-level refusal is not about any field. Left pointing at the last
    // one processed, it named a heading on a different route entirely.
    refusing = null;
    refusingPage = page;
    const source = readSource(page.file);
    const root = pageRootOf(source);
    if (root === null) {
      refuse("no page root to annotate");
      continue;
    }
    const call = `managedPage(${JSON.stringify(page.pageId)})`;
    const open = `<div className="contents" {...${call}}>`;
    if (ts.isJsxFragment(root)) {
      // REPLACE the fragment rather than wrap it. A fragment exists only
      // because the page had nothing to hang attributes on, so once there is a
      // div the fragment is redundant -- and `<div …><>` is a shape SWC
      // rejects outright, which is how the build said so.
      edits.push({
        file: page.file,
        start: root.openingFragment.getStart(source),
        end: root.openingFragment.getEnd(),
        text: open,
      });
      edits.push({
        file: page.file,
        start: root.closingFragment.getStart(source),
        end: root.closingFragment.getEnd(),
        text: `</div>`,
      });
    } else {
      edits.push({
        file: page.file,
        start: root.getStart(source),
        end: root.getStart(source),
        text: open,
      });
      edits.push({
        file: page.file,
        start: root.getEnd(),
        end: root.getEnd(),
        text: `</div>`,
      });
    }
    filesTouched.add(page.file);
    pagesAnnotated += 1;
  }
  void runtimeSpecifier;
  return {
    edits,
    rewritten,
    pagesAnnotated,
    unhandled,
    refusals,
    unrewired,
    filesTouched,
    annotationTypeNeeded,
    managedFieldsTypeNeeded,
    managedItemsTypeNeeded,
  };
}

/**
 * Applies a plan to the repository.
 *
 * Edits go in BACK TO FRONT: every offset was recorded against the original
 * text, so an earlier edit must not move a later one.
 */
/**
 * Where a new import goes: after every import already in the file.
 *
 * Asked of the PARSER rather than of the text. The last line starting with
 * `import` is not the last line of an import -- a multi-line one has exactly
 * one such line, its first -- so splicing after it put the new import between
 * `import {` and its own specifiers, and the file stopped parsing. Prettier
 * writes that shape as soon as a list is long enough.
 *
 * With no imports at all the answer is after any leading directive, because
 * `"use client"` must stay the first statement in the file.
 */
function importInsertPoint(text: string): number {
  const source = ts.createSourceFile(
    "insert.tsx",
    text,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  let at = 0;
  for (const statement of source.statements) {
    if (ts.isImportDeclaration(statement)) {
      at = statement.getEnd();
      continue;
    }
    if (
      ts.isExpressionStatement(statement) &&
      ts.isStringLiteral(statement.expression)
    ) {
      at = statement.getEnd();
      continue;
    }
    break;
  }
  return at;
}

/** `text` with `line` inserted as its own line after the existing imports. */
function withImport(text: string, line: string): string {
  const at = importInsertPoint(text);
  // At the very top there is nothing to follow, so the import takes its own
  // line ahead of what was there rather than running into it.
  if (at === 0) return `${line}\n${text}`;
  return `${text.slice(0, at)}\n${line}${text.slice(at)}`;
}

/**
 * Every import of `specifier` in the file, in source order.
 *
 * ALL of them, because a module path can be imported more than once and the
 * answer differs per declaration: a file holding both
 * `import type { ManagedFields }` and `import { managedText }` from the runtime
 * gives one answer at its first declaration and another at its second. Reading
 * only the first treated the type-only one as the whole story, discarded it as
 * unusable for a value, and inserted a second value import of a name already
 * imported.
 */
interface ExistingImport {
  /** Names this clause binds as VALUES, which a generated call can use. */
  readonly values: ReadonlySet<string>;
  /**
   * Names it binds as types only.
   *
   * Two spellings say this and reading only the first missed the second:
   * `import type { x }` marks the whole clause, and `import { type x, y }`
   * marks one specifier inside an otherwise ordinary import. Both are erased,
   * so both leave a generated call unbound.
   */
  readonly types: ReadonlySet<string>;
  /** Where another name is appended, after the last one in this clause. */
  readonly at: number;
  readonly typeOnly: boolean;
}

function importsFrom(
  text: string,
  specifier: string,
): readonly ExistingImport[] {
  const source = ts.createSourceFile(
    "imports.tsx",
    text,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const found: ExistingImport[] = [];
  for (const statement of source.statements) {
    if (
      !ts.isImportDeclaration(statement) ||
      !ts.isStringLiteral(statement.moduleSpecifier) ||
      statement.moduleSpecifier.text !== specifier
    ) {
      continue;
    }
    const bindings = statement.importClause?.namedBindings;
    // A default or namespace import binds no names this rewrite can extend, so
    // it is recorded as holding none rather than skipped: it still must not be
    // appended to.
    if (bindings === undefined || !ts.isNamedImports(bindings)) continue;
    const typeOnly = statement.importClause?.isTypeOnly === true;
    const values = new Set<string>();
    const types = new Set<string>();
    for (const element of bindings.elements) {
      (typeOnly || element.isTypeOnly ? types : values).add(element.name.text);
    }
    found.push({
      values,
      types,
      at: bindings.elements.at(-1)?.getEnd() ?? bindings.getEnd(),
      typeOnly,
    });
  }
  return found;
}

/**
 * `text` importing every name in `names` from `specifier`.
 *
 * Names already imported anywhere in the file are left alone, missing ones are
 * appended to a clause that can carry them, and a file with nowhere to put them
 * gets a whole import.
 *
 * `kind` is one-directional: a TYPE may be added to a value import, but a VALUE
 * added to an `import type` is erased with the clause, so the file compiles and
 * then calls a name that is not there.
 */
function withImportedNames(
  text: string,
  specifier: string,
  names: readonly string[],
  kind: "value" | "type",
): string {
  const existing = importsFrom(text, specifier);
  // A type-only binding does not supply a VALUE, so it cannot count as already
  // imported for one: the clause is erased and the call is left without a
  // binding. It does count for a type, which a value import also satisfies.
  const already = new Set(
    existing.flatMap((one) =>
      kind === "value" ? [...one.values] : [...one.values, ...one.types],
    ),
  );
  const missing = names.filter((name) => !already.has(name));
  // ...and the value cannot simply be imported alongside it either. TypeScript
  // reports `Duplicate identifier` for a name bound by both an `import type`
  // and an import, so writing one would trade a silent runtime failure for a
  // compile error. The file is refused instead: the existing import is the
  // customer's code and reinterpreting it is not this tool's call.
  if (kind === "value") {
    const shadowed = missing.filter((name) =>
      existing.some((one) => one.types.has(name)),
    );
    if (shadowed.length > 0) {
      throw new Error(
        `rewrite needs ${shadowed.join(", ")} as a value, but this file imports ` +
          `${shadowed.length === 1 ? "it" : "them"} as a TYPE from ` +
          `${specifier}. Both bindings cannot coexist, so nothing was written.`,
      );
    }
  }
  if (missing.length === 0) return text;
  const target =
    kind === "value"
      ? existing.find((one) => !one.typeOnly)
      : (existing.find((one) => !one.typeOnly) ?? existing[0]);
  if (target === undefined) {
    const prefix = kind === "type" ? "import type" : "import";
    return withImport(
      text,
      `${prefix} { ${missing.join(", ")} } from ${JSON.stringify(specifier)};`,
    );
  }
  return `${text.slice(0, target.at)}, ${missing.join(", ")}${text.slice(target.at)}`;
}

export function applyRewrite(
  plan: RewritePlan,
  runtimeSpecifier: string,
): void {
  // Grouped by the file each path RESOLVES to, not by the path as written. A
  // page's module and a value's module reach here spelled differently when the
  // repository sits under a symlink -- macOS puts every temporary directory
  // under one -- and the same file was then read, edited and written twice,
  // the second pass applying offsets taken from text the first had already
  // changed. It wrote an opening `<div>` into the middle of an import.
  const byFile = new Map<string, RewriteEdit[]>();
  for (const edit of plan.edits) {
    const file = realPathOf(edit.file);
    byFile.set(file, [...(byFile.get(file) ?? []), edit]);
  }
  const needsType = (paths: ReadonlySet<string>, file: string): boolean =>
    [...paths].some((path) => realPathOf(path) === file);
  // Every file is transformed and checked BEFORE any of them is written. The
  // rewrite refuses rather than writes something broken, and a refusal raised
  // while walking the files had already changed the ones before it: the site
  // was left importing a contract and a runtime that the aborted run never
  // wrote. Staging makes the refusal mean what it says.
  const staged = new Map<string, string>();
  for (const [file, edits] of byFile) {
    let text = readFileSync(file, "utf8");
    for (const edit of [...edits].sort(
      (a, b) => b.start - a.start || b.end - a.end,
    )) {
      text = text.slice(0, edit.start) + edit.text + text.slice(edit.end);
    }
    // A receiver names the annotation TYPE in its props, so it needs that
    // import even when it never calls `managedText`.
    // Test for the IMPORT, not the identifier: the edits above have already
    // inserted `leadAttributes?: ManagedSiteFieldAttributesV1`, so looking for
    // the name always found it and the import was never added.
    // Test for the IMPORT, not the identifier -- the same mistake as the
    // annotation type, made twice: the edits above have already written
    // `managedFields?: ManagedFields`, so looking for the name always finds it
    // and the import is never added.
    // Both runtime types come from the same module, so they are asked for
    // together: two separate calls would write two type imports of one module.
    const runtimeTypes = [
      ...(needsType(plan.managedFieldsTypeNeeded, file)
        ? ["ManagedFields"]
        : []),
      ...(needsType(plan.managedItemsTypeNeeded, file) ? ["ManagedItems"] : []),
    ];
    if (runtimeTypes.length > 0) {
      text = withImportedNames(text, runtimeSpecifier, runtimeTypes, "type");
    }
    if (needsType(plan.annotationTypeNeeded, file)) {
      text = withImportedNames(
        text,
        CONTRACT_PACKAGE,
        ["ManagedSiteFieldAttributesV1"],
        "type",
      );
    }
    // Only the names the file actually calls, and only the ones it does not
    // already import. Importing the set wholesale made every rewritten file
    // name four functions to use one, and suppressing on the module path alone
    // left a file that already imported `managedText` without the `managedPage`
    // it had just been given.
    const called = RUNTIME_EXPORTS.filter((name) => text.includes(`${name}(`));
    if (called.length > 0) {
      text = withImportedNames(text, runtimeSpecifier, called, "value");
    }
    // Parse what is about to be written. Every corruption this rewrite has
    // produced -- a tag renamed by a missing space, a redundant fragment inside
    // a new div, an opening `<div>` spliced into an import -- was a file that
    // no longer parsed, and each was found by a `next build` pointing a dozen
    // lines away from the cause. The parser is right here and knows exactly
    // where it is, so a bad edit stops at the file it damaged instead of
    // reaching the customer's repository.
    const broken = parseErrorsOf(file, text);
    if (broken.length > 0) {
      throw new Error(
        `rewrite would not parse: ${file}\n  ${broken.slice(0, 3).join("\n  ")}`,
      );
    }
    staged.set(file, text);
  }
  for (const [file, text] of staged) writeFileSync(file, text, "utf8");
}

/** What the parser objects to in `text`, as messages. */
export function parseErrorsOf(file: string, text: string): readonly string[] {
  const parsed = ts.createSourceFile(
    file,
    text,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const diagnostics =
    (parsed as unknown as { parseDiagnostics?: readonly ts.Diagnostic[] })
      .parseDiagnostics ?? [];
  return diagnostics.map((diagnostic) => {
    const { line } = parsed.getLineAndCharacterOfPosition(
      diagnostic.start ?? 0,
    );
    return `${String(line + 1)}: ${ts.flattenDiagnosticMessageText(diagnostic.messageText, " ")}`;
  });
}

/**
 * The component declaration a receiver names, and the parts a rewrite edits.
 *
 * Three things have to be found, and any one of them missing means the pair is
 * refused rather than half-edited: where to destructure the new prop, where to
 * declare its type, and the element that renders the value — which is what the
 * annotation has to land on, because annotating the CALL SITE would mark the
 * caller and the editor would highlight the wrong thing.
 */
/**
 * Where a receiver puts the value, and so where its annotation goes.
 *
 * `host` is the end of the line: the element is real markup and carries the
 * annotation. `forward` is one more component in the way -- `<Eyebrow>{eyebrow}</Eyebrow>`
 * -- and the annotation is handed on as that component's `childrenAttributes`,
 * which is the same edit the caller side makes, one level in.
 */
type ReceiverSite =
  | {
      readonly kind: "host";
      readonly renderAt: number;
      /** Set when the value shares its element and needs a span of its own. */
      readonly wrapAt: { readonly start: number; readonly end: number } | null;
    }
  | {
      readonly kind: "forward";
      readonly at: number;
      readonly elementPos: number;
      /** The prop the value arrives under in the component being forwarded to. */
      readonly prop: string;
    }
  /**
   * The value is read inside ANOTHER component's prop, and that prop takes a
   * node: `<TextReveal lines={[title]} />`. Nothing downstream has to change --
   * the wrapper IS the node the receiver renders -- so the annotation goes
   * around the read, in place.
   */
  | {
      readonly kind: "wrapInPlace";
      readonly start: number;
      readonly end: number;
    };

interface ReceiverStep {
  readonly file: string;
  readonly component: string;
  readonly prop: string;
  readonly parts: ReceiverParts;
}

interface ReceiverParts {
  readonly destructureAt: number;
  readonly typeAt: number;
  readonly site: ReceiverSite;
}

/** The prop object pattern and its inline type, from a component's first parameter. */
function propsParameterOf(
  fn: ts.FunctionDeclaration | ts.FunctionExpression | ts.ArrowFunction,
): { pattern: ts.ObjectBindingPattern; type: ts.TypeLiteralNode } | null {
  const parameter = fn.parameters[0];
  if (parameter === undefined || !ts.isObjectBindingPattern(parameter.name))
    return null;
  const type = parameter.type;
  // An interface or type alias would have to be found and edited in whatever
  // module declares it. Refused rather than followed, because a shared type is
  // shared with components this rewrite is not touching.
  if (type === undefined || !ts.isTypeLiteralNode(type)) return null;
  return { pattern: parameter.name, type };
}

/**
 * The HOST element that renders `{prop}` as its only child.
 *
 * `<h2 …>{title}</h2>` is the shape this handles, and it is the shape all five
 * of All Points Media's receivers use. An element mixing the value with other
 * children has no single place the annotation belongs, and a component tag
 * would put it on something that renders the value somewhere else again.
 */
/**
 * Whether a prop of `target` takes something React can render.
 *
 * Read off the declared type rather than inferred, because the question is
 * exactly what the author WROTE it accepts: a `string` prop must keep getting a
 * string, and `aria-label` is the case that makes this a guard rather than a
 * formality -- wrapping a value read there would put an element where the DOM
 * needs text.
 */
function propTakesNode(
  target: ComponentDeclaration,
  prop: string,
  read: (path: string) => ts.SourceFile,
): boolean {
  const source = read(target.module.file);
  for (const statement of source.statements) {
    if (
      !ts.isFunctionDeclaration(statement) ||
      statement.name?.text !== target.name
    )
      continue;
    const props = propsParameterOf(statement);
    if (props === null) return false;
    for (const member of props.type.members) {
      if (
        !ts.isPropertySignature(member) ||
        member.name === undefined ||
        member.name.getText(source) !== prop ||
        member.type === undefined
      )
        continue;
      return /\b(?:ReactNode|ReactElement|JSX\.Element)\b/u.test(
        member.type.getText(source),
      );
    }
    return false;
  }
  return false;
}

function soleRenderSiteOf(
  fn: ts.FunctionLikeDeclaration,
  prop: string,
  source: ts.SourceFile,
  resolve: (element: ts.Node) => ComponentDeclaration | null,
  read: (path: string) => ts.SourceFile,
): ReceiverSite | null {
  let found: ReceiverSite | null = null;
  const visit = (node: ts.Node): void => {
    if (found !== null) return;
    if (ts.isJsxElement(node)) {
      const tag = node.openingElement.tagName.getText(source);
      const children = node.children.filter(
        (child) =>
          !(ts.isJsxText(child) && child.containsOnlyTriviaWhiteSpaces),
      );
      const rendersProp = (child: ts.JsxChild): boolean =>
        ts.isJsxExpression(child) &&
        child.expression !== undefined &&
        ts.isIdentifier(child.expression) &&
        child.expression.text === prop;
      const mine = children.find(rendersProp);
      if (mine !== undefined) {
        if (!isHostTag(tag)) {
          // Another component in the way. It renders the value as ITS children,
          // so the annotation is forwarded rather than placed here.
          found = {
            kind: "forward",
            at: annotationInsertPoint(node.openingElement),
            elementPos: node.pos,
            prop: CHILDREN_PROP,
          };
          return;
        }
        // Alone in its element: the element carries the annotation. Sharing
        // with siblings: the value gets its own span, for the same reason as
        // on the caller side -- the editor replaces an annotated element's
        // whole textContent.
        found = {
          kind: "host",
          renderAt: node.openingElement.attributes.getStart(source),
          wrapAt:
            children.length === 1
              ? null
              : { start: mine.getStart(source), end: mine.getEnd() },
        };
        return;
      }
    }
    ts.forEachChild(node, visit);
  };
  if (fn.body !== undefined) visit(fn.body);
  if (found !== null || fn.body === undefined) return found;
  // Nothing renders the prop directly. It may still be READ inside another
  // component's prop, which is how All Points Media's headings reach the page:
  // `<TextReveal lines={[title]} />`, and `lines={[<>{title}</>]}` a level in.
  const wrapped = (node: ts.Node): ReceiverSite | null => {
    if (ts.isIdentifier(node) && node.text === prop && !isWriteTarget(node)) {
      const attribute = enclosingAttributeOf(node);
      if (attribute !== null) {
        const owner = attribute.parent.parent;
        const element = ts.isJsxOpeningElement(owner) ? owner.parent : owner;
        const target = resolve(element);
        const attributeName = attribute.name.getText(source);
        if (target !== null && propTakesNode(target, attributeName, read)) {
          return {
            kind: "wrapInPlace",
            start: node.getStart(source),
            end: node.getEnd(),
          };
        }
        // The prop takes text, so the value cannot be wrapped here -- but if it
        // is handed on WHOLE, the component it reaches renders it somewhere,
        // and the annotation travels with it under that component's name for
        // the prop. `<ImageReveal caption={caption} />` is the shape.
        const initializer = attribute.initializer;
        if (
          target !== null &&
          initializer !== undefined &&
          ts.isJsxExpression(initializer) &&
          initializer.expression === node
        ) {
          const opening = ts.isJsxElement(element)
            ? element.openingElement
            : (element as ts.JsxSelfClosingElement);
          return {
            kind: "forward",
            at: annotationInsertPoint(opening),
            elementPos: element.pos,
            prop: attributeName,
          };
        }
      }
    }
    return ts.forEachChild(node, wrapped) ?? null;
  };
  return wrapped(fn.body);
}

/** The JSX attribute whose value `node` is read inside, if any. */
function enclosingAttributeOf(node: ts.Node): ts.JsxAttribute | null {
  let current: ts.Node | undefined = node.parent;
  while (current !== undefined) {
    if (ts.isJsxAttribute(current)) return current;
    if (ts.isFunctionLike(current) || ts.isJsxElement(current)) return null;
    current = current.parent;
  }
  return null;
}

function receiverPartsOf(
  source: ts.SourceFile,
  component: string,
  prop: string,
  resolve: (element: ts.Node) => ComponentDeclaration | null,
  read: (path: string) => ts.SourceFile,
): ReceiverParts | string {
  for (const statement of source.statements) {
    if (
      !ts.isFunctionDeclaration(statement) ||
      statement.name?.text !== component
    )
      continue;
    const props = propsParameterOf(statement);
    if (props === null)
      return "receiver's props are not an inline type literal";
    // The prop must already be destructured: the value arrives under this name
    // today, and adding a name the component never reads would annotate
    // nothing.
    const named = props.pattern.elements.some(
      (element) => ts.isIdentifier(element.name) && element.name.text === prop,
    );
    if (!named) return `receiver does not destructure ${prop}`;
    // The attributes prop is a name this rewrite adds. A receiver that already
    // declares it would get a second destructuring of the same name, which does
    // not compile, and its own prop would be overwritten if it did.
    const attributesProp = `${prop}Attributes`;
    if (
      props.pattern.elements.some(
        (element) =>
          ts.isIdentifier(element.name) && element.name.text === attributesProp,
      )
    ) {
      return `receiver already declares ${attributesProp}`;
    }
    const site = soleRenderSiteOf(statement, prop, source, resolve, read);
    if (site === null) return `receiver does not render ${prop}`;
    // After the LAST element, not before the closing brace: a pattern ending
    // `video,` already has its comma, and inserting `, leadAttributes` before
    // the brace produced `video,\n, leadAttributes` and a syntax error. Anchoring
    // on the last element is trailing-comma-agnostic.
    const lastElement = props.pattern.elements.at(-1);
    const lastMember = props.type.members.at(-1);
    if (lastElement === undefined || lastMember === undefined)
      return "receiver has no props to extend";
    return {
      destructureAt: lastElement.getEnd(),
      typeAt: lastMember.getEnd(),
      site,
    };
  }
  return `no function declaration named ${component}`;
}

/**
 * The `.map()` callback a collection is rendered by, and the item binding name.
 *
 * A collection candidate is located at the expression child holding the call,
 * so the callback is one step in. Anything but a single arrow or function
 * expression taking a named item parameter is refused: the rewrite has to know
 * what the template calls each item to find its property reads.
 */
function mapCallbackOf(expression: ts.JsxExpression): {
  readonly callback: ts.ArrowFunction | ts.FunctionExpression;
  readonly item: string;
  /** The template's OWN index parameter, when it already takes one. */
  readonly index: string | null;
} | null {
  const call = expression.expression;
  if (call === undefined || !ts.isCallExpression(call)) return null;
  const first = call.arguments[0];
  if (first === undefined) return null;
  if (!ts.isArrowFunction(first) && !ts.isFunctionExpression(first))
    return null;
  const parameter = first.parameters[0];
  if (parameter === undefined || !ts.isIdentifier(parameter.name)) return null;
  const second = first.parameters[1];
  // Use the template's own index when it has one. Six of All Points Media's
  // collections already write `.map((item, i) =>`, and refusing them to avoid
  // introducing a name was refusing the ones that needed no name at all.
  const index =
    second !== undefined && ts.isIdentifier(second.name)
      ? second.name.text
      : null;
  if (second !== undefined && index === null) return null;
  return { callback: first, item: parameter.name.text, index };
}

/** Every `<item>.<property>` read in child position inside the callback. */
function itemPropertyReads(
  callback: ts.ArrowFunction | ts.FunctionExpression,
  item: string,
  property: string,
  source: ts.SourceFile,
): readonly ts.JsxExpression[] {
  const reads: ts.JsxExpression[] = [];
  const visit = (node: ts.Node): void => {
    if (
      ts.isJsxExpression(node) &&
      node.expression !== undefined &&
      ts.isPropertyAccessExpression(node.expression) &&
      ts.isIdentifier(node.expression.expression) &&
      node.expression.expression.text === item &&
      node.expression.name.text === property &&
      // Child position only. An item read in an ATTRIBUTE has nowhere to put
      // the annotation, and the editor finds fields by element.
      ts.isJsxElement(node.parent)
    ) {
      reads.push(node);
    }
    ts.forEachChild(node, visit);
  };
  visit(callback.body);
  void source;
  return reads;
}

/**
 * The declaration a file's client-module values belong to, by file.
 *
 * A value written inside a client component cannot read the contract: the
 * runtime is server-only. So it is threaded IN as a prop, and every caller has
 * to pass it. Callers come from the call-site index rather than from a search
 * for the component's name -- finding callers by spelling is the mistake this
 * package has already made three times.
 */
const MANAGED_FIELDS_PROP = "managedFields";

/** React's own name for a component's children, which is a prop like any other. */
const CHILDREN_PROP = "children";

/** The per-item records a client component renders a collection from. */
const MANAGED_ITEMS_PROP = "managedItems";

/** The package the annotation TYPE comes from, named once. */
const CONTRACT_PACKAGE = "@landing-pages-websites/managed-site-contract";

/** Everything the generated runtime exports that rewritten code can call. */
const RUNTIME_EXPORTS = [
  "managedFieldsFor",
  "managedItemsFor",
  "managedItem",
  "managedPage",
  "managedRichText",
  "managedRichTextAttributes",
  "managedText",
] as const;

/**
 * The component each rendered element resolves to, keyed by position.
 *
 * Keyed by position rather than by node because the rewrite parses each file
 * again: the index holds nodes from the proposer's parse, and only the offsets
 * are shared between the two. Both read the same bytes, so the offsets agree.
 */
function componentTargets(
  index: CallSiteIndex,
): ReadonlyMap<string, ComponentDeclaration> {
  const byPosition = new Map<string, ComponentDeclaration>();
  for (const [key, sites] of index.sites) {
    const target = index.declarations.get(key);
    if (target === undefined) continue;
    for (const site of sites) {
      byPosition.set(`${site.from.module.file}@${site.element.pos}`, target);
    }
  }
  return byPosition;
}

/**
 * The declaration whose enclosing function is `fn`.
 *
 * A component is identified by the function that renders it, not by its file:
 * one client module holds several, and a file-keyed lookup reported
 * `<Numeral/>` as a caller of its sibling `WordWall`, threading the value into
 * the wrong component.
 */
function declarationOf(
  index: CallSiteIndex,
  file: string,
  fn: ts.SignatureDeclaration,
): ComponentDeclaration | null {
  for (const declaration of index.declarations.values()) {
    if (declaration.module.file !== file) continue;
    // The function that ENCLOSES this declaration, not merely one that contains
    // it. A component declared inside another -- which this repository reads
    // under its own name, so both are declarations -- sits inside the outer
    // one's span as well, and a containment test returned whichever came first
    // in map order. Threading a value into the wrong one of the two puts the
    // prop on a component the caller does not render.
    const enclosing = enclosingFunctionOf(declaration.jsxRoot);
    if (
      enclosing !== null &&
      enclosing.pos === fn.pos &&
      enclosing.end === fn.end
    ) {
      return declaration;
    }
  }
  return null;
}

/** The nearest function-like ancestor of `node`, itself included. */
function enclosingFunctionOf(node: ts.Node): ts.SignatureDeclaration | null {
  let current: ts.Node | undefined = node;
  while (current !== undefined) {
    if (
      (ts.isFunctionDeclaration(current) ||
        ts.isFunctionExpression(current) ||
        ts.isArrowFunction(current) ||
        ts.isMethodDeclaration(current)) &&
      current.body !== undefined
    ) {
      return current;
    }
    current = current.parent;
  }
  return null;
}

/**
 * How to give a client component the `managedFields` prop.
 *
 * Two shapes, because five of All Points Media's client components take NO
 * parameter at all -- `function Nav()` -- and refusing those for "props are
 * not an inline type literal" was refusing the simplest case in the set. A
 * component with an existing props object gets the prop appended; one with no
 * parameter gets the whole parameter written.
 */
type ClientComponentParts =
  | {
      readonly kind: "append";
      readonly destructureAt: number;
      readonly typeAt: number;
    }
  | { readonly kind: "create"; readonly at: number };

/**
 * A prop threaded from a server component into the client components it
 * renders: what it is called, the type it carries, and where that type's import
 * is recorded.
 */
interface ThreadedProp {
  readonly prop: string;
  readonly type: string;
  readonly typeNeeded: Set<string>;
}

type ClientComponentTarget = ClientComponentParts & {
  readonly key: string;
  /** The enclosing function, so the declaration that owns the value is findable. */
  readonly fn: ts.SignatureDeclaration;
  /** Whether the component already destructures a prop of this name. */
  readonly has: (name: string) => boolean;
};

/**
 * The component that renders `node`, and how to give IT the prop.
 *
 * Anchored on the node rather than the file because a client module holds more
 * than one component: `WordWall.tsx` declares `Numeral` above `WordWall`, and a
 * file-first scan gave the prop to `Numeral` while the call site passed it to
 * `WordWall`. Walking up from the value reaches the component that renders it
 * by construction, and covers arrow-function components for free.
 */
function componentPartsAt(
  node: ts.Node,
  source: ts.SourceFile,
): ClientComponentTarget | null {
  let current: ts.Node | undefined = node;
  while (current !== undefined) {
    if (
      (ts.isFunctionDeclaration(current) ||
        ts.isFunctionExpression(current) ||
        ts.isArrowFunction(current)) &&
      current.body !== undefined
    ) {
      const key = `${source.fileName}@${current.pos}`;
      const fn = current;
      if (current.parameters.length === 0) {
        const open = current
          .getChildren(source)
          .find((child) => child.kind === ts.SyntaxKind.OpenParenToken);
        return open === undefined
          ? null
          : { kind: "create", at: open.getEnd(), key, fn, has: () => false };
      }
      const props = propsParameterOf(current);
      if (props === null) return null;
      const lastElement = props.pattern.elements.at(-1);
      const lastMember = props.type.members.at(-1);
      if (lastElement === undefined || lastMember === undefined) return null;
      return {
        kind: "append",
        destructureAt: lastElement.getEnd(),
        typeAt: lastMember.getEnd(),
        has: (name: string): boolean =>
          props.pattern.elements.some(
            (element) =>
              ts.isIdentifier(element.name) && element.name.text === name,
          ),
        key,
        fn,
      };
    }
    current = current.parent;
  }
  return null;
}

/**
 * How a value reaches a client module: who forwards it and who resolves it.
 *
 * A client component cannot call the runtime, so the value comes from a server
 * caller. When the caller is ALSO a client component it cannot resolve it
 * either — it takes the same `managedFields` record and forwards it verbatim,
 * because the record is keyed by field id and each component picks out its own.
 * So the walk goes up until it reaches server modules, which are the only ones
 * that can call `managedFieldsFor`.
 *
 * A cycle would be a component rendering itself through a chain; `seen` ends
 * the walk rather than trusting that never happens.
 */
interface ValueRoute {
  /** Client-to-client call sites, which forward the record they were given. */
  readonly forwards: readonly CallSite[];
  /** Server call sites, which resolve the values and originate the record. */
  readonly origins: readonly CallSite[];
}

function routeToServer(
  index: CallSiteIndex,
  from: ComponentDeclaration,
  read: (path: string) => ts.SourceFile,
): ValueRoute | null {
  const forwards: CallSite[] = [];
  const origins: CallSite[] = [];
  const seen = new Set<string>();
  const queue = [from];
  while (queue.length > 0) {
    const current = queue.shift();
    if (current === undefined) continue;
    const key = declarationKey(current);
    if (seen.has(key)) continue;
    seen.add(key);
    const callers = index.sites.get(key) ?? [];
    if (callers.length === 0) return null;
    for (const site of callers) {
      if (isClientModule(read(site.from.module.file))) {
        forwards.push(site);
        queue.push(site.from);
        continue;
      }
      origins.push(site);
    }
  }
  return origins.length === 0 ? null : { forwards, origins };
}
