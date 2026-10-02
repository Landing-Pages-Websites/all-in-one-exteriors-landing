import { readFileSync } from "node:fs";
import { relative, sep } from "node:path";

/**
 * Whether a conversion changed anything a reader can see.
 *
 * Build the site, convert it, build it again, and compare the two sets of
 * prerendered HTML. Everything normalised here is something the conversion is
 * ALLOWED to change and that no reader can perceive; a single differing
 * character anywhere else is a failure. That is the whole design: the defects
 * this has caught -- whitespace eaten between words, an HTML entity rendered
 * literally, a fragment replaced by a wrapper -- were all invisible on the page
 * and exact in the markup, and none of them was found by looking at the site.
 */
export interface ParityInput {
  /** Prerendered HTML from the build BEFORE the rewrite, by route-ish path. */
  readonly before: ReadonlyMap<string, string>;
  /** The same paths from the build after it. */
  readonly after: ReadonlyMap<string, string>;
  /**
   * Routes the contract declares, so a page that produced no HTML can be named
   * rather than passed over. A route rendered on demand writes no file and is
   * absent from BOTH sides, which is indistinguishable from agreement: a run
   * reporting "90 of 90 identical" had never looked at All Points Media's
   * /contact, which is dynamic because of its form.
   */
  readonly declaredRoutes?: readonly DeclaredRoute[];
  /** Stylesheet text from each build, so a masked filename still gets compared. */
  readonly stylesheets?: {
    readonly before: readonly string[];
    readonly after: readonly string[];
  };
}

/**
 * A route as the contract states it.
 *
 * A contract page is static or GENERATED, and a generated one stands for many
 * URLs rather than for a file. Reading `path` off one gave `undefined` and the
 * documented command crashed instead of saying so.
 */
export type DeclaredRoute =
  | { readonly kind: "static"; readonly path: string }
  | { readonly kind: "generated"; readonly pattern: string };

export interface ParityDifference {
  readonly page: string;
  /** Offset of the first differing character, in the normalised text. */
  readonly at: number;
  readonly before: string;
  readonly after: string;
}

export interface ParityReport {
  readonly compared: number;
  readonly identical: number;
  readonly annotated: number;
  readonly missing: readonly string[];
  readonly changed: readonly ParityDifference[];
  /** Declared routes with no prerendered HTML, which nothing here can compare. */
  readonly uncompared: readonly string[];
  /**
   * Declared routes that are patterns rather than URLs. One file cannot answer
   * for one of those, so they are reported and failed rather than skipped.
   */
  readonly unsupported: readonly string[];
  /** Pages the build produced only AFTER the conversion. */
  readonly appeared: readonly string[];
  /** Rules present after and not before, in order. An addition is allowed. */
  readonly stylesheetRulesAdded: readonly string[];
  /**
   * Rules of the BEFORE sequence the after sequence did not contain in order:
   * removed, reordered, or moved into or out of an at-rule. None of these is
   * something the rewrite does, so any of them fails.
   */
  readonly stylesheetsChanged: readonly string[];
}

/**
 * The serialised copy of the tree React ships for hydration.
 *
 * Dropped rather than compared: it restates every difference already compared
 * in the markup above it, so a real change shows up twice and a normalisation
 * has to be written twice to match.
 */
// `[\s\S]` rather than `.` with the `s` flag: this file is also type-checked by
// the starter's own build, whose target predates dotAll, and a regex flag it
// does not know is a build failure there and nowhere else.
const HYDRATION_PAYLOAD =
  /<script>self\.__next_f\.push\([\s\S]*?\)<\/script>/gu;

