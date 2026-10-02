import assert from "node:assert/strict";
import test from "node:test";

import { renderAnchor } from "../src/anchors.js";
import type { Candidate, Ownership } from "../src/candidates.js";
import { isAriaAttribute, STRUCTURAL_ATTRIBUTES } from "../src/jsx-facts.js";
import { applyConfidenceGate } from "../src/gate.js";
import { NAME_BEARING_ATTRIBUTES } from "../src/extract.js";
import { extractFiles } from "./support/proposals.js";

/**
 * What NAMES a region.
 *
 * A section's identity came from one place: a literal `id`. Real pages more
 * often name a landmark for assistive technology instead — `aria-labelledby`
 * points at an id, and `aria-label` carries the name inline — and both are
 * written by a developer and read as code by this tool, which is the same
 * durability an `id` has. Reading only `id` left those sections unnamed, so
 * everything inside them could be told apart only by position, and identical
 * siblings collided.
 */

/**
 * The accepted candidates for a set of fixture files, entered at `Page.tsx`.
 *
 * One extraction, three views. Each row below wants both the anchors and the
 * ownership of one value, and running the extraction once per view doubled the
 * work while letting the two copies drift apart.
 */
function acceptedOf(files: Readonly<Record<string, string>>): readonly Candidate[] {
  const accepted = applyConfidenceGate(extractFiles(files, "Page.tsx").candidates).accepted;
  // A row asserting that some region is NOT named proves nothing if nothing was
  // extracted at all, so no caller is allowed to see an empty run.
  assert.ok(accepted.length > 0, "extraction produced no accepted candidates");
  return accepted;
}

function anchorsOf(files: Readonly<Record<string, string>>): readonly string[] {
  return acceptedOf(files)
    .map((candidate) => renderAnchor(candidate.anchor))
    .sort();
}

/**
 * How each accepted candidate carrying `value` is owned.
 *
 * A row asserting that a prop must not name a region proves nothing unless the
 * prop is really classified the way the row says. Several fixtures in this
 * package have passed for the wrong reason, so each row checks the
 * classification it depends on as well as the naming outcome.
 */
function ownershipsOfValue(
  files: Readonly<Record<string, string>>,
  value: string,
): readonly Ownership[] {
  return acceptedOf(files)
    .filter((candidate) => "value" in candidate && candidate.value === value)
    .map((candidate) => candidate.ownership);
}

function findingsOf(files: Readonly<Record<string, string>>): readonly string[] {
  return extractFiles(files, "Page.tsx").findings.map((finding) => finding.code);
}

/**
 * WHICH component props may name a region.
 *
 * A region's name is the first segment of every anchor beneath it, so a region
 * named after a value the customer can edit re-anchors its whole subtree the
 * first time the copy changes — the one thing `anchors.ts` forbids.
 *
 * On a HOST element the naming attributes cannot carry copy: `id` is
 * structural and `aria-*` is an accessibility interface, and
 * `#collectAttributes` offers neither as the customer's. On a COMPONENT the
 * same spellings are ordinary props, and only the receiving component says what
 * one is — so naming asks the reader that decides the FIELD, and refuses a prop
 * whose answer is "content" or is not settled at all.
 *
 * Refusing every component prop instead was blunt in both directions: it left a
 * literal `id` naming a region while offering that same `id` as an editable
 * field, and it refused an `aria-label` a component provably uses as code.
 */
interface Receiver {
  readonly description: string;
  readonly source: string;
  /** Whether that use leaves the value beyond a customer's reach. */
  readonly mayName: boolean;
  /**
   * How the prop is offered, when it is: the reason the row holds. `null` means
   * the reader calls it code and proposes nothing, so a row claiming `mayName`
   * cannot be passing because extraction quietly stopped.
   */
  readonly ownership: Ownership | null;
  /** A rest element can pass the prop onward, so its use is unread. */
  readonly rest?: boolean;
}

