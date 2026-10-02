import assert from "node:assert/strict";
import test from "node:test";

import { renderAnchor } from "../src/anchors.js";
import type { Candidate } from "../src/candidates.js";
import { bindCandidates, type PageBinding } from "../src/bindings.js";
import { applyConfidenceGate } from "../src/gate.js";
import { IdLedger } from "../src/id-ledger.js";
import { extractEntries } from "./support/proposals.js";

/**
 * What a COLLISION means depends on what decided the identity.
 *
 * Two paragraphs at the same position are two places nothing can tell apart, so
 * both are refused. Two components reading one exported binding are one value
 * seen twice, so they merge. Two modules that each declare the same private
 * name are two different values, so they must not merge — and two modules that
 * each EXPORT the same name are one anchor over two values, so both are refused.
 */

interface Extracted {
  readonly accepted: readonly Candidate[];
  readonly refused: readonly string[];
}

/**
 * Every module in the set is an entry, because these rows are about values
 * SHARED across modules and no single module renders them all.
 *
 * The entries share one scratch root, which is the whole point of passing them
 * together: a candidate declared in `lib/content.ts` is identified by that
 * file's absolute path, so extracting each entry into a root of its own would
 * give one declaration two identities and the gate would refuse the readings
 * it is supposed to merge.
 */
function extractRepository(files: Readonly<Record<string, string>>): Extracted {
  const modules = Object.keys(files).filter(
    (relative) => relative.endsWith(".tsx") || relative.endsWith(".ts"),
  );
  const gated = applyConfidenceGate(extractEntries(files, modules).candidates);
  return {
    accepted: gated.accepted,
    refused: gated.findings.map((finding) => finding.code),
  };
}

function anchorsOf(extracted: Extracted): readonly string[] {
  return extracted.accepted.map((candidate) => renderAnchor(candidate.anchor)).sort();
}

function candidateAt(extracted: Extracted, anchor: string): Candidate {
  const found = extracted.accepted.find(
    (candidate) => renderAnchor(candidate.anchor) === anchor,
  );
  assert.ok(found !== undefined, `no accepted candidate at ${anchor}`);
  return found;
}

const SHARED_DATA = `export const ctas = { primary: { label: "Get Started" } };`;

function reader(name: string, expression: string, imports: string): string {
  return `${imports}\nexport function ${name}() {\n  return <p>{${expression}}</p>;\n}\n`;
}

test("a value read from a declared binding is anchored on the binding, not the markup", () => {
  const extracted = extractRepository({
    "lib/content.ts": SHARED_DATA,
    "Hero.tsx": reader("Hero", "ctas.primary.label", `import { ctas } from "./lib/content";`),
  });
  assert.deepEqual(anchorsOf(extracted), ["each:ctas/prop:primary/prop:label"]);
  const candidate = candidateAt(extracted, "each:ctas/prop:primary/prop:label");
  assert.equal(candidate.kind === "plain_text" ? candidate.value : null, "Get Started");
});

test("two components reading one exported binding are ONE field, naming both", () => {
  const extracted = extractRepository({
    "lib/content.ts": SHARED_DATA,
    "Hero.tsx": reader("Hero", "ctas.primary.label", `import { ctas } from "./lib/content";`),
    "Footer.tsx": reader("Footer", "ctas.primary.label", `import { ctas } from "./lib/content";`),
  });
  assert.deepEqual(anchorsOf(extracted), ["each:ctas/prop:primary/prop:label"]);
  const candidate = candidateAt(extracted, "each:ctas/prop:primary/prop:label");
  assert.deepEqual([...candidate.componentNames].sort(), ["Footer", "Hero"]);
  assert.deepEqual(extracted.refused, []);
});

