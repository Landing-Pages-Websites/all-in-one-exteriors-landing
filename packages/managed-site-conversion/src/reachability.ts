import ts from "typescript";

import {
  findComponentDeclarations,
  type ComponentDeclaration,
} from "./extract.js";
import {
  isComponentName,
  isProvablyHostTag,
  isTransparentWrapper,
  unwrapTransparent,
  type JsxElementNode,
} from "./jsx-facts.js";
import { notFoundCallIn, notFoundNamesIn } from "./not-found.js";
import {
  chainRender,
  notFoundRender,
  unreadEntryFinding,
  unreadRender,
  RENDERS,
  type RouteRender,
} from "./route-render.js";
import {
  walkRenderOutput,
  EVERY_TRIGGER,
  isUnfollowableRenderedCallee,
  type UnreadableRender,
} from "./render-output.js";
import type { Finding } from "./report.js";
import { nearestBinding, scopeOfDeclaration } from "./scopes.js";
import {
  evidenceOf,
  importedBindingsOf,
  locationOf,
  namedFunctionsOf,
  reExportsOf,
  type ModuleCache,
  type ModuleReference,
  type ParsedModule,
} from "./scan.js";

/**
 * What a route actually renders.
 *
 * A declaration is only customer content when a visitor can reach it: the
 * route's default export, the default export of every layout wrapping it, and
 * whatever those transitively render. A capitalized export sitting beside a page
 * renders nothing, so proposing fields for it would hand the customer an editor
 * for markup the browser never shows.
 *
 * Where the chain cannot be followed — a component picked at runtime, a prop
 * holding a component, an import that does not resolve — the subtree is left out
 * AND a finding names the spot. Failing closed in silence would hide exactly the
 * same coverage gap it is meant to prevent.
 */

export type { RouteRender } from "./route-render.js";

export interface RenderTree {
  readonly components: readonly ComponentDeclaration[];
  readonly findings: readonly Finding[];
  /**
   * What the FIRST entry module renders, which by this walk's contract is the
   * route's own page module rather than a layout above it.
   *
   * The walk already decides this to know whether to follow the module at all,
   * and used to keep only the finding. A caller that has to decide whether a
   * route SERVES anything -- the SEO emitter, which advertises it in a sitemap
   * -- needs the answer itself, and deriving it a second time is how two
   * readers come to disagree about what a page renders.
   */
  readonly route: RouteRender;
}

const DEFAULT_EXPORT = "default";
const MEMBER_SEPARATOR = ".";

type Resolution =
  | { readonly kind: "declaration"; readonly declaration: ComponentDeclaration }
  /** Declared outside the repository, so there is nothing of ours to inspect. */
  | { readonly kind: "external" }
  | { readonly kind: "missing_module"; readonly reference: ModuleReference }
  /** Resolves to a function that always answers 404, so it renders nothing. */
  | {
      readonly kind: "not_found";
      readonly module: ParsedModule;
      readonly node: ts.Node;
    }
  | { readonly kind: "unresolved" };

/**
 * What a component-shaped tag names, as much as this reader can tell.
 *
 * The distinction the resolver already draws and `resolveTagAt` throws away:
 * `external` is a component from OUTSIDE this repository, so it is certainly
 * not one of our declarations, while `opaque` is a binding in our own code that
 * could not be identified — `const Alias = Heading` among them. Collapsing both
 * to `null` is what let a reachable `<Alias as={Card} />` vanish from the
 * call-site index and a host-alias proof read the gap as agreement.
 */
export type TagTarget =
  | { readonly kind: "declaration"; readonly declaration: ComponentDeclaration }
  | { readonly kind: "external" }
  | { readonly kind: "opaque" };

const OPAQUE_TARGET: TagTarget = { kind: "opaque" };
const EXTERNAL_TARGET: TagTarget = { kind: "external" };

function tagTargetOf(resolution: Resolution): TagTarget {
  if (resolution.kind === "declaration") {
    return { kind: "declaration", declaration: resolution.declaration };
  }
  // A module of OURS that could not be read could hold any of our components,
  // so it is opaque rather than external. Fail closed.
  return resolution.kind === "external" ? EXTERNAL_TARGET : OPAQUE_TARGET;
}

const EXTERNAL: Resolution = { kind: "external" };
const UNRESOLVED: Resolution = { kind: "unresolved" };

/** Positions only mean anything within one source file. */
function encloses(outer: ts.Node, inner: ts.Node): boolean {
  return outer !== inner && outer.pos <= inner.pos && outer.end >= inner.end;
}