const RECEIVERS: readonly Receiver[] = [
  {
    description: "renders it as text",
    source: "return <section><h2>{name}</h2>{children}</section>;",
    mayName: false,
    ownership: "customer_editable",
  },
  {
    description: "renders it as text and also as a host id",
    source: "return <section id={name}><h2>{name}</h2>{children}</section>;",
    mayName: false,
    ownership: null,
  },
  {
    description: "forwards it to a host id",
    source: "return <section id={name}>{children}</section>;",
    mayName: true,
    ownership: null,
  },
  {
    description: "forwards it to a host aria-label",
    source: "return <section aria-label={name}>{children}</section>;",
    mayName: true,
    ownership: "code_owned_interface",
  },
  {
    description: "never reads it",
    source: "return <section>{children}</section>;",
    mayName: true,
    ownership: null,
  },
  {
    description: "may pass it on through a rest element",
    source: "return <section>{children}</section>;",
    mayName: false,
    ownership: null,
    rest: true,
  },
];

/**
 * A literal for one naming attribute, derived from its own name.
 *
 * The value only has to be a literal the reader can carry, so deriving it means
 * a naming attribute added to `extract.ts` gets every row below for free rather
 * than needing a hand-written pair.
 */
function literalFor(attribute: string): string {
  return `named-by-${attribute}`;
}

function receiverFiles(
  attribute: string,
  receiver: Receiver,
): Readonly<Record<string, string>> {
  const parameters = `{ "${attribute}": name, children${receiver.rest === true ? ", ...rest" : ""} }`;
  return {
    "Panel.tsx":
      `export function Panel(${parameters}: Record<string, never>) {\n` +
      `  ${receiver.source}\n}\n`,
    "Page.tsx":
      `import { Panel } from "./Panel";\n` +
      `export function Page() {\n` +
      `  return (\n` +
      `    <Panel ${attribute}="${literalFor(attribute)}">\n` +
      `      <span>Body</span>\n    </Panel>\n  );\n}\n`,
  };
}

for (const attribute of NAME_BEARING_ATTRIBUTES) {
  const literal = literalFor(attribute);

  for (const receiver of RECEIVERS) {
    test(
      `a component's ${attribute} ${receiver.mayName ? "names" : "does not name"} a region ` +
        `when the component ${receiver.description}`,
      () => {
        const files = receiverFiles(attribute, receiver);
        const named = anchorsOf(files).some((one) => one.includes(`region:${literal}`));
        assert.equal(
          named,
          receiver.mayName,
          `expected region:${literal} ${receiver.mayName ? "" : "not "}to be named`,
        );
        // And the classification the row depends on is what the reader really
        // says, so a fixture that stopped classifying cannot pass silently.
        assert.deepEqual(
          ownershipsOfValue(files, literal),
          receiver.ownership === null ? [] : [receiver.ownership],
        );
        // A name refused because the value is the customer's is the one refusal
        // nothing else mentions, so it is reported. The other refusals are not:
        // the prop itself already carries the reason.
        assert.equal(
          findingsOf(files).includes("NO_DURABLE_ANCHOR"),
          receiver.ownership === "customer_editable",
          `expected the lost name ${
            receiver.ownership === "customer_editable" ? "" : "not "
          }to be reported, got ${findingsOf(files).join(", ")}`,
        );
      },
    );
  }

  /** A host element is unaffected: the browser receives these, always. */
  test(`a host element's ${attribute} still names a region`, () => {
    const anchors = anchorsOf({
      "Page.tsx":
        `export function Page() {\n` +
        `  return (\n` +
        `    <section ${attribute}="${literal}">\n` +
        `      <span>Body</span>\n    </section>\n  );\n}\n`,
    });
    assert.ok(
      anchors.some((one) => one.includes(`region:${literal}`)),
      `expected region:${literal}, got ${anchors.join(", ")}`,
    );
  });

  /**
   * A tag naming nothing this repository declares still names its region.
   *
   * This is the one place the rule is not "deny unless proven", and the reason
   * is measured rather than aesthetic. A component this reader never looked at
   * has NO field proposed for the value, so no edit can reach it and no anchor
   * can move. Refusing anyway cost real identity: `next/link`, `next/image` and
   * `next/script` all live in `node_modules` and resolve to nothing, and
   * `#collectImage` and `#collectLink` fall back from a refused `id` to `src`
   * and `href`, which the customer DOES own. Two `<Link id>` siblings then
   * collapsed onto one anchor and were both withheld.
   *
   * The prop itself is still reported, so a human declaring it by hand is told
   * the role was never read.
   */
  test(`an unresolvable component's ${attribute} still names a region`, () => {
    const files = {
      "Page.tsx":
        `import { Panel } from "some-package";\n` +
        `export function Page() {\n` +
        `  return (\n` +
        `    <Panel ${attribute}="${literal}">\n` +
        `      <span>Body</span>\n    </Panel>\n  );\n}\n`,
    };
    assert.ok(
      anchorsOf(files).some((one) => one.includes(`region:${literal}`)),
      `expected region:${literal}, got ${anchorsOf(files).join(", ")}`,
    );
    assert.ok(
      findingsOf(files).includes("UNKNOWN_ATTRIBUTE_ROLE"),
      `expected the unread receiver reported, got ${findingsOf(files).join(", ")}`,
    );
    // Nothing is proposed for the value, which is why naming it is safe.
    assert.deepEqual(ownershipsOfValue(files, literal), []);
  });
}