test("a renamed import still merges, because the DECLARED name is the anchor", () => {
  const extracted = extractRepository({
    "lib/content.ts": SHARED_DATA,
    "Hero.tsx": reader("Hero", "ctas.primary.label", `import { ctas } from "./lib/content";`),
    "Footer.tsx": reader(
      "Footer",
      "actions.primary.label",
      `import { ctas as actions } from "./lib/content";`,
    ),
  });
  assert.deepEqual(anchorsOf(extracted), ["each:ctas/prop:primary/prop:label"]);
  assert.deepEqual(
    [...candidateAt(extracted, "each:ctas/prop:primary/prop:label").componentNames].sort(),
    ["Footer", "Hero"],
  );
});

test("a module-private name of the same spelling in two modules is two fields", () => {
  const extracted = extractRepository({
    "Privacy.tsx":
      `const LAST_UPDATED = "18 August 2026";\n` +
      `export function Privacy() {\n  return <p>{LAST_UPDATED}</p>;\n}\n`,
    "Terms.tsx":
      `const LAST_UPDATED = "2 March 2026";\n` +
      `export function Terms() {\n  return <p>{LAST_UPDATED}</p>;\n}\n`,
  });
  assert.deepEqual(anchorsOf(extracted), [
    "component:Privacy/each:LAST_UPDATED",
    "component:Terms/each:LAST_UPDATED",
  ]);
  assert.equal(
    candidateAt(extracted, "component:Privacy/each:LAST_UPDATED").kind === "plain_text"
      ? (candidateAt(extracted, "component:Privacy/each:LAST_UPDATED") as { value: string }).value
      : null,
    "18 August 2026",
  );
  assert.deepEqual(extracted.refused, []);
});

test("the SAME exported name declared by two modules is refused, not merged", () => {
  const extracted = extractRepository({
    "lib/a.ts": `export const LAST_UPDATED = "18 August 2026";`,
    "lib/b.ts": `export const LAST_UPDATED = "2 March 2026";`,
    "Privacy.tsx": reader("Privacy", "LAST_UPDATED", `import { LAST_UPDATED } from "./lib/a";`),
    "Terms.tsx": reader("Terms", "LAST_UPDATED", `import { LAST_UPDATED } from "./lib/b";`),
  });
  assert.deepEqual(anchorsOf(extracted), []);
  assert.deepEqual(extracted.refused, ["AMBIGUOUS_ANCHOR", "AMBIGUOUS_ANCHOR"]);
});

test("a positional value still refuses its twin, so merging did not weaken the gate", () => {
  const extracted = extractRepository({
    "Panel.tsx":
      `export function Panel() {\n` +
      `  return (<div><p>One</p><p>Two</p></div>);\n}\n`,
  });
  assert.deepEqual(anchorsOf(extracted), []);
  assert.deepEqual(extracted.refused, ["AMBIGUOUS_ANCHOR", "AMBIGUOUS_ANCHOR"]);
});

test("one component reading the same binding twice is still one field", () => {
  const extracted = extractRepository({
    "lib/content.ts": SHARED_DATA,
    "Hero.tsx":
      `import { ctas } from "./lib/content";\n` +
      `export function Hero() {\n` +
      `  return (<div><p>{ctas.primary.label}</p><span>{ctas.primary.label}</span></div>);\n}\n`,
  });
  assert.deepEqual(anchorsOf(extracted), ["each:ctas/prop:primary/prop:label"]);
  assert.deepEqual(candidateAt(extracted, "each:ctas/prop:primary/prop:label").componentNames, [
    "Hero",
  ]);
});

/**
 * A page renders declarations, not names, so a hand-built binding takes its
 * `componentKeys` from what extraction actually produced. Spelling them by
 * name here would test a join this code no longer performs.
 */
function keysRendering(
  candidates: readonly Candidate[],
  component: string,
): ReadonlySet<string> {
  return new Set(
    candidates
      .filter((candidate) => candidate.componentNames.includes(component))
      .flatMap((candidate) => candidate.componentKeys),
  );
}

/**
 * A section belongs to one page. Values anchored on a declaration carry no
 * component and no region, so before this they all rendered to the same empty
 * section key and the last candidate to arrive decided which page the whole
 * group was emitted under.
 */
