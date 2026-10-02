import assert from "node:assert/strict";
import test from "node:test";

import {
  type ComponentExtraction,
  extractEntries,
  extractFiles,
} from "./support/proposals.js";

/**
 * What the CALLER writes, read against what the receiver does with it.
 *
 * A host element's attributes are a fixed vocabulary, so `jsx-facts` can
 * classify them by name. A component's props are not, and the caller side has
 * to ask the component before applying any host rule — otherwise `className`
 * is skipped and `aria-label` is code-owned no matter what the component
 * actually renders.
 */

function extractCaller(files: Readonly<Record<string, string>>): ComponentExtraction {
  return extractFiles(files, "Caller.tsx");
}

function editableValues(extracted: ComponentExtraction): readonly string[] {
  return extracted.candidates
    .filter((candidate) => candidate.ownership === "customer_editable")
    .map((candidate) => (candidate.kind === "plain_text" ? candidate.value : ""))
    .sort();
}

const RENDERS_CLASSNAME = `export function Inner({ className }: { className?: string }) {
  return <p>{className}</p>;
}
`;

const RENDERS_ARIA = `export function Inner(props: { "aria-label"?: string }) {
  return <p>{props["aria-label"]}</p>;
}
`;

const RENDERS_LABEL = `export function Inner({ label }: { label?: string }) {
  return <p>{label}</p>;
}
`;

function caller(body: string): string {
  return `import { Inner } from "./Inner";\nexport function Caller() {\n  return ${body};\n}\n`;
}

test("a component that renders className as copy is asked, not skipped by name", () => {
  const extracted = extractCaller({
    "Inner.tsx": RENDERS_CLASSNAME,
    "Caller.tsx": caller(`<Inner className="Copy" />`),
  });
  assert.deepEqual(editableValues(extracted), ["Copy"]);
});

test("a component that renders aria-label as copy is asked too", () => {
  const extracted = extractCaller({
    "Inner.tsx": RENDERS_ARIA,
    "Caller.tsx": caller(`<Inner aria-label="Copy" />`),
  });
  assert.deepEqual(editableValues(extracted), ["Copy"]);
});

test("a host element's className is still structural, and reported as nothing", () => {
  const extracted = extractCaller({
    "Inner.tsx": RENDERS_CLASSNAME,
    "Caller.tsx": caller(`<div className="wrapper">text</div>`),
  });
  assert.deepEqual(editableValues(extracted), ["text"]);
  assert.deepEqual(
    extracted.findings.filter((finding) => finding.code === "UNKNOWN_ATTRIBUTE_ROLE"),
    [],
  );
});

test("a host element's aria-label stays code-owned", () => {
  const extracted = extractCaller({
    "Inner.tsx": RENDERS_CLASSNAME,
    "Caller.tsx": caller(`<p aria-label="Described">text</p>`),
  });
  assert.equal(
    extracted.candidates.filter(
      (candidate) => candidate.ownership === "code_owned_interface",
    ).length,
    1,
  );
});

/**
 * JSX resolves attributes left to right, so only a spread that FOLLOWS a
 * literal can replace it. `<Inner label="Original" {...runtimeProps} />` shows
 * whatever `runtimeProps.label` holds, which is not written here.
 */
test("a literal a later spread may replace is reported, not proposed", () => {
  const extracted = extractCaller({
    "Inner.tsx": RENDERS_LABEL,
    "Caller.tsx":
      `import { Inner } from "./Inner";\n` +
      `export function Caller({ runtimeProps }: { runtimeProps: object }) {\n` +
      `  return <Inner label="Original" {...runtimeProps} />;\n}\n`,
  });
  assert.deepEqual(editableValues(extracted), []);
  assert.deepEqual(
    extracted.findings.map((finding) => finding.code),
    ["UNKNOWN_ATTRIBUTE_ROLE"],
  );
});

test("a spread BEFORE the literal cannot replace it, so the literal is read", () => {
  const extracted = extractCaller({
    "Inner.tsx": RENDERS_LABEL,
    "Caller.tsx":
      `import { Inner } from "./Inner";\n` +
      `export function Caller({ runtimeProps }: { runtimeProps: object }) {\n` +
      `  return <Inner {...runtimeProps} label="Original" />;\n}\n`,
  });
  assert.deepEqual(editableValues(extracted), ["Original"]);
});

/**
 * Once a tag is a component, host semantics no longer apply to its props. If
 * the receiver cannot be read, the honest answer is that nothing here knows
 * what the prop is — not that `className` is structural and `aria-label` is an
 * accessibility interface, which are facts about HOST elements.
 */
test("an unreadable component receiver reports, rather than falling back to host rules", () => {
  const extracted = extractCaller({
    "Inner.tsx": RENDERS_LABEL,
    "Caller.tsx":
      `import { Dynamic } from "some-package";\n` +
      `export function Caller() {\n` +
      `  return <div><Dynamic className="Visible copy" /><Dynamic aria-label="Also copy" /></div>;\n}\n`,
  });
  assert.deepEqual(editableValues(extracted), []);
  assert.deepEqual(
    extracted.candidates.filter((c) => c.ownership === "code_owned_interface").length,
    0,
  );
  assert.deepEqual(
    extracted.findings.map((finding) => finding.code),
    ["UNKNOWN_ATTRIBUTE_ROLE", "UNKNOWN_ATTRIBUTE_ROLE"],
  );
});

/**
 * A tag is resolved by NAME, and a local declaration of that name is what JSX
 * actually renders. Reading the import instead classifies the prop from a
 * component the page never renders.
 */
test("a locally shadowed tag is not classified from the import it shadows", () => {
  const extracted = extractCaller({
    "Inner.tsx": RENDERS_LABEL,
    "Caller.tsx":
      `import { Inner } from "./Inner";\n` +
      `export function Caller() {\n` +
      `  function Inner() { return null; }\n` +
      `  return <Inner label="Copy" />;\n}\n`,
  });
  assert.deepEqual(editableValues(extracted), []);
});

/** A component rendering itself is not shadowing its own name. */
test("a recursive component still classifies its own props", () => {
  const extracted = extractCaller({
    "Inner.tsx": RENDERS_LABEL,
    "Caller.tsx":
      `import { Inner } from "./Inner";\n` +
      `export function Caller({ depth }: { depth: number }) {\n` +
      `  if (depth === 0) return <Inner label="Copy" />;\n` +
      `  return <Caller depth={depth - 1} />;\n}\n`,
  });
  assert.deepEqual(editableValues(extracted), ["Copy"]);
});

/**
 * A component's own parameters bind inside it, so a prop named like an import
 * is what JSX renders. The guard must reach them without also treating the
 * component's own NAME as a shadow, which would break self-recursion.
 */
test("a tag shadowed by the component's own parameter is not read from the import", () => {
  const extracted = extractCaller({
    "Inner.tsx": RENDERS_LABEL,
    "Caller.tsx":
      `import { Inner } from "./Inner";\n` +
      `export function Caller({ Inner }: { Inner: () => null }) {\n` +
      `  return <Inner label="Copy" />;\n}\n`,
  });
  assert.deepEqual(editableValues(extracted), []);
});

/**
 * `key` is consumed by React on the CALLER's side and never reaches a
 * component, so nothing written into it can render, whatever the component's
 * body does with a prop of that name.
 *
 * `ref` is NOT universally that. React 19 passes it to a function component
 * like any other prop; React 18 consumes it unless the component was wrapped in
 * `forwardRef`. Which one applies is a fact about the repository being read, so
 * it is read from there — and when it cannot be read, the value is skipped,
 * which can only cost a field nobody writes rather than propose one that edits
 * nothing.
 */
const RENDERS = (name: string) =>
  `export function Inner({ ${name} }: { ${name}?: string }) {\n  return <p>{${name}}</p>;\n}\n`;

const CALLER = (name: string) =>
  `import { Inner } from "./Inner";\n` +
  `export function Caller() {\n  return <Inner ${name}="Visible" />;\n}\n`;

const REACT_VERSIONS: readonly (readonly [string, string | null, readonly string[]])[] = [
  ["React 19 hands a component its ref", "19.2.4", ["Visible"]],
  ["React 18 consumes ref before the component", "18.3.1", []],
  ["a caret range is read by its major", "^19.0.0", ["Visible"]],
  ["a tilde range is read by its major", "~19.1.0", ["Visible"]],
  ["a prerelease pin is read by its major", "19.0.0-rc.1", ["Visible"]],
  // Every row below answers "this does not pin one major", which fails closed.
  // Deciding what a RANGE permits needs a semver implementation; three
  // attempts to reason about operators each got a different spelling wrong.
  ["an alternation is not a pin", "^19.0.0 || ^18.0.0", []],
  ["an alternation with no spaces is not a pin", "^19.0.0||^18.0.0", []],
  ["a comma list is not a pin", "^19.0.0,^18.0.0", []],
  ["an alternation of 19 and 20 is still not a pin", "^19.0.0 || ^20.0.0", []],
  ["a lower bound is not a pin", ">=18", []],
  ["a lower bound at 19 is not a pin either", ">=19", []],
  ["an UPPER bound naming 19 excludes it", "<19", []],
  ["a wildcard is not a pin", "*", []],
  ["a workspace protocol is not a pin", "workspace:*", []],
  ["a future major still hands it over", "20.1.0", ["Visible"]],
  ["an unreadable version skips it", null, []],
];