/**
 * Two name-bearing attributes on ONE element get two answers.
 *
 * Naming asks what a component does with an attribute, and `#collectAttributes`
 * asks again about the same attribute, so the answer is read once per attribute
 * and remembered. Remembering it against the ELEMENT instead of the attribute
 * would hand the second attribute the first one's role, and every other row here
 * carries a single name-bearing attribute, so none of them could tell. These do:
 * each element below uses its two attributes for opposite purposes, in both
 * orders, since naming always reads `id` first.
 */
const MIXED_RECEIVERS: readonly {
  readonly description: string;
  readonly source: string;
  /** The literal that must name the region, and the one that must be the copy. */
  readonly names: string;
  readonly edits: string;
  /** How the naming value itself is offered, if at all. */
  readonly namesOwnership: readonly Ownership[];
}[] = [
  {
    description: "forwards the id and renders the label",
    source: "return <section id={id}><h2>{label}</h2>{children}</section>;",
    names: "id-value",
    edits: "label-value",
    // A structural attribute is code, so nothing is proposed for it.
    namesOwnership: [],
  },
  {
    description: "renders the id and forwards the label",
    source: "return <section aria-label={label}><h2>{id}</h2>{children}</section>;",
    names: "label-value",
    edits: "id-value",
    // An accessible name IS offered, as the developer's interface, which is why
    // it is durable enough to name a region.
    namesOwnership: ["code_owned_interface"],
  },
];

for (const receiver of MIXED_RECEIVERS) {
  test(`a component that ${receiver.description} gets an answer for each`, () => {
    const files = {
      "Panel.tsx":
        `export function Panel({ id, "aria-label": label, children }: Record<string, never>) {\n` +
        `  ${receiver.source}\n}\n`,
      "Page.tsx":
        `import { Panel } from "./Panel";\n` +
        `export function Page() {\n` +
        `  return (\n` +
        `    <Panel id="id-value" aria-label="label-value">\n` +
        `      <span>Body</span>\n    </Panel>\n  );\n}\n`,
    };
    const anchors = anchorsOf(files);
    assert.ok(
      anchors.some((one) => one.includes(`region:${receiver.names}`)),
      `expected region:${receiver.names}, got ${anchors.join(", ")}`,
    );
    assert.ok(
      !anchors.some((one) => one.includes(`region:${receiver.edits}`)),
      `the customer's value must not name a region, got ${anchors.join(", ")}`,
    );
    // Each attribute keeps its own answer. Reading one answer for both breaks
    // exactly this pair, and nothing else here would notice.
    assert.deepEqual(ownershipsOfValue(files, receiver.names), receiver.namesOwnership);
    assert.deepEqual(ownershipsOfValue(files, receiver.edits), ["customer_editable"]);
  });
}

/**
 * The host half of the naming rule, stated where it can fail.
 *
 * `#nameVerdictOf` lets a HOST element be named by asking the two facts
 * `#collectAttributes` routes a host attribute by, rather than by concluding
 * that hosts are safe. Every name-bearing attribute is one of those two today,
 * so that branch cannot be told from `true` by behaviour alone, which is what
 * makes it falsifiable here instead. It iterates the real exported set, because
 * a hand-copied list would let the addition this test exists to catch sail past
 * it.
 */
