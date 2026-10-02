import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";

import { nameFromSourceIdentifier } from "../src/anchor-name.js";
import { POSITION_IDENTITY, type Candidate } from "../src/candidates.js";
import {
  type AnchorName,
  applyAnchorNames,
  nameAmbiguousAnchors,
  revertAnchorNames,
  verifyAnchorNames,
} from "../src/name-anchors.js";
import { propose } from "../src/propose.js";

/**
 * Writing the name the reader is missing.
 *
 * `AMBIGUOUS_ANCHOR` is the largest refusal on a real site, and the advice in
 * every one of those findings is the same sentence: give this element a
 * durable name. That is a mechanical edit — an `id` changes nothing about what
 * the page renders — so a person making it seventy times is doing what the
 * tool could have done, which is the difference between a conversion that
 * needs supervision and one that does not.
 *
 * What it must never write is a name that is WRONG. An id is a fragment target
 * and a selector target, and a duplicate one is a silent bug in the site rather
 * than a loud one in the report. So the refusals below are the substance, and
 * each names a way the attribute would not do what it appears to.
 */

function write(files: Readonly<Record<string, string>>): string {
  const root = mkdtempSync(join(tmpdir(), "managed-site-naming-"));
  for (const [relative, text] of Object.entries(files)) {
    const file = join(root, relative);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, text, "utf8");
  }
  return root;
}

function proposeIn(root: string): ReturnType<typeof propose> {
  return propose({ repositoryRoot: root, configPath: null, ledgerPath: join(root, "idmap.json") });
}

function namesFor(root: string): ReturnType<typeof nameAmbiguousAnchors> {
  return nameAmbiguousAnchors(proposeIn(root).ambiguous, root);
}

/** The shipped writer, so the tests exercise what the CLI actually runs. */
function applyNames(names: readonly AnchorName[]): void {
  const applied = applyAnchorNames(names);
  assert.deepEqual(applied.rejected, [], "a written file must still parse");
}

/** A page whose only interesting feature is two sibling elements, alike. */
const PAGE = (body: string, prelude = ""): Record<string, string> => ({
  "app/page.tsx":
    `${prelude}export default function Home() {\n  return (\n    <section id="s">\n` +
    `${body}\n    </section>\n  );\n}\n`,
});

const TWINS = PAGE(`      <p>Start anywhere</p>\n      <p>Finish anywhere</p>`);

test("two indistinguishable paragraphs are each given a name", () => {
  assert.deepEqual(
    namesFor(write(TWINS))
      .names.map((name) => name.id)
      .sort(),
    ["ms-home-finish-anywhere", "ms-home-start-anywhere"],
  );
});

test("the names it writes actually resolve the ambiguity", () => {
  const root = write(TWINS);
  applyNames(namesFor(root).names);
  assert.deepEqual(
    proposeIn(root).report.findings.filter((finding) => finding.code === "AMBIGUOUS_ANCHOR"),
    [],
  );
});

test("naming is idempotent: a second pass has nothing left to add", () => {
  const root = write(TWINS);
  applyNames(namesFor(root).names);
  assert.deepEqual(namesFor(root).names, []);
});

/**
 * A name is spoken for by anything that can NAME an id, not only by an element
 * that carries one. Each row reserves the same name a different way, and none
 * of them may be handed out again.
 */
const RESERVED: readonly (readonly [string, Record<string, string>])[] = [
  [
    "an element already carrying it",
    PAGE(
      `      <p>Start anywhere</p>\n      <p>Finish anywhere</p>\n` +
        `      <div id="ms-home-start-anywhere">Third</div>`,
    ),
  ],
  [
    "an element carrying it as a braced string",
    PAGE(
      `      <p>Start anywhere</p>\n      <p>Finish anywhere</p>\n` +
        `      <div id={"ms-home-start-anywhere"}>Third</div>`,
    ),
  ],
  [
    "an element carrying it as a template literal",
    PAGE(
      `      <p>Start anywhere</p>\n      <p>Finish anywhere</p>\n` +
        "      <div id={`ms-home-start-anywhere`}>Third</div>",
    ),
  ],
  [
    "a fragment link pointing at it",
    PAGE(
      `      <p>Start anywhere</p>\n      <p>Finish anywhere</p>\n` +
        `      <a href="#ms-home-start-anywhere">Jump</a>`,
    ),
  ],
  [
    "a getElementById call looking it up",
    PAGE(
      `      <p>Start anywhere</p>\n      <p>Finish anywhere</p>`,
      `declare const document: { getElementById: (id: string) => unknown };\n` +
        `export const found = document.getElementById("ms-home-start-anywhere");\n`,
    ),
  ],
  [
    "a getElementById call using a template literal",
    PAGE(
      `      <p>Start anywhere</p>\n      <p>Finish anywhere</p>`,
      `declare const document: { getElementById: (id: string) => unknown };\n` +
        "export const found = document.getElementById(`ms-home-start-anywhere`);\n",
    ),
  ],
  [
    "a stylesheet rule selecting it",
    {
      ...PAGE(`      <p>Start anywhere</p>\n      <p>Finish anywhere</p>`),
      "app/globals.css": "#ms-home-start-anywhere { scroll-margin-top: 4rem; }\n",
    },
  ],
];

for (const [description, files] of RESERVED) {
  test(`does not hand out a name ${description}`, () => {
    const { names } = namesFor(write(files));
    assert.ok(!names.some((name) => name.id === "ms-home-start-anywhere"), JSON.stringify(names));
    assert.ok(
      names.some((name) => /^ms-home-start-anywhere-\d+$/u.test(name.id)),
      JSON.stringify(names),
    );
  });
}

/**
 * JSX text keeps its entities, so the words a person reads are not the words
 * in the file. `&apos;` is punctuation spelled out, and a name built from it
 * reads as `don-apos-t` — permanent, because an id is written once.
 */
test("an entity in the words does not become part of the name", () => {
  const { names } = namesFor(
    write(PAGE(`      <p>Don&apos;t Buy a Network</p>\n      <p>Build One</p>`)),
  );
  assert.deepEqual(names.map((name) => name.id).sort(), [
    "ms-home-build-one",
    "ms-home-don-t-buy-a-network",
  ]);
});

test("two rivals whose words are the same get different names", () => {
  const { names } = namesFor(write(PAGE(`      <p>Same words</p>\n      <p>Same words</p>`)));
  assert.equal(names.length, 2);
  assert.equal(new Set(names.map((name) => name.id)).size, 2);
});

test("the edit adds the attribute and changes nothing else", () => {
  const root = write(TWINS);
  const file = join(root, "app/page.tsx");
  const before = readFileSync(file, "utf8");
  applyNames(namesFor(root).names);
  const after = readFileSync(file, "utf8");
  assert.notEqual(after, before);
  assert.equal(after.replaceAll(/ id="ms-[a-z0-9-]+"/gu, ""), before.replaceAll(/ id="ms-[a-z0-9-]+"/gu, ""));
});

/**
 * Every row here is a way an `id` written on the element would be wrong, not
 * merely a shape this reader finds awkward. Each leaves the ambiguity reported
 * exactly as it was.
 */
const REFUSALS: readonly (readonly [string, Record<string, string>])[] = [
  [
    "a component, which is under no obligation to pass an id to anything",
    {
      "app/Box.tsx": `export function Box({ label }: { label?: string }) {\n  return <p>{label}</p>;\n}\n`,
      "app/page.tsx":
        `import { Box } from "./Box";\nexport default function Home() {\n  return (\n    <section id="s">\n` +
        `      <Box label="One" />\n      <Box label="Two" />\n    </section>\n  );\n}\n`,
    },
  ],
  [
    "an element a spread may set the id of",
    PAGE(
      `      <p {...rest}>Start anywhere</p>\n      <p {...rest}>Finish anywhere</p>`,
      `declare const rest: Record<string, unknown>;\n`,
    ),
  ],
  [
    "a dotted tag, which is a component however its parts are spelled",
    PAGE(
      `      <motion.div>Start anywhere</motion.div>\n      <motion.div>Finish anywhere</motion.div>`,
      `declare const motion: Record<string, (props: never) => null>;\n`,
    ),
  ],
  [
    "a deeper dotted tag",
    PAGE(
      `      <ui.layout.box>Start anywhere</ui.layout.box>\n      <ui.layout.box>Finish anywhere</ui.layout.box>`,
      `declare const ui: { layout: Record<string, (props: never) => null> };\n`,
    ),
  ],
  [
    "an element whose id is there already but is not a literal",
    PAGE(
      `      <p id={a}>Start anywhere</p>\n      <p id={b}>Finish anywhere</p>`,
      `declare const a: string;\ndeclare const b: string;\n`,
    ),
  ],
];

for (const [description, files] of REFUSALS) {
  test(`refuses to name ${description}`, () => {
    const { names, findings } = namesFor(write(files));
    assert.deepEqual(names, []);
    assert.ok(findings.length > 0, "a refusal must say why");
    assert.ok(findings.every((finding) => finding.code === "AMBIGUOUS_ANCHOR"));
  });
}

/**
 * An element inside a `.map` renders once per item, so one id written there is
 * a duplicate id on the page — the exact failure this naming exists to avoid.
 *
 * Today's extractor reads a repeated element as a collection rather than as a
 * rival, so this asks the namer directly instead of routing a fixture through
 * a reading that would never present the case. The guard is what is under
 * test; how the case arrives is not.
 */