for (const [description, version, expected] of REACT_VERSIONS) {
  test(`ref: ${description}`, () => {
    const files: Record<string, string> = {
      "Inner.tsx": RENDERS("ref"),
      "Caller.tsx": CALLER("ref"),
    };
    if (version !== null) {
      files["package.json"] = JSON.stringify({ dependencies: { react: version } });
    }
    assert.deepEqual(editableValues(extractCaller(files)), [...expected]);
  });
}

/**
 * React is normally a runtime dependency, but a reference app or a component
 * library pins it elsewhere, and reading only one group would answer "unknown"
 * for a repository that states the version plainly.
 */
for (const group of ["devDependencies", "peerDependencies"] as const) {
  test(`ref: a version pinned in ${group} is read`, () => {
    const extracted = extractCaller({
      "package.json": JSON.stringify({ [group]: { react: "19.2.4" } }),
      "Inner.tsx": RENDERS("ref"),
      "Caller.tsx": CALLER("ref"),
    });
    assert.deepEqual(editableValues(extracted), ["Visible"]);
  });
}

/** `key` is never a prop, at any React version. */
for (const version of ["19.2.4", "18.3.1"]) {
  test(`key is not a field under React ${version}`, () => {
    const extracted = extractCaller({
      "package.json": JSON.stringify({ dependencies: { react: version } }),
      "Inner.tsx": RENDERS("key"),
      "Caller.tsx": CALLER("key"),
    });
    assert.deepEqual(editableValues(extracted), []);
    assert.deepEqual(extracted.findings.map((finding) => finding.code), []);
  });
}

/** A `ref` landing on a HOST element is never rendered text, whatever the
 * React version says about components. */
test("ref on a host element is not a field", () => {
  const extracted = extractCaller({
    "package.json": JSON.stringify({ dependencies: { react: "19.2.4" } }),
    "Caller.tsx": `export function Caller() {\n  return <p ref="Visible" />;\n}\n`,
  });
  assert.deepEqual(editableValues(extracted), []);
  assert.deepEqual(extracted.findings.map((finding) => finding.code), []);
});

/**
 * A DOTTED tag is a component, and its props are read from the receiver when the
 * receiver can be read.
 *
 * `isComponentName("ui.Card")` is false, so host rules used to decide a dotted
 * tag's attributes by NAME. That silently dropped a customer's copy: a namespace
 * component rendering `{id}` as a heading had its caller's `id="..."` skipped as
 * structural, so no field was proposed and nothing said it had been. `aria-label`
 * was worse than silent, offered as a code-owned interface, so the customer
 * could not edit their own heading.
 *
 * When the receiver CANNOT be read the host rules still apply, deliberately.
 * `motion.div` forwards its props to the `div` it names, so those rules describe
 * it correctly, and asking a package this reader cannot open would turn every
 * `className` on a `motion.*` tag into a finding a human must dismiss.
 */
const DOTTED_PROP_CASES: readonly {
  readonly description: string;
  readonly attribute: string;
  readonly receiver: string;
  readonly editable: readonly string[];
  readonly codes: readonly string[];
}[] = [
  {
    description: "renders a resolvable namespace component's id as a heading",
    attribute: "id",
    receiver: "return <section><h2>{value}</h2></section>;",
    editable: ["Copy"],
    // The two readings agree, which is the point: the value is offered as the
    // customer's AND refused as a name, with the refusal reported.
    codes: ["NO_DURABLE_ANCHOR"],
  },
  {
    description: "renders a resolvable namespace component's aria-label as a heading",
    attribute: "aria-label",
    receiver: "return <section><h2>{value}</h2></section>;",
    editable: ["Copy"],
    codes: [],
  },
  {
    description: "forwards a resolvable namespace component's id to a host id",
    attribute: "id",
    receiver: "return <section id={value} />;",
    editable: [],
    codes: [],
  },
  {
    description: "puts a resolvable namespace component's id in an aria-label",
    attribute: "id",
    receiver: "return <section aria-label={value} />;",
    editable: [],
    codes: [],
  },
];

for (const row of DOTTED_PROP_CASES) {
  test(`the caller is asked when the component ${row.description}`, () => {
    const extracted = extractCaller({
      "ui.tsx":
        `export function Card({ "${row.attribute}": value }: Record<string, never>) {\n` +
        `  ${row.receiver}\n}\n`,
      "Caller.tsx":
        `import * as ui from "./ui";\n` +
        `export function Caller() {\n` +
        `  return <ui.Card ${row.attribute}="Copy" />;\n}\n`,
    });
    assert.deepEqual(editableValues(extracted), [...row.editable]);
    assert.deepEqual(
      extracted.findings.map((finding) => finding.code),
      [...row.codes],
    );
  });
}

/**
 * An unreadable dotted receiver keeps the host reading, so a package wrapper
 * costs no new findings.
 */
const UNREADABLE_DOTTED: readonly (readonly [string, string, readonly string[], readonly string[]])[] = [
  ["className stays structural", `className="grid gap-4"`, [], []],
  ["aria-label stays a code-owned interface", `aria-label="Named"`, [], []],
  ["an unclassifiable name is still reported", `data-thing="x"`, [], ["UNKNOWN_ATTRIBUTE_ROLE"]],
];

for (const [description, attribute, editable, codes] of UNREADABLE_DOTTED) {
  test(`on an unreadable dotted tag, ${description}`, () => {
    const extracted = extractCaller({
      // `import` from a PACKAGE, not `declare const`. This fixture said
      // "a wrapper this reader cannot open" and wrote a LOCAL binding, which
      // is a different thing: a local receiver could hold one of our
      // components. Written this way the tag is external, which is the fact
      // the host reading actually rests on.
      "Caller.tsx":
        `import { motion } from "framer-motion";\n` +
        `export function Caller() {\n` +
        `  return <motion.div ${attribute} />;\n}\n`,
    });
    assert.deepEqual(editableValues(extracted), [...editable]);
    assert.deepEqual(
      extracted.findings.map((finding) => finding.code),
      [...codes],
    );
  });
}

/**
 * `ref` follows the same boundary as every other prop.
 *
 * On React 19 a `ref` written on a component reaches it as a prop, so a
 * resolvable dotted component is asked what it does with one. An unreadable
 * dotted tag keeps the host reading, where `ref` is a handle the DOM consumes
 * and nothing renders.
 */
test("a resolvable dotted component is asked what it does with ref", () => {
  const extracted = extractCaller({
    "package.json": `{"dependencies":{"react":"^19.0.0"}}\n`,
    "ui.tsx":
      `export function Card({ ref }: Record<string, never>) {\n` +
      `  return <section><h2>{ref}</h2></section>;\n}\n`,
    "Caller.tsx":
      `import * as ui from "./ui";\n` +
      `export function Caller() {\n  return <ui.Card ref="Visible" />;\n}\n`,
  });
  assert.deepEqual(editableValues(extracted), ["Visible"]);
});

test("an unreadable dotted tag's ref stays a host handle", () => {
  const extracted = extractCaller({
    "package.json": `{"dependencies":{"react":"^19.0.0"}}\n`,
    // A package import, for the same reason as the rows above: `declare const`
    // is a LOCAL binding, and a local receiver could hold one of our
    // components.
    "Caller.tsx":
      `import { motion } from "framer-motion";\n` +
      `export function Caller() {\n  return <motion.div ref="Visible" />;\n}\n`,
  });
  assert.deepEqual(editableValues(extracted), []);
  assert.deepEqual(extracted.findings.map((finding) => finding.code), []);
});

/**
 * WHAT KIND of text a prop holds is decided where the receiver shows it.
 *
 * `#pushAttributeText` hardcoded `semantic: "label"`, so a paragraph a
 * component renders in a `<p>` was capped at the label length. On a real site
 * that was 42 fields of body copy, and the only way to emit them was to raise
 * the cap in that site's config by hand.
 *
 * The rule is the one the host walk already used, asked of the receiver's
 * element instead of the caller's.
 */
const SEMANTIC_CASES: readonly (readonly [string, string, "body" | "label"])[] = [
  ["rendered in a paragraph", `<p>{copy}</p>`, "body"],
  ["rendered in a blockquote", `<blockquote>{copy}</blockquote>`, "body"],
  ["rendered in a span", `<span>{copy}</span>`, "label"],
  ["rendered in a button", `<button type="button">{copy}</button>`, "label"],
  ["rendered in a div", `<div>{copy}</div>`, "label"],
  // No element of its own to read, so the stricter cap stands.
  ["rendered in a fragment", `<>{copy}</>`, "label"],
  // Two sites that disagree cannot both be right; body needs unanimity.
  ["rendered in a paragraph AND a span", `<div><p>{copy}</p><span>{copy}</span></div>`, "label"],
  ["rendered in two paragraphs", `<div><p>{copy}</p><p>{copy}</p></div>`, "body"],
];

