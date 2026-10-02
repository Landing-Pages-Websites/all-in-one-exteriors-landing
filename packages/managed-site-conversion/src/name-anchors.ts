import { readFileSync, writeFileSync } from "node:fs";
import { basename } from "node:path";

import ts from "typescript";

import { renderAnchor } from "./anchors.js";
import type { Candidate } from "./candidates.js";
import {
  attributesOf,
  namesARegion,
  isComponentName,
  isProvablyHostTag,
  literalAttributeValue,
  tagNameOf,
  type JsxElementNode,
} from "./jsx-facts.js";
import type { Finding } from "./report.js";
import {
  importedBindingsOf,
  ModuleCache,
  repositoryFileForSpecifier,
  containsPath,
  repositoryFiles,
  repositoryModuleFiles,
  type ParsedModule,
} from "./scan.js";

/**
 * Writing the name the reader is missing.
 *
 * `AMBIGUOUS_ANCHOR` is the largest refusal on a real site, and the advice in
 * every one of those findings is the same sentence: give this element a
 * durable name. That is a mechanical edit — an `id` attribute changes nothing
 * about what the page renders — so a person making it seventy times is doing
 * what the tool could have done, which is the difference between a conversion
 * that needs supervision and one that does not.
 *
 * An id is a fragment target and a selector target, though, and a WRONG one is
 * worse than none: two elements answering to the same name is a silent bug in
 * the site, not a loud one in the report. So this refuses far more than it
 * accepts, and everything it refuses stays reported exactly as before.
 *
 * A group is named as a whole or not at all. Naming some of a group leaves an
 * ambiguity the gate reports on the next run anyway, and makes the field set
 * change shape between two runs of the same tool over the same source.
 */

/** One `id` to insert, as a position and a string. */
export interface AnchorName {
  readonly file: string;
  /** Character offset to insert ` id="…"` at: just past the tag name. */
  readonly insertAt: number;
  readonly tag: string;
  readonly id: string;
  /** The ambiguous anchor this name resolves, for the diff's explanation. */
  readonly anchor: string;
}

export interface NamingProposal {
  readonly names: readonly AnchorName[];
  /** Every group it would not name, and why. */
  readonly findings: readonly Finding[];
}

/** Longest slug taken from an element's own words. Ids stay readable. */
const MAX_TEXT_WORDS = 6;
const MAX_SLUG_LENGTH = 48;

/**
 * Every name this tool writes carries this prefix.
 *
 * It is not decoration. An id is spoken for by anything that can NAME one — a
 * `#fragment` link, a `getElementById`, a stylesheet rule — and this reader
 * cannot see all of those with certainty. A namespace it owns removes the
 * whole collision class by construction rather than by enumeration, and it
 * also lets a later run tell its own names from a person's.
 */
const NAME_PREFIX = "ms-";