test("refuses to name an element rendered once per item", () => {
  const root = write({
    "app/page.tsx":
      `const rows = ["a", "b"];\nexport default function Home() {\n  return (\n    <section id="s">\n` +
      `      {rows.map((row) => (<p key={row}>Fixed words</p>))}\n    </section>\n  );\n}\n`,
  });
  const file = join(root, "app/page.tsx");
  const group = [candidateAt(file, "<p key={row}>"), candidateAt(file, "<p key={row}>")];
  const { names, findings } = nameAmbiguousAnchors([group], root);
  assert.deepEqual(names, []);
  assert.equal(findings.length, 1);
  assert.match(findings[0]?.decision ?? "", /once per item/u);
});

/** The same shape, presented as rivals that are NOT repeated, is named — so the
 * row above fails for the reason it claims and not for another. Two DISTINCT
 * elements, because two candidates resolving to one element is refused by the
 * row below and would make this pass for the wrong reason. */
test("the same shape outside a map is named", () => {
  const root = write(PAGE(`      <p>First words</p>\n      <p>Second words</p>`));
  const file = join(root, "app/page.tsx");
  const group = [candidateAt(file, "<p>First"), candidateAt(file, "<p>Second")];
  assert.equal(nameAmbiguousAnchors([group], root).names.length, 2);
});

/**
 * One element cannot be two anchors.
 *
 * A collection candidate points at its map EXPRESSION, so two rivals whose maps
 * are children of the same unnamed host element resolve to that one element.
 * Writing both names would put two `id` attributes on a single tag rather than
 * telling the rivals apart — a duplicate id, which is the failure this naming
 * exists to avoid, written by the thing that exists to prevent it.
 */
test("two rivals resolving to one element are not named", () => {
  const root = write(PAGE(`      <p>Fixed words</p>`));
  const file = join(root, "app/page.tsx");
  const group = [candidateAt(file, "<p>"), candidateAt(file, "<p>")];
  const { names, findings } = nameAmbiguousAnchors([group], root);
  assert.deepEqual(names, []);
  assert.equal(findings.length, 1);
  assert.match(findings[0]?.decision ?? "", /same element/u);
});

/**
 * An id is written ONCE in the source and rendered once per instance.
 *
 * A component rendered twice therefore puts the same DOM id on the page twice,
 * and no check on the source text can see it -- the writer edits one location
 * and the browser renders two elements. So the question is how many times the
 * component holding the element renders, followed up the chain.
 */
const MULTI_INSTANCE: readonly (readonly [string, Record<string, string>])[] = [
  [
    "a component rendered twice on one route",
    {
      "app/page.tsx":
        `function Card() {\n  return (\n    <div>\n      <p>Start anywhere</p>\n` +
        `      <p>Finish anywhere</p>\n    </div>\n  );\n}\n` +
        `export default function Home() {\n  return (\n    <main>\n` +
        `      <Card />\n      <Card />\n    </main>\n  );\n}\n`,
    },
  ],
  [
    "a component rendered once by a component rendered twice",
    {
      "app/page.tsx":
        `function Inner() {\n  return (\n    <div>\n      <p>Start anywhere</p>\n` +
        `      <p>Finish anywhere</p>\n    </div>\n  );\n}\n` +
        `function Outer() {\n  return <Inner />;\n}\n` +
        `export default function Home() {\n  return (\n    <main>\n` +
        `      <Outer />\n      <Outer />\n    </main>\n  );\n}\n`,
    },
  ],
  [
    "a component rendered inside a map",
    {
      "app/page.tsx":
        `const rows = ["a", "b"];\n` +
        `function Card() {\n  return (\n    <div>\n      <p>Start anywhere</p>\n` +
        `      <p>Finish anywhere</p>\n    </div>\n  );\n}\n` +
        `export default function Home() {\n  return (\n    <main>\n` +
        `      {rows.map((row) => (<Card key={row} />))}\n    </main>\n  );\n}\n`,
    },
  ],
];

for (const [description, files] of MULTI_INSTANCE) {
  test(`refuses to name inside ${description}`, () => {
    const { names, findings } = namesFor(write(files));
    assert.deepEqual(names, [], JSON.stringify(names));
    assert.ok(findings.length > 0, "a refusal must say why");
  });
}

/**
 * A render site is a REFERENCE to the binding, not a tag whose spelling matches
 * the declaration.
 *
 * `import { Card as Item }` renders `<Item />`, which matched nothing and
 * counted as zero sites -- read as a route and named. That row is the reachable
 * one: restoring the name-only count names it.
 *
 * The two `map(Card)` rows are OUTCOME checks. The render walk does not resolve
 * a component passed by name as a render, so nothing inside `Card` is extracted
 * and there is nothing to name either way -- the fixture reports zero ambiguous
 * groups. `isComponentValueReference` is kept because a component handed
 * somewhere renders as often as the receiver decides, but nothing here
 * distinguishes it.
 */
const ALIASED_INSTANCES: readonly (readonly [string, Record<string, string>])[] = [
  [
    "an aliased import rendered twice",
    {
      "app/Card.tsx":
        `export function Card() {\n  return (\n    <div>\n      <p>Start anywhere</p>\n` +
        `      <p>Finish anywhere</p>\n    </div>\n  );\n}\n`,
      "app/page.tsx":
        `import { Card as Item } from "./Card";\n` +
        `export default function Home() {\n  return (\n    <main>\n` +
        `      <Item />\n      <Item />\n    </main>\n  );\n}\n`,
    },
  ],
  [
    "a component passed by name to map",
    {
      "app/Card.tsx":
        `export function Card() {\n  return (\n    <div>\n      <p>Start anywhere</p>\n` +
        `      <p>Finish anywhere</p>\n    </div>\n  );\n}\n`,
      "app/page.tsx":
        `import { Card } from "./Card";\nconst rows = ["a", "b"];\n` +
        `export default function Home() {\n  return <main>{rows.map(Card)}</main>;\n}\n`,
    },
  ],
  [
    "a component passed by an aliased name to map",
    {
      "app/Card.tsx":
        `export function Card() {\n  return (\n    <div>\n      <p>Start anywhere</p>\n` +
        `      <p>Finish anywhere</p>\n    </div>\n  );\n}\n`,
      "app/page.tsx":
        `import { Card as Item } from "./Card";\nconst rows = ["a", "b"];\n` +
        `export default function Home() {\n  return <main>{rows.map(Item)}</main>;\n}\n`,
    },
  ],
];

for (const [description, files] of ALIASED_INSTANCES) {
  test(`refuses to name inside ${description}`, () => {
    const { names } = namesFor(write(files));
    assert.deepEqual(names, [], JSON.stringify(names));
  });
}

/**
 * A name is safe only if the repository does not already SAY it, in any file
 * and any syntax.
 *
 * Six rounds found six spellings the reservation scan did not read: a braced
 * string, a template literal, a `getElementById` argument, an IDREF token, a
 * stylesheet rule, and a literal passed through a component prop. Enumerating
 * spellings does not terminate, so the last word is a text search over every
 * file. These rows are the spellings a reader would have to know about
 * individually; the search knows about none of them and catches them all.
 */
const NAMES_THE_REPOSITORY_SAYS: readonly (readonly [string, Record<string, string>])[] = [
  [
    "a literal passed through a component prop",
    {
      "app/Widget.tsx":
        `export function Widget({ anchorId }: { anchorId?: string }) {\n` +
        `  return <div id={anchorId} />;\n}\n`,
      ...PAGE(
        `      <p>Start anywhere</p>\n      <p>Finish anywhere</p>\n` +
          `      <Widget anchorId="ms-home-start-anywhere" />`,
        `import { Widget } from "./Widget";\n`,
      ),
    },
  ],
  [
    "a name only a JSON file says",
    {
      ...PAGE(`      <p>Start anywhere</p>\n      <p>Finish anywhere</p>`),
      "app/anchors.json": `{ "highlight": "ms-home-start-anywhere" }\n`,
    },
  ],
  [
    "a name only a markdown file says",
    {
      ...PAGE(`      <p>Start anywhere</p>\n      <p>Finish anywhere</p>`),
      "app/notes.md": `Jump to [the start](#ms-home-start-anywhere).\n`,
    },
  ],
];

for (const [description, files] of NAMES_THE_REPOSITORY_SAYS) {
  test(`does not hand out ${description}`, () => {
    const { names } = namesFor(write(files));
    assert.ok(!names.some((name) => name.id === "ms-home-start-anywhere"), JSON.stringify(names));
    assert.ok(
      names.some((name) => /^ms-home-start-anywhere-\d+$/u.test(name.id)),
      JSON.stringify(names),
    );
  });
}

/** A longer token is not an occurrence of a shorter name, or every suffix would
 * be refused in turn. */
test("a longer id is not treated as saying a shorter name", () => {
  const { names } = namesFor(
    write({
      ...PAGE(`      <p>Start anywhere</p>\n      <p>Finish anywhere</p>`),
      "app/other.css": `#ms-home-start-anywhere-elsewhere { color: red; }\n`,
    }),
  );
  assert.ok(names.some((name) => name.id === "ms-home-start-anywhere"), JSON.stringify(names));
});