/** `chunks/<name>-<hash>.js`, `css/<hash>.css` — identity of a build, not of a page. */
/**
 * A built asset's filename, whatever the bundler calls it.
 *
 * Three narrower rules stood here and all three were shaped like Next 14 --
 * `chunks/672-<hash>.js`, `css/<hash>.css`, `<name>-<hash>.<ext>`. Next 16
 * names every chunk with a bare opaque hash (`0atut6a2uuyid.js`), which none of
 * them matched, so comparing any site built by it reported every page changed
 * as soon as a bundle was rebuilt. The reference fixture found that the first
 * time it ran.
 *
 * A bundle can also sit in a directory named after the route that loads it --
 * `chunks/app/(site)/work/%5Bslug%5D/page-<hash>.js` -- and matching only a
 * filename directly under `chunks/` left every one of those comparing as a
 * change. The route directory is preserved, so a page that starts loading
 * another route's bundle still differs.
 *
 * The NAME is masked; the directory, extension, order and count are not. A page
 * that loads an extra bundle, or loads one where another belongs, still
 * differs. The name itself carries nothing a reader can see: it is a content
 * hash of code whose effect the markup already states.
 *
 * `media` is deliberately NOT in that set, and the reason is the opposite of
 * the one above. A bundle is renamed when unrelated code changes, which is why
 * its name has to be masked; an image's name is a hash of the IMAGE, so it
 * changes only when the image does. Masking it would make
 * `media/logo-old.svg` and `media/logo-new.svg` compare equal while a reader
 * sees a different picture.
 */
const BUILT_ASSET =
  /(\/_next\/static\/(?:chunks|css)\/(?:[^"'\s\\]*\/)?)[^"'/\s\\]+?(\.[a-z0-9]+)/gu;

/**
 * React's marker between a text node and an expression. The rewrite both adds
 * and removes these -- text beside an expression becomes one expression --
 * so stripping one side inverted the diff. Both sides lose them.
 */
const TEXT_SEPARATOR = /<!-- -->/gu;
const ANNOTATION_ATTRIBUTE = / data-gomega-[a-z-]+="[^"]*"/gu;
const BUILD_ID = [
  /"buildId":"([^"]+)"/u,
  /\/_next\/static\/([A-Za-z0-9_-]{16,})\/_ssgManifest/u,
];

/** The wrapper the rewrite adds to carry a page's annotation. */
const PAGE_ROOT = /<div class="contents" data-gomega-page-id="[^"]*">/u;
/**
 * A span whose only attribute is a field annotation, which the rewrite adds
 * where an element holds more than the value.
 */
const VALUE_SPAN =
  /<span data-gomega-field-id="[^"]*"(?: data-gomega-item-id="[^"]*")?>/u;
/**
 * A span with NO attributes, unwrapped on BOTH sides. A value already alone in
 * a bare span -- `<a><span>Explore Solutions</span></a>` in a button primitive
 * -- keeps its span and merely gains the annotation, and unwrapping only the
 * annotated side reported the span as deleted. The rewrite never removes an
 * element, so doing both sides cannot hide one, and any difference in the text,
 * the attributes or the order still shows.
 */
const BARE_SPAN = /<span>/u;

/** `text` with each match of `opener` and its DEPTH-MATCHED close removed. */
function unwrap(text: string, opener: RegExp, tag: string): string {
  const boundary = new RegExp(`<${tag}\\b|</${tag}>`, "gu");
  const out: string[] = [];
  let at = 0;
  for (;;) {
    const opened = new RegExp(opener.source, "u").exec(text.slice(at));
    if (opened === null) {
      out.push(text.slice(at));
      return out.join("");
    }
    const start = at + opened.index;
    let depth = 1;
    boundary.lastIndex = start + opened[0].length;
    while (depth > 0) {
      const next = boundary.exec(text);
      if (next === null) {
        out.push(text.slice(at));
        return out.join("");
      }
      depth += next[0].startsWith("</") ? -1 : 1;
    }
    const closed = boundary.lastIndex;
    out.push(text.slice(at, start));
    out.push(text.slice(start + opened[0].length, closed - `</${tag}>`.length));
    at = closed;
  }
}

function normalise(html: string, converted: boolean): string {
  let text = html.replace(HYDRATION_PAYLOAD, "");
  if (converted) {
    // Before the attributes go, while the annotation still identifies them.
    text = unwrap(text, PAGE_ROOT, "div");
    text = unwrap(text, VALUE_SPAN, "span");
  }
  text = unwrap(text, BARE_SPAN, "span");
  for (const pattern of BUILD_ID) {
    const found = pattern.exec(text);
    if (found?.[1] !== undefined)
      text = text.split(found[1]).join("<BUILD_ID>");
  }
  text = text.replace(BUILT_ASSET, "$1<ASSET>$2");
  text = text.replace(TEXT_SEPARATOR, "");
  return converted ? text.replace(ANNOTATION_ATTRIBUTE, "") : text;
}