for (const attribute of NAME_BEARING_ATTRIBUTES) {
  test(`a host element treats '${attribute}' as no one's copy`, () => {
    assert.ok(
      STRUCTURAL_ATTRIBUTES.has(attribute) || isAriaAttribute(attribute),
      `'${attribute}' may name a region, but a host element treats it as ` +
        "neither structural nor an accessibility interface, so naming refuses it",
    );
  });
}

/**
 * A dotted tag is a component, however its parts are spelled, and it resolves
 * to nothing this reader can describe.
 *
 * JSX resolves `<motion.div>` as a member expression, so the browser is not what
 * receives its props. `!isComponentName("motion.div")` is true, which is why
 * `isProvablyHostTag` is the predicate that routes it to the component branch.
 * There it resolves to nothing, and an unread component has no field proposed
 * for the value, so the name stands. #63 refused these outright; that refusal is
 * superseded for the reason the unresolvable rows above give, and for an
 * UNRESOLVED dotted tag it agrees with the field side, which proposes its
 * `aria-label` as a code-owned field, i.e. already calls the value the
 * developer's.
 *
 * The two sides do NOT agree once the dotted tag resolves: naming reads the
 * receiver while the field side still reads host attribute names, so a resolvable
 * `<ui.Card aria-label>` rendered as a heading is refused a name (correctly, with
 * a finding) and simultaneously offered as code-owned. That is a pre-existing
 * field-classification defect, measured and deferred; see `#nameVerdictOf`.
 *
 * A dotted tag that DOES resolve to a component in this repository is read like
 * any other, so `UI.Card` rendering its `id` as copy is refused on the evidence
 * rather than on its spelling.
 */
const DOTTED_TAGS: readonly (readonly [string, string])[] = [
  ["a lowercase dotted tag", "motion.div"],
  ["a capitalised dotted tag", "Motion.Div"],
  ["a deeper dotted tag", "ui.layout.section"],
];

function dottedTagFiles(
  tag: string,
  attribute: string,
  literal: string,
): Readonly<Record<string, string>> {
  return {
    "Page.tsx":
      `declare const motion: Record<string, (props: never) => null>;\n` +
      `declare const Motion: Record<string, (props: never) => null>;\n` +
      `declare const ui: { layout: Record<string, (props: never) => null> };\n` +
      `export function Page() {\n` +
      `  return (\n` +
      `    <${tag} ${attribute}="${literal}">\n` +
      `      <span>Body</span>\n    </${tag}>\n  );\n}\n`,
  };
}

for (const [description, tag] of DOTTED_TAGS) {
  for (const attribute of NAME_BEARING_ATTRIBUTES) {
    const literal = literalFor(attribute);
    test(`${description} is named by its ${attribute}`, () => {
      const anchors = anchorsOf(dottedTagFiles(tag, attribute, literal));
      assert.ok(
        anchors.some((one) => one.includes(`region:${literal}`)),
        `expected region:${literal}, got ${anchors.join(", ")}`,
      );
    });
  }
}

/**
 * A dotted tag that resolves to a component in this repository is judged on what
 * that component does, so the spelling never decides it. Both spellings, and
 * both halves of the rule: the copy is refused as a name AND offered as the
 * customer's, because a value can only be one of the two.
 */