/**
 * A FRAGMENT or selector built from a name points at whatever that name holds,
 * and matches no literal `#name` for the regex scan to find.
 */

/**
 * The hash need not be in the template's HEAD.
 *
 * `` `${prefix}#${target}` `` puts it in a span, which a check on the head could
 * not see and which matches no literal `#name` either. And what follows the hash
 * IS the id: a literal there is a name spoken for, an interpolation there is a
 * name unknown.
 */
/**
 * The writer checks its own work, by re-reading rather than by trusting the
 * analysis that produced the edit.
 *
 * Eleven review rounds here were each a different syntactic route to one of two
 * failures: a duplicate DOM id, or a name that did not resolve the ambiguity it
 * was written for. Proving neither can happen, over arbitrary JavaScript, does
 * not terminate. Observing it does -- and a route nobody has thought of still
 * produces one of those two results.
 */
test("a duplicate id is caught after the fact and the whole edit is withdrawn", () => {
  const root = write(PAGE(`      <p>Start anywhere</p>\n      <p>Finish anywhere</p>`));
  const file = join(root, "app/page.tsx");
  const before = readFileSync(file, "utf8");
  const [first, second] = namesFor(root).names;
  assert.ok(first !== undefined && second !== undefined);
  // Two names that collide, which is what every one of those rounds was about.
  const applied = applyAnchorNames([first, { ...second, id: first.id }]);
  const broken = verifyAnchorNames([first, second], [], root);
  assert.ok(
    broken.some((reason) => reason.includes(first.id) && reason.includes("2 times")),
    JSON.stringify(broken),
  );
  revertAnchorNames(applied);
  assert.equal(readFileSync(file, "utf8"), before, "the file must be put back exactly");
});

/**
 * The coupling the two tests below stand on.
 *
 * Correlating a surviving ambiguity with THIS edit is only possible because a
 * written id lands inside the anchor the reader builds for that element
 * (`extract.ts#namingOf` turns a literal id into `region:<id>` or `at:<id>`).
 * Asserted against the real reader so the rows below cannot pass against an
 * anchor shape nothing produces.
 */
test("a written id appears in the anchor the reader builds", () => {
  const root = write(TWINS);
  const { names } = namesFor(root);
  assert.ok(names.length > 0);
  applyNames(names);
  const ledgerPath = join(root, "written.json");
  proposeIn(root).ledger.save(ledgerPath);
  const saved = JSON.parse(readFileSync(ledgerPath, "utf8")) as {
    readonly entries: readonly { readonly anchor: string }[];
  };
  const anchors = saved.entries.map((entry) => entry.anchor);
  for (const name of names) {
    assert.ok(
      anchors.some((anchor) => anchor.includes(name.id)),
      `${name.id} is in no anchor: ${JSON.stringify(anchors)}`,
    );
  }
});

/**
 * Which surviving ambiguities are THIS edit's fault.
 *
 * The namer deliberately returns safe names beside groups it refuses, so the
 * scan after the edit still reports those refusals -- correctly. Counting them
 * as failure withdrew every valid name because something unrelated could not be
 * named, which is the opposite of the partial application this is documented to
 * do. The rows below are the discrimination, including two spellings the
 * refusal does not name: a discriminator segment, and an id that is only the
 * PREFIX of the one in the anchor.
 */
for (const row of [
  { name: "a named container still ambiguous", region: true, suffix: "", withdrawn: true },
  { name: "a named element still ambiguous as a discriminator", region: false, suffix: "", withdrawn: true },
  { name: "a longer id that merely starts with ours", region: true, suffix: "-extra", withdrawn: false },
  { name: "an unrelated group nothing named", region: true, suffix: null, withdrawn: false },
] as const) {
  test(`${row.name} ${row.withdrawn ? "withdraws" : "does not withdraw"} the edit`, () => {
    const root = write(TWINS);
    const file = join(root, "app/page.tsx");
    const { names } = namesFor(root);
    const first = names[0];
    assert.ok(first !== undefined);
    applyNames(names);
    const inAnchor = row.suffix === null ? "some-other-thing" : `${first.id}${row.suffix}`;
    const survivor: Candidate = {
      ...candidateAt(file, "<p"),
      anchor: [
        { kind: "component", name: "Home" },
        row.region
          ? { kind: "region", name: nameFromSourceIdentifier(inAnchor) }
          : { kind: "role", tag: "p", attribute: null },
        ...(row.region
          ? []
          : ([{ kind: "discriminator", value: nameFromSourceIdentifier(inAnchor) }] as const)),
        { kind: "text" },
      ],
    };
    const broken = verifyAnchorNames(names, [[survivor]], root);
    assert.equal(
      broken.some((reason) => reason.includes("still ambiguous")),
      row.withdrawn,
      JSON.stringify(broken),
    );
  });
}

/**
 * The whole point, end to end: a page with one nameable pair and one group the
 * namer refuses on purpose keeps its safe names.
 */
test("a refused group beside a named one does not withdraw the names", () => {
  const root = write({
    "app/Card.tsx":
      `function Card() {\n  return (\n    <div>\n      <p>Alpha here</p>\n` +
      `      <p>Beta here</p>\n    </div>\n  );\n}\nexport default Card;\n`,
    "app/page.tsx":
      `import Card from "./Card";\nexport default function Home() {\n  return (\n    <main>\n` +
      `      <p>Start anywhere</p>\n      <p>Finish anywhere</p>\n` +
      `      <Card />\n      <Card />\n    </main>\n  );\n}\n`,
  });
  const page = join(root, "app/page.tsx");
  const { names, findings } = nameAmbiguousAnchors(proposeIn(root).ambiguous, root);
  assert.ok(names.length > 0, "the safe pair must be named");
  assert.ok(findings.length > 0, "the twice-rendered component must still be refused");
  applyNames(names);
  const after = proposeIn(root);
  assert.ok(after.ambiguous.length > 0, "the refused group must still be reported");
  assert.deepEqual(verifyAnchorNames(names, after.ambiguous, root), []);
  const text = readFileSync(page, "utf8");
  for (const name of names) assert.ok(text.includes(`id="${name.id}"`), `${name.id} was kept`);
});

/** A name the writer reported but did not put anywhere reads as success at
 * every other layer, so the count that catches duplicates catches zero too. */
test("an id that never reached the repository withdraws the edit", () => {
  const root = write(TWINS);
  const { names } = namesFor(root);
  const first = names[0];
  assert.ok(first !== undefined);
  applyNames(names);
  const phantom: AnchorName = { ...first, id: "ms-never-written" };
  const broken = verifyAnchorNames([...names, phantom], [], root);
  assert.ok(
    broken.some((reason) => reason.includes("ms-never-written") && reason.includes("not in the")),
    JSON.stringify(broken),
  );
});

test("a sound edit passes its own check", () => {
  const root = write(PAGE(`      <p>Start anywhere</p>\n      <p>Finish anywhere</p>`));
  const { names } = namesFor(root);
  applyNames(names);
  assert.deepEqual(verifyAnchorNames(names, proposeIn(root).ambiguous, root), []);
});

/**
 * The property that matters: applying the names REMOVES the finding.
 *
 * A collection candidate sits at its map expression, so it resolves to the
 * enclosing wrapper. An id on a map-only `<div>` is a discriminator the walk
 * drops before anchoring what is inside, so the file changed and the next scan
 * reported the same ambiguity -- an edit that does not do what it was written
 * for.
 *
 * This asserts the outcome rather than the mechanism: name, apply, re-read, and
 * require that nothing ambiguous is left OR that nothing was written.
 */
const APPLY_AND_RESCAN: readonly (readonly [string, Record<string, string>])[] = [
  [
    "two paragraphs",
    PAGE(`      <p>Start anywhere</p>\n      <p>Finish anywhere</p>`),
  ],
  [
    "two map-only wrappers",
    {
      "app/page.tsx":
        `const rows = [{ slug: "a", title: "One" }];\n` +
        `export default function Home() {\n  return (\n    <main>\n` +
        `      <div>{rows.map((row) => (<p key={row.slug}>{row.title}</p>))}</div>\n` +
        `      <div>{rows.map((row) => (<p key={row.slug}>{row.title}</p>))}</div>\n` +
        `    </main>\n  );\n}\n`,
    },
  ],
  [
    "two named sections holding maps",
    {
      "app/page.tsx":
        `const rows = [{ slug: "a", title: "One" }];\n` +
        `export default function Home() {\n  return (\n    <main>\n` +
        `      <section><div>{rows.map((row) => (<p key={row.slug}>{row.title}</p>))}</div></section>\n` +
        `      <section><div>{rows.map((row) => (<p key={row.slug}>{row.title}</p>))}</div></section>\n` +
        `    </main>\n  );\n}\n`,
    },
  ],
];

for (const [description, files] of APPLY_AND_RESCAN) {
  test(`naming ${description} either resolves the ambiguity or writes nothing`, () => {
    const root = write(files);
    const before = proposeIn(root).ambiguous.length;
    const { names } = namesFor(root);
    if (names.length === 0) {
      // Refused, which is the honest answer where an id would not help.
      assert.ok(before > 0, `${description}: nothing was ambiguous to begin with`);
      return;
    }
    applyNames(names);
    assert.deepEqual(
      proposeIn(root).ambiguous,
      [],
      `${description}: names were written but the ambiguity remains`,
    );
  });
}