function isNestedIn(
  inner: ComponentDeclaration,
  outer: ComponentDeclaration,
): boolean {
  return (
    inner.module.file === outer.module.file &&
    encloses(outer.jsxRoot, inner.jsxRoot)
  );
}

/**
 * Two declarations of one name in one file are told apart by where they are
 * written. Keying on the name alone would drop the second silently, where the
 * confidence gate exists to withhold both loudly.
 */
export function declarationKey(declaration: ComponentDeclaration): string {
  return `${declaration.module.file}#${declaration.name}@${declaration.jsxRoot.pos}`;
}

function isDefaultExported(statement: ts.Statement): boolean {
  return ts.canHaveModifiers(statement)
    ? (ts.getModifiers(statement) ?? []).some(
        (modifier) => modifier.kind === ts.SyntaxKind.DefaultKeyword,
      )
    : false;
}

function defaultExportStatement(module: ParsedModule): ts.Statement | null {
  for (const statement of module.source.statements) {
    if (ts.isExportAssignment(statement) && statement.isExportEquals !== true)
      return statement;
    if (isDefaultExported(statement)) return statement;
  }
  return null;
}

/**
 * The function body an anonymous `export default` renders from, when there is
 * one to read.
 *
 * `defaultExportName` answers null for these, so every reading keyed on a name
 * skips them. The two forms Next pages are written in are a function with no
 * name and an exported arrow; anything else -- a class, an object, a call
 * wrapping a component -- is left unread, as it was.
 */
function anonymousDefaultBody(module: ParsedModule): ts.Node | null {
  const statement = defaultExportStatement(module);
  if (statement === null) return null;
  if (ts.isFunctionDeclaration(statement)) {
    return statement.name === undefined ? (statement.body ?? null) : null;
  }
  if (!ts.isExportAssignment(statement)) return null;
  const exported = unwrapTransparent(statement.expression);
  return ts.isArrowFunction(exported) || ts.isFunctionExpression(exported)
    ? exported.body
    : null;
}

/** The local name a module's default export refers to, when it has one at all. */
function defaultExportName(module: ParsedModule): string | null {
  const statement = defaultExportStatement(module);
  if (statement === null) return null;
  if (ts.isExportAssignment(statement)) {
    return ts.isIdentifier(statement.expression)
      ? statement.expression.text
      : null;
  }
  if (ts.isFunctionDeclaration(statement)) return statement.name?.text ?? null;
  if (ts.isClassDeclaration(statement)) return statement.name?.text ?? null;
  return null;
}

interface RenderedTag {
  readonly name: string;
  readonly node: ts.Node;
}

interface RenderedOutput {
  readonly tags: readonly RenderedTag[];
  /** Hand-offs of a JSX-writing function whose rendering could not be read. */
  readonly unreadable: readonly UnreadableRender[];
}

const RENDERED_OUTPUT = new WeakMap<ts.Node, RenderedOutput>();

/**
 * What a human is asked to decide, by what the function was handed to. The two
 * are separate sentences because they are separate questions: a call renders
 * its result where the call is written, so the fix is local, while a component
 * renders a prop wherever its own declaration says, which is where the reader
 * has to look.
 */
const UNREADABLE_DECISION: Readonly<Record<UnreadableRender["kind"], string>> =
  {
    call:
      "This call is given a function that writes JSX, but whether the call's " +
      "result is rendered could not be read, so nothing inside it was " +
      "inspected. Render the result where it is written, or convert this " +
      "subtree by hand. Nothing was proposed for it.",
    attribute:
      "A component is given this function, which writes JSX, but only that " +
      "component decides whether it renders what the function returns, and an " +
      "attribute is written the same way whether it does or not. Nothing inside " +
      "was inspected. Write the JSX where it renders, or convert this subtree " +
      "by hand. Nothing was proposed for it.",
  };

/**
 * Every component-shaped tag this declaration renders, each named once, and
 * every call it could not read. Which nested functions count is
 * `render-output.ts`'s decision; this reading follows a name wherever the
 * browser would, so it admits every trigger.
 *
 * Cached because a walker is built per route, so a layout's components and
 * everything they render would otherwise be re-walked once for every route on
 * the site. The answer depends only on the syntax below `jsxRoot`, which never
 * changes once parsed.
 */