/**
 * Every declaration block in a stylesheet, IN ORDER and with the at-rules
 * enclosing it.
 *
 * Both parts are load-bearing. A flat multiset of rule text cannot see a rule
 * moved into an `@media` block -- the text is identical either side -- and it
 * cannot see two rules swapped, which is a different cascade and a different
 * page. Each entry is therefore its context chain and its own text, and the
 * comparison is a sequence, not a set.
 */
const CONTAINER_AT_RULE =
  /^@(?:media|supports|layer|container|scope|document)\b/iu;

function entriesOf(css: string): readonly string[] {
  const entries: string[] = [];
  const context: string[] = [];
  let at = 0;
  for (const match of css.matchAll(/[{}]/gu)) {
    const index = match.index;
    if (match[0] === "{") {
      const prelude = css.slice(at, index).trim();
      // An at-rule that takes a block -- `@media`, `@supports`, `@layer` --
      // wraps what follows. Anything else opens a declaration block, whose
      // contents run to its close.
      // Only a CONTAINER at-rule nests other rules. A DECLARATION at-rule --
      // `@font-face`, `@page`, `@property`, `@counter-style` -- holds
      // declarations, so treating every `@` as a context meant its contents
      // produced no entry at all, and changing or deleting a whole `@font-face`
      // left the sequence identical.
      if (prelude.startsWith("@") && CONTAINER_AT_RULE.test(prelude)) {
        context.push(prelude.replace(/\s+/gu, " "));
        at = index + 1;
        continue;
      }
      const close = css.indexOf("}", index);
      const body = css.slice(index + 1, close === -1 ? undefined : close);
      entries.push(
        `${context.join(" > ")}${context.length > 0 ? " > " : ""}${prelude.replace(/\s+/gu, " ")}{${body.trim()}}`,
      );
      at = close === -1 ? css.length : close + 1;
      continue;
    }
    if (index >= at) {
      context.pop();
      at = index + 1;
    }
  }
  return entries;
}

function sheetEntries(sheets: readonly string[]): readonly string[] {
  return sheets.flatMap((sheet) => entriesOf(sheet));
}

/**
 * How `after` differs from `before` as a SEQUENCE: pure insertions are
 * reported and allowed, anything else is a change.
 *
 * The rewrite can only add a rule -- the page-root wrapper is the first user of
 * `display:contents` on most sites, so Tailwind emits it for the first time --
 * and it has no way to remove, reorder or re-nest one. So a walk that consumes
 * `before` in order and records what had to be skipped says exactly whether
 * the change is an insertion or something else.
 */
function sheetDifference(
  before: readonly string[],
  after: readonly string[],
): { readonly added: readonly string[]; readonly changed: readonly string[] } {
  const added: string[] = [];
  let cursor = 0;
  for (const entry of after) {
    if (cursor < before.length && before[cursor] === entry) {
      cursor += 1;
      continue;
    }
    added.push(entry);
  }
  // Anything of `before` left over was removed, reordered or re-nested, none of
  // which the rewrite does.
  return { added, changed: before.slice(cursor) };
}

/** The file a route's prerendered HTML is written to, relative to the app dir. */
export function htmlNameOf(route: string): string {
  return route === "/" ? "index.html" : `${route.replace(/^\//u, "")}.html`;
}