for (const [why, body, expected] of SEMANTIC_CASES) {
  test(`a prop ${why} is ${expected}`, () => {
    const extracted = extractCaller({
      "Inner.tsx": `export function Inner({ copy }: { copy?: string }) {\n  return ${body};\n}\n`,
      "Caller.tsx":
        `import { Inner } from "./Inner";\n` +
        `export function Caller() {\n  return <Inner copy="Some words" />;\n}\n`,
    });
    const found = extracted.candidates.find(
      (candidate) => candidate.kind === "plain_text" && candidate.value === "Some words",
    );
    assert.ok(found !== undefined, JSON.stringify(extracted.candidates.map((c) => c.kind)));
    assert.equal(found.kind === "plain_text" ? found.semantic : null, expected, why);
  });
}

/** An accessibility string is a name, never a paragraph, whatever it sits in. */
test("an aria attribute on a host element stays a label", () => {
  const extracted = extractCaller({
    "Caller.tsx":
      `export function Caller() {\n  return <p aria-label="A described region">Text</p>;\n}\n`,
  });
  const found = extracted.candidates.find(
    (candidate) => candidate.kind === "plain_text" && candidate.value === "A described region",
  );
  assert.ok(found !== undefined);
  assert.equal(found.kind === "plain_text" ? found.semantic : null, "label");
});

/**
 * A PROP rendered in child position of a proven host alias.
 *
 * Review reported this as forwarded `children` being dropped. The mechanism is
 * real and the shape is not: a component's text children are not extracted for
 * ANY receiver -- `children` is a slot filled from the call site
 * (`childrenSlotsOf`), so `<Heading>copy</Heading>` yields nothing whether the
 * receiver renders it in `<p>{children}</p>`, in `<Tag>{children}</Tag>`, or
 * not at all. Probed all three plus a bare `<p>copy</p>` control, which does
 * yield a field.
 *
 * What DOES reach `roleOfChild` is a prop whose value lands in child position,
 * and there the drop was exactly as described: `resolveTagAt("Tag")` returned
 * null and the value was withheld with no field and no finding.
 *
 * The rows also pin the reason the proof returns NAMES rather than a boolean:
 * `as="p"` makes the copy `body`, `as="h1"` makes it `label`, and only the
 * observed host names can say which.
 */
const CHILD_ALIAS = `export function Inner({ as = "h2", copy }: {
  as?: string;
  copy?: string;
}) {
  const Tag = as;
  return <Tag>{copy}</Tag>;
}
`;

/** The same receiver with no default, so an omitting site proves nothing. */
const CHILD_ALIAS_NO_DEFAULT = `export function Inner({ as, copy }: {
  as?: string;
  copy?: string;
}) {
  const Tag = as;
  return <Tag>{copy}</Tag>;
}
`;

const CHILD_ALIAS_CASES: readonly (readonly [string, string, string, string | null])[] = [
  // `OPAQUE_TAGS` was only ever consulted against the SYNTACTIC name, and `Tag`
  // is in no such set, so a tag PROVEN to be `script` had its prop proposed as
  // page copy. Every opaque tag in the set gets a row: they are one rule, and a
  // single one would leave the other three on the reviewer's next pass.
  ["one site proving a script tag", CHILD_ALIAS, '<Inner as="script" copy="Some words" />', null],
  ["one site proving a style tag", CHILD_ALIAS, '<Inner as="style" copy="Some words" />', null],
  ["one site proving an svg tag", CHILD_ALIAS, '<Inner as="svg" copy="Some words" />', null],
  ["one site proving a template tag", CHILD_ALIAS, '<Inner as="template" copy="Some words" />', null],
  // A MIXED set is refused rather than resolved either way: nothing true of
  // both a paragraph and a script is worth saying about the value.
  [
    "two sites proving one prose and one opaque tag",
    CHILD_ALIAS,
    '<div><Inner as="p" copy="Some words" /><Inner as="script" copy="Other" /></div>',
    null,
  ],

  ["one site proving a heading tag", CHILD_ALIAS, '<Inner as="h1" copy="Some words" />', "label"],
  // `p` is the only host tag that makes copy a paragraph, and the proof has to
  // carry the NAME for this row to be able to differ from the one above.
  ["one site proving a paragraph tag", CHILD_ALIAS, '<Inner as="p" copy="Some words" />', "body"],
  [
    "two sites proving different host tags",
    CHILD_ALIAS,
    '<div><Inner as="p" copy="Some words" /><Inner as="h1" copy="Other" /></div>',
    "label",
  ],
  [
    "a site passing a component",
    CHILD_ALIAS,
    '<div><Inner as="p" copy="Some words" /><Inner as={Card} copy="Other" /></div>',
    null,
  ],
  [
    "an omitting site where the prop has no default",
    CHILD_ALIAS_NO_DEFAULT,
    '<div><Inner as="p" copy="Some words" /><Inner copy="Other" /></div>',
    null,
  ],
];

for (const [why, receiver, body, semantic] of CHILD_ALIAS_CASES) {
  test(`a prop in child position of a dynamic tag with ${why} ${semantic === null ? "stays unread" : `is ${semantic}`}`, () => {
    const extracted = extractCaller({
      "Card.tsx": CARD,
      "Inner.tsx": receiver,
      "Caller.tsx":
        `import { Inner } from "./Inner";\n` +
        `import { Card } from "./Card";\n` +
        `export function Caller() {\n  return ${body};\n}\n`,
    });
    const found = extracted.candidates.find(
      (candidate) => candidate.kind === "plain_text" && candidate.value === "Some words",
    );
    if (semantic === null) {
      assert.equal(
        found,
        undefined,
        `${why}: the tag is not proven, so the value must not be claimed as content`,
      );
      return;
    }
    assert.ok(found !== undefined, `${why}: the caller's copy was dropped`);
    assert.equal(found.kind === "plain_text" ? found.semantic : null, semantic, why);
  });
}

/**
 * The shape review described, kept as a row that records what is true of it.
 *
 * A component's text children are a SLOT, so no receiver makes them a field.
 * If that ever changes, this row fails and the child-position reading above is
 * where it has to be wired.
 */
const CHILDREN_RECEIVERS: readonly (readonly [string, string])[] = [
  ["a static host element", `export function Heading({ children }: { children?: React.ReactNode }) {\n  return <p>{children}</p>;\n}\n`],
  ["a proven host alias", `export function Heading({ as = "h2", children }: { as?: string; children?: React.ReactNode }) {\n  const Tag = as;\n  return <Tag>{children}</Tag>;\n}\n`],
  ["a receiver that never renders them", `export function Heading({ children }: { children?: React.ReactNode }) {\n  void children;\n  return <p>fixed</p>;\n}\n`],
];

for (const [why, receiver] of CHILDREN_RECEIVERS) {
  test(`a component's text children are not a field, with ${why}`, () => {
    const extracted = extractCaller({
      "Heading.tsx": receiver,
      "Caller.tsx":
        `import { Heading } from "./Heading";\n` +
        `export function Caller() {\n  return <Heading as="h1">Editable copy</Heading>;\n}\n`,
    });
    assert.equal(
      extracted.candidates.some(
        (candidate) => candidate.kind === "plain_text" && candidate.value === "Editable copy",
      ),
      false,
      `${why}: children are a slot filled from the call site, not a value the receiver declares`,
    );
  });
}

/**
 * The attribute side of the same rule has NO row, deliberately.
 *
 * `roleOfAttribute` now returns `INERT` rather than `ACCESSIBILITY` for a
 * proven opaque tag, which is the honest reading -- nothing on a `<script>`
 * renders, its `aria-label` included. But neither answer emits a candidate or a
 * finding through this harness, so a row asserting "no field" passes with the
 * branch removed. It is a fail-direction change with no reachable difference
 * today, and a vacuous row claiming otherwise is worse than none.
 *
 * The prose twin below is not vacuous: it asserts the proof still SETTLES an
 * accessibility attribute, which is what separates these rows from a blanket
 * refusal of dynamic tags.
 */
test("aria-label on a proven PROSE dynamic tag is still settled", () => {
  const extracted = extractCaller({
    "Inner.tsx": CHILD_ALIAS,
    "Caller.tsx":
      `import { Inner } from "./Inner";\n` +
      `export function Caller() {\n  return <Inner as="h1" aria-label="A described region" />;\n}\n`,
  });
  assert.equal(
    extracted.findings.some((finding) => finding.code === "UNKNOWN_ATTRIBUTE_ROLE"),
    false,
    "a proven prose host settles its accessibility attributes",
  );
});

/** The control for the rows above: the same text in the caller's own markup IS a field. */
test("the same text in the caller's own host element is a field", () => {
  const extracted = extractCaller({
    "Caller.tsx": `export function Caller() {\n  return <p>Editable copy</p>;\n}\n`,
  });
  assert.equal(
    extracted.candidates.some(
      (candidate) => candidate.kind === "plain_text" && candidate.value === "Editable copy",
    ),
    true,
    "without this the rows above could pass because nothing is extracted at all",
  );
});