for (const attribute of NAME_BEARING_ATTRIBUTES) {
  const literal = literalFor(attribute);
  test(`a resolvable dotted tag rendering its ${attribute} as copy is refused and offered`, () => {
    const files = {
      "ui.tsx":
        `export function Card({ "${attribute}": value, children }: Record<string, never>) {\n` +
        `  return <section><h2>{value}</h2>{children}</section>;\n}\n`,
      "Page.tsx":
        `import * as ui from "./ui";\n` +
        `export function Page() {\n` +
        `  return (\n` +
        `    <ui.Card ${attribute}="${literal}">\n` +
        `      <span>Body</span>\n    </ui.Card>\n  );\n}\n`,
    };
    const anchors = anchorsOf(files);
    assert.ok(
      !anchors.some((one) => one.includes(`region:${literal}`)),
      `the customer's copy must not name a region, got ${anchors.join(", ")}`,
    );
    // The field that must replace the refused name. Losing this was the defect:
    // host rules skipped `id` as structural and called `aria-label` code-owned.
    assert.deepEqual(ownershipsOfValue(files, literal), ["customer_editable"]);
    assert.ok(
      findingsOf(files).includes("NO_DURABLE_ANCHOR"),
      `expected the refused name reported, got ${findingsOf(files).join(", ")}`,
    );
  });
}

test("a resolvable dotted tag rendering its id as copy is refused", () => {
  const files = {
    "ui.tsx":
      `export function Card({ id, children }: Record<string, never>) {\n` +
      `  return <section><h2>{id}</h2>{children}</section>;\n}\n`,
    "Page.tsx":
      `import * as ui from "./ui";\n` +
      `export function Page() {\n` +
      `  return (\n` +
      `    <ui.Card id="named-by-id">\n` +
      `      <span>Body</span>\n    </ui.Card>\n  );\n}\n`,
  };
  const anchors = anchorsOf(files);
  assert.ok(
    !anchors.some((one) => one.includes("region:named-by-id")),
    `a rendered prop must not name a region, got ${anchors.join(", ")}`,
  );
});

/**
 * When a section carries both, `aria-labelledby` wins: it holds an ID, which is
 * the same kind of durable token an `id` is, where `aria-label` is prose the
 * developer may reword without moving anything it points at.
 */
test("aria-labelledby outranks aria-label when a section carries both", () => {
  const anchors = anchorsOf({
    "Page.tsx":
      `export function Page() {\n` +
      `  return (\n` +
      `    <section aria-labelledby="offer-heading" aria-label="Browse venue networks">\n` +
      `      <h2 id="offer-heading">Offer</h2>\n` +
      `      <p>Body</p>\n` +
      `    </section>\n  );\n}\n`,
  });
  assert.ok(
    anchors.some((one) => one.includes("region:offer-heading")),
    `expected the labelledby id to name the region, got ${anchors.join(", ")}`,
  );
  assert.ok(
    !anchors.some((one) => one.includes("region:Browse venue networks")),
    `the inline label must not name it, got ${anchors.join(", ")}`,
  );
});

/**
 * An `id` outranks both, so a section that carries an accessible name as well
 * is still addressed by the id it already had.
 */
test("an id outranks an accessible name", () => {
  const anchors = anchorsOf({
    "Page.tsx":
      `export function Page() {\n` +
      `  return (\n` +
      `    <section id="hero" aria-label="Browse venue networks">\n` +
      `      <p>Body</p>\n` +
      `    </section>\n  );\n}\n`,
  });
  assert.ok(
    anchors.some((one) => one.includes("region:hero")),
    `expected the id to name the region, got ${anchors.join(", ")}`,
  );
});

/**
 * A later spread decides the attribute, whichever attribute it is.
 *
 * JSX applies attributes left to right, so `<section id="hero" {...rest}>` is
 * named whatever `rest` says `id` is. Naming a region from the literal there
 * names an element that may not carry it, and the same is true of every
 * name-bearing spelling, so the guard belongs to the reading rather than to one
 * attribute. A spread BEFORE the attribute is harmless: the literal wins.
 */
for (const attribute of NAME_BEARING_ATTRIBUTES) {
  const literal = literalFor(attribute);

  function spreadFiles(order: string): Readonly<Record<string, string>> {
    return {
      "Page.tsx":
        `declare const rest: Record<string, unknown>;\n` +
        `export function Page() {\n` +
        `  return (\n` +
        `    <section ${order}>\n` +
        `      <h2 id="offer-heading">Offer</h2>\n` +
        `      <p>Body</p>\n` +
        `    </section>\n  );\n}\n`,
    };
  }

  test(`a section whose ${attribute} a later spread may replace is not named by it`, () => {
    const findings = findingsOf(spreadFiles(`${attribute}="${literal}" {...rest}`));
    assert.ok(
      findings.includes("NO_DURABLE_ANCHOR"),
      `expected the section to report no durable name, got ${findings.join(", ")}`,
    );
  });

  test(`a section whose ${attribute} follows a spread is still named by it`, () => {
    const anchors = anchorsOf(spreadFiles(`{...rest} ${attribute}="${literal}"`));
    assert.ok(
      anchors.some((one) => one.includes(`region:${literal}`)),
      `expected region:${literal}, got ${anchors.join(", ")}`,
    );
  });
}