/**
 * A selector names an id by more syntaxes than `#`.
 *
 * `[id="${target}"]` matches by attribute, so a check looking only for `#`
 * called it safe while the selector could begin matching a newly named element.
 * Any interpolation in a selector that cannot be shown disjoint refuses.
 */
const SELECTOR_SYNTAXES: readonly (readonly [string, string, boolean])[] = [
  ["an attribute predicate", '`[id="${target}"]`', false],
  ["a tilde attribute predicate", '`[id~="${target}"]`', false],
  ["a fragment", "`#${target}`", false],
  ["an interpolation that diverges", '`[id="${safe}"]`', true],
  ["no interpolation at all", '"#hero"', true],
];

for (const [description, selector, names_ok] of SELECTOR_SYNTAXES) {
  test(`${names_ok ? "names past" : "refuses on"} a selector using ${description}`, () => {
    const { names } = namesFor(
      write(
        PAGE(
          `      <p>Start anywhere</p>\n      <p>Finish anywhere</p>`,
          `declare const document: { querySelector: (s: string) => unknown };\n` +
            `declare const target: string;\ndeclare const which: string;\n` +
            `const safe = \`field-\${which}\`;\n` +
            `export const found = document.querySelector(${selector});\n`,
        ),
      ),
    );
    if (names_ok) assert.equal(names.length, 2, `${description}: ${JSON.stringify(names)}`);
    else assert.deepEqual(names, [], `${description}: ${JSON.stringify(names)}`);
  });
}

/**
 * An imperative loop renders its body once per iteration, exactly as a callback
 * does. One lexical `<Card />` and many rendered elements means a fixed id
 * written inside `Card` appears once per iteration.
 */
const LOOP_RENDER_SITES: readonly (readonly [string, string])[] = [
  ["a for statement", `for (let i = 0; i < 2; i += 1) { cards.push(<Card />); }`],
  ["a for...of statement", `for (const row of rows) { void row; cards.push(<Card />); }`],
  ["a while statement", `while (cards.length < 2) { cards.push(<Card />); }`],
  ["a do statement", `do { cards.push(<Card />); } while (cards.length < 2);`],
];

for (const [description, loop] of LOOP_RENDER_SITES) {
  test(`refuses to name a component rendered from ${description}`, () => {
    const { names } = namesFor(
      write({
        "app/Card.tsx":
          `export function Card() {\n  return (\n    <div>\n      <p>Start anywhere</p>\n` +
          `      <p>Finish anywhere</p>\n    </div>\n  );\n}\n`,
        "app/page.tsx":
          `import { Card } from "./Card";\nconst rows = ["a", "b"];\n` +
          `export default function Home() {\n  const cards: unknown[] = [];\n  ${loop}\n` +
          `  return <main>{cards as never}</main>;\n}\n`,
      }),
    );
    assert.deepEqual(names, [], `${description}: ${JSON.stringify(names)}`);
  });
}

/**
 * The id after a `#` is the ACCUMULATED text, not pieces judged separately.
 *
 * `` `#ms-${suffix}` `` has a literal `ms-` that does not diverge, and testing
 * the interpolation on its own called the whole thing safe while the runtime id
 * was `ms-...`. Only where the literal contributes nothing can the
 * interpolation settle it.
 */
const CUMULATIVE_FRAGMENTS: readonly (readonly [string, string, boolean])[] = [
  ["a literal prefix that does not diverge", "`#ms-${suffix}`", false],
  ["a literal prefix that does diverge", "`#field-${suffix}`", true],
  ["no literal, and an interpolation that diverges", "`#${safe}`", true],
];

for (const [description, expression, names_ok] of CUMULATIVE_FRAGMENTS) {
  test(`${names_ok ? "names past" : "refuses on"} ${description}`, () => {
    const { names } = namesFor(
      write(
        PAGE(
          `      <p>Start anywhere</p>\n      <p>Finish anywhere</p>`,
          `declare const document: { querySelector: (s: string) => unknown };\n` +
            `declare const which: string;\n` +
            `const suffix = \`home-\${which}\`;\n` +
            `const safe = \`field-\${which}\`;\n` +
            `export const found = document.querySelector(${expression});\n`,
        ),
      ),
    );
    if (names_ok) assert.equal(names.length, 2, `${description}: ${JSON.stringify(names)}`);
    else assert.deepEqual(names, [], `${description}: ${JSON.stringify(names)}`);
  });
}

/**
 * An outcome row for the corpus half: `fragmentsIn` unescapes too, so removing
 * either unescape alone still catches this. Both are kept because they answer
 * different questions -- one reserves the id, the other refuses the name.
 *
 * A stylesheet may ESCAPE characters an identifier allows anyway.
 * `#ms\-home-start-anywhere` selects the id `ms-home-start-anywhere`, and
 * neither the fragment scan nor the corpus search saw that spelling.
 */
const ESCAPED_SELECTORS: readonly (readonly [string, string])[] = [
  ["a one-character escape", "#ms\\-home-start-anywhere"],
  ["a hex escape with a terminating space", "#ms\\2d home-start-anywhere"],
  ["an upper-case hex escape", "#ms\\2D home-start-anywhere"],
  ["a zero-padded hex escape", "#ms\\00002d home-start-anywhere"],
];

for (const [description, selector] of ESCAPED_SELECTORS) {
  test(`does not hand out a name ${description} points at`, () => {
    const { names } = namesFor(
      write({
        ...PAGE(`      <p>Start anywhere</p>\n      <p>Finish anywhere</p>`),
        "app/globals.css": `${selector} { scroll-margin-top: 4rem; }\n`,
      }),
    );
    assert.ok(
      !names.some((name) => name.id === "ms-home-start-anywhere"),
      `${description}: ${JSON.stringify(names)}`,
    );
    assert.ok(
      names.some((name) => /^ms-home-start-anywhere-\d+$/u.test(name.id)),
      `${description}: ${JSON.stringify(names)}`,
    );
  });
}

/** A selector naming something else is not a reason to move off the name. */
test("an unrelated escaped selector does not block the name", () => {
  const { names } = namesFor(
    write({
      ...PAGE(`      <p>Start anywhere</p>\n      <p>Finish anywhere</p>`),
      "app/globals.css": "#other\\2d thing { color: red; }\n",
    }),
  );
  assert.ok(names.some((name) => name.id === "ms-home-start-anywhere"), JSON.stringify(names));
});

/**
 * This tool's own output is not part of the repository it reads.
 *
 * A dry run writes the proposed names into the repository, and a second
 * unchanged run that read them back would find every name occupied and propose
 * suffixed ones -- the same input answering differently each time.
 *
 * The output directory is caller-supplied, so the exclusion has to be per-run.
 * `.managed-site-proposal`, the DEFAULT, is skipped by name as well -- see
 * `SKIPPED_DIRECTORIES` -- which is why this case names its report folder
 * something else. A run given no exclusion at all must still drift, or the
 * per-run exclusion proves nothing.
 */
test("a previous proposal in the repository does not change the next one", () => {
  const root = write({
    ...PAGE(`      <p>Start anywhere</p>\n      <p>Finish anywhere</p>`),
    "reports/anchor-names.json": JSON.stringify({
      names: [{ id: "ms-home-start-anywhere" }, { id: "ms-home-finish-anywhere" }],
    }),
  });
  const withoutOutput = nameAmbiguousAnchors(proposeIn(root).ambiguous, root);
  const withOutput = nameAmbiguousAnchors(proposeIn(root).ambiguous, root, {
    outputDirectory: join(root, "reports"),
  });
  // Excluded, the names are the plain ones. Included, they collide with
  // themselves and drift to suffixes.
  assert.deepEqual(
    withOutput.names.map((name) => name.id).sort(),
    ["ms-home-finish-anywhere", "ms-home-start-anywhere"],
  );
  assert.notDeepEqual(
    withoutOutput.names.map((name) => name.id).sort(),
    withOutput.names.map((name) => name.id).sort(),
  );
});

/**
 * The default output directory is skipped by name, in every walk this tool
 * makes rather than only the one the run was told about.
 *
 * Nothing broke before it was: the report that quotes `id="ms-..."` evidence is
 * a `.txt` and `.txt` is not a searched extension, so the corpus never read it.
 * A rule beats an accident, and the walks that find render sites, read route
 * metadata and drive the proposer were never given the exclusion at all.
 */
test("the default proposal directory is skipped even with no exclusion given", () => {
  const root = write({
    ...PAGE(`      <p>Start anywhere</p>\n      <p>Finish anywhere</p>`),
    ".managed-site-proposal/anchor-names.json": JSON.stringify({
      names: [{ id: "ms-home-start-anywhere" }, { id: "ms-home-finish-anywhere" }],
    }),
  });

  assert.deepEqual(
    nameAmbiguousAnchors(proposeIn(root).ambiguous, root).names.map((name) => name.id).sort(),
    ["ms-home-finish-anywhere", "ms-home-start-anywhere"],
  );
});

/**
 * A fragment is not only a template. `"#" + target` and a name bound to one are
 * neither literal `#name` for the text scan nor templates for the reader, so
 * the value is flattened into literal and unreadable pieces and read the same
 * way whatever its shape.
 */