/**
 * An attribute written DIRECTLY on the dynamic tag, inside the receiver.
 *
 * `extract.ts#collectAttributes` routed every PascalCase tag to the component
 * path, so `<Tag className="grid">` reported `UNKNOWN_ATTRIBUTE_ROLE` -- a
 * finding about a tag this reader had already proven to be a host element, for
 * a human to dismiss.
 *
 * BOTH modules are entries on purpose. Extraction walks the markup of the
 * entry modules' own components, so with only `Caller.tsx` the receiver's
 * internals are never walked and this row passes with the fix reverted -- which
 * is how my first attempt at it was vacuous.
 */
const DIRECT_ATTRIBUTE_ALIAS = `export function Heading({ as = "h2", children }: {
  as?: string;
  children?: React.ReactNode;
}) {
  const Tag = as;
  return <Tag className="grid gap-4">{children}</Tag>;
}
`;

/** The same receiver whose tag is NOT proven, so the finding is still owed. */
const DIRECT_ATTRIBUTE_UNPROVEN = `import { Card } from "./Card";
export function Heading({ as = "h2", children }: {
  as?: string;
  children?: React.ReactNode;
}) {
  const Tag = as;
  void Card;
  return <Tag className="grid gap-4">{children}</Tag>;
}
`;

const DIRECT_ATTRIBUTE_CASES: readonly (readonly [string, string, string, boolean])[] = [
  [
    "a proven host alias",
    DIRECT_ATTRIBUTE_ALIAS,
    '<Heading as="h1">Copy</Heading>',
    false,
  ],
  [
    // Unproven, so the reader genuinely does not know what the attribute is on,
    // and saying so is the right answer rather than assuming a host element.
    "an alias a caller passes a component to",
    DIRECT_ATTRIBUTE_UNPROVEN,
    '<div><Heading as="h1">Copy</Heading><Heading as={Card}>Other</Heading></div>',
    true,
  ],
];

/**
 * Attributes written directly on a proven OPAQUE dynamic tag.
 *
 * Two readers had to agree here and did not: `prop-roles.ts` treats a proven
 * `script` as inert, while `extract.ts` tested the proof for `null` alone, so
 * the opaque answer went down the HOST branch. Without the fix `aria-label`
 * becomes a code-owned interface and `alt` reports `UNKNOWN_ATTRIBUTE_ROLE`,
 * both on markup the reader had already decided shows nothing.
 *
 * The DEFAULT has to be opaque too, and finding that out is the row. The
 * `<Tag>` render site inside the receiver is itself an unattributable call
 * site, so it contributes the declared default to the proven set -- with
 * `as = "h2"` the set is `["style", "h2"]`, mixed, and the proof refuses
 * instead of returning opaque. My first attempt at these rows used a prose
 * default, never reached the branch, and failed for that reason.
 *
 * BOTH modules are entries: extraction walks the entry modules' own
 * components, so with only the caller the receiver's markup is never walked.
 * That is also what made my round-12 rows vacuous -- they were written against
 * the CALLER's element, where neither answer is observable.
 */
const OPAQUE_DIRECT_ATTRIBUTES: readonly (readonly [string, string])[] = [
  ["aria-label", 'aria-label="A described region"'],
  ["alt", 'alt="A described image"'],
  ["className", 'className="grid gap-4"'],
];

for (const [why, attribute] of OPAQUE_DIRECT_ATTRIBUTES) {
  test(`${why} directly on a proven OPAQUE dynamic tag needs no human`, () => {
    const extracted = extractEntries(
      {
        "Heading.tsx":
          `export function Heading({ as = "script", children }: {\n` +
          `  as?: string;\n  children?: React.ReactNode;\n}) {\n` +
          `  const Tag = as;\n  return <Tag ${attribute}>{children}</Tag>;\n}\n`,
        "Caller.tsx":
          `import { Heading } from "./Heading";\n` +
          `export function Caller() {\n  return <Heading as="style" />;\n}\n`,
      },
      ["Caller.tsx", "Heading.tsx"],
    );
    assert.deepEqual(
      extracted.findings.map((finding) => finding.code),
      [],
      `${why}: an opaque element renders nothing, so nothing about it is a question`,
    );
    assert.deepEqual(
      extracted.candidates.map((candidate) => candidate.kind),
      [],
      `${why}: and nothing about it is a field either`,
    );
  });
}

/**
 * A call site written inside a locally-called renderer still counts.
 *
 * `{renderHeading()}` puts whatever `renderHeading` writes into rendered
 * output, but the render walk followed named functions only when they were
 * ARGUMENTS, never when they were the callee. So the `<Heading as={Card} />`
 * inside it was invisible to the call-site index, and the direct
 * `<Heading as="h1" />` beside it built an all-host proof on its own.
 *
 * The twin keeps it honest: the same shape passing a HOST literal must still
 * settle, so the row is about seeing the site rather than about refusing calls.
 */
const LOCAL_RENDERER_CASES: readonly (readonly [string, string, boolean])[] = [
  ["a component", "{Card}", false],
  ["a host literal", '"p"', true],
];

for (const [why, passed, settled] of LOCAL_RENDERER_CASES) {
  test(`a site inside a locally-called renderer passing ${why} is ${settled ? "settled" : "not settled"}`, () => {
    const extracted = extractEntries(
      {
        "Card.tsx": CARD,
        "Heading.tsx": ALIAS_TAG,
        "Caller.tsx":
          `import { Heading } from "./Heading";\n` +
          `import { Card } from "./Card";\n` +
          `const renderHeading = () => <Heading as=${passed} className="mt-3">B</Heading>;\n` +
          `export function Caller() {\n` +
          `  return (\n    <div>\n` +
          `      <Heading as="h1" className="mt-2">A</Heading>\n` +
          `      {renderHeading()}\n` +
          `    </div>\n  );\n}\n`,
      },
      ["Caller.tsx", "Heading.tsx"],
    );
    assert.equal(
      extracted.findings.some(
        (finding) =>
          finding.code === "UNKNOWN_ATTRIBUTE_ROLE" && finding.decision.includes("className"),
      ),
      !settled,
      settled
        ? `${why}: every observed value is a host tag, so the role should have settled`
        : `${why}: the renderer's site passes a component, so nothing is settled`,
    );
  });
}

/**
 * A duplicated prop on a COMPONENT extracts only what the element receives.
 *
 * `findAttribute` was taught that JSX applies attributes left to right;
 * `#collectAttributes` iterates `namedAttributes` and was not, so both literals
 * of `<Inner label="stale" label="shown" />` reached extraction and the stale
 * one could become the customer's field.
 */
test("a duplicated component prop offers only the effective value", () => {
  const extracted = extractCaller({
    "Inner.tsx": RENDERS_LABEL,
    "Caller.tsx":
      `import { Inner } from "./Inner";\n` +
      `export function Caller() {\n  return <Inner label="Stale words" label="Shown words" />;\n}\n`,
  });
  const values = extracted.candidates
    .filter((candidate) => candidate.kind === "plain_text")
    .map((candidate) => (candidate.kind === "plain_text" ? candidate.value : ""));
  assert.deepEqual(values, ["Shown words"], "only the received value is the customer's field");
});

/**
 * A proven opaque alias excludes its whole SUBTREE, not just its attributes.
 *
 * `isWalkedElement` asks `OPAQUE_TAGS` about the syntactic name, and `Tag` is
 * in no such set, so `<Tag><p>Invisible</p></Tag>` had the nested paragraph
 * walked and its text offered as customer copy from inside excluded markup.
 * Skipping only the attributes was half a boundary.
 */
test("a proven OPAQUE alias excludes the text nested inside it", () => {
  const extracted = extractEntries(
    {
      "Heading.tsx":
        `export function Heading({ as = "script" }: { as?: string }) {\n` +
        `  const Tag = as;\n  return <Tag><p>Invisible</p></Tag>;\n}\n`,
      "Caller.tsx":
        `import { Heading } from "./Heading";\n` +
        `export function Caller() {\n  return <Heading as="style" />;\n}\n`,
    },
    ["Caller.tsx", "Heading.tsx"],
  );
  assert.equal(
    extracted.candidates.some(
      (candidate) => candidate.kind === "plain_text" && candidate.value === "Invisible",
    ),
    false,
    "text inside a proven script or style element is not the customer's copy",
  );
});

/** The prose twin: the same nesting under a proven `h1` IS the customer's copy. */
test("a proven PROSE alias still yields the text nested inside it", () => {
  const extracted = extractEntries(
    {
      "Heading.tsx":
        `export function Heading({ as = "h2" }: { as?: string }) {\n` +
        `  const Tag = as;\n  return <Tag><p>Visible</p></Tag>;\n}\n`,
      "Caller.tsx":
        `import { Heading } from "./Heading";\n` +
        `export function Caller() {\n  return <Heading as="h1" />;\n}\n`,
    },
    ["Caller.tsx", "Heading.tsx"],
  );
  assert.equal(
    extracted.candidates.some(
      (candidate) => candidate.kind === "plain_text" && candidate.value === "Visible",
    ),
    true,
    "without this the row above could pass because nothing is extracted at all",
  );
});