function renderedOutputOf(declaration: ComponentDeclaration): RenderedOutput {
  const cached = RENDERED_OUTPUT.get(declaration.jsxRoot);
  if (cached !== undefined) return cached;
  // EVERY occurrence, not one per name. Which declaration a tag names depends
  // on where it is written, so two `<Item />` in different scopes are two
  // render targets — and keeping only the first let whichever was seen first
  // answer for both, leaving the other component unwalked. Resolution
  // deduplicates by declaration afterwards, which is the identity that matters.
  const tags: RenderedTag[] = [];
  const walk = walkRenderOutput(declaration.jsxRoot, EVERY_TRIGGER, (node) => {
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const name = node.tagName.getText(declaration.module.source);
      if (isComponentName(name)) tags.push({ name, node });
    }
    return false;
  });
  const found: RenderedOutput = { tags, unreadable: walk.unreadable };
  RENDERED_OUTPUT.set(declaration.jsxRoot, found);
  return found;
}

class RenderWalker {
  readonly #cache: ModuleCache;
  readonly #repositoryRoot: string;
  readonly #declarations = new Map<string, readonly ComponentDeclaration[]>();
  readonly #visited = new Set<string>();
  readonly #components: ComponentDeclaration[] = [];
  readonly #findings: Finding[] = [];

  constructor(cache: ModuleCache, repositoryRoot: string) {
    this.#cache = cache;
    this.#repositoryRoot = repositoryRoot;
  }

  walk(entryFiles: readonly string[]): RenderTree {
    const rendered = entryFiles.map((file) => this.#enterModule(file));
    return {
      components: this.#components,
      findings: this.#findings,
      route: chainRender(rendered),
    };
  }

  #enterModule(file: string): RouteRender {
    const entry = this.#cache.read(file);
    const resolution = this.#resolveExport(entry, DEFAULT_EXPORT, new Set());
    if (resolution.kind === "declaration") {
      this.#visit(resolution.declaration);
      return RENDERS;
    }
    if (resolution.kind === "not_found") {
      // No finding here. The route that reaches this module carries one, with
      // the declaration that advertises it beside the line that answers 404,
      // and a finding is one decision for a human.
      return notFoundRender(resolution.module, resolution.node);
    }
    const render = unreadRender(file, entry, defaultExportStatement(entry));
    this.#findings.push(unreadEntryFinding(render));
    return render;
  }

  #visit(declaration: ComponentDeclaration): void {
    const key = declarationKey(declaration);
    if (this.#visited.has(key)) return;
    this.#visited.add(key);
    this.#components.push(declaration);
    const rendered = renderedOutputOf(declaration);
    for (const entry of rendered.unreadable)
      this.#reportUnreadable(entry, declaration);
    for (const tag of rendered.tags) this.#follow(tag, declaration);
  }