const CONCATENATED_FRAGMENTS: readonly (readonly [string, string, boolean])[] = [
  // The concatenation rows refuse with the `+` flattening removed too: an
  // unreadable value with no readable `#` is not treated as a fragment, so
  // these pass through `fragmentsWrittenBy` unchanged and the OPAQUE id guard
  // on the element refuses them for its own reason. They pin the outcome.
  ["a string concatenation", `<a href={"#" + target}>Jump</a>`, false],
  ["a concatenation bound to a name", `<a href={joined}>Jump</a>`, false],
  ["a concatenation whose id diverges", `<a href={"#field-" + target}>Jump</a>`, true],
  ["a literal id built by concatenation", `<a href={"#" + "ms-home-start-anywhere"}>Jump</a>`, true],
];

for (const [description, markup, names_ok] of CONCATENATED_FRAGMENTS) {
  test(`${names_ok ? "names past" : "refuses on"} ${description}`, () => {
    const { names } = namesFor(
      write(
        PAGE(
          `      <p>Start anywhere</p>\n      <p>Finish anywhere</p>\n      ${markup}`,
          `declare const target: string;\nconst joined = "#" + target;\n`,
        ),
      ),
    );
    if (names_ok) {
      assert.equal(names.length, 2, `${description}: ${JSON.stringify(names)}`);
      // A literal id built by concatenation is a name spoken for -- but only
      // the row that actually writes one says so.
      if (markup.includes("ms-home-start-anywhere")) {
        assert.ok(
          !names.some((name) => name.id === "ms-home-start-anywhere"),
          JSON.stringify(names),
        );
      }
    } else {
      assert.deepEqual(names, [], `${description}: ${JSON.stringify(names)}`);
    }
  });
}

/**
 * `aria-activedescendant` is an IDREF like the rest, and was outside the
 * boundary.
 *
 * An outcome row: a LITERAL like this one is caught by the repository text
 * search regardless, so nothing here distinguishes the list entry. It earns its
 * place on the DYNAMIC path, where an unreadable IDREF value must make naming
 * refuse and only the list decides which attributes are asked.
 */
test("does not hand out a name aria-activedescendant points at", () => {
  const { names } = namesFor(
    write(
      PAGE(
        `      <p>Start anywhere</p>\n      <p>Finish anywhere</p>\n` +
          `      <div aria-activedescendant="ms-home-start-anywhere">Third</div>`,
      ),
    ),
  );
  assert.ok(!names.some((name) => name.id === "ms-home-start-anywhere"), JSON.stringify(names));
});

/**
 * The prop exemption applies only to the component's OWN parameter. A local
 * binding that merely shares a prop's name is not proven by what callers pass.
 */
test("a local sharing a prop's name is not exempted by the callers", () => {
  const { names } = namesFor(
    write({
      // The local SHADOWS the prop, which is what makes the callers' literal
      // look like a proof. A differently-named local would be refused anyway,
      // for want of a matching prop at the render sites.
      "app/Widget.tsx":
        `export function Widget({ id: incoming }: { id?: string }) {\n` +
        `  void incoming;\n` +
        `  const id = String(Math.random());\n` +
        `  return <div id={id} />;\n}\n`,
      ...PAGE(
        `      <p>Start anywhere</p>\n      <p>Finish anywhere</p>\n` +
          `      <Widget id="hero" />`,
        `import { Widget } from "./Widget";\n`,
      ),
    }),
  );
  assert.deepEqual(names, [], JSON.stringify(names));
});

test("a hash in a template SPAN with an interpolated id refuses every name", () => {
  const { names, findings } = namesFor(
    write(
      PAGE(
        `      <p>Start anywhere</p>\n      <p>Finish anywhere</p>\n` +
          "      <a href={`${prefix}#${target}`}>Jump</a>",
        `declare const prefix: string;\ndeclare const target: string;\n`,
      ),
    ),
  );
  assert.deepEqual(names, [], JSON.stringify(names));
  assert.ok(findings.length > 0);
});

test("a querySelector whose hash is in a span refuses every name", () => {
  const { names } = namesFor(
    write(
      PAGE(
        `      <p>Start anywhere</p>\n      <p>Finish anywhere</p>`,
        `declare const document: { querySelector: (s: string) => unknown };\n` +
          `declare const prefix: string;\ndeclare const target: string;\n` +
          "export const found = document.querySelector(`${prefix}#${target}`);\n",
      ),
    ),
  );
  assert.deepEqual(names, [], JSON.stringify(names));
});

/**
 * A LITERAL after the hash is a known id, whatever comes before it. This is the
 * shape a real site's structured data uses -- `` `${SITE_URL}/#organization` ``
 * -- and requiring every interpolation to be disjoint refused all 64 names on
 * one, because the canonical URL is an imported constant.
 */
test("a literal id after a hash in a span is reserved, not refused", () => {
  const { names } = namesFor(
    write(
      PAGE(
        `      <p>Start anywhere</p>\n      <p>Finish anywhere</p>`,
        `declare const base: string;\n` +
          "export const url = `${base}/#ms-home-start-anywhere`;\n",
      ),
    ),
  );
  // Named, and the name it already says is not handed out again.
  assert.equal(names.length, 2, JSON.stringify(names));
  assert.ok(!names.some((name) => name.id === "ms-home-start-anywhere"), JSON.stringify(names));
});

/**
 * A default export without a semicolon is valid, and the first version of
 * `isDefaultExported` matched with a regex that demanded one. It reads the AST
 * now, which does not distinguish the two spellings at all.
 *
 * These are OUTCOME rows. Both spellings are refused either way, for a reason
 * upstream of the export question -- the reported decision is that how many
 * times the component renders could not be settled -- so no id is written and
 * neither row distinguishes the AST change. The change stands because a regex
 * over source text is the wrong instrument in a file this tool has parsed, not
 * because a test separates it.
 */
const DEFAULT_EXPORT_SPELLINGS: readonly (readonly [string, string])[] = [
  ["with a semicolon", `export default Card;`],
  ["without a semicolon", `export default Card`],
];

for (const [description, exported] of DEFAULT_EXPORT_SPELLINGS) {
  test(`a component default-exported ${description} and rendered twice is not named`, () => {
    const { names } = namesFor(
      write({
        "app/Card.tsx":
          `function Card() {\n  return (\n    <div>\n      <p>Start anywhere</p>\n` +
          `      <p>Finish anywhere</p>\n    </div>\n  );\n}\n${exported}\n`,
        "app/page.tsx":
          `import Card from "./Card";\n` +
          `export default function Home() {\n  return (\n    <main>\n` +
          `      <Card />\n      <Card />\n    </main>\n  );\n}\n`,
      }),
    );
    assert.deepEqual(names, [], `${description}: ${JSON.stringify(names)}`);
  });
}

test("a fragment built from an unreadable name refuses every name", () => {
  const { names, findings } = namesFor(
    write(
      PAGE(
        `      <p>Start anywhere</p>\n      <p>Finish anywhere</p>\n` +
          "      <a href={`#${target}`}>Jump</a>",
        `declare const target: string;\n`,
      ),
    ),
  );
  assert.deepEqual(names, []);
  assert.ok(findings.length > 0);
});

/** An outcome row: a `#`-headed template is caught by the fragment rule before
 * the selector rule is reached, so `selectorArgumentIsOpaque` is depth here. It
 * exists for a selector written without a `#` head that this rule would still
 * have to judge. */
test("a querySelector built from an unreadable name refuses every name", () => {
  const { names } = namesFor(
    write(
      PAGE(
        `      <p>Start anywhere</p>\n      <p>Finish anywhere</p>`,
        `declare const document: { querySelector: (s: string) => unknown };\n` +
          `declare const target: string;\n` +
          "export const found = document.querySelector(`#${target}`);\n",
      ),
    ),
  );
  assert.deepEqual(names, []);
});

test("a fragment built from a name whose head diverges does not block naming", () => {
  const { names } = namesFor(
    write(
      PAGE(
        `      <p>Start anywhere</p>\n      <p>Finish anywhere</p>\n` +
          "      <a href={`#${safe}`}>Jump</a>",
        `declare const which: string;\nconst safe = \`field-\${which}\`;\n`,
      ),
    ),
  );
  assert.equal(names.length, 2, JSON.stringify(names));
});

/**
 * A namespace import carries every name at once and a barrel resolves to
 * itself, so neither says which declaration a tag used -- and counting zero
 * sites would call the component a route rendered once.
 */
test("a component reached through a barrel is not named", () => {
  const { names } = namesFor(
    write({
      "app/Card.tsx":
        `export function Card() {\n  return (\n    <div>\n      <p>Start anywhere</p>\n` +
        `      <p>Finish anywhere</p>\n    </div>\n  );\n}\n`,
      "app/index.tsx": `export { Card } from "./Card";\n`,
      "app/page.tsx":
        `import { Card } from "./index";\n` +
        `export default function Home() {\n  return (\n    <main>\n` +
        `      <Card />\n      <Card />\n    </main>\n  );\n}\n`,
    }),
  );
  assert.deepEqual(names, [], JSON.stringify(names));
});

/**
 * A default import rendered TWICE is the row that proves the tracing. Rendered
 * once it is named either way -- untraced counts zero sites, which reads as a
 * route rendered once -- so only the repeated case distinguishes them.
 */