/**
 * A rendered callee is followed by BINDING, not by spelling.
 *
 * `soleFunctionBodies` is a module-wide map keyed on the name, so a parameter
 * called `renderHeading` handed the walk an unrelated module function's body --
 * and its `<Heading as="h1" />` entered the index as evidence about a call that
 * never happens, while the parameter it actually calls renders
 * `<Heading as={Card} />`.
 */
test("a rendered callee shadowed by a parameter is not followed", () => {
  const extracted = extractEntries(
    {
      "Card.tsx": CARD,
      "Heading.tsx": ALIAS_TAG,
      "Caller.tsx":
        `import { Heading } from "./Heading";\n` +
        `import { Card } from "./Card";\n` +
        `const renderHeading = () => <Heading as="p" className="mt-3">M</Heading>;\n` +
        `void renderHeading;\n` +
        `export function Caller({ renderHeading }: { renderHeading: () => React.ReactNode }) {\n` +
        `  return (\n    <div>\n` +
        `      <Heading as="h1" className="mt-2">A</Heading>\n` +
        `      {renderHeading()}\n` +
        `    </div>\n  );\n}\n`,
    },
    ["Caller.tsx", "Heading.tsx"],
  );
  assert.equal(
    extracted.findings.some(
      (finding) =>
        finding.code === "UNKNOWN_ATTRIBUTE_ROLE" && finding.decision.includes("className"),
    ),
    true,
    "the parameter's body is unknown, so the module function of that name is not evidence",
  );
});

/**
 * A component with NO observed caller proves nothing, however it renders.
 *
 * `<Tag>` inside the receiver is in the opaque call-site list -- the resolver
 * cannot identify it -- and once an omitting opaque site began contributing the
 * declared default, that render proved the component from its OWN markup:
 * `values` came out `["h2"]` with no caller anywhere. A route-level or
 * externally invoked `Heading` could then be handed `as={Card}` while its props
 * had already been given host semantics.
 *
 * 92 of the 552 opaque checks on All Points Media are these self-renders.
 */
test("a receiver with no observed call site is not settled by its own render", () => {
  const extracted = extractEntries(
    {
      // A LITERAL attribute, because a forwarded `{className}` is a non-literal
      // value and reports under a different code -- the first version of this
      // row used one and failed with the fix AND without it.
      "Heading.tsx":
        `export function Heading({ as = "h2" }: { as?: string }) {\n` +
        `  const Tag = as;\n  return <Tag className="grid gap-4" />;\n}\n`,
      // Nothing renders <Heading>. The entry exists so the receiver's own
      // markup is walked.
      "Caller.tsx": `export function Caller() {\n  return <p>Unrelated</p>;\n}\n`,
    },
    ["Caller.tsx", "Heading.tsx"],
  );
  assert.equal(
    extracted.findings.some(
      (finding) =>
        finding.code === "UNKNOWN_ATTRIBUTE_ROLE" && finding.decision.includes("className"),
    ),
    true,
    "with no caller observed the tag is unknown, and saying so is the answer",
  );
});

/**
 * The prose twin: the same attribute on a proven `h1` IS still classified.
 *
 * Without this the rows above would pass if the proof simply stopped working.
 */
test("aria-label directly on a proven PROSE dynamic tag is classified", () => {
  const extracted = extractEntries(
    {
      "Heading.tsx":
        `export function Heading({ as = "h2", children }: {\n` +
        `  as?: string;\n  children?: React.ReactNode;\n}) {\n` +
        `  const Tag = as;\n  return <Tag aria-label="A described region">{children}</Tag>;\n}\n`,
      "Caller.tsx":
        `import { Heading } from "./Heading";\n` +
        `export function Caller() {\n  return <Heading as="h1" />;\n}\n`,
    },
    ["Caller.tsx", "Heading.tsx"],
  );
  assert.equal(
    extracted.candidates.some(
      (candidate) =>
        candidate.kind === "plain_text" && candidate.ownership === "code_owned_interface",
    ),
    true,
    "a proven prose host offers its accessibility string as a code-owned interface",
  );
});

/**
 * A MIXED set refuses, and the refusal is visible rather than silent.
 *
 * TWO callers, one prose and one opaque. The earlier version of this row mixed
 * a `"script"` caller with an `as = "h2"` DEFAULT, which worked only because
 * the component's own `<Tag>` render was contributing that default as
 * evidence -- the defect review found next. With self-renders giving no
 * positive evidence, the only observed value there is `"script"`, all-opaque,
 * and the row was asserting the wrong thing. Mixing has to come from real call
 * sites.
 */
test("an attribute on a MIXED proven dynamic tag is still reported", () => {
  const extracted = extractEntries(
    {
      "Heading.tsx":
        `export function Heading({ as = "h2", children }: {\n` +
        `  as?: string;\n  children?: React.ReactNode;\n}) {\n` +
        `  const Tag = as;\n  return <Tag alt="A described image">{children}</Tag>;\n}\n`,
      "Caller.tsx":
        `import { Heading } from "./Heading";\n` +
        `export function Caller() {\n` +
        `  return (\n    <div>\n` +
        `      <Heading as="p" />\n` +
        `      <Heading as="script" />\n` +
        `    </div>\n  );\n}\n`,
    },
    ["Caller.tsx", "Heading.tsx"],
  );
  assert.equal(
    extracted.findings.some((finding) => finding.code === "UNKNOWN_ATTRIBUTE_ROLE"),
    true,
    "a mixed proof is not a proof, so the attribute still needs a human",
  );
});

for (const [why, receiver, body, owed] of DIRECT_ATTRIBUTE_CASES) {
  test(`an attribute directly on ${why} ${owed ? "is still reported" : "is structural"}`, () => {
    const extracted = extractEntries(
      {
        "Card.tsx": CARD,
        "Heading.tsx": receiver,
        "Caller.tsx":
          `import { Heading } from "./Heading";\n` +
          `import { Card } from "./Card";\n` +
          `export function Caller() {\n  return ${body};\n}\n`,
      },
      ["Caller.tsx", "Heading.tsx"],
    );
    assert.equal(
      extracted.findings.some((finding) => finding.code === "UNKNOWN_ATTRIBUTE_ROLE"),
      owed,
      owed
        ? `${why}: the tag is unproven, so the attribute still needs a human`
        : `${why}: the tag is proven to be a host element, so its className needs no human`,
    );
    assert.equal(
      extracted.candidates.some(
        (candidate) => candidate.kind === "plain_text" && candidate.value.includes("grid"),
      ),
      false,
      "a host element's className is never customer copy",
    );
  });
}

/**
 * A capitalised tag that is provably a HOST element every time it renders.
 *
 * `const Tag = as; <Tag className={…}>` reads as a component, resolves to
 * nothing, and every prop landing on it was undecided — 22 findings on one real
 * component. WHICH element it is need not be known to know WHAT it is: if every
 * value the prop can take is a lowercase host-tag literal, host semantics
 * apply, and `className` on a host element is code.
 *
 * The refusals are the substance. Each row below names one thing the reading
 * has NOT seen, and one unseen value puts a component back in play.
 */
const ALIAS_TAG = `export function Heading({ as = "h2", className, children }: {
  as?: string;
  className?: string;
  children?: React.ReactNode;
}) {
  const Tag = as;
  return <Tag className={className}>{children}</Tag>;
}
`;

/**
 * The default written as `??` on the alias instead of in the destructuring.
 *
 * NOT settled, and deliberately: the alias initializer has to be the prop
 * itself for the value to be traceable to a call site, and `as ?? "h2"` is an
 * expression whose result this reading has not established. Refusing is the
 * safe direction, and the row exists so the limit is recorded rather than
 * discovered.
 */
const COALESCED_TAG = `export function Heading({ as, className, children }: {
  as?: string;
  className?: string;
  children?: React.ReactNode;
}) {
  const Tag = as ?? "h2";
  return <Tag className={className}>{children}</Tag>;
}
`;

/** The same component with the prop destructured straight to the tag name. */
const DESTRUCTURED_TAG = `export function Heading({ as: Tag = "h2", className, children }: {
  as?: string;
  className?: string;
  children?: React.ReactNode;
}) {
  return <Tag className={className}>{children}</Tag>;
}
`;

/** No default at all, so a site that omits `as` supplies nothing readable. */
const NO_DEFAULT_TAG = `export function Heading({ as, className, children }: {
  as: string;
  className?: string;
  children?: React.ReactNode;
}) {
  const Tag = as;
  return <Tag className={className}>{children}</Tag>;
}
`;

function callerOf(body: string, receiver = ALIAS_TAG): ComponentExtraction {
  return extractCaller({
    "Heading.tsx": receiver,
    "Caller.tsx": `import { Heading } from "./Heading";\nexport function Caller() {\n  return ${body};\n}\n`,
  });
}

/** Whether the caller's `className` was offered to the customer to edit. */
function classNameIsEditable(extracted: ComponentExtraction): boolean {
  return extracted.candidates.some(
    (candidate) =>
      candidate.kind === "plain_text" &&
      candidate.ownership === "customer_editable" &&
      candidate.value.includes("mt-"),
  );
}

function roleWasUndecided(extracted: ComponentExtraction): boolean {
  return extracted.findings.some(
    (finding) =>
      finding.code === "UNKNOWN_ATTRIBUTE_ROLE" && finding.decision.includes("className"),
  );
}