  /**
   * A function that writes JSX was handed to something whose rendering could
   * not be read. Following it would propose markup for something no visitor may
   * reach, and dropping it quietly would hide the same gap, so nothing inside
   * is read and the place it was handed over is named.
   */
  #reportUnreadable(entry: UnreadableRender, from: ComponentDeclaration): void {
    this.#findings.push({
      code: "UNRESOLVED_RENDER_TARGET",
      anchor: null,
      location: locationOf(from.module.source, from.module.file, entry.node),
      evidence: evidenceOf(from.module.source, entry.node),
      decision: UNREADABLE_DECISION[entry.kind],
    });
  }

  /**
   * The declaration a JSX tag names, or null when it is not ours to read. This
   * is the SAME resolution the render walk follows — exposed rather than
   * reimplemented, so a second reader cannot come to disagree with it about
   * what `<Hero />` refers to.
   */
  resolveTag(
    tagName: string,
    from: ComponentDeclaration,
  ): ComponentDeclaration | null {
    const resolution = this.#resolutionOf(tagName, from);
    return resolution.kind === "declaration" ? resolution.declaration : null;
  }

  resolveTagAtSite(
    tagName: string,
    from: ComponentDeclaration,
    at: ts.Node,
  ): ComponentDeclaration | null {
    const resolution = this.#resolutionOf(tagName, from, at);
    return resolution.kind === "declaration" ? resolution.declaration : null;
  }

  targetAtSite(
    tagName: string,
    from: ComponentDeclaration,
    at: ts.Node,
  ): TagTarget {
    return tagTargetOf(this.#resolutionOf(tagName, from, at));
  }

  /**
   * `at` is the JSX the tag is written in, when the caller has it.
   *
   * Component ancestry alone is not lexical scope: a declaration in one block
   * and a tag in a SIBLING block share an enclosing component, and answering
   * by ancestry made the walk extract markup the page cannot reach and
   * classify props from a receiver it never renders. With the use site in
   * hand the question is asked the way the language answers it — the nearest
   * binding, and only what the module itself binds when there is none.
   */
  #resolutionOf(
    tagName: string,
    from: ComponentDeclaration,
    at?: ts.Node,
  ): Resolution {
    const [root = tagName, ...members] = tagName.split(MEMBER_SEPARATOR);
    // The ROOT of a dotted tag is a name like any other, so it is checked for a
    // nearer binding BEFORE the namespace is resolved. Resolving the member
    // first skipped shadowing entirely: a parameter called `UI` renders, while
    // the analyzer read `UI.Card` from the import.
    if (at !== undefined && nearestBinding(at, root) !== null) {
      return members.length === 0
        ? this.#resolved(componentDeclaredBy(nearestBinding(at, root)!, from.module))
        : UNRESOLVED;
    }
    if (members.length > 0)
      return this.#resolveMember(from.module, root, members);
    if (at !== undefined)
      return this.#resolveName(from.module, root, new Set(), null);
    return this.#resolveName(from.module, root, new Set(), from);
  }

  #follow(tag: RenderedTag, from: ComponentDeclaration): void {
    const resolution = this.#resolutionOf(tag.name, from, tag.node);
    if (resolution.kind === "external") return;
    if (resolution.kind === "declaration") {
      this.#visit(resolution.declaration);
      return;
    }
    if (resolution.kind === "missing_module") {
      this.#findings.push(
        unresolvedImportFinding(resolution.reference, from.module.file),
      );
      return;
    }
    if (resolution.kind === "not_found") {
      this.#findings.push({
        code: "UNRESOLVED_RENDER_TARGET",
        anchor: null,
        location: locationOf(from.module.source, from.module.file, tag.node),
        evidence: evidenceOf(from.module.source, tag.node),
        decision:
          `'${tag.name}' always calls \`notFound()\`, so it renders nothing and ` +
          "whatever it stands in for was not inspected. Render a component here, " +
          "or convert this subtree by hand. Nothing was proposed for it.",
      });
      return;
    }
    this.#findings.push({
      code: "UNRESOLVED_RENDER_TARGET",
      anchor: null,
      location: locationOf(from.module.source, from.module.file, tag.node),
      evidence: evidenceOf(from.module.source, tag.node),
      decision:
        `'${tag.name}' does not name a component declared in this repository, so ` +
        "what it renders could not be read. Render a named component here, or " +
        "convert this subtree by hand. Nothing was proposed for it.",
    });
  }

  /** `<Icons.Check />` is only followable through a namespace import of our own code. */
  #resolveMember(
    module: ParsedModule,
    root: string,
    members: readonly string[],
  ): Resolution {
    const binding = importedBindingsOf(module, this.#repositoryRoot).get(root);
    if (binding === undefined) return UNRESOLVED;
    if (!binding.isRepositoryLocal) return EXTERNAL;
    if (binding.resolvedFile === null)
      return { kind: "missing_module", reference: binding };
    const [member] = members;
    if (
      binding.importedName !== null ||
      member === undefined ||
      members.length > 1
    ) {
      return UNRESOLVED;
    }
    return this.#resolveExport(
      this.#cache.read(binding.resolvedFile),
      member,
      new Set(),
    );
  }

  /**
   * `scope` is the component the name is written inside, or null for a name a
   * second module imported, which only module-level declarations can satisfy.
   */
  #resolveName(
    module: ParsedModule,
    name: string,
    seen: Set<string>,
    scope: ComponentDeclaration | null,
  ): Resolution {
    const declared = this.#declarationInScope(module, name, scope);
    if (declared !== undefined) return this.#resolved(declared);
    const binding = importedBindingsOf(module, this.#repositoryRoot).get(name);
    if (binding === undefined) return UNRESOLVED;
    if (!binding.isRepositoryLocal) return EXTERNAL;
    if (binding.resolvedFile === null)
      return { kind: "missing_module", reference: binding };
    if (binding.importedName === null) return UNRESOLVED;
    return this.#resolveExport(
      this.#cache.read(binding.resolvedFile),
      binding.importedName,
      seen,
    );
  }

  #resolveExport(
    module: ParsedModule,
    exportName: string,
    seen: Set<string>,
  ): Resolution {
    const key = `${module.file}#${exportName}`;
    if (seen.has(key)) return UNRESOLVED;
    seen.add(key);
    const localName =
      exportName === DEFAULT_EXPORT ? defaultExportName(module) : exportName;
    if (localName !== null) {
      const local = this.#resolveName(module, localName, seen, null);
      if (local.kind !== "unresolved") return local;
      // Only an EXPORTED name is asked this. A tag resolving to nothing is a
      // gap in the walk wherever it is written, while a module whose export
      // answers 404 is a fact about the route that names the module, and the
      // one place that distinction can be drawn is here.
      const answers404 = this.#answers404(module, localName);
      if (answers404 !== null) return answers404;
    } else if (exportName === DEFAULT_EXPORT) {
      // `export default function () { notFound(); }` and `export default () =>
      // notFound()` bind no name at all, so there is nothing for the lookup
      // above to find. The body is right there in the export statement, and a
      // route written that way answers 404 exactly as one with a name does.
      const anonymous = this.#anonymousDefaultAnswers404(module);
      if (anonymous !== null) return anonymous;
    }
    return this.#throughReExports(module, exportName, seen);
  }

  #throughReExports(
    module: ParsedModule,
    exportName: string,
    seen: Set<string>,
  ): Resolution {
    for (const reExport of reExportsOf(module, this.#repositoryRoot)) {
      const named = reExport.exportedName !== null;
      if (named && reExport.exportedName !== exportName) continue;
      if (!reExport.isRepositoryLocal) {
        if (named) return EXTERNAL;
        continue;
      }
      if (reExport.resolvedFile === null) {
        if (named) return { kind: "missing_module", reference: reExport };
        continue;
      }
      const through = this.#resolveExport(
        this.#cache.read(reExport.resolvedFile),
        reExport.importedName ?? exportName,
        seen,
      );
      if (through.kind !== "unresolved") return through;
    }
    return UNRESOLVED;
  }

  /**
   * The `notFound()` an exported function always reaches, when it has one.
   *
   * Asked only of names `findComponentDeclarations` already declined, which is
   * every named function with no JSX in it. Such a function renders nothing
   * whatever it does; the call is what says the route answers 404 rather than
   * merely defeating this reader.
   */
  #answers404(module: ParsedModule, name: string): Resolution | null {
    for (const entry of namedFunctionsOf(module.source)) {
      if (entry.name !== name) continue;
      if (!isModuleLevelBinding(entry.body, module)) continue;
      const answers = this.#answeredBy(module, entry.body);
      if (answers !== null) return answers;
    }
    return null;
  }

  /** The 404 an anonymous `export default` answers with, when it does. */
  #anonymousDefaultAnswers404(module: ParsedModule): Resolution | null {
    const body = anonymousDefaultBody(module);
    return body === null ? null : this.#answeredBy(module, body);
  }

  /**
   * A resolved declaration, unless its body proves the route answers 404.
   *
   * The proof runs HERE, at the one place a name becomes a declaration, rather
   * than only where a name resolves to nothing. `export default function
   * Hidden() { notFound(); return <div />; }` is a component declaration by
   * every structural test -- it writes JSX -- and every request still reaches
   * `notFound()` before that JSX exists. Asking only about functions the
   * component reading declined left exactly those routes in the contract.
   *
   * It answers for a rendered TAG as well, deliberately: markup below a
   * component that always 404s is markup no visitor sees, which is the same
   * reason this walk exists.
   */
  #resolved(declaration: ComponentDeclaration | null): Resolution {
    if (declaration === null) return UNRESOLVED;
    return (
      this.#answeredBy(declaration.module, declaration.jsxRoot) ?? {
        kind: "declaration",
        declaration,
      }
    );
  }

  /** The `notFound()` a body is guaranteed to reach, as a resolution. */
  #answeredBy(module: ParsedModule, body: ts.Node): Resolution | null {
    // Cheapest question first: a module that never imports `notFound` cannot
    // reach one, and almost none of them do.
    const names = notFoundNamesIn(
      module,
      importedBindingsOf(module, this.#repositoryRoot),
    );
    if (names === null) return null;
    const node = notFoundCallIn(body, names);
    return node === null ? null : { kind: "not_found", module, node };
  }

  #moduleDeclarations(module: ParsedModule): readonly ComponentDeclaration[] {
    const existing = this.#declarations.get(module.file);
    if (existing !== undefined) return existing;
    const declarations = findComponentDeclarations(module);
    this.#declarations.set(module.file, declarations);
    return declarations;
  }

  /** Every component this one is written inside, innermost first. */
  #enclosingDeclarations(
    declaration: ComponentDeclaration,
  ): readonly ComponentDeclaration[] {
    return this.#moduleDeclarations(declaration.module)
      .filter((other) => encloses(other.jsxRoot, declaration.jsxRoot))
      .sort((left, right) => right.jsxRoot.pos - left.jsxRoot.pos);
  }

  /**
   * Whether the name is bound at MODULE level.
   *
   * "No enclosing component declaration" is not the same fact: a component
   * declared inside an `if` block has none, and is still invisible to code
   * written outside that block. Asking the syntax directly is what a second
   * module importing this one, and a tag with no nearer binding, both need.
   */
  #isModuleLevel(declaration: ComponentDeclaration): boolean {
    return isModuleLevelDeclaration(declaration);
  }

  /**
   * A nested component is only a render target for code written inside the same
   * closure: the component it is declared in, or one nested deeper in that one.
   * Anywhere else the name is out of scope and resolves to nothing.
   */
  #isInScope(
    target: ComponentDeclaration,
    from: ComponentDeclaration,
  ): boolean {
    const [enclosing] = this.#enclosingDeclarations(target);
    if (enclosing === undefined) return true;
    return enclosing === from || isNestedIn(from, enclosing);
  }

  /**
   * The declaration a name resolves to from `scope`. A name declared nearer the
   * reference shadows the same name further out, exactly as the closure does.
   */
  #declarationInScope(
    module: ParsedModule,
    name: string,
    scope: ComponentDeclaration | null,
  ): ComponentDeclaration | undefined {
    return this.#moduleDeclarations(module)
      .filter((entry) => entry.name === name)
      .filter((entry) =>
        scope === null
          ? this.#isModuleLevel(entry)
          : this.#isInScope(entry, scope),
      )
      .sort(
        (left, right) =>
          this.#enclosingDeclarations(right).length -
          this.#enclosingDeclarations(left).length,
      )
      .at(0);
  }
}