test("a component default-imported and rendered twice is not named", () => {
  const { names } = namesFor(
    write({
      "app/Card.tsx":
        `export default function Card() {\n  return (\n    <div>\n      <p>Start anywhere</p>\n` +
        `      <p>Finish anywhere</p>\n    </div>\n  );\n}\n`,
      "app/page.tsx":
        `import Card from "./Card";\n` +
        `export default function Home() {\n  return (\n    <main>\n` +
        `      <Card />\n      <Card />\n    </main>\n  );\n}\n`,
    }),
  );
  assert.deepEqual(names, [], JSON.stringify(names));
});

/** A DEFAULT import is traceable -- one declaration, one local name -- so a
 * component rendered once through one is still named. */
test("a component reached through a default import is named", () => {
  const { names } = namesFor(
    write({
      "app/Card.tsx":
        `export default function Card() {\n  return (\n    <div>\n      <p>Start anywhere</p>\n` +
        `      <p>Finish anywhere</p>\n    </div>\n  );\n}\n`,
      "app/page.tsx":
        `import Card from "./Card";\n` +
        `export default function Home() {\n  return <main><Card /></main>;\n}\n`,
    }),
  );
  assert.equal(names.length, 2, JSON.stringify(names));
});

/**
 * An id an existing LOOKUP takes must be readable, or shown different from
 * every name this writer mints. `getElementById(target)` finds nothing today;
 * handing that name out would make it select the new element.
 */
test("a name a getElementById variable holds is not handed out", () => {
  const { names } = namesFor(
    write(
      PAGE(
        `      <p>Start anywhere</p>\n      <p>Finish anywhere</p>`,
        `declare const document: { getElementById: (id: string) => unknown };\n` +
          `const target = "ms-home-start-anywhere";\n` +
          `export const found = document.getElementById(target);\n`,
      ),
    ),
  );
  assert.ok(!names.some((name) => name.id === "ms-home-start-anywhere"), JSON.stringify(names));
  assert.ok(
    names.some((name) => /^ms-home-start-anywhere-\d+$/u.test(name.id)),
    JSON.stringify(names),
  );
});

test("a getElementById argument it cannot read refuses every name", () => {
  const { names, findings } = namesFor(
    write(
      PAGE(
        `      <p>Start anywhere</p>\n      <p>Finish anywhere</p>`,
        `declare const document: { getElementById: (id: string) => unknown };\n` +
          `declare const chosen: string;\n` +
          `export const found = document.getElementById(chosen);\n`,
      ),
    ),
  );
  assert.deepEqual(names, []);
  assert.ok(findings.length > 0);
});

test("a getElementById argument whose head diverges does not block naming", () => {
  const { names } = namesFor(
    write(
      PAGE(
        `      <p>Start anywhere</p>\n      <p>Finish anywhere</p>`,
        `declare const document: { getElementById: (id: string) => unknown };\n` +
          `declare const which: string;\n` +
          "const target = `field-${which}`;\n" +
          `export const found = document.getElementById(target);\n`,
      ),
    ),
  );
  assert.equal(names.length, 2, JSON.stringify(names));
});

/** A component rendered exactly once is still named, so the rows above fail for
 * the reason they claim. */
test("a component rendered once is named", () => {
  const { names } = namesFor(
    write({
      "app/page.tsx":
        `function Card() {\n  return (\n    <div>\n      <p>Start anywhere</p>\n` +
        `      <p>Finish anywhere</p>\n    </div>\n  );\n}\n` +
        `export default function Home() {\n  return (\n    <main>\n      <Card />\n    </main>\n  );\n}\n`,
    }),
  );
  assert.equal(names.length, 2, JSON.stringify(names));
});

/**
 * An id this reader cannot READ still has to be shown different from every name
 * it mints, or that name may already be on the page.
 *
 * Two ways count, and the rows below pin both: a literal head that diverges
 * from the generated prefix inside the part both spell out, and a prop whose
 * every render site passes a literal. Anything else refuses ALL naming, because
 * the element carrying the opaque id is unrelated to the one being named.
 */

test("an id it cannot read and cannot tell apart refuses every name", () => {
  const { names, findings } = namesFor(
    write(
      PAGE(
        `      <p>Start anywhere</p>\n      <p>Finish anywhere</p>\n` +
          `      <div id={other}>Third</div>`,
        `declare const other: string;\n`,
      ),
    ),
  );
  assert.deepEqual(names, []);
  assert.ok(findings.length > 0);
  assert.match(findings[0]?.decision ?? "", /cannot be read or shown different/u);
});

/**
 * A head that could still COMPLETE the generated prefix proves nothing.
 *
 * `` `ms-${x}` `` may be any generated name, and `` `m${x}` `` may become one
 * too -- they must differ inside the part both spell out, not merely be
 * non-empty. These are the rows that make the prefix test a proof.
 */
const HEADS_THAT_PROVE_NOTHING: readonly (readonly [string, string])[] = [
  ["the whole prefix", "`ms-${other}`"],
  ["a proper prefix of it", "`m${other}`"],
  ["the prefix without its dash", "`ms${other}`"],
  ["an empty head", "`${other}`"],
];

for (const [description, expression] of HEADS_THAT_PROVE_NOTHING) {
  test(`an id whose head is ${description} refuses every name`, () => {
    const { names, findings } = namesFor(
      write(
        PAGE(
          `      <p>Start anywhere</p>\n      <p>Finish anywhere</p>\n` +
            `      <div id={${expression}}>Third</div>`,
          `declare const other: string;\n`,
        ),
      ),
    );
    assert.deepEqual(names, [], `${description}: ${JSON.stringify(names)}`);
    assert.ok(findings.length > 0);
  });
}

/** Two bindings of one name in scope is an ambiguity, not a resolution. */
test("an id from a name bound twice refuses every name", () => {
  const { names } = namesFor(
    write({
      "app/page.tsx":
        `declare const flag: boolean;\ndeclare const other: string;\n` +
        `export default function Home() {\n` +
        `  const built = \`field-\${other}\`;\n` +
        `  const built2 = built;\n  void built2;\n` +
        `  var built = \`ms-\${other}\`;\n  void flag;\n` +
        `  return (\n    <section id="s">\n      <p>Start anywhere</p>\n` +
        `      <p>Finish anywhere</p>\n      <div id={built}>Third</div>\n    </section>\n  );\n}\n`,
    }),
  );
  assert.deepEqual(names, [], JSON.stringify(names));
});

test("an id built from a template whose head diverges does not block naming", () => {
  const { names } = namesFor(
    write(
      PAGE(
        `      <p>Start anywhere</p>\n      <p>Finish anywhere</p>\n` +
          "      <div id={`field-${other}`}>Third</div>",
        `declare const other: string;\n`,
      ),
    ),
  );
  assert.equal(names.length, 2, JSON.stringify(names));
});

test("an id from a local const whose head diverges does not block naming", () => {
  const { names } = namesFor(
    write({
      "app/page.tsx":
        `declare const other: string;\n` +
        `export default function Home() {\n  const built = \`field-\${other}\`;\n` +
        `  return (\n    <section id="s">\n      <p>Start anywhere</p>\n` +
        `      <p>Finish anywhere</p>\n      <div id={built}>Third</div>\n    </section>\n  );\n}\n`,
    }),
  );
  assert.equal(names.length, 2, JSON.stringify(names));
});

/**
 * An IDREF attribute POINTS at an id. If it currently points at nothing,
 * generating that name would bind a relationship this writer claims not to
 * change -- so each token in one is spoken for.
 */
const IDREF_RESERVATIONS: readonly (readonly [string, string])[] = [
  ["aria-labelledby", `aria-labelledby="ms-home-start-anywhere"`],
  ["aria-describedby", `aria-describedby="ms-home-start-anywhere"`],
  ["htmlFor", `htmlFor="ms-home-start-anywhere"`],
  ["a space-separated list", `aria-labelledby="other-thing ms-home-start-anywhere"`],
];

for (const [description, attribute] of IDREF_RESERVATIONS) {
  test(`does not hand out a name ${description} already points at`, () => {
    const { names } = namesFor(
      write(
        PAGE(
          `      <p>Start anywhere</p>\n      <p>Finish anywhere</p>\n` +
            `      <div ${attribute}>Third</div>`,
        ),
      ),
    );
    assert.ok(!names.some((name) => name.id === "ms-home-start-anywhere"), JSON.stringify(names));
    assert.ok(
      names.some((name) => /^ms-home-start-anywhere-\d+$/u.test(name.id)),
      JSON.stringify(names),
    );
  });
}

/**
 * One element cannot be two anchors ACROSS groups either.
 *
 * A mixed-content `<a>` yields both a link candidate and a direct-text
 * candidate, under different anchors, at the same opening tag. A per-group
 * check cannot see that: each group looks internally consistent, and both names
 * are written at the same offset. So the claim is tracked per FILE for the
 * whole run, and a later group resolving to an element already spoken for is
 * refused.
 */