const HOST_ALIAS_CASES: readonly (readonly [string, string, boolean])[] = [
  ['one site with a lowercase literal', '<Heading as="h1" className="mt-2">Hi</Heading>', true],
  [
    "two sites, both lowercase literals",
    '<div><Heading as="h1" className="mt-2">A</Heading><Heading as="p" className="mt-3">B</Heading></div>',
    true,
  ],
  [
    // The other order. Reading the first occurrence would refuse this, which is
    // the safe direction but still the wrong answer: the element receives
    // `"h1"`.
    "a duplicate prop whose effective value IS a host literal",
    '<Heading as={Card} as="h1" className="mt-2">Hi</Heading>',
    true,
  ],
  [
    // A spread between two literals: the trailing literal wins over it.
    "a duplicate prop written after a spread",
    '<Heading as="p" {...rest} as="h1" className="mt-2">Hi</Heading>',
    true,
  ],
  [
    "a site that omits the prop, where the default is a literal",
    '<div><Heading as="h1" className="mt-2">A</Heading><Heading className="mt-3">B</Heading></div>',
    true,
  ],
  // Everything below is a value the reading has NOT seen.
  [
    "a site passing a CAPITALISED value",
    '<div><Heading as="h1" className="mt-2">A</Heading><Heading as="Section" className="mt-3">B</Heading></div>',
    false,
  ],
  [
    "a site passing a value that is not a literal",
    '<div><Heading as="h1" className="mt-2">A</Heading><Heading as={pick} className="mt-3">B</Heading></div>',
    false,
  ],
];

for (const [why, body, settled] of HOST_ALIAS_CASES) {
  test(`a dynamic tag with ${why} is ${settled ? "a host element" : "not settled"}`, () => {
    const extracted = callerOf(body);
    assert.equal(
      classNameIsEditable(extracted),
      false,
      "className was offered as customer copy, which it never is on a host element",
    );
    assert.equal(
      roleWasUndecided(extracted),
      !settled,
      settled
        ? `${why}: the role should have been settled as code`
        : `${why}: an unseen value must leave the role undecided`,
    );
  });
}

/**
 * A DOTTED call site vetoes the host proof.
 *
 * The call-site index took PascalCase tags only, while extraction reads a
 * resolvable dotted tag as a component. So `<ui.Heading as={Card} />` was
 * reachable, rendered a component, and contributed nothing: the index held one
 * site, every observed value was `"h1"`, and `className` was settled as
 * structural code on a component that renders it.
 *
 * An index that omits a site is worse than an absent one, because the proof
 * reads the gap as agreement. Both readers now ask `readTagAs`.
 */
test("a resolvable DOTTED call site is evidence against the host reading", () => {
  const extracted = extractCaller({
    "Card.tsx": CARD,
    "Heading.tsx": ALIAS_TAG,
    "Caller.tsx":
      `import { Heading } from "./Heading";\n` +
      `import * as ui from "./Heading";\n` +
      `import { Card } from "./Card";\n` +
      `export function Caller() {\n` +
      `  return (\n` +
      `    <div>\n` +
      `      <Heading as="h1" className="mt-2">A</Heading>\n` +
      `      <ui.Heading as={Card} className="mt-3">B</ui.Heading>\n` +
      `    </div>\n` +
      `  );\n}\n`,
  });
  assert.equal(
    roleWasUndecided(extracted),
    true,
    "the dotted site renders a component, so the host proof must not settle",
  );
});

/**
 * The same shape where every site AGREES, so the dotted site does not merely
 * refuse everything: a dotted call site passing a lowercase literal still lets
 * the proof settle.
 */
test("a resolvable DOTTED call site with a lowercase literal still settles", () => {
  const extracted = extractCaller({
    "Card.tsx": CARD,
    "Heading.tsx": ALIAS_TAG,
    "Caller.tsx":
      `import { Heading } from "./Heading";\n` +
      `import * as ui from "./Heading";\n` +
      `export function Caller() {\n` +
      `  return (\n` +
      `    <div>\n` +
      `      <Heading as="h1" className="mt-2">A</Heading>\n` +
      `      <ui.Heading as="p" className="mt-3">B</ui.Heading>\n` +
      `    </div>\n` +
      `  );\n}\n`,
  });
  assert.equal(
    roleWasUndecided(extracted),
    false,
    "every observed value is a host tag, so the role should have settled as code",
  );
});

/**
 * An OPAQUE call site vetoes the host proof; an EXTERNAL one does not.
 *
 * `const Alias = Heading` resolves to no declaration, so the site was absent
 * from the index and the proof saw only the direct lowercase call. The
 * resolver already knew the difference between "a component from a package"
 * and "a binding of ours I could not identify" and `resolveTagAt` threw it
 * away; `TagTarget` keeps it, because only the second can secretly be the
 * declaration under proof.
 *
 * The negative rows matter as much: a blanket veto would be sound and useless.
 * On All Points Media the proof reaches this check 44 times with 12 opaque
 * sites in scope and vetoes nothing, because those sites are the dynamic tag
 * renders themselves -- no `as`, no spread, literal defaults.
 */
const OPAQUE_ALIAS_CASES: readonly (readonly [string, string, boolean])[] = [
  [
    "an opaque alias site passing a COMPONENT",
    `import { Heading } from "./Heading";\n` +
      `import { Card } from "./Card";\n` +
      `const Alias = Heading;\n` +
      `export function Caller() {\n` +
      `  return (\n    <div>\n` +
      `      <Heading as="h1" className="mt-2">A</Heading>\n` +
      `      <Alias as={Card}>B</Alias>\n` +
      `    </div>\n  );\n}\n`,
    false,
  ],
  [
    "an opaque alias site carrying a SPREAD that may supply the prop",
    `import { Heading } from "./Heading";\n` +
      `const Alias = Heading;\n` +
      `declare const rest: Record<string, unknown>;\n` +
      `export function Caller() {\n` +
      `  return (\n    <div>\n` +
      `      <Heading as="h1" className="mt-2">A</Heading>\n` +
      `      <Alias {...rest}>B</Alias>\n` +
      `    </div>\n  );\n}\n`,
    false,
  ],
  [
    // The omitting opaque site's DEFAULT has to enter the proven set, not just
    // be checked for existence. A default of `"Card"` renders a component, and
    // two loops that disagreed about this proved the tag a host element.
    "an opaque alias site that omits a prop whose default is a COMPONENT name",
    `import { Heading } from "./HeadingCard";\n` +
      `const Alias = Heading;\n` +
      `export function Caller() {\n` +
      `  return (\n    <div>\n` +
      `      <Heading as="h1" className="mt-2">A</Heading>\n` +
      `      <Alias>B</Alias>\n` +
      `    </div>\n  );\n}\n`,
    false,
  ],
  [
    "an opaque alias site that omits the prop, where the default IS a literal",
    `import { Heading } from "./Heading";\n` +
      `const Alias = Heading;\n` +
      `export function Caller() {\n` +
      `  return (\n    <div>\n` +
      `      <Heading as="h1" className="mt-2">A</Heading>\n` +
      `      <Alias>B</Alias>\n` +
      `    </div>\n  );\n}\n`,
    true,
  ],
  [
    // A DOTTED opaque tag. `const ui = { Heading }` is not a namespace import,
    // so the receiver is a binding of OURS that could not be identified, and it
    // might hold the component under proof.
    "an opaque DOTTED alias site passing a component",
    `import { Heading } from "./Heading";\n` +
      `import { Card } from "./Card";\n` +
      `const ui = { Heading };\n` +
      `export function Caller() {\n` +
      `  return (\n    <div>\n` +
      `      <Heading as="h1" className="mt-2">A</Heading>\n` +
      `      <ui.Heading as={Card}>B</ui.Heading>\n` +
      `    </div>\n  );\n}\n`,
    false,
  ],
  [
    // The same with a LOWERCASE member. A member-case rule called this a DOM
    // element and skipped the call; the receiver is what decides, and this one
    // is ours.
    "an opaque DOTTED alias site with a lowercase member",
    `import { Heading } from "./Heading";\n` +
      `import { Card } from "./Card";\n` +
      `const ui = { heading: Heading };\n` +
      `export function Caller() {\n` +
      `  return (\n    <div>\n` +
      `      <Heading as="h1" className="mt-2">A</Heading>\n` +
      `      <ui.heading as={Card}>B</ui.heading>\n` +
      `    </div>\n  );\n}\n`,
    false,
  ],
  [
    // An EXTERNAL receiver with a lowercase member: `motion.div` forwards to
    // the DOM element it names, and this is the row that keeps that working.
    "an external dotted tag with a lowercase member",
    `import { Heading } from "./Heading";\n` +
      `import { motion } from "framer-motion";\n` +
      `export function Caller() {\n` +
      `  return (\n    <div>\n` +
      `      <Heading as="h1" className="mt-2">A</Heading>\n` +
      `      <motion.div>B</motion.div>\n` +
      `    </div>\n  );\n}\n`,
    true,
  ],
  [
    // The row that keeps the guard from being a blanket refusal, and the reason
    // All Points Media still converts: a package's component is not ours.
    "an EXTERNAL component site passing a component",
    `import { Heading } from "./Heading";\n` +
      `import { Card } from "./Card";\n` +
      `import { Link } from "some-package";\n` +
      `export function Caller() {\n` +
      `  return (\n    <div>\n` +
      `      <Heading as="h1" className="mt-2">A</Heading>\n` +
      `      <Link as={Card}>B</Link>\n` +
      `    </div>\n  );\n}\n`,
    true,
  ],
];