test("declared values on different routes are sections on their own pages", () => {
  const extracted = extractRepository({
    "lib/content.ts": `export const ctas = { primary: { label: "Go" }, rfp: { label: "RFP" } };`,
    "Hero.tsx": reader("Hero", "ctas.primary.label", `import { ctas } from "./lib/content";`),
    "ContactPanel.tsx": reader(
      "ContactPanel",
      "ctas.rfp.label",
      `import { ctas } from "./lib/content";`,
    ),
  });
  assert.equal(extracted.accepted.length, 2);
  const home: PageBinding = {
    routePath: "/",
    file: "app/page.tsx",
    pageId: "page_home" as PageBinding["pageId"],
    slug: "home",
    componentKeys: keysRendering(extracted.accepted, "Hero"),
    render: { kind: "renders" },
    ownsContent: true,
  };
  const contact: PageBinding = {
    routePath: "/contact",
    file: "app/page.tsx",
    pageId: "page_contact" as PageBinding["pageId"],
    slug: "contact",
    componentKeys: keysRendering(extracted.accepted, "ContactPanel"),
    render: { kind: "renders" },
    ownsContent: true,
  };

  const bound = bindCandidates(extracted.accepted, [home, contact], IdLedger.empty(), "content");
  assert.equal(bound.sections.length, 2);
  assert.deepEqual(
    bound.sections.map((section) => section.pageId).sort(),
    ["page_contact", "page_home"],
  );
  // Distinct sections, so distinct ids — the collapse produced one of each.
  assert.equal(new Set(bound.sections.map((section) => section.sectionId)).size, 2);
  for (const section of bound.sections) {
    assert.notEqual(section.key, "");
    assert.equal(section.fields.length, 1);
  }
});

/**
 * `export { copy }` makes a binding exactly as shared as `export const copy`
 * does. A reader in the declaring module must reach the same conclusion an
 * importing reader does, or the two produce different anchors for one value
 * and it never merges.
 */
test("an export-list binding merges its local readers with its importing ones", () => {
  const extracted = extractRepository({
    "lib/content.ts": `const ctas = { primary: { label: "Go" } };\nexport { ctas };\nexport function Local() {\n  return <p>{ctas.primary.label}</p>;\n}\n`,
    "Hero.tsx": reader("Hero", "ctas.primary.label", `import { ctas } from "./lib/content";`),
  });
  assert.deepEqual(anchorsOf(extracted), ["each:ctas/prop:primary/prop:label"]);
  assert.deepEqual(
    [...candidateAt(extracted, "each:ctas/prop:primary/prop:label").componentNames].sort(),
    ["Hero", "Local"],
  );
});

test("two local readers of an export-list binding are still one field", () => {
  const extracted = extractRepository({
    "lib/content.ts":
      `const ctas = { primary: { label: "Go" } };\nexport { ctas };\n` +
      `export function A() {\n  return <p>{ctas.primary.label}</p>;\n}\n` +
      `export function B() {\n  return <span>{ctas.primary.label}</span>;\n}\n`,
  });
  assert.deepEqual(anchorsOf(extracted), ["each:ctas/prop:primary/prop:label"]);
  assert.deepEqual(extracted.refused, []);
});

test("a module-private binding read by two components stays component-qualified", () => {
  const extracted = extractRepository({
    "lib/content.ts":
      `const ctas = { primary: { label: "Go" } };\n` +
      `export function A() {\n  return <p>{ctas.primary.label}</p>;\n}\n` +
      `export function B() {\n  return <span>{ctas.primary.label}</span>;\n}\n`,
  });
  assert.deepEqual(anchorsOf(extracted), [
    "component:A/each:ctas/prop:primary/prop:label",
    "component:B/each:ctas/prop:primary/prop:label",
  ]);
});

/**
 * A rendered anchor is compared as a STRING, so a property name must not be
 * able to spell another path. A separator alone is not enough — `copy["a/b"]`
 * renders `prop:a/b` while `copy.a.b` renders `prop:a/prop:b`, which differ.
 * The name has to reproduce the segment tag as well, and `copy["a/prop:b"]`
 * does exactly that. Unescaped, both render `each:copy/prop:a/prop:b`, the
 * gate merges two different values and keeps one of them.
 */