test("a second group resolving to an already-named element is refused", () => {
  const root = write(PAGE(`      <p>First words</p>\n      <p>Second words</p>`));
  const file = join(root, "app/page.tsx");
  const first = [candidateAt(file, "<p>First"), candidateAt(file, "<p>Second")];
  const second = [candidateAt(file, "<p>First"), candidateAt(file, "<p>Second")];
  const { names, findings } = nameAmbiguousAnchors([first, second], root);
  // The first group is named; the second finds both its elements spoken for.
  assert.equal(names.length, 2, JSON.stringify(names));
  assert.equal(new Set(names.map((name) => name.insertAt)).size, 2);
  assert.equal(findings.length, 1);
  assert.match(findings[0]?.decision ?? "", /same element/u);
});

/** And two names are never written at one offset, which is what that prevents. */
test("no two names share an insertion point", () => {
  const root = write(PAGE(`      <p>First words</p>\n      <p>Second words</p>`));
  const file = join(root, "app/page.tsx");
  const group = [candidateAt(file, "<p>First"), candidateAt(file, "<p>Second")];
  const { names } = nameAmbiguousAnchors([group, [...group]], root);
  const points = names.map((name) => `${name.file}#${String(name.insertAt)}`);
  assert.equal(new Set(points).size, points.length, JSON.stringify(points));
});

/**
 * The one failure that would not surface as a finding is a file this tool has
 * corrupted: it surfaces as a broken build in someone else's afternoon. So the
 * writer parses what it is about to write and leaves the file alone when it
 * would not parse, rather than trusting the offset it was handed.
 */
test("a name written at a nonsense offset is not written at all", () => {
  const root = write(TWINS);
  const file = join(root, "app/page.tsx");
  const before = readFileSync(file, "utf8");
  const applied = applyAnchorNames([
    { file, insertAt: before.indexOf("<p>") + 1, tag: "p", id: "ms-x", anchor: "a" },
  ]);
  assert.deepEqual(applied.files, []);
  assert.deepEqual(applied.rejected, [file]);
  assert.equal(readFileSync(file, "utf8"), before);
});

/** A candidate pointing at the element that opens with `marker`. */
function candidateAt(file: string, marker: string): Candidate {
  const text = readFileSync(file, "utf8");
  const offset = text.indexOf(marker);
  assert.notEqual(offset, -1, `${marker} is not in ${file}`);
  const line = text.slice(0, offset).split("\n").length;
  return {
    kind: "plain_text",
    semantic: "body",
    value: "Fixed words",
    anchor: [{ kind: "component", name: "Home" }, { kind: "role", tag: "p", attribute: null }, { kind: "text" }],
    componentNames: ["Home"],
    componentKeys: [`${file}#Home@${String(offset)}`],
    location: { file, line, offset },
    evidence: marker,
    ownership: "customer_editable",
    identity: POSITION_IDENTITY,
  };
}

/**
 * Containment is a path question, not a prefix one.
 *
 * The output directory is excluded from both scans so a dry run's own proposal
 * does not read back as occupied. `startsWith` made `out` swallow `outside`,
 * which silently hid a real selector file from the collision scan -- the exact
 * failure the exclusion exists to avoid, applied to the wrong directory.
 */
for (const sibling of ["outside", "out-takes", "outer/deep"] as const) {
  test(`a directory beside the output one is still scanned: ${sibling}`, () => {
    const root = write({
      ...TWINS,
      // The output directory has to EXIST, or its real path cannot be taken and
      // the comparison runs between two spellings of the same place -- which
      // excludes nothing at all and would pass this row for the wrong reason.
      "out/anchor-names.txt": "",
      [`${sibling}/globals.css`]: "#ms-home-start-anywhere { color: red; }\n",
    });
    const { names } = nameAmbiguousAnchors(proposeIn(root).ambiguous, root, { outputDirectory: join(root, "out") });
    assert.ok(names.length > 0, "the page is still nameable");
    for (const name of names) {
      assert.notEqual(name.id, "ms-home-start-anywhere", `${sibling} was treated as output`);
    }
  });
}

/** The output directory itself still is excluded, or the exclusion is inert. */
test("the output directory is excluded from the scan", () => {
  const root = write({
    ...TWINS,
    "out/globals.css": "#ms-home-start-anywhere { color: red; }\n",
  });
  const { names } = nameAmbiguousAnchors(proposeIn(root).ambiguous, root, { outputDirectory: join(root, "out") });
  assert.ok(
    names.some((name) => name.id === "ms-home-start-anywhere"),
    JSON.stringify(names.map((name) => name.id)),
  );
});

/**
 * The ledger is the tool's own artifact too, and it is the one that has to live
 * in the tree.
 *
 * It records the anchor every id was minted for, so every name already handed
 * out appears in it as text. Scanned, it reserves the names it is the record of,
 * and the next run mints `-2` for a value that has not moved -- which changes
 * that value's anchor, which mints a new field id, which is exactly the
 * stability the ledger exists to provide. The third run would say `-3`.
 *
 * Converting All Points Media a second time did this to `ms-proof-challenge`.
 */
test("the ledger is excluded from the scan, so a name it holds is not taken twice", () => {
  const root = write({
    ...TWINS,
    "src/content/managed-site.idmap.json": JSON.stringify({
      version: 1,
      entries: { "anchor:component:Home/role:p/id:ms-home-start-anywhere/text": "field_x" },
      tombstonedIds: [],
    }),
  });
  const ledgerPath = join(root, "src/content/managed-site.idmap.json");

  assert.ok(
    nameAmbiguousAnchors(proposeIn(root).ambiguous, root, { ledgerPath }).names.some(
      (name) => name.id === "ms-home-start-anywhere",
    ),
    "the plain name is still available",
  );
});

/** Or the exclusion above is inert and proves nothing. */
test("a ledger left in the scan does reserve its own names", () => {
  const root = write({
    ...TWINS,
    "src/content/managed-site.idmap.json": JSON.stringify({
      version: 1,
      entries: { "anchor:component:Home/role:p/id:ms-home-start-anywhere/text": "field_x" },
      tombstonedIds: [],
    }),
  });

  assert.equal(
    nameAmbiguousAnchors(proposeIn(root).ambiguous, root, {}).names.some(
      (name) => name.id === "ms-home-start-anywhere",
    ),
    false,
    "unexcluded, the ledger takes the name it is the record of",
  );
});

/** Both exclusions at once: neither may cancel the other. */
test("the output directory and the ledger are both excluded", () => {
  const root = write({
    ...TWINS,
    "out/globals.css": "#ms-home-start-anywhere { color: red; }\n",
    "src/content/managed-site.idmap.json": JSON.stringify({
      version: 1,
      entries: { "anchor:component:Home/role:p/id:ms-home-finish-anywhere/text": "field_y" },
      tombstonedIds: [],
    }),
  });
  const { names } = nameAmbiguousAnchors(proposeIn(root).ambiguous, root, {
    outputDirectory: join(root, "out"),
    ledgerPath: join(root, "src/content/managed-site.idmap.json"),
  });

  for (const id of ["ms-home-start-anywhere", "ms-home-finish-anywhere"]) {
    assert.ok(
      names.some((name) => name.id === id),
      `${id} was treated as occupied: ${JSON.stringify(names.map((name) => name.id))}`,
    );
  }
});

/**
 * A selector this scan cannot spell out.
 *
 * `.scss`/`.sass` are declared selector sources, but both reservation paths
 * need an already-contiguous id token. `$p: "ms-home-"; #{$p}start-anywhere`
 * compiles to a selector for `#ms-home-start-anywhere` while no text in the
 * repository contains that token, so a generated name cannot be shown
 * different from it. Refuse rather than guess what the compiler will emit.
 */
const INTERPOLATED: readonly (readonly [string, string])[] = [
  ["styles/app.scss", '$prefix: "ms-home-";\n#{$prefix}start-anywhere { color: red; }\n'],
  ["styles/app.sass", '$prefix: "ms-home-"\n#{$prefix}start-anywhere\n  color: red\n'],
  // Less spells the same construction `@{...}`, which the finding did not name.
  ["styles/app.less", '@prefix: ms-home-;\n#@{prefix}start-anywhere { color: red; }\n'],
  ["styles/app.css", "#ms-home-start-anywhere { color: red; }\n/* #{$x} */\n"],
];

for (const [stylesheet, text] of INTERPOLATED) {
  test(`interpolated selector text refuses every name: ${stylesheet}`, () => {
    const root = write({ ...TWINS, [stylesheet]: text });
    const { names, findings } = nameAmbiguousAnchors(proposeIn(root).ambiguous, root);
    assert.deepEqual(names, []);
    assert.ok(findings.length > 0);
    assert.match(findings[0]?.decision ?? "", /cannot be read or shown/u);
  });
}

/** The same stylesheet without interpolation names normally, so the row above
 * fails for the reason it claims and not because a stylesheet exists at all. */
test("a plain stylesheet does not refuse naming", () => {
  const root = write({ ...TWINS, "styles/app.scss": ".hero { color: red; }\n" });
  assert.ok(nameAmbiguousAnchors(proposeIn(root).ambiguous, root).names.length > 0);
});

/**
 * A selector literal denotes an id the file never spells.
 *
 * Ids were reserved from RAW repository text, so
 * `querySelector("#ms\x2dhome-start-anywhere")` reserved nothing: the text
 * holds `\x2d`, and the CSS decoder resolves `\-` and `\2d ` but knows nothing
 * of JavaScript's escapes. The generator could mint `ms-home-start-anywhere`,
 * and applying it turned a selector that matched nothing into one that selects
 * the element just named.
 *
 * Enumerating JavaScript's escape forms is the same non-terminating shape this
 * file has paid for repeatedly, so the value comes from the scanner that
 * already resolved them. These rows are the forms that decoder must not need
 * to know about individually -- two the finding named and four it did not.
 */