function unresolvedImportFinding(
  reference: ModuleReference,
  file: string,
): Finding {
  return {
    code: "UNRESOLVED_COMPONENT",
    anchor: null,
    location: { file, line: reference.line, offset: reference.offset },
    evidence: `import "${reference.specifier}"`,
    decision:
      "This local import could not be resolved, so the component it renders was " +
      "not inspected. Fix the path or convert that module by hand.",
  };
}

/**
 * Walks the render tree of each entry module — a route and the layouts that wrap
 * it — and returns every component declaration it reaches, each exactly once.
 */
export function resolveRenderTree(
  entryFiles: readonly string[],
  repositoryRoot: string,
  cache: ModuleCache,
): RenderTree {
  return new RenderWalker(cache, repositoryRoot).walk(entryFiles);
}

/** Resolves a JSX tag to the component it renders, by the render walk's rules. */
/**
 * One place a component is rendered, and the component that renders it.
 *
 * A reading that asks what a prop can BE needs the sites that supply it, and
 * the element rather than just the file, because two sites in one component
 * can pass different values.
 */
export interface CallSite {
  readonly element: JsxElementNode;
  readonly from: ComponentDeclaration;
}

/**
 * Every place each declaration is rendered, keyed by `declarationKey`.
 *
 * Built from the declarations reachability already resolved, so it covers
 * exactly the components a route reaches — a site in dead code supplies no
 * value at runtime and must not count as evidence.
 *
 * Resolved with `resolveAt`, not `resolve`: which declaration a tag names is a
 * question about the scope it is written in, and a reading that classifies a
 * value cannot afford the breadth answer.
 */