test("a section named by aria-labelledby is named by the id it points at", () => {
  const anchors = anchorsOf({
    "Page.tsx":
      `export function Page() {\n` +
      `  return (\n` +
      `    <section aria-labelledby="offer-heading">\n` +
      `      <h2 id="offer-heading">Offer</h2>\n` +
      `      <p>Body</p>\n` +
      `    </section>\n  );\n}\n`,
  });
  assert.ok(
    anchors.some((anchor) => anchor.includes("region:offer-heading")),
    `expected a region named for the labelledby target, got ${anchors.join(", ")}`,
  );
});

test("a section named by aria-label is named by that label", () => {
  const anchors = anchorsOf({
    "Page.tsx":
      `export function Page() {\n` +
      `  return (\n` +
      `    <section aria-label="Browse venue networks">\n      <p>Body</p>\n    </section>\n  );\n}\n`,
  });
  assert.ok(
    anchors.some((anchor) => anchor.includes("region:Browse venue networks")),
    `expected a region named for the label, got ${anchors.join(", ")}`,
  );
});

test("an accessible name keeps two otherwise identical sections apart", () => {
  const anchors = anchorsOf({
    "Page.tsx":
      `export function Page() {\n` +
      `  return (\n    <div>\n` +
      `      <section aria-label="First"><p>One</p></section>\n` +
      `      <section aria-label="Second"><p>Two</p></section>\n` +
      `    </div>\n  );\n}\n`,
  });
  // The labels themselves are candidates too (code-owned), so the claim is
  // about the two paragraphs: both survive, under distinct anchors.
  const paragraphs = anchors.filter((anchor) => anchor.endsWith("role:p/text"));
  assert.equal(paragraphs.length, 2, anchors.join(", "));
  assert.equal(new Set(paragraphs).size, 2);
});

test("a literal id still wins over an accessible name", () => {
  const anchors = anchorsOf({
    "Page.tsx":
      `export function Page() {\n` +
      `  return (\n` +
      `    <section id="offer" aria-label="Something else"><p>Body</p></section>\n  );\n}\n`,
  });
  assert.ok(anchors.every((anchor) => anchor.includes("region:offer")), anchors.join(", "));
});

test("a section with an accessible name is no longer reported as unnamed", () => {
  const codes = findingsOf({
    "Page.tsx":
      `export function Page() {\n` +
      `  return <section aria-label="Named"><p>Body</p></section>;\n}\n`,
  });
  assert.ok(!codes.includes("NO_DURABLE_ANCHOR"), codes.join(", "));
});

test("a section with no name at all is still reported", () => {
  const codes = findingsOf({
    "Page.tsx":
      `export function Page() {\n` +
      `  return <section className="plain"><p>Body</p></section>;\n}\n`,
  });
  assert.ok(codes.includes("NO_DURABLE_ANCHOR"), codes.join(", "));
});

test("a non-literal accessible name does not name anything", () => {
  const codes = findingsOf({
    "Page.tsx":
      `export function Page({ label }: { label: string }) {\n` +
      `  return <section aria-label={label}><p>Body</p></section>;\n}\n`,
  });
  assert.ok(codes.includes("NO_DURABLE_ANCHOR"), codes.join(", "));
});

/** An empty accessible name names nothing, and must not stand in for one. */
test("an empty aria-label does not name a region", () => {
  const codes = findingsOf({
    "Page.tsx":
      `export function Page() {\n` +
      `  return <section aria-label=""><p>Body</p></section>;\n}\n`,
  });
  assert.ok(codes.includes("NO_DURABLE_ANCHOR"), codes.join(", "));
});