const JS_ESCAPED_SELECTORS: readonly (readonly [string, string])[] = [
  ["hex", '"#ms\\x2dhome-start-anywhere"'],
  ["unicode", '"#ms\\u002dhome-start-anywhere"'],
  ["code point", '"#ms\\u{2d}home-start-anywhere"'],
  ["single quotes", "'#ms\\x2dhome-start-anywhere'"],
  ["template literal", "`#ms\\x2dhome-start-anywhere`"],
  // The HASH itself escaped, so the raw file holds no `#` for any text scan to
  // find. Only the decoded value is a fragment at all.
  ["escaped hash", '"\\x23ms-home-start-anywhere"'],
  // A CSS escape written inside a JS literal needs BOTH decoders, in order:
  // the source holds `\\-`, JS yields `\-`, CSS yields `-`.
  ["css escape inside a js literal", '"#ms\\\\-home-start-anywhere"'],
];

for (const [form, selector] of JS_ESCAPED_SELECTORS) {
  test(`a selector escaped as ${form} reserves the id it denotes`, () => {
    const root = write(
      PAGE(
        `      <p>Start anywhere</p>\n      <p>Finish anywhere</p>`,
        `const found = document.querySelector(${selector});\nvoid found;\n`,
      ),
    );
    const { names } = nameAmbiguousAnchors(proposeIn(root).ambiguous, root);
    for (const name of names) {
      assert.notEqual(
        name.id,
        "ms-home-start-anywhere",
        `${form}: the generated name is what that selector already denotes`,
      );
    }
  });
}

/** The same page with no selector DOES get that name, so the rows above fail
 * for the reason they claim and not because the name was never available. */
test("with no selector present the plain name is used", () => {
  const root = write(PAGE(`      <p>Start anywhere</p>\n      <p>Finish anywhere</p>`));
  assert.ok(
    nameAmbiguousAnchors(proposeIn(root).ambiguous, root).names.some(
      (name) => name.id === "ms-home-start-anywhere",
    ),
  );
});

/**
 * A component reached through a barrel that re-exports its DEFAULT.
 *
 * A binding travels under two names -- its own, and `default` when it is the
 * default export -- and only one side of this reader knew that.
 * `export { default as Card } from "./Card"` was read as carrying nothing, so
 * consumers resolved to the barrel, no render site was found, and a count of
 * zero was read as "a route rendered once". Fixed ids then went into a
 * declaration rendered twice: two elements with the same DOM id, which is the
 * one failure this whole reader exists to prevent.
 *
 * Two spellings the finding named and two it did not.
 */
interface Barrel {
  readonly why: string;
  readonly barrel: string;
  readonly imports: string;
  readonly tag: string;
}

const DEFAULT_BARRELS: readonly Barrel[] = [
  {
    why: "aliased re-export",
    barrel: `export { default as Item } from "./Card";\n`,
    imports: `import { Item } from "./barrel";`,
    tag: "Item",
  },
  {
    why: "bare default re-export",
    barrel: `export { default } from "./Card";\n`,
    imports: `import Item from "./barrel";`,
    tag: "Item",
  },
  {
    why: "star re-export",
    barrel: `export * from "./Card";\n`,
    imports: `import { Card as Item } from "./barrel";`,
    tag: "Item",
  },
  {
    // Not a specifier at all: imported, then re-exported as this module's own
    // default.
    why: "import then export default",
    barrel: `import Renamed from "./Card";\nexport default Renamed;\n`,
    imports: `import Item from "./barrel";`,
    tag: "Item",
  },
];

const CARD =
  `export default function Card() {\n  return (\n    <div>\n      <p>Start anywhere</p>\n` +
  `      <p>Finish anywhere</p>\n    </div>\n  );\n}\n`;

/**
 * Every row aliases to a name the declaration does NOT have.
 *
 * Written as `export { default as Card }`, the barrel's own specifier counts as
 * a second declaration named `Card` and the group refuses for that reason
 * instead — passing without exercising the re-export at all. Verified: with the
 * traceability guard removed entirely, the `as Card` spelling still refuses and
 * only these spellings write ids.
 */
for (const { why, barrel, imports, tag } of DEFAULT_BARRELS) {
  test(`a component rendered twice through a ${why} is not named`, () => {
    const { names } = namesFor(
      write({
        "app/Card.tsx": CARD,
        "app/barrel.ts": barrel,
        "app/page.tsx":
          `${imports}\nexport default function Home() {\n  return (\n    <main>\n` +
          `      <${tag} />\n      <${tag} />\n    </main>\n  );\n}\n`,
      }),
    );
    assert.deepEqual(names, [], `${why}: ${JSON.stringify(names.map((n) => n.id))}`);
  });
}

/**
 * The SAME fixture imported directly, rendered once, IS named -- so the rows
 * above refuse because of the barrel and the count, not because this component
 * is unnameable. (A barrel refuses at any count; that contract is older than
 * this change and has its own row above.)
 */
test("the same component imported directly and rendered once is named", () => {
  const { names } = namesFor(
    write({
      "app/Card.tsx":
        `export default function Card() {\n  return (\n    <div>\n      <p>Start anywhere</p>\n` +
        `      <p>Finish anywhere</p>\n    </div>\n  );\n}\n`,
      "app/page.tsx":
        `import Card from "./Card";\n` +
        `export default function Home() {\n  return (\n    <main>\n      <Card />\n    </main>\n  );\n}\n`,
    }),
  );
  assert.equal(names.length, 2, JSON.stringify(names.map((n) => n.id)));
});

/**
 * A barrel with no `from` forwards the binding just the same.
 *
 * `import { Card } from "./Card"; export { Card };` has no module specifier, so
 * the re-export check skipped it entirely. A consumer of the barrel resolves to
 * the barrel, its render sites are invisible, and one DIRECT render elsewhere
 * looks like the only one: fixed ids written into a declaration the barrel
 * route renders twice.
 *
 * Each row pairs one direct site with two through the barrel, which is the
 * combination that makes the count wrong rather than merely unknown.
 */
const LOCAL_BARRELS: readonly (readonly [string, string, string])[] = [
  ["plain forward", `import { Card } from "./Card";\nexport { Card };\n`, "Card"],
  ["aliased forward", `import { Card } from "./Card";\nexport { Card as Item };\n`, "Item"],
  [
    "forward under the declaration's own name from a renamed import",
    `import { Card as Local } from "./Card";\nexport { Local as Card };\n`,
    "Card",
  ],
];

// A named export ONLY. Adding `export default Card` to the declaring module
// makes every group refuse on its own, which would pass each row below
// without exercising the barrel at all -- verified by probe.
const NAMED_CARD =
  `export function Card() {\n  return (\n    <div>\n      <p>Start anywhere</p>\n` +
  `      <p>Finish anywhere</p>\n    </div>\n  );\n}\n`;

for (const [why, barrel, exported] of LOCAL_BARRELS) {
  test(`one direct render plus two through a ${why} is not named`, () => {
    const { names } = namesFor(
      write({
        "app/Card.tsx": NAMED_CARD,
        "app/barrel.ts": barrel,
        "app/page.tsx":
          `import { Card } from "./Card";\n` +
          `export default function Home() {\n  return (\n    <main>\n      <Card />\n    </main>\n  );\n}\n`,
        "app/twice/page.tsx":
          `import { ${exported} } from "../barrel";\n` +
          `export default function Twice() {\n  return (\n    <main>\n` +
          `      <${exported} />\n      <${exported} />\n    </main>\n  );\n}\n`,
      }),
    );
    assert.deepEqual(names, [], `${why}: ${JSON.stringify(names.map((n) => n.id))}`);
  });
}

/** The same component and the same single direct render, with no barrel in the
 * repository, IS named -- so the rows above refuse because of the forward. */
test("a single direct render with no barrel present is named", () => {
  const { names } = namesFor(
    write({
      "app/Card.tsx": NAMED_CARD,
      "app/page.tsx":
        `import { Card } from "./Card";\n` +
        `export default function Home() {\n  return (\n    <main>\n      <Card />\n    </main>\n  );\n}\n`,
    }),
  );
  assert.equal(names.length, 2, JSON.stringify(names.map((n) => n.id)));
});

/**
 * A module exporting its OWN declaration is not a barrel.
 *
 * `function Card() {} export { Card };` uses the same syntax a forwarding
 * barrel does, and consumers resolve to this file, which is the declaring one.
 * Treating it as untraceable would refuse every component written that way.
 */
test("a declaration exported from its own module by specifier is named", () => {
  const { names } = namesFor(
    write({
      "app/Card.tsx":
        `function Card() {\n  return (\n    <div>\n      <p>Start anywhere</p>\n` +
        `      <p>Finish anywhere</p>\n    </div>\n  );\n}\nexport { Card };\n`,
      "app/page.tsx":
        `import { Card } from "./Card";\n` +
        `export default function Home() {\n  return (\n    <main>\n      <Card />\n    </main>\n  );\n}\n`,
    }),
  );
  assert.equal(names.length, 2, JSON.stringify(names.map((n) => n.id)));
});