/** Files that can NAME an id without being a module this tool parses. */
/** A stylesheet that builds selector text at compile time. */
const SELECTOR_INTERPOLATION = /[#@]\{/u;

/**
 * A stand-in node for a stylesheet this reader cannot resolve.
 *
 * The opaque list holds AST nodes because every other member is one, and a
 * stylesheet has no AST here. The refusal renders each member with `getText`,
 * so the reason is carried as the stand-in's own source text.
 */
function interpolatedSelector(file: string): ts.Node {
  const reason = `${basename(file)} builds selector text by interpolation`;
  return ts.createSourceFile(file, reason, ts.ScriptTarget.Latest, false, ts.ScriptKind.TSX);
}

const SELECTOR_FILE_EXTENSIONS = [".css", ".scss", ".sass", ".less", ".html"] as const;

/** `#name` anywhere: a fragment link, a selector, a scroll target. */
const FRAGMENT_PATTERN = /#([A-Za-z][\w-]*)/gu;

/**
 * The paths this run writes, which are never the repository's own text.
 *
 * The output directory was the only one for a long time, and the reason is
 * stated at `repositoryText`: a run that reads its own proposal back finds
 * every name occupied and mints suffixed ones, so the same input answers
 * differently each time. The LEDGER is the same hazard and has to live
 * somewhere worse. It records the anchor each id was minted for, so a name it
 * holds appears as text; and it must sit INSIDE the repository, because that
 * is the only way a later conversion keeps the ids the CMS addresses a
 * customer's edits by. Left in the scan it poisons itself: converting All
 * Points Media a second time turned `ms-proof-challenge` into
 * `ms-proof-challenge-2`, which changed the anchor, which minted a new field
 * id for a value that had not moved -- and a third run would have said `-3`.
 */
export interface OwnArtifacts {
  readonly outputDirectory?: string;
  readonly ledgerPath?: string;
}

function ownPathsOf(own: OwnArtifacts): readonly string[] {
  return [own.outputDirectory, own.ledgerPath].filter(
    (path): path is string => path !== undefined && path !== "",
  );
}

export function nameAmbiguousAnchors(
  ambiguous: readonly (readonly Candidate[])[],
  repositoryRoot: string,
  own: OwnArtifacts = {},
): NamingProposal {
  const cache = new ModuleCache();
  const ownPaths = ownPathsOf(own);
  const existing = takenIdentifiers(repositoryRoot, cache, ownPaths);
  const taken = new Set(existing.taken);
  const corpus = repositoryText(repositoryRoot, ownPaths, cache);
  const names: AnchorName[] = [];
  const findings: Finding[] = [];
  // An id somewhere in this repository that cannot be shown disjoint from the
  // names this writer mints makes every name unsafe, not just that file's: the
  // element it lands on is unrelated to the element carrying the opaque id.
  // So nothing is written, and each group is told why.
  if (existing.opaque.length > 0) {
    const where = existing.opaque
      .slice(0, OPAQUE_IDS_REPORTED)
      .map((node) => node.getText().replace(/\s+/gu, " ").slice(0, 60))
      .join(", ");
    for (const group of ambiguous) {
      findings.push(
        refusalFinding(
          group[0],
          `${String(existing.opaque.length)} id(s) in this repository cannot be read or shown ` +
            `different from a generated name, so no name is safe to write: ${where}`,
        ),
      );
    }
    return { names, findings };
  }
  /**
   * Every element already spoken for, across ALL groups.
   *
   * One element cannot be two anchors. A collection candidate points at its map
   * EXPRESSION and a mixed-content `<a>` yields both a link candidate and a
   * direct-text candidate, so two candidates can resolve to one opening tag
   * from DIFFERENT groups -- and a per-group set cannot see that. Both names
   * would then be written at the same offset, putting two `id` attributes on
   * one tag.
   */
  const claimed = new Set<string>();

  for (const group of ambiguous) {
    const proposed: AnchorName[] = [];
    let refusal: Finding | null = null;
    // (the claimed set is per FILE and spans every group -- see `claimed` above)
    for (const candidate of group) {
      const element = elementFor(candidate, cache);
      if (element === null) {
        refusal ??= refusalFinding(candidate, "its element could not be read back from the source");
        continue;
      }
      const at = insertionPoint(element);
      const target = `${candidate.location.file}#${String(at)}`;
      if (claimed.has(target)) {
        refusal ??= refusalFinding(
          candidate,
          "it resolves to the same element as another rival, so one id cannot tell them apart",
        );
        continue;
      }
      claimed.add(target);
      const reason = whyNotNameable(element, candidate, repositoryRoot, cache);
      if (reason !== null) {
        refusal ??= refusalFinding(candidate, reason);
        continue;
      }
      const id = uniqueIdentifier(baseIdentifier(candidate, element), taken, corpus);
      if (id === "") {
        refusal ??= refusalFinding(
          candidate,
          "every spelling of the name it would be given already occurs in this repository",
        );
        continue;
      }
      taken.add(id);
      proposed.push({
        file: candidate.location.file,
        insertAt: at,
        tag: tagNameOf(element),
        id,
        anchor: renderAnchor(candidate.anchor),
      });
    }
    if (refusal !== null || proposed.length !== group.length) {
      for (const name of proposed) {
        taken.delete(name.id);
        claimed.delete(`${name.file}#${String(name.insertAt)}`);
      }
      findings.push(refusal ?? refusalFinding(group[0], "not every rival could be named"));
      continue;
    }
    names.push(...proposed);
  }
  return { names, findings };
}

function refusalFinding(candidate: Candidate | undefined, reason: string): Finding {
  return {
    code: "AMBIGUOUS_ANCHOR",
    anchor: candidate === undefined ? null : renderAnchor(candidate.anchor),
    location: candidate?.location ?? null,
    evidence: candidate?.evidence ?? "",
    decision:
      `No name was written for this ambiguity because ${reason}. ` +
      "Name it by hand — an `id` attribute, its own named component, or a " +
      "declared collection — then re-run.",
  };
}

/**
 * Why an `id` written here would be wrong. Each of these is a way the
 * attribute would not do what it appears to, not merely a shape this code
 * finds awkward.
 */
function whyNotNameable(
  element: JsxElementNode,
  candidate: Candidate,
  repositoryRoot: string,
  cache: ModuleCache,
): string | null {
  const tag = tagNameOf(element);
  // Not `!isComponentName`: a DOTTED tag is a member expression and so a
  // component however its parts are spelled, so `<motion.div>` would have
  // passed that test and been given an id it is under no obligation to pass on.
  // `isProvablyHostTag` is the one statement of this, in `jsx-facts.ts`.
  if (!isProvablyHostTag(tag)) {
    return `'${tag}' is a component, which is under no obligation to pass an id to anything`;
  }
  for (const attribute of attributesOf(element)) {
    if (ts.isJsxSpreadAttribute(attribute)) {
      return "a spread on this element may set `id` to something else at runtime";
    }
    if (attribute.name.getText() === "id") {
      return "it already has an `id`, which is not a literal this reader can use";
    }
  }
  if (isRepeated(element)) {
    return "it is rendered once per item, so one id would appear on the page many times";
  }
  // A COLLECTION candidate sits at its map expression, so it resolves to the
  // enclosing wrapper. An id there only tells the wrapper from its siblings --
  // the walk drops that discriminator before anchoring what is inside -- so the
  // name would be written, the file changed, and the same ambiguity reported on
  // the next scan. A writer whose edit does not resolve the finding it was
  // written for is worse than one that refuses.
  if (candidate.kind === "collection" && !namesARegion(element, tagNameOf(element))) {
    return "an id here would not become part of the collection's anchor, so it would not resolve this";
  }
  // An id is written ONCE in the source and rendered once per instance of the
  // component that holds it. A component rendered twice therefore puts the same
  // DOM id on the page twice, which no check on the source text can see.
  const instances = instanceCountOf(element, repositoryRoot, cache);
  if (instances !== 1) {
    return instances === null
      ? "how many times its component renders could not be settled from the source"
      : `its component renders ${String(instances)} times, so one id would appear that often`;
  }
  return null;
}

/** Every statement that runs its body more than once. */
function isLoopStatement(node: ts.Node): boolean {
  return (
    ts.isForStatement(node) ||
    ts.isForInStatement(node) ||
    ts.isForOfStatement(node) ||
    ts.isWhileStatement(node) ||
    ts.isDoStatement(node)
  );
}

/**
 * How many times the component holding this element renders, or null when the
 * source does not settle it.
 *
 * A root -- a page or a layout, referenced by no tag -- renders once for its
 * route. A component referenced exactly once renders as often as ITS holder
 * does, so the question repeats up the chain. Anything else, including a name
 * two components share, is not settled and refuses.
 */
function instanceCountOf(
  element: ts.Node,
  repositoryRoot: string,
  cache: ModuleCache,
): number | null {
  let current: ts.Node | undefined = element;
  for (let step = 0; step <= MAX_RENDER_CHAIN; step += 1) {
    const holder = enclosingComponent(current);
    // No enclosing component: the markup is at module level, which renders with
    // whatever imports it -- not something this reader can count.
    if (holder === null) return null;
    const sites = renderSitesOf(holder, repositoryRoot, cache);
    if (sites === null) return null;
    // Referenced by nothing: a route page or a layout, rendered once.
    if (sites.length === 0) return 1;
    if (sites.length > 1) return sites.length;
    const only = sites[0];
    if (only === undefined) return null;
    // Rendered once per item is already refused above, but the site being
    // inside a callback matters again at every step up the chain.
    if (isRepeated(only)) return null;
    current = only;
  }
  return null;
}

/** The nearest enclosing component declaration, with its own module. */
function enclosingComponent(node: ts.Node): ts.Node | null {
  let current: ts.Node | undefined = node.parent;
  while (current !== undefined) {
    if (ts.isFunctionDeclaration(current) && current.name !== undefined) {
      return isComponentName(current.name.text) ? current : null;
    }
    if (
      (ts.isVariableDeclaration(current) || ts.isPropertyAssignment(current)) &&
      ts.isIdentifier(current.name)
    ) {
      return isComponentName(current.name.text) ? current : null;
    }
    current = current.parent;
  }
  return null;
}

/** The name a component declaration introduces. */
function declaredNameOf(declaration: ts.Node): string | null {
  if (ts.isFunctionDeclaration(declaration)) return declaration.name?.text ?? null;
  if (ts.isVariableDeclaration(declaration) || ts.isPropertyAssignment(declaration)) {
    return ts.isIdentifier(declaration.name) ? declaration.name.text : null;
  }
  return null;
}

/** Whether this declaration's name leaves its module. */
function isExportedComponent(declaration: ts.Node): boolean {
  let current: ts.Node | undefined = declaration;
  while (current !== undefined && !ts.isSourceFile(current)) {
    const modifiers = ts.canHaveModifiers(current) ? ts.getModifiers(current) : undefined;
    if (modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword) === true) {
      return true;
    }
    if (ts.isExportAssignment(current)) return true;
    current = current.parent;
  }
  const source = declaration.getSourceFile();
  const name = declaredNameOf(declaration);
  if (name === null) return true;
  return source.statements.some(
    (statement) =>
      ts.isExportDeclaration(statement) &&
      statement.exportClause !== undefined &&
      ts.isNamedExports(statement.exportClause) &&
      statement.exportClause.elements.some(
        (element) => (element.propertyName ?? element.name).text === name,
      ),
  );
}

/**
 * Every JSX tag that renders this declaration.
 *
 * A component that does NOT leave its module is only visible there, so two
 * modules each declaring their own local `Section` are two different
 * components and are counted separately. Counting by name across the
 * repository conflated them, and refused both. An exported name is counted
 * repository-wide, and refuses if more than one declaration answers to it.
 */
function renderSitesOf(
  declaration: ts.Node,
  repositoryRoot: string,
  cache: ModuleCache,
): readonly ts.Node[] | null {
  const name = declaredNameOf(declaration);
  if (name === null) return null;
  const own = declaration.getSourceFile();
  if (!isExportedComponent(declaration)) {
    return tagsNamed(name, own);
  }
  const sites: ts.Node[] = [];
  let declarations = 0;
  for (const file of repositoryModuleFiles(repositoryRoot)) {
    let parsed;
    try {
      parsed = cache.read(file);
    } catch {
      continue;
    }
    // A binding this reader cannot tie back to the DECLARATION means the sites
    // cannot be enumerated: a barrel re-export resolves to the barrel, and a
    // default or namespace import records no declaration name. The reachability
    // resolver follows both, so such a component does reach this path -- and
    // counting zero sites would call it a route rendered once.
    if (bindingIsUntraceable(parsed, own.fileName, name, repositoryRoot, cache)) return null;
    declarations += declarationsNamed(name, parsed.source);
    for (const local of localNamesFor(name, own.fileName, parsed, repositoryRoot, cache)) {
      sites.push(...tagsNamed(local, parsed.source));
    }
  }
  return declarations === 1 ? sites : null;
}

/**
 * Every place one module USES this component, under whichever local name it is
 * bound to.
 *
 * A tag whose spelling matches the declaration was the wrong question twice
 * over. `import { Card as Item }` renders `<Item />`, which matched nothing and
 * counted as ZERO sites -- read as a route, rendered once. And `items.map(Card)`
 * is not a tag at all, yet renders the component once per item.
 */