export interface CallSiteIndex {
  /** Sites keyed by the declaration they provably call. */
  readonly sites: ReadonlyMap<string, readonly CallSite[]>;
  /**
   * Reachable component-shaped sites whose target could not be identified.
   *
   * These are not attributable to any declaration, and each one might be a
   * call of ANY of ours -- `const Alias = Heading` is the reviewed case. A
   * proof that depends on having seen every call of a declaration has to
   * account for them; dropping them makes the index quietly wrong rather than
   * visibly incomplete.
   */
  readonly opaque: readonly CallSite[];
  /**
   * Rendered calls whose body this reader could not follow.
   *
   * Unlike an opaque JSX site there is no element to interrogate: the call
   * renders something unknown, so a proof that depends on having seen every
   * call of a declaration cannot hold. Counted rather than listed because the
   * only question asked of them is whether any exist.
   */
  readonly unknownRenders: number;
  /**
   * The declarations the index was built from, keyed the same way as `sites`.
   *
   * A caller walk asks "who renders THIS component", which is a question about
   * a declaration, not a file: `WordWall.tsx` declares `Numeral` beside
   * `WordWall`, so a file-keyed lookup reported `<Numeral/>` as a caller of
   * `WordWall` and threaded a value into the wrong component.
   */
  readonly declarations: ReadonlyMap<string, ComponentDeclaration>;
}