for (const [why, callerSource, settled] of OPAQUE_ALIAS_CASES) {
  test(`${why} is ${settled ? "still settled" : "not settled"}`, () => {
    const extracted = extractCaller({
      "Card.tsx": CARD,
      "Heading.tsx": ALIAS_TAG,
      "HeadingCard.tsx": HEADING_CARD_DEFAULT,
      "Caller.tsx": callerSource,
    });
    assert.equal(
      roleWasUndecided(extracted),
      !settled,
      settled
        ? `${why}: the proof should have settled the role as code`
        : `${why}: a site the reader could not attribute must stop the proof`,
    );
  });
}

/**
 * The same alias, where the prop has NO literal default.
 *
 * An opaque site carrying neither the prop nor a spread still behaves like a
 * call that omits it, so it gets what omitting sites get: without a literal
 * default the rendered tag is whatever `undefined` renders, and nothing is
 * settled.
 */
test("an opaque alias site is not settled when the prop has no default", () => {
  const extracted = extractCaller({
    "Card.tsx": CARD,
    "Heading.tsx": NO_DEFAULT_TAG,
    "Caller.tsx":
      `import { Heading } from "./Heading";\n` +
      `const Alias = Heading;\n` +
      `export function Caller() {\n` +
      `  return (\n    <div>\n` +
      `      <Heading as="h1" className="mt-2">A</Heading>\n` +
      `      <Alias>B</Alias>\n` +
      `    </div>\n  );\n}\n`,
  });
  assert.equal(
    roleWasUndecided(extracted),
    true,
    "an omitting opaque site with no literal default cannot settle the role",
  );
});

test("a dynamic tag whose prop has no default is not settled by an omitting site", () => {
  const extracted = callerOf(
    '<div><Heading as="h1" className="mt-2">A</Heading><Heading className="mt-3">B</Heading></div>',
    NO_DEFAULT_TAG,
  );
  assert.equal(roleWasUndecided(extracted), true);
});

/** The same renamed prop with a lowercase literal on the REAL property does
 * settle — so the row above refuses because it reads `kind`, not because a
 * rename refuses everything. */
test("an alias reading a renamed prop settles from that property's value", () => {
  const extracted = extractCaller({
    "Card.tsx": CARD,
    "Heading.tsx": RENAMED_PROP_TAG,
    "Caller.tsx":
      `import { Heading } from "./Heading";\n` +
      `export function Caller() {\n  return <Heading kind="h1" className="mt-2" />;\n}\n`,
  });
  assert.equal(roleWasUndecided(extracted), false);
});

test("a default written as ?? on the alias is not settled", () => {
  const extracted = callerOf('<Heading as="h1" className="mt-2">Hi</Heading>', COALESCED_TAG);
  assert.equal(roleWasUndecided(extracted), true);
});

test("a prop destructured straight to the tag name is read the same way", () => {
  const extracted = callerOf('<Heading as="h1" className="mt-2">Hi</Heading>', DESTRUCTURED_TAG);
  assert.equal(roleWasUndecided(extracted), false);
  assert.equal(classNameIsEditable(extracted), false);
});

/**
 * The alias must stand for a PROP.
 *
 * `const Tag = Fallback` where `Fallback` is a module constant names something
 * whose value no call site supplies, so no site is evidence about it and the
 * tag stays unread. Without this the reading would accept any local whose name
 * happened to match, and settle a tag from values that never reach it.
 */
test("an alias for something that is not a prop is not settled", () => {
  const extracted = extractCaller({
    "Heading.tsx":
      `const Fallback = "h2";\n` +
      `export function Heading({ as = "h2", className, children }: {\n` +
      `  as?: string;\n  className?: string;\n  children?: React.ReactNode;\n}) {\n` +
      `  void as;\n  const Tag = Fallback;\n` +
      `  return <Tag className={className}>{children}</Tag>;\n}\n`,
    "Caller.tsx":
      `import { Heading } from "./Heading";\n` +
      `export function Caller() {\n  return <Heading as="h1" className="mt-2">Hi</Heading>;\n}\n`,
  });
  assert.equal(roleWasUndecided(extracted), true);
});

/**
 * Three ways the call sites would be evidence about the WRONG value.
 *
 * Each was a merge blocker, and the second was a guard I had deleted the round
 * before on the reasoning that a non-prop name carries no attribute at any
 * site — which ignores the case where the name COLLIDES with a prop callers do
 * pass.
 */

/** `let`, reassigned to a component on one path. */
const MUTABLE_TAG = `import { Card } from "./Card";
export function Heading({ as = "h2", className, children }: {
  as?: string;
  className?: string;
  children?: React.ReactNode;
}) {
  let Tag = as;
  if (className === "x") Tag = Card as unknown as string;
  return <Tag className={className}>{children}</Tag>;
}
`;

/** A local named like the prop, holding a component. Callers still pass `as`. */
const COLLIDING_TAG = `import { Card } from "./Card";
export function Heading({ className, children }: {
  as?: string;
  className?: string;
  children?: React.ReactNode;
}) {
  const as = Card;
  const Tag = as;
  return <Tag className={className}>{children}</Tag>;
}
`;

/**
 * The same collision at MODULE level rather than inside the function.
 *
 * The shadow check walks blocks up to the module and so does not see this one;
 * only "does the component declare such a prop at all" does. The two checks
 * look redundant on the local version and are not.
 */
const MODULE_COLLIDING_TAG = `import { Card } from "./Card";
const as = Card;
export function Heading({ className, children }: {
  className?: string;
  children?: React.ReactNode;
}) {
  const Tag = as;
  return <Tag className={className}>{children}</Tag>;
}
`;

/**
 * The component DOES declare `as`, and a nested block shadows it.
 *
 * Only the shadow check catches this: the component has the prop, so "does it
 * declare one" says yes, and the value that renders is the block's, not the
 * caller's.
 */
const SHADOWED_TAG = `import { Card } from "./Card";
export function Heading({ as = "h2", className, children }: {
  as?: string;
  className?: string;
  children?: React.ReactNode;
}) {
  void as;
  {
    const as = Card as unknown as string;
    const Tag = as;
    return <Tag className={className}>{children}</Tag>;
  }
}
`;

/**
 * A CALLBACK parameter binds the prop's name nearer than the prop does.
 *
 * `(as) => { const Tag = as; … }` receives whatever the callback is called
 * with, which may be a component, while every call site still says `as="h1"`.
 * A block-only scan cannot see this; only resolving the exact lexical binding
 * — parameters included — can.
 */
const CALLBACK_SHADOWED_TAG = `import { Card } from "./Card";
export function Heading({ as = "h2", className, items = [] }: {
  as?: string;
  className?: string;
  items?: readonly string[];
}) {
  void as;
  void Card;
  return <ul>{items.map((as) => {
    const Tag = as;
    return <Tag key={as} className={className} />;
  })}</ul>;
}
`;

/** The destructured prop is WRITTEN before the alias reads it. */
const WRITTEN_PROP_TAG = `import { Card } from "./Card";
export function Heading({ as = "h2", className, children }: {
  as?: string;
  className?: string;
  children?: React.ReactNode;
}) {
  as = Card as unknown as string;
  const Tag = as;
  return <Tag className={className}>{children}</Tag>;
}
`;

/**
 * The tag is destructured straight from the prop, and a CALLBACK rebinds it.
 *
 * `{ as: Tag }` then `items.map((Tag) => <Tag/>)` renders the callback's value,
 * which may be a component, while callers still pass a lowercase `as`.
 */
const DIRECT_CALLBACK_TAG = `export function Heading({ as: Tag, className, items = [] }: {
  as?: string;
  className?: string;
  items?: readonly string[];
}) {
  void Tag;
  return <ul>{items.map((Tag) => <Tag key="k" className={className} />)}</ul>;
}
`;

/**
 * A RENAMED destructuring: the local `as` is the property `kind`.
 *
 * `const Tag = as` renders whatever `kind` holds. Reading callers' `as`
 * attribute reads an unrelated prop, so `<Heading kind={Card} as="h1" />`
 * would be proven host-like while it renders `Card`.
 */
const RENAMED_PROP_TAG = `export function Heading({ kind: as, as: tag = "h2", className }: {
  kind?: string;
  as?: string;
  className?: string;
}) {
  void tag;
  const Tag = as;
  return <Tag className={className} />;
}
`;

/**
 * `let` with no reassignment anywhere.
 *
 * Only the `const` requirement refuses this; the write check sees nothing. The
 * two look redundant on a `let` that IS reassigned.
 */
const LET_NEVER_WRITTEN_TAG = `export function Heading({ as = "h2", className }: {
  as?: string;
  className?: string;
}) {
  let Tag = as;
  return <Tag className={className} />;
}
`;