test("a property name that spells another path does not collide with it", () => {
  const extracted = extractRepository({
    "Panel.tsx":
      `const copy = { "a/prop:b": "SPELLED", a: { b: "NESTED" } };\n` +
      `export function Panel() {\n` +
      `  return (<div><p>{copy["a/prop:b"]}</p><span>{copy.a.b}</span></div>);\n}\n`,
  });
  assert.equal(extracted.accepted.length, 2);
  assert.equal(new Set(anchorsOf(extracted)).size, 2);
  assert.deepEqual(
    extracted.accepted
      .map((candidate) => (candidate.kind === "plain_text" ? candidate.value : null))
      .sort(),
    ["NESTED", "SPELLED"],
  );
  assert.deepEqual(extracted.refused, []);
});

/** The separator on its own is safe, and must keep resolving to both values. */
test("a property name containing only the separator still reads both paths", () => {
  const extracted = extractRepository({
    "Panel.tsx":
      `const copy = { "a/b": "SLASH", a: { b: "NESTED" } };\n` +
      `export function Panel() {\n` +
      `  return (<div><p>{copy["a/b"]}</p><span>{copy.a.b}</span></div>);\n}\n`,
  });
  assert.equal(extracted.accepted.length, 2);
  assert.deepEqual(
    extracted.accepted
      .map((candidate) => (candidate.kind === "plain_text" ? candidate.value : null))
      .sort(),
    ["NESTED", "SLASH"],
  );
});

/**
 * `export { copy as default }` sends a declaration out under a name this tool
 * refuses to follow, so a write made through a default import cannot be
 * attributed back to it. Refusing to FOLLOW a default while still trusting its
 * declaration would be the wrong half of that decision, so nothing is proposed
 * for it at all — which is stronger than merely declining to share it.
 */
test("a default-exported declaration is not read at all", () => {
  const extracted = extractRepository({
    "lib/content.ts":
      `const ctas = { primary: { label: "Go" } };\nexport { ctas as default };\n` +
      `export function A() {\n  return <p>{ctas.primary.label}</p>;\n}\n` +
      `export function B() {\n  return <span>{ctas.primary.label}</span>;\n}\n`,
  });
  assert.deepEqual(anchorsOf(extracted), []);
});

/** A sibling in the same module, exported normally, is unaffected. */
test("a default export does not poison its module's other declarations", () => {
  const extracted = extractRepository({
    "lib/content.ts":
      `const ctas = { primary: { label: "Go" } };\nexport { ctas as default };\n` +
      `export const other = { label: "Other" };\n` +
      `export function A() {\n  return <p>{other.label}</p>;\n}\n`,
  });
  assert.deepEqual(anchorsOf(extracted), ["each:other/prop:label"]);
});

/**
 * A content pointer is a readable address derived from the anchor, and that
 * derivation is not injective: `copy["foo-bar"]` and `copy.fooBar` are
 * different properties with different anchors that both normalise to `fooBar`.
 * The prefix check cannot catch equality, so emission wrote one over the other.
 */
test("two anchors claiming one content pointer fail loudly", () => {
  const extracted = extractRepository({
    "Panel.tsx":
      `const copy = { "foo-bar": "DASHED", fooBar: "CAMEL" };\n` +
      `export function Panel() {\n` +
      `  return (<div><p>{copy["foo-bar"]}</p><span>{copy.fooBar}</span></div>);\n}\n`,
  });
  assert.equal(extracted.accepted.length, 2);
  const page: PageBinding = {
    routePath: "/",
    file: "app/page.tsx",
    pageId: "page_home" as PageBinding["pageId"],
    slug: "home",
    componentKeys: keysRendering(extracted.accepted, "Panel"),
    render: { kind: "renders" },
    ownsContent: true,
  };
  assert.throws(
    () => bindCandidates(extracted.accepted, [page], IdLedger.empty(), "content"),
    /claimed by two anchors/,
  );
});