export function callSiteIndex(
  declarations: readonly ComponentDeclaration[],
  resolver: TagResolver,
): CallSiteIndex {
  const sites = new Map<string, CallSite[]>();
  const byKey = new Map<string, ComponentDeclaration>(
    declarations.map((declaration) => [
      declarationKey(declaration),
      declaration,
    ]),
  );
  const opaque: CallSite[] = [];
  let unknownRenders = 0;
  for (const from of declarations) {
    walkRenderOutput(from.jsxRoot, EVERY_TRIGGER, (node) => {
      if (isUnfollowableRenderedCallee(node, from.module.source))
        unknownRenders += 1;
      if (!ts.isJsxOpeningElement(node) && !ts.isJsxSelfClosingElement(node))
        return false;
      const name = node.tagName.getText(from.module.source);
      // Every reachable site that renders a component is evidence, dotted ones
      // included -- see `readTagAs`. A component from a PACKAGE is not one of
      // ours and is skipped; one of ours that could not be identified is kept,
      // because a proof cannot tell it apart from the declaration it is about.
      const reading = readTagAs(resolver, name, node, from);
      if (reading.kind !== "component") return false;
      const element = ts.isJsxOpeningElement(node) ? node.parent : node;
      if (reading.target.kind === "opaque") {
        opaque.push({ element, from });
        return false;
      }
      if (reading.target.kind === "external") return false;
      const key = declarationKey(reading.target.declaration);
      const recorded = sites.get(key) ?? [];
      recorded.push({ element, from });
      sites.set(key, recorded);
      return false;
    });
  }
  return { sites, opaque, unknownRenders, declarations: byKey };
}

export interface TagResolver {
  resolve(
    tagName: string,
    from: ComponentDeclaration,
  ): ComponentDeclaration | null;
  /**
   * `resolveAt` with the REASON kept: a tag that is not one of our
   * declarations is either a package's component or a binding of ours this
   * reader could not identify, and only the second can secretly be the
   * declaration a proof is about.
   */
  targetAt(tagName: string, from: ComponentDeclaration, at: ts.Node): TagTarget;
  /**
   * The same question asked from MODULE scope only, for a use site that has no
   * nearer binding. The render walk wants breadth and a wrong answer only adds
   * a component; a reading that classifies a value needs the declaration that
   * is actually visible where the tag is written.
   */
  /**
   * The same question asked AT a use site, which is the only way to answer it:
   * the nearest binding, and only what the module itself binds when there is
   * none. The render walk asks it too, so one rule decides what a tag renders
   * and what a reading may conclude about it.
   */
  resolveAt(
    tagName: string,
    from: ComponentDeclaration,
    at: ts.Node,
  ): ComponentDeclaration | null;
}

export function tagResolver(
  repositoryRoot: string,
  cache: ModuleCache,
): TagResolver {
  const walker = new RenderWalker(cache, repositoryRoot);
  return {
    resolve: (tagName, from) => walker.resolveTag(tagName, from),
    resolveAt: (tagName, from, at) =>
      walker.resolveTagAtSite(tagName, from, at),
    targetAt: (tagName, from, at) => walker.targetAtSite(tagName, from, at),
  };
}

/**
 * Resolves a tag to the declaration it names AT the place it is written.
 *
 * `resolve` answers by name, from the module. That is what the render walk
 * wants — it visits everything reachable and a wrong answer only adds a
 * component. A reading that CLASSIFIES a value cannot afford it: with
 * `import { Inner } from "./Inner"` and a local `function Inner()`, the page
 * renders the local one, and reading the import would describe a prop from a
 * component the page never renders.
 *
 * Which declaration a tag names is a LEXICAL question, and two heuristics
 * standing in for it were wrong in opposite directions. "Any binding means
 * unresolvable" rejected a local component this reader can read perfectly
 * well. "The name matches mine means recursion" accepted a parameter that
 * shadows the component's own name, and described a prop of a component the
 * page never renders.
 *
 * So the question is asked directly: find the NEAREST binding of the name
 * between the JSX and the module. No binding means the module answers.
 * A binding that is a component in this module means that component — which is
 * also how recursion resolves, with no exemption, because a component's own
 * declaration is the nearest binding of its own name. Any other binding — a
 * parameter, a local holding a call's result — is opaque, and the tag is
 * unresolved.
 */
export function resolveTagAt(
  resolver: TagResolver,
  tagName: string,
  node: ts.Node,
  from: ComponentDeclaration,
): ComponentDeclaration | null {
  return resolver.resolveAt(tagName, from, node);
}