function tagsNamed(name: string, source: ts.SourceFile): readonly ts.Node[] {
  const sites: ts.Node[] = [];
  const visit = (node: ts.Node): void => {
    if (
      (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) &&
      ts.isIdentifier(node.tagName) &&
      node.tagName.text === name
    ) {
      sites.push(node);
      ts.forEachChild(node, visit);
      return;
    }
    // The component handed to something else -- `items.map(Card)`,
    // `renderItem={Card}` -- renders once per item, or once per whatever the
    // receiver decides, which this reader cannot count.
    if (ts.isIdentifier(node) && node.text === name && isComponentValueReference(node)) {
      sites.push(node);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return sites;
}

/** Whether this identifier HANDS the component somewhere, rather than declaring it. */
function isComponentValueReference(node: ts.Identifier): boolean {
  const parent = node.parent;
  if (parent === undefined) return false;
  if (ts.isImportSpecifier(parent) || ts.isImportClause(parent)) return false;
  if (ts.isExportSpecifier(parent)) return false;
  if (ts.isFunctionDeclaration(parent) || ts.isVariableDeclaration(parent)) return false;
  if (ts.isPropertyAccessExpression(parent) && parent.name === node) return false;
  if (ts.isJsxOpeningElement(parent) || ts.isJsxSelfClosingElement(parent)) return false;
  if (ts.isJsxClosingElement(parent)) return false;
  return true;
}

/**
 * Whether the declaring file exports this declaration as its default.
 *
 * Read from the AST, not the text. The first version matched
 * `export default Card;` with a regex that required the semicolon, so the
 * valid semicolonless spelling associated no default import with the
 * declaration -- zero render sites, which reads as a route rendered once. Using
 * a regex in a file this tool has already parsed was the whole mistake.
 */
function isDefaultExported(
  declaringFile: string,
  name: string,
  cache: ModuleCache,
): boolean {
  let parsed;
  try {
    parsed = cache.read(declaringFile);
  } catch {
    return false;
  }
  for (const statement of parsed.source.statements) {
    // `export default Card` -- with or without a semicolon, which the AST does
    // not distinguish.
    if (
      ts.isExportAssignment(statement) &&
      statement.isExportEquals !== true &&
      ts.isIdentifier(statement.expression) &&
      statement.expression.text === name
    ) {
      return true;
    }
    // `export default function Card() {}`
    if (
      ts.isFunctionDeclaration(statement) &&
      statement.name?.text === name &&
      hasModifier(statement, ts.SyntaxKind.DefaultKeyword)
    ) {
      return true;
    }
    // `export default class Card {}`
    if (
      ts.isClassDeclaration(statement) &&
      statement.name?.text === name &&
      hasModifier(statement, ts.SyntaxKind.DefaultKeyword)
    ) {
      return true;
    }
  }
  return false;
}

function hasModifier(node: ts.Node, kind: ts.SyntaxKind): boolean {
  const modifiers = ts.canHaveModifiers(node) ? ts.getModifiers(node) : undefined;
  return modifiers?.some((modifier) => modifier.kind === kind) === true;
}

/**
 * Whether this module reaches the declaring file by a route that hides which
 * declaration a local name stands for.
 *
 * A default or namespace import records no declaration name, and a module that
 * RE-EXPORTS the declaring file is a barrel whose importers resolve to the
 * barrel rather than to the declaration. Either way the local name cannot be
 * tied to this component, so its render sites cannot be counted.
 */
function bindingIsUntraceable(
  module: ParsedModule,
  declaringFile: string,
  name: string,
  repositoryRoot: string,
  cache: ModuleCache,
): boolean {
  for (const reference of importedBindingsOf(module, repositoryRoot).values()) {
    if (reference.resolvedFile !== declaringFile) continue;
    // A namespace import carries every name at once, so which binding a tag
    // used cannot be told from the import. A DEFAULT import is traceable: it
    // binds one declaration under one local name, which `localNamesFor`
    // resolves.
    if (reference.importedName === null) return true;
  }
  for (const statement of module.source.statements) {
    // `import X from "./Card"; export default X;` is the other re-export shape.
    // It is NOT checked here: that spelling already refuses upstream of this
    // guard, and a branch no test can reach is the third piece of dead code
    // this file would be carrying. `DEFAULT_BARRELS` keeps a row on it so the
    // refusal cannot regress unnoticed.
    if (!ts.isExportDeclaration(statement)) continue;
    const specifier = statement.moduleSpecifier;
    if (specifier === undefined) {
      // `import { Card } from "./Card"; export { Card };` -- a barrel with no
      // `from`. It forwards the binding just as a re-export does, and a
      // consumer of THIS module resolves here rather than to the declaring
      // file, so its render sites are invisible to the count. The declaring
      // module exporting its own binding is not that, and is skipped.
      if (module.file === declaringFile) continue;
      if (forwardsALocalBinding(statement, module, declaringFile, repositoryRoot, cache, name)) {
        return true;
      }
      continue;
    }
    if (!ts.isStringLiteral(specifier)) continue;
    const resolved = repositoryFileForSpecifier(specifier.text, module.file, repositoryRoot);
    if (resolved !== declaringFile) continue;
    // `export * from` carries every name; `export { X } from` carries this one.
    const clause = statement.exportClause;
    if (clause === undefined) return true;
    if (!ts.isNamedExports(clause)) return true;
    if (
      clause.elements.some((element) =>
        exportNameCarries((element.propertyName ?? element.name).text, declaringFile, name, cache),
      )
    ) {
      return true;
    }
  }
  return false;
}

/**
 * Whether a `from`-less export forwards a local binding that holds this
 * declaration.
 *
 * The locals come from `localNamesFor`, the same reader that resolves them for
 * counting, so the two cannot disagree about which name holds what.
 */
function forwardsALocalBinding(
  statement: ts.ExportDeclaration,
  module: ParsedModule,
  declaringFile: string,
  repositoryRoot: string,
  cache: ModuleCache,
  name: string,
): boolean {
  const clause = statement.exportClause;
  // `export * ;` is not valid without `from`, so a missing clause here cannot
  // forward anything.
  if (clause === undefined || !ts.isNamedExports(clause)) return false;
  const locals = localNamesFor(name, declaringFile, module, repositoryRoot, cache);
  if (locals.length === 0) return false;
  // The LOCAL side of a specifier is `propertyName` when it is aliased
  // (`export { Card as Item }`) and `name` when it is not.
  return clause.elements.some((element) =>
    locals.includes((element.propertyName ?? element.name).text),
  );
}

/**
 * Whether an exported name carries THIS declaration out of its module.
 *
 * A binding travels under two names, not one: its own, and `default` when it is
 * the default export. `localNamesFor` already knew that -- it resolves
 * `import Card from "./Card"` -- and this side did not, so
 * `export { default as Card } from "./Card"` was read as carrying nothing.
 * Consumers then resolved to the barrel, no render site was found, and a zero
 * count became "rendered once": fixed ids written into a declaration rendered
 * twice, which is the duplicate DOM id this whole reader exists to prevent.
 *
 * One predicate for both readers, because the disagreement WAS the defect.
 */
function exportNameCarries(
  exportedName: string,
  declaringFile: string,
  name: string,
  cache: ModuleCache,
): boolean {
  if (exportedName === name) return true;
  return exportedName === "default" && isDefaultExported(declaringFile, name, cache);
}

/**
 * The local names a module binds this component to, aliases included.
 *
 * `import { Card as Item }` binds it to `Item`, so counting `<Card />` there
 * finds nothing and reports zero sites.
 */
function localNamesFor(
  name: string,
  declaringFile: string,
  module: ParsedModule,
  repositoryRoot: string,
  cache: ModuleCache,
): readonly string[] {
  if (module.file === declaringFile) return [name];
  const names: string[] = [];
  for (const [local, reference] of importedBindingsOf(module, repositoryRoot)) {
    if (reference.resolvedFile !== declaringFile) continue;
    // The name it was exported under, or -- for `import Nav from "./Nav"` --
    // the local name the default binding took.
    if (reference.importedName === name) names.push(local);
    else if (
      reference.importedName === "default" &&
      isDefaultExported(declaringFile, name, cache)
    ) {
      names.push(local);
    }
  }
  return names;
}

/** Declarations in one module introducing this name. */
function declarationsNamed(name: string, source: ts.SourceFile): number {
  let count = 0;
  const visit = (node: ts.Node): void => {
    if (ts.isFunctionDeclaration(node) && node.name?.text === name) count += 1;
    if (
      (ts.isVariableDeclaration(node) || ts.isPropertyAssignment(node)) &&
      ts.isIdentifier(node.name) &&
      node.name.text === name
    ) {
      count += 1;
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return count;
}

/** How many opaque ids are named in the refusal, so it stays readable. */
const OPAQUE_IDS_REPORTED = 3;

/** How far up the render chain the instance count is followed. */
const MAX_RENDER_CHAIN = 8;

/**
 * Whether the element is inside a callback the surrounding code iterates. One
 * id written there is rendered once per item, which is a duplicate id on the
 * page — the exact failure this whole naming exists to avoid.
 */
function isRepeated(element: ts.Node): boolean {
  let current: ts.Node | undefined = element.parent;
  while (current !== undefined && !ts.isSourceFile(current)) {
    if (ts.isArrowFunction(current) || ts.isFunctionExpression(current)) {
      const call = current.parent;
      if (ts.isCallExpression(call) && call.arguments.includes(current as ts.Expression)) {
        return true;
      }
    }
    // An imperative loop renders its body once per iteration just as a callback
    // does: `for (...) cards.push(<Card key={i} />)` has ONE lexical site and
    // many rendered elements, so a fixed id written inside it is duplicated.
    if (isLoopStatement(current)) return true;
    current = current.parent;
  }
  return false;
}

/** Just past the tag name, where an attribute may always be written. */
function insertionPoint(element: JsxElementNode): number {
  const opening = ts.isJsxElement(element) ? element.openingElement : element;
  return opening.tagName.getEnd();
}

/** The element a candidate points at, found back through its recorded offset. */
function elementFor(candidate: Candidate, cache: ModuleCache): JsxElementNode | null {
  let parsed;
  try {
    parsed = cache.read(candidate.location.file);
  } catch {
    return null;
  }
  let found: JsxElementNode | null = null;
  const visit = (node: ts.Node): void => {
    if (node.getStart(parsed.source) > candidate.location.offset) return;
    if (node.getEnd() <= candidate.location.offset) return;
    if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) found = node;
    ts.forEachChild(node, visit);
  };
  visit(parsed.source);
  return found;
}

/** A readable name derived from the component and the element's own words. */
function baseIdentifier(candidate: Candidate, element: JsxElementNode): string {
  const component = slugify(candidate.componentNames[0] ?? "");
  const words = slugify(ownWords(element));
  const tail = words.length > 0 ? words : slugify(tagNameOf(element));
  const base = component.length > 0 ? `${component}-${tail}` : tail;
  const trimmed = base.slice(0, MAX_SLUG_LENGTH).replace(/-+$/u, "");
  return `${NAME_PREFIX}${trimmed.length > 0 ? trimmed : "anchor"}`;
}

/** The element's own literal text, which is what a person would call it. */
function ownWords(element: JsxElementNode): string {
  if (!ts.isJsxElement(element)) return "";
  const parts: string[] = [];
  for (const child of element.children) {
    if (ts.isJsxText(child)) parts.push(child.text);
  }
  return parts.join(" ").trim().split(/\s+/u).slice(0, MAX_TEXT_WORDS).join(" ");
}

function slugify(value: string): string {
  return value
    // JSX text keeps its entities, and `&apos;` is not a word.
    .replace(/&[a-z]+;|&#\d+;/giu, " ")
    .replace(/([a-z0-9])([A-Z])/gu, "$1-$2")
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "");
}

/**
 * A name nothing in the repository already says.
 *
 * `taken` lists the places this reader knows how to READ -- a literal `id`, a
 * fragment, an IDREF, a `getElementById` argument. Every round of review found
 * another spelling it did not: an id passed through a component prop, an id in
 * a stylesheet, an id built from a name. Enumerating spellings does not
 * terminate.
 *
 * So the last word is a text search: the chosen name must not occur anywhere in
 * the repository, in any file, in any syntax. That is bounded, total, and it
 * covers every spelling that exists today and every one added later. `taken`
 * stays because it is what makes the SUFFIX search terminate sensibly, and
 * because a name reserved for a reason worth reporting is worth naming.
 */
function uniqueIdentifier(
  base: string,
  taken: ReadonlySet<string>,
  corpus: string,
): string {
  if (!taken.has(base) && !occursInText(base, corpus)) return base;
  for (let suffix = 2; suffix <= MAX_NAME_SUFFIX; suffix += 1) {
    const candidate = `${base}-${suffix}`;
    if (!taken.has(candidate) && !occursInText(candidate, corpus)) return candidate;
  }
  // Every spelling of this name is spoken for. The caller refuses the group.
  return "";
}

/** How many suffixes are tried before the name is given up on. */
const MAX_NAME_SUFFIX = 64;

/**
 * Whether this name occurs in the text as a WHOLE id-ish token.
 *
 * A bare substring match would refuse `ms-hero-start` because
 * `ms-hero-start-2` exists, and then refuse every suffix of it too. The
 * delimiters are the characters an id may contain, so a longer token does not
 * count as an occurrence of a shorter one.
 */
function occursInText(name: string, text: string): boolean {
  const token = name.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  return new RegExp(`(^|[^A-Za-z0-9_-])${token}([^A-Za-z0-9_-]|$)`, "u").test(text);
}

/**
 * Every string a module's literals actually produce, joined for searching.
 *
 * A selector or fragment written `"#ms\x2dhome"` denotes `#ms-home` while no
 * text in the file spells that. Enumerating JavaScript's escape forms is the
 * shape of problem that does not terminate -- `\x2d`, `\u002d`, `\u{2d}`,
 * `\
 * ` -- so the values come from the scanner that already resolved them: a
 * literal node's `text` IS the decoded value.
 */
function decodedLiteralsOf(source: ts.SourceFile | null): string {
  if (source === null) return "";
  const values: string[] = [];
  const visit = (node: ts.Node): void => {
    if (
      ts.isStringLiteral(node) ||
      ts.isNoSubstitutionTemplateLiteral(node) ||
      ts.isTemplateHead(node) ||
      ts.isTemplateMiddle(node) ||
      ts.isTemplateTail(node)
    ) {
      values.push(node.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return values.join("\n");
}

/** Every file's text, read once, as the corpus a chosen name must not appear in. */
function repositoryText(
  repositoryRoot: string,
  ownPaths: readonly string[],
  cache: ModuleCache,
): string {
  const parts: string[] = [];
  for (const file of repositoryFiles(repositoryRoot, SEARCHED_FILE_EXTENSIONS)) {
    // This tool's own output is not part of the repository it is reading. A dry
    // run writes the proposed names, and a second unchanged run that read them
    // back would find every name occupied and propose suffixed ones instead --
    // the same input producing a different answer each time. See `OwnArtifacts`
    // for why the ledger is in this set even though it lives in the tree.
    if (isOwnArtifact(file, ownPaths)) continue;
    try {
      const text = readFileSync(file, "utf8");
      parts.push(text);
      // `"#ms\x2dhome"` is the id `#ms-home`, and the file does not contain
      // that spelling anywhere. Reading raw text alone let a name be minted
      // that a selector in this repository already denotes, so applying it
      // turned a selector that matched nothing into one that matches the
      // element just named. Every JS escape form -- `\x2d`, `\u002d`,
      // `\u{2d}`, a line continuation -- resolves in one place, so the value
      // is taken from TypeScript's own scanner instead of being decoded here.
      const literals = decodedLiteralsOf(cache.read(file)?.source ?? null);
      if (literals !== "") parts.push(literals, decodeCssEscapes(literals));
      // A CSS selector may ESCAPE characters an identifier allows anyway:
      // `#ms\\-home` and `#ms\\2d home` both select `ms-home`. The decoded
      // spelling is appended so the search sees the name the browser sees.
      const decoded = decodeCssEscapes(text);
      if (decoded !== text) parts.push(decoded);
    } catch {
      continue;
    }
  }
  return parts.join("\n");
}

/**
 * Whether a file is one this run writes, named directly or by a directory above
 * it.
 *
 * `containsPath` answers both, because a path contains itself, and it resolves
 * each side first -- which matters here, since a ledger reached as
 * `/var/...` and walked to as `/private/var/...` is one file with two
 * spellings, and comparing the spellings would put it back in the corpus.
 *
 * One rule for this, in `scan.ts`, because the layout walk asks the same
 * question and the two answers must not drift.
 */
function isOwnArtifact(file: string, ownPaths: readonly string[]): boolean {
  return ownPaths.some((own) => containsPath(own, file));
}

/**
 * A CSS identifier with its escapes resolved to the characters they name.
 *
 * Two forms, and only handling the first was the defect: `\\-` is a literal
 * `-`, but `\\2d ` is the code point 0x2D -- also `-` -- with a single trailing
 * whitespace that terminates the hex and is consumed. Treating that as a
 * one-character escape produced `2d ` and the browser-resolved id was never
 * seen.
 */
function decodeCssEscapes(text: string): string {
  if (!text.includes("\\")) return text;
  return text.replace(
    /\\(?:([0-9a-fA-F]{1,6})[ \t\n\r\f]?|([^\n\r\f]))/gu,
    (whole, hex: string | undefined, literal: string | undefined) => {
      if (hex === undefined) return literal ?? whole;
      const point = Number.parseInt(hex, 16);
      // 0 and anything past the last code point are errors in CSS; leaving the
      // text alone is the answer that invents nothing. Redundant with the catch
      // below, which `String.fromCodePoint` would reach by throwing -- kept
      // because the intent is a rule, not an exception handler.
      if (!Number.isFinite(point) || point <= 0 || point > 0x10ffff) return whole;
      try {
        return String.fromCodePoint(point);
      } catch {
        return whole;
      }
    },
  );
}

/** Everything a name could be written in, which is every file this tool reads. */
const SEARCHED_FILE_EXTENSIONS = [
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".css",
  ".scss",
  ".sass",
  ".less",
  ".html",
  ".json",
  ".md",
  ".mdx",
] as const;

/**
 * Every name already spoken for.
 *
 * A literal `id` attribute is only the half this reader can see for certain.
 * A `#fragment` link, a stylesheet rule and a `getElementById` argument each
 * name an id too, and a new element answering to one of those names is a
 * silent change to the page. So this also takes every `#name` written anywhere
 * in the repository, including its stylesheets. Over-reserving costs a numeric
 * suffix; under-reserving costs a duplicate id nobody notices.
 */
/**
 * Every name already spoken for, and every element whose id cannot be shown
 * disjoint from the names this writer mints.
 *
 * An opaque id is not a name to avoid; it is a reason to write nothing at all,
 * because which name it takes is exactly what is unknown.
 */
interface ExistingNames {
  readonly taken: readonly string[];
  readonly opaque: readonly ts.Node[];
}

function takenIdentifiers(
  repositoryRoot: string,
  cache: ModuleCache,
  ownPaths: readonly string[],
): ExistingNames {
  const found: string[] = [];
  const opaque: ts.Node[] = [];
  for (const file of repositoryModuleFiles(repositoryRoot)) {
    let parsed;
    try {
      parsed = cache.read(file);
    } catch {
      continue;
    }
    const visit = (node: ts.Node): void => {
      if (ts.isJsxAttribute(node) && node.name.getText() === "id") {
        // `literalAttributeValue` is what the rest of this tool means by "an id
        // written as a literal", and it reads `id="x"`, `id={"x"}` and
        // ``id={`x`}`` alike. Reading only the first spelling here meant a
        // generated name could duplicate an id the page already renders --
        // which is the one failure this whole naming exists to avoid.
        const literal = literalAttributeValue(node);
        if (literal !== null) found.push(literal);
        // An `id` this reader CANNOT read is the dangerous case, not the safe
        // one: `id={RESERVED_ID}` may evaluate to any name, so no generated
        // name can be shown disjoint from it. The candidate's own element is
        // already refused for this; another element carrying one has to make
        // the whole file's names unavailable, because which name it takes is
        // exactly what is unknown.
        // An id this reader cannot read as a literal still has to be shown
        // disjoint from every name this writer mints, or it may already be one.
        if (literal === null && !cannotBeAGeneratedName(node, repositoryRoot, cache)) {
          opaque.push(node);
        }
      }
      // A spread can supply an `id` of any value, and nothing about it is
      // readable, so it can never be shown disjoint.
      if (ts.isJsxSpreadAttribute(node)) opaque.push(node);
      // An IDREF attribute POINTS at an id. If it currently points at nothing,
      // generating that name would silently bind it -- an accessibility
      // relationship this writer claims not to change.
      if (ts.isJsxAttribute(node) && IDREF_ATTRIBUTES.has(node.name.getText())) {
        const literal = literalAttributeValue(node);
        if (literal !== null) found.push(...literal.split(/\s+/u).filter((one) => one !== ""));
        else if (!cannotBeAGeneratedName(node, repositoryRoot, cache)) opaque.push(node);
      }
      // A name an ID API already looks up is spoken for, even though nothing
      // carries it yet. `document.getElementById("ms-home-start-anywhere")`
      // finds nothing today; handing that name out would make it select the new
      // paragraph, so the attribute would not be inert -- which is the whole
      // claim this writer makes.
      // A FRAGMENT or selector built from a name points at whatever that name
      // holds. `href={`#${target}`}` matches no literal `#name`, so the regex
      // scan sees nothing, and if `target` is a generated name the anchor
      // silently acquires a link.
      // Any FRAGMENT-valued expression, not just a template. `"#" + target`
      // and a bare `href={fragment}` are neither literal `#name` for the text
      // scan nor templates for the reader below.
      if (ts.isJsxAttribute(node) && FRAGMENT_ATTRIBUTES.has(node.name.getText())) {
        const built = fragmentsWrittenBy(node.initializer);
        found.push(...built.literals);
        if (built.unknown) opaque.push(node);
      }
      if (ts.isTemplateExpression(node)) {
        const built = fragmentsBuiltBy(node);
        // A fragment written as a literal after the hash is a name spoken for.
        found.push(...built.literals);
        if (built.unknown) opaque.push(node);
      }
      if (ts.isCallExpression(node)) {
        const looked = identifiersLookedUpBy(node);
        found.push(...looked);
        // An id this lookup takes that cannot be read, nor shown different from
        // the names this writer mints, is the same hazard as an unreadable
        // `id`: applying anchors would change what the lookup finds.
        if (lookupArgumentIsOpaque(node)) opaque.push(node);
        // A selector takes `#name` inside a string, so a selector built from a
        // name is the same hazard one syntax along.
        if (selectorArgumentIsOpaque(node)) opaque.push(node);
      }
      ts.forEachChild(node, visit);
    };
    visit(parsed.source);
    found.push(...fragmentsIn(parsed.source.getFullText()));
    found.push(...fragmentsIn(decodedLiteralsOf(parsed.source)));
  }
  for (const file of repositoryFiles(repositoryRoot, SELECTOR_FILE_EXTENSIONS)) {
    if (isOwnArtifact(file, ownPaths)) continue;
    try {
      const text = readFileSync(file, "utf8");
      // `#{$prefix}start-anywhere` compiles to a selector for an id no text in
      // this repository spells contiguously, so neither scan can see it and no
      // name can be shown disjoint from it.
      if (SELECTOR_INTERPOLATION.test(text)) opaque.push(interpolatedSelector(file));
      found.push(...fragmentsIn(text));
    } catch {
      continue;
    }
  }
  return { taken: found, opaque };
}

/**
 * The ids a call looks up, when it names them as literals.
 *
 * Only the APIs that take an ID ITSELF. `querySelector` takes a selector, which
 * the fragment scan already covers by matching `#name` in any text, so it is
 * not repeated here.
 */
function identifiersLookedUpBy(call: ts.CallExpression): readonly string[] {
  const callee = call.expression;
  const method = ts.isPropertyAccessExpression(callee)
    ? callee.name.text
    : ts.isIdentifier(callee)
      ? callee.text
      : null;
  if (method === null || !ID_LOOKUP_METHODS.has(method)) return [];
  const found: string[] = [];
  for (const argument of call.arguments) {
    const direct =
      ts.isStringLiteral(argument) || ts.isNoSubstitutionTemplateLiteral(argument)
        ? argument.text
        : null;
    if (direct !== null) {
      found.push(direct);
      continue;
    }
    // `const target = "ms-..."; getElementById(target)` names an id this
    // reader can read, one hop along, so it is reserved rather than opaque.
    const bound = ts.isIdentifier(argument) ? boundInitializerOf(argument) : null;
    if (bound === null) continue;
    if (ts.isStringLiteral(bound) || ts.isNoSubstitutionTemplateLiteral(bound)) {
      found.push(bound.text);
    }
  }
  return found;
}

/**
 * Whether this attribute's value provably cannot be a name this writer mints.
 *
 * Two ways to show it, and nothing else counts:
 *
 * - the value starts with a literal chunk that differs from `ms-` inside the
 *   part both spell out. `` `field-${name}` `` can never be `ms-anything`,
 *   whatever the interpolation holds.
 * - the value is the enclosing component's own prop, and every tag that renders
 *   that component passes a literal. Those literals are then reserved by the
 *   caller, so the collision is settled rather than assumed away.
 *
 * Anything else is opaque, and an opaque id makes naming refuse rather than
 * risking a duplicate on the page.
 */
function cannotBeAGeneratedName(
  attribute: ts.JsxAttribute,
  repositoryRoot: string,
  cache: ModuleCache,
): boolean {
  const initializer = attribute.initializer;
  if (initializer === undefined) return true;
  const expression = ts.isJsxExpression(initializer) ? initializer.expression : initializer;
  if (expression === undefined) return false;
  const head = literalHeadOf(expression);
  if (head !== null && divergesFromPrefix(head)) return true;
  if (!ts.isIdentifier(expression)) return false;
  // A local `const id = `field-${field.name}`` is the commonest way a real form
  // builds an id. Following it one hop gives the same literal head.
  const bound = boundInitializerOf(expression);
  if (bound !== null) {
    const boundHead = literalHeadOf(bound);
    if (boundHead !== null && divergesFromPrefix(boundHead)) return true;
  }
  // The prop exemption applies only when the name IS the component's own
  // parameter. `const id = runtimeId` binds a local that merely shares a prop's
  // name, and callers passing a literal `id` prop say nothing about it.
  if (!isComponentParameter(expression)) return false;
  return propAlwaysLiteral(expression, repositoryRoot, cache);
}

/**
 * The initializer of the nearest `const` or `let` binding this name refers to.
 *
 * One hop, in the scopes that enclose the reference, and only where the name is
 * bound exactly once on the way up -- two bindings of one name is an ambiguity
 * this reader does not resolve.
 */
function boundInitializerOf(reference: ts.Identifier): ts.Expression | null {
  let scope: ts.Node | undefined = reference.parent;
  while (scope !== undefined) {
    const statements = ts.isBlock(scope) || ts.isSourceFile(scope) ? scope.statements : null;
    if (statements !== null) {
      const found = statements
        .filter(ts.isVariableStatement)
        .flatMap((statement) => [...statement.declarationList.declarations])
        .filter(
          (declaration) =>
            ts.isIdentifier(declaration.name) && declaration.name.text === reference.text,
        );
      if (found.length > 1) return null;
      const only = found[0];
      if (only?.initializer !== undefined) return only.initializer;
    }
    scope = scope.parent;
  }
  return null;
}

/** The literal text a value is known to start with, if any. */
function literalHeadOf(expression: ts.Expression): string | null {
  if (ts.isStringLiteral(expression) || ts.isNoSubstitutionTemplateLiteral(expression)) {
    return expression.text;
  }
  if (ts.isTemplateExpression(expression)) return expression.head.text;
  // `"field-" + name` — the left side is what the value starts with.
  if (
    ts.isBinaryExpression(expression) &&
    expression.operatorToken.kind === ts.SyntaxKind.PlusToken
  ) {
    return literalHeadOf(expression.left);
  }
  return null;
}

/**
 * Whether a value starting with this text can never equal a generated name.
 *
 * They must differ within the part BOTH spell out. A head of `"m"` proves
 * nothing, because the rest could complete `ms-`.
 */
function divergesFromPrefix(head: string): boolean {
  const shared = Math.min(head.length, NAME_PREFIX.length);
  return head.slice(0, shared) !== NAME_PREFIX.slice(0, shared);
}

/**
 * Whether this identifier resolves to the enclosing component's own parameter.
 *
 * A LOCAL binding of the same name shadows the parameter, so what the render
 * sites pass says nothing about the value here. Without this, `const id =
 * runtimeId` inside a component whose callers pass a literal `id` prop was
 * accepted while the rendered id stayed dynamic.
 */
function isComponentParameter(reference: ts.Identifier): boolean {
  const holder = enclosingComponent(reference);
  if (holder === null) return false;
  const parameters = ts.isFunctionDeclaration(holder)
    ? holder.parameters
    : ts.isVariableDeclaration(holder) &&
        holder.initializer !== undefined &&
        (ts.isArrowFunction(holder.initializer) ||
          ts.isFunctionExpression(holder.initializer))
      ? holder.initializer.parameters
      : null;
  if (parameters === null) return false;
  const bound = new Set<string>();
  for (const parameter of parameters) collectParameterNames(parameter.name, bound);
  if (!bound.has(reference.text)) return false;
  // A local declaration of the same name shadows the parameter, and this reader
  // does not decide which one won.
  return boundInitializerOf(reference) === null;
}

/** The names a parameter introduces, through any pattern. */
function collectParameterNames(name: ts.BindingName, into: Set<string>): void {
  if (ts.isIdentifier(name)) {
    into.add(name.text);
    return;
  }
  for (const element of name.elements) {
    if (ts.isBindingElement(element)) collectParameterNames(element.name, into);
  }
}

/**
 * Whether this name is the enclosing component's prop and every tag rendering
 * that component passes an `id` written as a literal.
 */
function propAlwaysLiteral(
  reference: ts.Identifier,
  repositoryRoot: string,
  cache: ModuleCache,
): boolean {
  const holder = enclosingComponent(reference);
  if (holder === null) return false;
  const sites = renderSitesOf(holder, repositoryRoot, cache);
  if (sites === null || sites.length === 0) return false;
  return sites.every((site) => {
    if (!ts.isJsxOpeningElement(site) && !ts.isJsxSelfClosingElement(site)) return false;
    if (site.attributes.properties.some(ts.isJsxSpreadAttribute)) return false;
    const passed = site.attributes.properties.find(
      (property): property is ts.JsxAttribute =>
        ts.isJsxAttribute(property) && property.name.getText() === reference.text,
    );
    return passed !== undefined && literalAttributeValue(passed) !== null;
  });
}

/**
 * Attributes whose value IS one or more ids, pointing at other elements.
 *
 * `aria-labelledby` takes a space-separated LIST, so each token is a name that
 * is spoken for. Generating one would bind a relationship that currently points
 * at nothing.
 */
const IDREF_ATTRIBUTES: ReadonlySet<string> = new Set([
  "aria-labelledby",
  "aria-describedby",
  "aria-controls",
  "aria-owns",
  "aria-details",
  "aria-errormessage",
  "aria-flowto",
  "aria-activedescendant",
  "htmlFor",
  "for",
]);

/**
 * Whether an id-lookup call takes an argument this reader can neither read nor
 * tell apart from a generated name.
 *
 * A literal is read by `identifiersLookedUpBy`. A name bound to a literal is
 * read one hop along. A value whose literal head diverges from the prefix can
 * never be a generated name. Anything else is opaque, and an opaque lookup
 * makes every name unsafe to write.
 */
function lookupArgumentIsOpaque(call: ts.CallExpression): boolean {
  const callee = call.expression;
  const method = ts.isPropertyAccessExpression(callee)
    ? callee.name.text
    : ts.isIdentifier(callee)
      ? callee.text
      : null;
  if (method === null || !ID_LOOKUP_METHODS.has(method)) return false;
  return call.arguments.some((argument) => {
    if (ts.isStringLiteral(argument) || ts.isNoSubstitutionTemplateLiteral(argument)) return false;
    const head = literalHeadOf(argument);
    if (head !== null && divergesFromPrefix(head)) return false;
    if (!ts.isIdentifier(argument)) return true;
    const bound = boundInitializerOf(argument);
    if (bound === null) return true;
    if (ts.isStringLiteral(bound) || ts.isNoSubstitutionTemplateLiteral(bound)) return false;
    const boundHead = literalHeadOf(bound);
    return !(boundHead !== null && divergesFromPrefix(boundHead));
  });
}

/**
 * Whether a selector call is handed a selector this reader cannot read.
 *
 * `querySelector("#hero")` is covered by the fragment regex, which matches
 * `#name` in any text. `querySelector(`#${target}`)` is not: nothing literal
 * says which id it means.
 */
function selectorArgumentIsOpaque(call: ts.CallExpression): boolean {
  const callee = call.expression;
  const method = ts.isPropertyAccessExpression(callee)
    ? callee.name.text
    : ts.isIdentifier(callee)
      ? callee.text
      : null;
  if (method === null || !SELECTOR_METHODS.has(method)) return false;
  return call.arguments.some((argument) => {
    if (ts.isStringLiteral(argument) || ts.isNoSubstitutionTemplateLiteral(argument)) return false;
    if (ts.isTemplateExpression(argument)) {
      // A selector names an id by more syntaxes than `#`: `[id="x"]`,
      // `[id~="x"]`, and the fragment form. Rather than enumerate them, any
      // interpolation in a selector that cannot be shown disjoint refuses --
      // a selector built from a name is rare, and which syntax it uses is not
      // something this reader should have to keep a list of.
      if (fragmentsBuiltBy(argument).unknown) return true;
      return argument.templateSpans.some(
        (span) => !expressionCannotBeAGeneratedName(span.expression),
      );
    }
    return true;
  });
}

/** Calls that take a SELECTOR, in which `#name` means an id. */
const SELECTOR_METHODS: ReadonlySet<string> = new Set([
  "querySelector",
  "querySelectorAll",
  "closest",
  "matches",
]);

/** Attributes whose value may be a fragment, so `#name` in it targets an id. */
const FRAGMENT_ATTRIBUTES: ReadonlySet<string> = new Set(["href", "xlinkHref", "action"]);

/**
 * The fragment ids an attribute VALUE writes, whatever shape it takes.
 *
 * A value is flattened into literal text and unknown pieces, so a template, a
 * `+` concatenation and a name bound to either are all read the same way. What
 * follows a `#` is the id: literal text is a name spoken for, an unknown piece
 * is a name unknown.
 *
 * A value with no readable `#` at all is not treated as a fragment. That is a
 * deliberate limit rather than a proof: a bare `href={fragment}` whose value is
 * assembled at runtime could begin with one. Refusing on it costs every name on
 * a real site -- 67 of its hrefs are dynamic -- and the whole-repository text
 * search is what actually stands between a generated name and an existing
 * reference, since a runtime value would have to spell the name without the
 * name appearing anywhere in the source.
 */
function fragmentsWrittenBy(initializer: ts.JsxAttribute["initializer"]): {
  readonly literals: readonly string[];
  readonly unknown: boolean;
} {
  if (initializer === undefined) return { literals: [], unknown: false };
  const expression = ts.isJsxExpression(initializer) ? initializer.expression : initializer;
  if (expression === undefined) return { literals: [], unknown: false };
  const parts = flattenValue(expression, 0);
  if (parts === null) return { literals: [], unknown: true };
  const literals: string[] = [];
  let unknown = false;
  for (const [index, part] of parts.entries()) {
    if (part.kind !== "text") continue;
    const hash = part.text.lastIndexOf("#");
    if (hash < 0) continue;
    // The id is everything after the hash, which runs on through the literal
    // pieces that follow until something unreadable or the end.
    let id = part.text.slice(hash + 1);
    let ended = true;
    for (const rest of parts.slice(index + 1)) {
      if (rest.kind !== "text") {
        ended = false;
        break;
      }
      id += rest.text;
    }
    if (ended) {
      if (id !== "") literals.push(id);
      continue;
    }
    // It runs into something unreadable, so only the ACCUMULATED start proves
    // anything: `#ms-` followed by an unknown is a name this writer could mint,
    // however that unknown behaves on its own.
    if (!divergesFromPrefix(id)) unknown = true;
  }
  return { literals, unknown };
}

/** A value as literal text and the pieces this reader cannot read. */
type ValuePart = { readonly kind: "text"; readonly text: string } | { readonly kind: "unknown" };

/** Flattens a value into its literal and unknown pieces, or null past the depth cap. */
function flattenValue(expression: ts.Expression, depth: number): readonly ValuePart[] | null {
  if (depth > MAX_FLATTEN_DEPTH) return null;
  if (ts.isStringLiteral(expression) || ts.isNoSubstitutionTemplateLiteral(expression)) {
    return [{ kind: "text", text: expression.text }];
  }
  if (ts.isTemplateExpression(expression)) {
    const parts: ValuePart[] = [{ kind: "text", text: expression.head.text }];
    for (const span of expression.templateSpans) {
      const inner = flattenValue(span.expression, depth + 1) ?? [{ kind: "unknown" } as const];
      parts.push(...inner, { kind: "text", text: span.literal.text });
    }
    return parts;
  }
  if (
    ts.isBinaryExpression(expression) &&
    expression.operatorToken.kind === ts.SyntaxKind.PlusToken
  ) {
    const left = flattenValue(expression.left, depth + 1);
    const right = flattenValue(expression.right, depth + 1);
    if (left === null || right === null) return null;
    return [...left, ...right];
  }
  if (
    ts.isParenthesizedExpression(expression) ||
    ts.isAsExpression(expression) ||
    ts.isSatisfiesExpression(expression) ||
    ts.isNonNullExpression(expression)
  ) {
    return flattenValue(expression.expression, depth + 1);
  }
  if (ts.isIdentifier(expression)) {
    const bound = boundInitializerOf(expression);
    if (bound !== null) return flattenValue(bound, depth + 1);
  }
  return [{ kind: "unknown" }];
}

/** How far a value is followed before this reader gives up on reading it. */
const MAX_FLATTEN_DEPTH = 8;

/**
 * The fragment ids a template writes, and whether any of them is unknown.
 *
 * What follows the `#` IS the id, so the question is only ever about that. In
 * `` `${SITE_URL}/#office-portland` `` the hash sits in a SPAN -- invisible to a
 * check on the head -- but what follows it is a literal, so the id is known and
 * reserved. In `` `${prefix}#${target}` `` an interpolation follows the hash, so
 * the id is whatever that holds.
 *
 * Requiring every interpolation to be disjoint was the wrong question and cost
 * every name on a real site, whose canonical URL is an imported constant.
 */
function fragmentsBuiltBy(template: ts.TemplateExpression): {
  readonly literals: readonly string[];
  readonly unknown: boolean;
} {
  const literals: string[] = [];
  let unknown = false;
  // Each literal part, paired with the interpolation that continues it.
  const parts: readonly { readonly text: string; readonly next: ts.Expression | null }[] = [
    { text: template.head.text, next: template.templateSpans[0]?.expression ?? null },
    ...template.templateSpans.map((span, index) => ({
      text: span.literal.text,
      next: template.templateSpans[index + 1]?.expression ?? null,
    })),
  ];
  for (const part of parts) {
    const hash = part.text.lastIndexOf("#");
    if (hash < 0) continue;
    const after = part.text.slice(hash + 1);
    if (part.next === null) {
      // The template ends here, so the id is exactly this text.
      if (after !== "") literals.push(after);
      continue;
    }
    // An interpolation continues the id. Two proofs that it still cannot be one
    // of these names: the literal start already diverges from the prefix, or the
    // interpolation's own value does.
    // The id STARTS with this literal, so it is the accumulated text that has
    // to diverge -- not the pieces independently. `` `#ms-${suffix}` `` has a
    // literal `ms-` that does not diverge, and testing the interpolation on its
    // own called the whole thing safe while the runtime id was `ms-...`.
    if (divergesFromPrefix(after)) continue;
    // Only where the literal contributes NOTHING can the interpolation's own
    // value settle it, because then the id begins with whatever it holds.
    if (after === "" && expressionCannotBeAGeneratedName(part.next)) continue;
    unknown = true;
  }
  return { literals, unknown };
}

/**
 * Whether this expression provably cannot evaluate to a generated name.
 *
 * The same two proofs the `id` attribute uses, on a bare expression: a literal
 * head that diverges from the prefix, or a name bound to one.
 */
function expressionCannotBeAGeneratedName(expression: ts.Expression): boolean {
  const head = literalHeadOf(expression);
  if (head !== null && divergesFromPrefix(head)) return true;
  if (!ts.isIdentifier(expression)) return false;
  const bound = boundInitializerOf(expression);
  if (bound === null) return false;
  const boundHead = literalHeadOf(bound);
  return boundHead !== null && divergesFromPrefix(boundHead);
}

/** Calls whose argument IS an element id rather than a selector. */
const ID_LOOKUP_METHODS: ReadonlySet<string> = new Set(["getElementById"]);

function fragmentsIn(text: string): readonly string[] {
  // Decoded too, so `#ms\\-home-start` and `#ms\\2d home-start` both reserve
  // `ms-home-start` -- the id the browser resolves, not the spelling written.
  const decoded = decodeCssEscapes(text);
  const found = [...text.matchAll(FRAGMENT_PATTERN)].map(([, name]) => name ?? "");
  if (decoded === text) return found;
  return [...found, ...[...decoded.matchAll(FRAGMENT_PATTERN)].map(([, name]) => name ?? "")];
}

/** A one-line explanation of an edit, for the diff a person reviews. */
export function describeName(name: AnchorName): string {
  return `${name.file}: <${name.tag} id="${name.id}"> names ${name.anchor}`;
}

/** What a write did, and what it declined to do. */
export interface AppliedNames {
  /** What each edited file held before, so an edit that failed can be undone. */
  readonly original: ReadonlyMap<string, string>;
  readonly files: readonly string[];
  /** Files left untouched because the edited text would not parse. */
  readonly rejected: readonly string[];
}

/**
 * Writes the names into the source.
 *
 * Later offsets are written first so the earlier ones stay where they were
 * measured; every offset in a file is from ONE reading of that file, and an
 * insertion moves everything after it.
 *
 * The edited text is parsed before it is written. This tool's whole claim is
 * that adding an id changes nothing else, and a file it has corrupted is the
 * one failure that would not surface as a finding — it would surface as a
 * broken build in someone else's afternoon. A file whose new text does not
 * parse is left exactly as it was and named in the result.
 */
export function applyAnchorNames(names: readonly AnchorName[]): AppliedNames {
  const byFile = new Map<string, AnchorName[]>();
  for (const name of names) byFile.set(name.file, [...(byFile.get(name.file) ?? []), name]);
  const files: string[] = [];
  const rejected: string[] = [];
  const original = new Map<string, string>();
  for (const [file, entries] of byFile) {
    let text = readFileSync(file, "utf8");
    original.set(file, text);
    for (const entry of [...entries].sort((a, b) => b.insertAt - a.insertAt)) {
      text = `${text.slice(0, entry.insertAt)} id="${entry.id}"${text.slice(entry.insertAt)}`;
    }
    if (hasParseErrors(file, text)) {
      rejected.push(file);
      continue;
    }
    writeFileSync(file, text, "utf8");
    files.push(file);
  }
  return { files, rejected, original };
}

/**
 * Puts back exactly what was there, for an edit that did not do what it claimed.
 *
 * The alternative to being able to undo is a repository left half-named by a
 * tool that then reports it failed, which is worse than either outcome on its
 * own.
 */
export function revertAnchorNames(applied: AppliedNames): void {
  for (const file of applied.files) {
    const text = applied.original.get(file);
    if (text !== undefined) writeFileSync(file, text, "utf8");
  }
}

/**
 * What the writer promised, checked against what it produced.
 *
 * Eleven review rounds on this writer were each a different syntactic route to
 * one of two failures: a duplicate DOM id, or a name that did not resolve the
 * ambiguity it was written for. Proving neither can happen, over arbitrary
 * JavaScript, does not terminate -- there is always another spelling.
 *
 * Observing it does. The edit is applied, the repository re-read, and both
 * promises checked against the result. A route this reader has never heard of
 * still produces a duplicate id or a surviving ambiguity, and is caught here.
 * The static guards remain because a refusal names WHICH element and why, where
 * this only says the edit was withdrawn.
 */
export function verifyAnchorNames(
  names: readonly AnchorName[],
  ambiguousAfter: readonly (readonly Candidate[])[],
  repositoryRoot: string,
): readonly string[] {
  const broken: string[] = [];
  const written = new Set(names.map((name) => name.id));
  const seen = new Map<string, number>();
  for (const id of written) seen.set(id, 0);
  for (const file of repositoryFiles(repositoryRoot, SEARCHED_FILE_EXTENSIONS)) {
    let text;
    try {
      text = readFileSync(file, "utf8");
    } catch {
      continue;
    }
    for (const [, id] of text.matchAll(WRITTEN_ID_PATTERN)) {
      if (id === undefined || !written.has(id)) continue;
      seen.set(id, (seen.get(id) ?? 0) + 1);
    }
  }
  for (const [id, count] of seen) {
    // Both directions are failures of the same promise -- this id names exactly
    // one element. Zero means the write did not land where the analysis said it
    // would, which reads as success everywhere else in this run.
    if (count === 0) broken.push(`the id ${id} was proposed but is not in the repository`);
    if (count > 1) broken.push(`the id ${id} was written ${String(count)} times`);
  }
  // Only an ambiguity THIS EDIT claimed to resolve counts. The namer returns
  // safe names beside groups it refuses on purpose -- a component, a mapping,
  // an element it cannot tell from its twin -- and those groups are still
  // reported afterwards, correctly. Treating any survivor as failure withdrew
  // every valid name because some unrelated group had been refused, which is
  // the opposite of the partial application this is documented to do.
  //
  // A named element carries its id into its own anchor, as `region:<id>` or
  // `at:<id>` (`extract.ts#namingOf`), so a group still ambiguous after being
  // named says so in the anchor itself. That is a positive fact about this
  // edit rather than a count of what else the repository still cannot name.
  for (const group of ambiguousAfter) {
    for (const candidate of group) {
      const anchor = renderAnchor(candidate.anchor);
      const mine = [...written].find((id) => occursInText(id, anchor));
      if (mine === undefined) continue;
      broken.push(`${mine} was written and ${anchor} is still ambiguous`);
      break;
    }
  }
  return broken;
}

/** An id this writer minted, in the one spelling it writes. */
const WRITTEN_ID_PATTERN = /id="(ms-[a-z0-9-]+)"/gu;

function hasParseErrors(file: string, text: string): boolean {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const diagnostics = (source as unknown as { parseDiagnostics?: readonly ts.Diagnostic[] })
    .parseDiagnostics;
  return diagnostics !== undefined && diagnostics.length > 0;
}