export function renderedParity(input: ParityInput): ParityReport {
  const missing: string[] = [];
  const changed: ParityDifference[] = [];
  let identical = 0;
  let annotated = 0;
  for (const [page, before] of [...input.before].sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    const after = input.after.get(page);
    if (after === undefined) {
      missing.push(page);
      continue;
    }
    const left = normalise(before, false);
    const right = normalise(after, true);
    if (left === right) {
      identical += 1;
      if (after.includes("data-gomega-")) annotated += 1;
      continue;
    }
    let at = 0;
    while (at < left.length && at < right.length && left[at] === right[at])
      at += 1;
    changed.push({
      page,
      at,
      before: left.slice(Math.max(0, at - 90), at + 60),
      after: right.slice(Math.max(0, at - 90), at + 60),
    });
  }
  const declared = input.declaredRoutes ?? [];
  const uncompared = declared
    .flatMap((route) => (route.kind === "static" ? [route.path] : []))
    .filter((path) => !input.before.has(htmlNameOf(path)));
  const unsupported = declared.flatMap((route) =>
    route.kind === "generated" ? [route.pattern] : [],
  );
  // A page the conversion ADDED is a change too, and iterating only `before`
  // could never see one.
  const appeared = [...input.after.keys()]
    .filter((page) => !input.before.has(page))
    .sort();
  const stylesheets = sheetDifference(
    sheetEntries(input.stylesheets?.before ?? []),
    sheetEntries(input.stylesheets?.after ?? []),
  );
  return {
    compared: input.before.size,
    identical,
    annotated,
    missing,
    changed,
    uncompared,
    unsupported,
    appeared,
    stylesheetRulesAdded: stylesheets.added,
    stylesheetsChanged: stylesheets.changed,
  };
}

/** Every `*.html` under `directory`, keyed by its path relative to it. */
export function htmlUnder(
  directory: string,
  walk: (at: string) => readonly string[],
): ReadonlyMap<string, string> {
  const found = new Map<string, string>();
  for (const file of walk(directory)) {
    if (!file.endsWith(".html")) continue;
    found.set(
      relative(directory, file).split(sep).join("/"),
      readFileSync(file, "utf8"),
    );
  }
  return found;
}

/**
 * Whether a report is a pass.
 *
 * A declared route that produced no HTML fails it. Reporting such a route and
 * passing anyway is the defect this whole module exists to avoid: the run says
 * every page is identical while one was never looked at. The caller clears it
 * by fetching that route from a running build and adding it to both maps under
 * the same name -- which is what the runbook already tells an operator to do,
 * and now what the gate insists on.
 */
/**
 * The one stylesheet rule a conversion may add.
 *
 * The page-root wrapper is `display:contents`, and on most sites it is the
 * first user of that utility, so the stylesheet gains the rule for the first
 * time. Nothing else about a conversion changes styling, so every OTHER
 * addition is a change: a `.hero{color:red}` appearing from nowhere renders
 * differently, and allowing all additions let that pass.
 */
const WRAPPER_RULE = /^\.contents\{display:\s*contents;?\}$/u;

export function parityHolds(report: ParityReport): boolean {
  return (
    report.changed.length === 0 &&
    report.missing.length === 0 &&
    report.uncompared.length === 0 &&
    report.unsupported.length === 0 &&
    report.appeared.length === 0 &&
    report.stylesheetsChanged.length === 0 &&
    report.stylesheetRulesAdded.every((rule) => WRAPPER_RULE.test(rule))
  );
}

export function renderParityText(report: ParityReport): string {
  const lines = [
    `pages compared:        ${String(report.compared)}`,
    `identical:             ${String(report.identical)}`,
    `  of those, annotated: ${String(report.annotated)}`,
    `missing after:         ${String(report.missing.length)}`,
    `CHANGED:               ${String(report.changed.length)}`,
  ];
  for (const difference of report.changed) {
    lines.push(
      `\n  ${difference.page}  (first difference at character ${String(difference.at)})`,
      `    before: ...${JSON.stringify(difference.before)}`,
      `    after:  ...${JSON.stringify(difference.after)}`,
    );
  }
  for (const page of report.appeared) {
    lines.push(`  APPEARED after conversion: ${page}`);
  }
  if (report.unsupported.length > 0) {
    lines.push(
      `declared as a PATTERN, which one file cannot answer for: ${String(report.unsupported.length)}`,
      ...report.unsupported.map((pattern) => `  ${pattern}`),
    );
  }
  if (report.uncompared.length > 0) {
    lines.push(
      `declared but not prerendered, so NOT compared: ${String(report.uncompared.length)}`,
      ...report.uncompared.map((route) => `  ${route}`),
    );
  }
  for (const rule of report.stylesheetRulesAdded)
    lines.push(`  stylesheet ADDED   ${rule}`);
  for (const rule of report.stylesheetsChanged)
    lines.push(`  stylesheet CHANGED OR REMOVED ${rule}`);
  return `${lines.join("\n")}\n`;
}