/**
 * What a JSX tag renders, as ONE decision both readers use.
 *
 * `Heading` is a component beyond doubt, so an unreadable one is still a
 * component (`target: null`) rather than a host element. A DOTTED tag is a
 * component too, but only a resolvable one can be read: `ui.Card` is in this
 * repository, while `motion.div` keeps the host reading because a package
 * wrapper forwarding to the DOM element it names is exactly what the host
 * rules describe. Lowercase and undotted is a host element.
 *
 * This lived in two places and they diverged: the call-site index took
 * PascalCase only, so a reachable `<ui.Heading as={Card} />` never became
 * evidence and could not veto a host-tag proof that other call sites
 * supported. An index that silently omits a site is worse than one that is
 * absent, because the proof reads the gap as agreement.
 */
export type TagReading =
  | { readonly kind: "host" }
  | { readonly kind: "component"; readonly target: TagTarget };

export function readTagAs(
  resolver: TagResolver,
  tagName: string,
  node: ts.Node,
  from: ComponentDeclaration,
): TagReading {
  if (isComponentName(tagName)) {
    return {
      kind: "component",
      target: resolver.targetAt(tagName, from, node),
    };
  }
  if (isProvablyHostTag(tagName)) return { kind: "host" };

  // A DOTTED tag asks where the RECEIVER comes from, and nothing else.
  //
  // External is the host case, and the only one: `motion.div` and `pkg.Card`
  // both forward to something this reader cannot open, and asking a package
  // about a prop would turn every `className` on a `motion.*` tag into a
  // finding a human must dismiss. Anything else -- a declaration, or a binding
  // of ours that could not be identified -- is a component, so it is indexed
  // or it vetoes.
  //
  // I had a member-case rule here for one round: lowercase member means a DOM
  // element. It is wrong, because `const ui = { heading: Heading }` makes
  // `<ui.heading>` render a component with a lowercase member, and the rule
  // skipped it. The reason I reached for it is worth recording: the round
  // before, this simpler rule turned three `motion.div` tests red, and I read
  // that as evidence about the RULE when it was evidence about the FIXTURES --
  // they wrote `declare const motion`, a local binding, where they meant an
  // import from a package.
  const target = resolver.targetAt(tagName, from, node);
  return target.kind === "external"
    ? { kind: "host" }
    : { kind: "component", target };
}

/**
 * The component a binding declares, when it declares one this reader can read.
 *
 * A parameter, or a local bound to anything but a function with JSX in it,
 * yields null: the tag renders something whose props this reader cannot
 * describe.
 */
function componentDeclaredBy(
  binding: ts.Node,
  module: ParsedModule,
): ComponentDeclaration | null {
  // `namedFunctionsOf` finds the function behind `as`, `satisfies` and
  // parentheses, so the match has to look through them too — comparing against
  // the original initializer made the two disagree and reported a local
  // component unresolved.
  const initializer = ts.isVariableDeclaration(binding)
    ? binding.initializer
    : binding;
  if (initializer === undefined) return null;
  const owner = ts.isExpression(initializer)
    ? unwrapTransparent(initializer)
    : initializer;
  return (
    findComponentDeclarations(module).find(
      (candidate) => candidate.jsxRoot.parent === owner,
    ) ?? null
  );
}

/**
 * Whether a component's binding lives at the top level of its module.
 *
 * Not "is it outside every block": a `var` written inside a top-level `if` is
 * module scoped in JavaScript, and a `let` beside it is not. Which ancestor
 * the binding belongs to depends on how it was declared, so `scopeOfDeclaration`
 * decides and this only asks whether the answer is the file.
 */
function isModuleLevelDeclaration(declaration: ComponentDeclaration): boolean {
  return isModuleLevelBinding(declaration.jsxRoot, declaration.module);
}

/**
 * The same question for any named function, component or not.
 *
 * Only a module-level name can be exported, so a nested function that happens
 * to share the export's name answers for nothing.
 */
function isModuleLevelBinding(body: ts.Node, module: ParsedModule): boolean {
  const site = bindingSiteOf(body);
  if (site === null) return false;
  return scopeOfDeclaration(site) === module.source;
}

/**
 * The syntax that binds a function's name: its declaration or its variable.
 *
 * Transparent wrappers nest, so this climbs through however many there are.
 * Reading one level agreed with `componentDeclaredBy` — which unwraps
 * recursively — only for singly-wrapped components, and a module-level
 * `const Local = (((() => …))) as T` became unreachable.
 */
function bindingSiteOf(body: ts.Node): ts.Node | null {
  const owner = body.parent;
  if (owner === undefined) return null;
  if (ts.isFunctionDeclaration(owner)) return owner;
  let current: ts.Node | undefined = owner.parent;
  while (
    current !== undefined &&
    ts.isExpression(current) &&
    isTransparentWrapper(current)
  ) {
    current = current.parent;
  }
  return current !== undefined && ts.isVariableDeclaration(current)
    ? current
    : null;
}