/**
 * The component destructures `as` AND a body-level `const as` shadows it.
 *
 * Only "the initializer must be a PARAMETER" refuses this: the component does
 * declare the prop, so the declared-property lookup succeeds and callers' `as`
 * would be read, while the rendered value is the local constant.
 */
const LOCAL_SHADOWS_OWN_PROP_TAG = `import { Card } from "./Card";
export function Heading({ as = "h2", className }: {
  as?: string;
  className?: string;
}) {
  const as2 = as;
  void as2;
  const as = Card as unknown as string;
  const Tag = as;
  return <Tag className={className} />;
}
`;

/**
 * A `const` that is nonetheless assigned to.
 *
 * Invalid TypeScript, and the parser accepts it — this reader runs over
 * whatever is on disk, including a half-edited file, so the write check on the
 * TAG name is the only thing that refuses here. `const` is satisfied.
 */
const WRITTEN_CONST_TAG = `import { Card } from "./Card";
export function Heading({ as = "h2", className }: {
  as?: string;
  className?: string;
}) {
  const Tag = as;
  Tag = Card as unknown as string;
  return <Tag className={className} />;
}
`;

/**
 * A directly destructured tag that is REASSIGNED.
 *
 * A parameter is as writable as a `let`. Every call site may say `as="h1"` and
 * the rendered target is still `Card`, so the write check has to cover the
 * parameter branch and not only the `const` one.
 */
const WRITTEN_DIRECT_TAG = `import { Card } from "./Card";
export function Heading({ as: Tag, className }: {
  as?: string;
  className?: string;
}) {
  Tag = Card as unknown as string;
  return <Tag className={className} />;
}
`;

/**
 * The same, written from inside a nested function rather than the body.
 *
 * `isWrittenWithin` walks the whole component, so the write does not have to
 * sit where a reader would notice it.
 */
const NESTED_WRITTEN_DIRECT_TAG = `import { Card } from "./Card";
export function Heading({ as: Tag, className }: {
  as?: string;
  className?: string;
}) {
  const swap = () => {
    Tag = Card as unknown as string;
  };
  swap();
  return <Tag className={className} />;
}
`;

/**
 * The same, written by an UPDATE rather than an assignment.
 *
 * `isWriteTarget` is `evaluate.ts`'s, so `for (Tag of …)` counts as a write;
 * a check that only looked for `=` would accept this.
 */
const REBOUND_BY_LOOP_DIRECT_TAG = `export function Heading({ as: Tag, className, names }: {
  as?: string;
  className?: string;
  names?: string[];
}) {
  for (Tag of names ?? []) {
    void Tag;
  }
  return <Tag className={className} />;
}
`;

/**
 * A directly destructured tag reassigned by SHORTHAND object destructuring.
 *
 * `({ Tag } = replacement)` is the form that showed the climb in
 * `isWriteTarget` was listing element kinds: `PropertyAssignment` was there and
 * `ShorthandPropertyAssignment` was not, so every caller saying `as="h1"` was
 * trusted while `Tag` had become a component.
 */
const SHORTHAND_REBOUND_TAG = `import { Card } from "./Card";
export function Heading({ as: Tag, className }: {
  as?: string;
  className?: string;
}) {
  const replacement = { Tag: Card as unknown as string };
  ({ Tag } = replacement);
  return <Tag className={className} />;
}
`;

/**
 * The same, rebound by ARRAY destructuring.
 *
 * A second spelling of one defect, because the fix is the climb rather than the
 * one node kind the review named.
 */
const ARRAY_REBOUND_TAG = `import { Card } from "./Card";
export function Heading({ as: Tag, className }: {
  as?: string;
  className?: string;
}) {
  [Tag] = [Card as unknown as string];
  return <Tag className={className} />;
}
`;

/** A dynamic-tag receiver whose `as` default is a COMPONENT name, not a host tag. */
const HEADING_CARD_DEFAULT = `export function Heading({ as = "Card", className }: {
  as?: string;
  className?: string;
}) {
  const Tag = as;
  return <Tag className={className} />;
}
`;

const CARD = `export function Card() {\n  return <div>card</div>;\n}\n`;

const WRONG_VALUE_CASES: readonly (readonly [string, string, string])[] = [
  [
    // JSX applies attributes left to right, so the LAST `as` is what the
    // element receives. `findAttribute` took the first, read `"h1"`, and proved
    // a tag that renders `Card`.
    "a DUPLICATE prop whose effective value is a component",
    ALIAS_TAG,
    '<Heading as="h1" as={Card} className="mt-2">Hi</Heading>',
  ],
  [
    "a duplicate prop whose effective value is not a literal at all",
    ALIAS_TAG,
    '<Heading as="h1" as={pick} className="mt-2">Hi</Heading>',
  ],
  [
    "a spread that may supply the prop where no literal is written",
    ALIAS_TAG,
    '<div><Heading as="h1" className="mt-2">A</Heading><Heading {...rest} className="mt-3">B</Heading></div>',
  ],
  [
    "a spread AFTER the literal, which replaces it",
    ALIAS_TAG,
    '<div><Heading as="h1" className="mt-2">A</Heading><Heading as="p" {...rest} className="mt-3">B</Heading></div>',
  ],
  ["an alias that can be reassigned", MUTABLE_TAG, '<Heading as="h1" className="mt-2">Hi</Heading>'],
  [
    "an alias whose name collides with a LOCAL of the prop's name",
    COLLIDING_TAG,
    '<Heading as="h1" className="mt-2">Hi</Heading>',
  ],
  [
    "an alias whose name collides with a MODULE constant of the prop's name",
    MODULE_COLLIDING_TAG,
    '<Heading as="h1" className="mt-2">Hi</Heading>',
  ],
  [
    "an alias resolved from a block that SHADOWS the prop",
    SHADOWED_TAG,
    '<Heading as="h1" className="mt-2">Hi</Heading>',
  ],
  [
    "an alias bound by a CALLBACK parameter of the prop's name",
    CALLBACK_SHADOWED_TAG,
    '<Heading as="h1" className="mt-2" />',
  ],
  [
    "an alias whose source prop is written before it is read",
    WRITTEN_PROP_TAG,
    '<Heading as="h1" className="mt-2">Hi</Heading>',
  ],
  [
    "a directly destructured tag that a CALLBACK rebinds",
    DIRECT_CALLBACK_TAG,
    '<Heading as="h1" className="mt-2" />',
  ],
  [
    "a `const` alias that is assigned to anyway",
    WRITTEN_CONST_TAG,
    '<Heading as="h1" className="mt-2" />',
  ],
  [
    "a `let` alias that is never reassigned",
    LET_NEVER_WRITTEN_TAG,
    '<Heading as="h1" className="mt-2" />',
  ],
  [
    "a body-level constant that shadows the component's own prop",
    LOCAL_SHADOWS_OWN_PROP_TAG,
    '<Heading as="h1" className="mt-2" />',
  ],
  [
    "a directly destructured tag rebound by shorthand object destructuring",
    SHORTHAND_REBOUND_TAG,
    '<Heading as="h1" className="mt-2" />',
  ],
  [
    "a directly destructured tag rebound by array destructuring",
    ARRAY_REBOUND_TAG,
    '<Heading as="h1" className="mt-2" />',
  ],
  [
    "a directly destructured tag that is reassigned",
    WRITTEN_DIRECT_TAG,
    '<Heading as="h1" className="mt-2" />',
  ],
  [
    "a directly destructured tag reassigned inside a nested function",
    NESTED_WRITTEN_DIRECT_TAG,
    '<Heading as="h1" className="mt-2" />',
  ],
  [
    "a directly destructured tag rebound by a for..of",
    REBOUND_BY_LOOP_DIRECT_TAG,
    '<Heading as="h1" className="mt-2" />',
  ],
  [
    // Reading the LOCAL name would find `as="h1"` and settle. The declared
    // property is `kind`, and `{Card}` is no literal, so it refuses.
    "an alias reading a RENAMED prop whose real property is not a literal",
    RENAMED_PROP_TAG,
    '<Heading kind={Card} as="h1" className="mt-2" />',
  ],
];

for (const [why, receiver, body] of WRONG_VALUE_CASES) {
  test(`${why} leaves the role undecided`, () => {
    const extracted = extractCaller({
      "Card.tsx": CARD,
      "Heading.tsx": receiver,
      "Caller.tsx":
        `import { Heading } from "./Heading";\n` +
        `export function Caller() {\n  return ${body};\n}\n`,
    });
    assert.equal(
      roleWasUndecided(extracted),
      true,
      `${why}: the call sites were treated as evidence about a value they do not decide`,
    );
  });
}

/** A spread BEFORE the literal does not replace it, so that site still counts. */
test("a spread before the literal does not stop the reading", () => {
  const extracted = extractCaller({
    "Heading.tsx": ALIAS_TAG,
    "Caller.tsx":
      `import { Heading } from "./Heading";\n` +
      `export function Caller() {\n  return <Heading {...rest} as="h1" className="mt-2">Hi</Heading>;\n}\n`,
  });
  assert.equal(roleWasUndecided(extracted), false);
});
