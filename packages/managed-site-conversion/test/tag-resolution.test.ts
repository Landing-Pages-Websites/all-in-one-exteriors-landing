import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";

import { propose } from "../src/propose.js";

/**
 * Which component a tag renders.
 *
 * The walk answered by COMPONENT ancestry: a declaration and a tag sharing an
 * enclosing component were treated as in scope for each other, whatever blocks
 * lay between them. JavaScript answers by lexical scope, and the difference is
 * not academic — the walk entered components the page cannot reach and
 * proposed their markup as a customer's copy.
 *
 * Every row here reads the whole pipeline, because which components got walked
 * is only visible in what came out of it.
 */

function proposedText(files: Readonly<Record<string, string>>): readonly string[] {
  const root = mkdtempSync(join(tmpdir(), "managed-site-tags-"));
  for (const [relative, text] of Object.entries(files)) {
    const file = join(root, relative);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, text, "utf8");
  }
  const proposal = propose({
    repositoryRoot: root,
    configPath: null,
    ledgerPath: join(root, "idmap.json"),
  });
  const values: string[] = [];
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) {
      for (const entry of value) visit(entry);
      return;
    }
    if (value === null || typeof value !== "object") return;
    const record = value as Record<string, unknown>;
    if (typeof record["value"] === "string" && record["classification"] === undefined) {
      values.push(record["value"] as string);
    }
    for (const entry of Object.values(record)) visit(entry);
  };
  visit(proposal.contentDraft);
  return values;
}

/** Renders one distinctive string, so reaching it is visible in the output. */
const IMPORTED = `export function Inner() {
  return <p id="imported">Imported text</p>;
}
`;

const PAGE = (body: string, prelude = "") =>
  `import { Inner } from "./Inner";\ndeclare const flag: boolean;\n${prelude}` +
  `export default function Home() {\n${body}\n}\n`;

/**
 * A declaration in one block is not in scope in a sibling block. Answering by
 * component ancestry sent the sibling's tag to it, and the walk extracted
 * markup from a component nothing renders.
 */
test("a tag in a sibling block resolves to the import", () => {
  const values = proposedText({
    "app/Inner.tsx": IMPORTED,
    "app/page.tsx": PAGE(
      `  if (flag) {\n` +
        `    const Inner = () => <p id="ghost">Ghost text</p>;\n` +
        `    void Inner;\n  }\n` +
        `  return (\n    <section id="s">\n      <Inner />\n    </section>\n  );`,
    ),
  });
  assert.ok(values.includes("Imported text"), JSON.stringify(values));
  assert.ok(!values.includes("Ghost text"), JSON.stringify(values));
});

/** The same declaration, used INSIDE its own block, is what renders there. */
test("a tag inside the block that declares it resolves to that declaration", () => {
  const values = proposedText({
    "app/Inner.tsx": IMPORTED,
    "app/page.tsx": PAGE(
      `  if (flag) {\n` +
        `    const Inner = () => <p id="local">Local text</p>;\n` +
        `    return (\n      <section id="s">\n        <Inner />\n      </section>\n    );\n  }\n` +
        `  return null;`,
    ),
  });
  assert.ok(values.includes("Local text"), JSON.stringify(values));
  assert.ok(!values.includes("Imported text"), JSON.stringify(values));
});

/**
 * A `for` initializer binds to its loop. Excluding blocks but not loop
 * initializers let such a declaration pass as module scoped and answer for a
 * tag written after the loop.
 */
test("a component declared in a top-level loop initializer is not module scoped", () => {
  const values = proposedText({
    "app/Inner.tsx": IMPORTED,
    "app/page.tsx": PAGE(
      `  return (\n    <section id="s">\n      <Inner />\n    </section>\n  );`,
      `for (const Inner = () => <p id="loop">Loop text</p>; false; ) {\n  void Inner;\n}\n`,
    ),
  });
  assert.ok(values.includes("Imported text"), JSON.stringify(values));
  assert.ok(!values.includes("Loop text"), JSON.stringify(values));
});

/** A module-level declaration still shadows an import, as the language says. */
test("a module-level declaration shadows an import of the same name", () => {
  const values = proposedText({
    "app/Inner.tsx": IMPORTED,
    "app/page.tsx":
      `import { Inner } from "./Inner";\n` +
      `function Local() {\n  return <p id="module">Module text</p>;\n}\n` +
      `export default function Home() {\n  return (\n    <section id="s">\n` +
      `      <Local />\n      <Inner />\n    </section>\n  );\n}\n`,
  });
  assert.ok(values.includes("Module text"), JSON.stringify(values));
  assert.ok(values.includes("Imported text"), JSON.stringify(values));
});

/**
 * A transparent wrapper around a local component is still that component.
 * `namedFunctionsOf` looks through `as`, `satisfies` and parentheses to find
 * the function; the resolver compared against the original initializer, so the
 * two disagreed and a local tag reported unresolved.
 */
const WRAPPED: readonly (readonly [string, string])[] = [
  ["an `as` assertion", `(() => <p id="w">Wrapped text</p>) as any`],
  ["parentheses", `(() => <p id="w">Wrapped text</p>)`],
  ["a `satisfies` clause", `(() => <p id="w">Wrapped text</p>) satisfies any`],
];

for (const [description, initializer] of WRAPPED) {
  test(`resolves a local component behind ${description}`, () => {
    const values = proposedText({
      "app/page.tsx":
        `export default function Home() {\n  const Local = ${initializer};\n` +
        `  return (\n    <section id="s">\n      <Local />\n    </section>\n  );\n}\n`,
    });
    assert.ok(values.includes("Wrapped text"), JSON.stringify(values));
  });
}

/** A component nested inside another still renders where it is in scope. */
test("a component nested in the component that renders it still resolves", () => {
  const values = proposedText({
    "app/page.tsx":
      `export default function Home() {\n` +
      `  const Local = () => <p id="n">Nested text</p>;\n` +
      `  return (\n    <section id="s">\n      <Local />\n    </section>\n  );\n}\n`,
  });
  assert.ok(values.includes("Nested text"), JSON.stringify(values));
});

/**
 * Two occurrences of one tag name can bind to DIFFERENT declarations, because
 * resolution depends on where the tag is written. Keeping only the first
 * occurrence of each name was harmless while resolution was by name alone; it
 * is not once the use site decides, because whichever occurrence was seen
 * first then answers for both and the other component is never walked.
 */
test("two tags of one name in different scopes resolve separately", () => {
  // Both declarations live in ONE file: two components sharing a name across
  // FILES is a different refusal (`DUPLICATE_COMPONENT_NAME`), and a fixture
  // that tripped it would prove nothing about resolution.
  const values = proposedText({
    "app/page.tsx":
      `declare const flag: boolean;\n` +
      `function Inner() {\n  return <p id="outer">Outer text</p>;\n}\n` +
      `export default function Home() {\n` +
      `  if (flag) {\n` +
      `    const Inner = () => <p id="shadow">Shadow text</p>;\n` +
      `    return (\n      <section id="a">\n        <Inner />\n      </section>\n    );\n  }\n` +
      `  return (\n    <section id="b">\n      <Inner />\n    </section>\n  );\n}\n`,
  });
  assert.ok(values.includes("Shadow text"), JSON.stringify(values));
  assert.ok(values.includes("Outer text"), JSON.stringify(values));
});

/**
 * `var` is function-scoped, not block-scoped. Both of these follow from that
 * one fact, and both were wrong in opposite directions: a hoisted name
 * resolved to its enclosing FUNCTION rather than to the declaration, and a
 * top-level `var` in a block was excluded from module scope although the
 * language keeps it there.
 */
test("a `var` component declared in a block is in scope after it", () => {
  const values = proposedText({
    "app/page.tsx":
      `declare const flag: boolean;\n` +
      `export default function Home() {\n` +
      `  if (flag) {\n    var Inner = () => <p id="v">Var text</p>;\n  }\n` +
      `  return (\n    <section id="s">\n      <Inner />\n    </section>\n  );\n}\n`,
  });
  assert.ok(values.includes("Var text"), JSON.stringify(values));
});

test("a module-level `var` inside a top-level block is module scoped", () => {
  const values = proposedText({
    "app/page.tsx":
      `declare const flag: boolean;\n` +
      `if (flag) {\n  var Inner = () => <p id="mv">Module var text</p>;\n}\n` +
      `export default function Home() {\n  return (\n    <section id="s">\n` +
      `      <Inner />\n    </section>\n  );\n}\n`,
  });
  assert.ok(values.includes("Module var text"), JSON.stringify(values));
});

/** A `let` in a block is NOT in scope after it, which is the other half. */
test("a `let` component declared in a block is not in scope after it", () => {
  const values = proposedText({
    "app/Inner.tsx": IMPORTED,
    "app/page.tsx":
      `import { Inner } from "./Inner";\ndeclare const flag: boolean;\n` +
      `export default function Home() {\n` +
      `  if (flag) {\n    let Inner = () => <p id="l">Let text</p>;\n    void Inner;\n  }\n` +
      `  return (\n    <section id="s">\n      <Inner />\n    </section>\n  );\n}\n`,
  });
  assert.ok(values.includes("Imported text"), JSON.stringify(values));
  assert.ok(!values.includes("Let text"), JSON.stringify(values));
});

/**
 * Three shapes, one root: a helper enumerating a subset of the language while
 * another reader enumerates a different subset. Every row here is a construct
 * one list had and another did not.
 */

/** `componentDeclaredBy` unwraps wrappers recursively; the binding site read
 * one level, so a doubly-wrapped module-level component became unreachable. */
test("a module-level component behind several wrappers still resolves", () => {
  const values = proposedText({
    "app/page.tsx":
      `const Local = (((() => <p id="w">Wrapped text</p>))) as any;\n` +
      `export default function Home() {\n  return (\n    <section id="s">\n` +
      `      <Local />\n    </section>\n  );\n}\n`,
  });
  assert.ok(values.includes("Wrapped text"), JSON.stringify(values));
});

/**
 * A constructor, a getter and a setter are function bodies too. One list had
 * them and another did not, so a component declared in one could be treated as
 * module scoped and answer for a tag that cannot see it.
 */
const CLASS_BODIES: readonly (readonly [string, string])[] = [
  ["a constructor", `constructor() {\n    var Hidden = () => <p id="c">Hidden text</p>;\n    void Hidden;\n  }`],
  ["a getter", `get thing() {\n    var Hidden = () => <p id="g">Hidden text</p>;\n    void Hidden;\n    return 1;\n  }`],
  ["a setter", `set thing(_v: number) {\n    var Hidden = () => <p id="s2">Hidden text</p>;\n    void Hidden;\n  }`],
];

for (const [description, member] of CLASS_BODIES) {
  test(`a component declared in ${description} is not module scoped`, () => {
    const values = proposedText({
      "app/Inner.tsx": IMPORTED,
      "app/page.tsx":
        `import { Inner } from "./Inner";\n` +
        `class Holder {\n  ${member}\n}\nvoid Holder;\n` +
        `export default function Home() {\n  return (\n    <section id="s">\n` +
        `      <Hidden />\n      <Inner />\n    </section>\n  );\n}\n`,
    });
    assert.ok(values.includes("Imported text"), JSON.stringify(values));
    assert.ok(!values.includes("Hidden text"), JSON.stringify(values));
  });
}

/**
 * A `var` can be written in a loop initializer as readily as in a statement,
 * and it is function-scoped either way. Searching only `VariableStatement`
 * left the loop spelling unresolved after the loop.
 */
const VAR_IN_LOOP: readonly (readonly [string, string])[] = [
  ["a `for` initializer", `for (var Inner = () => <p id="f">Loop var text</p>; false; ) {\n    void Inner;\n  }`],
];

for (const [description, loop] of VAR_IN_LOOP) {
  test(`a \`var\` component declared in ${description} is in scope after it`, () => {
    const values = proposedText({
      "app/page.tsx":
        `export default function Home() {\n  ${loop}\n` +
        `  return (\n    <section id="s">\n      <Inner />\n    </section>\n  );\n}\n`,
    });
    assert.ok(values.includes("Loop var text"), JSON.stringify(values));
  });
}

/**
 * A function declaration is block-scoped, because an ES module is strict.
 *
 * `var` hoists out of a block; a function declaration written inside one does
 * not, and treating them alike let a declaration in a top-level `if` answer for
 * a tag outside it — the walk then extracted markup nothing renders.
 */
const BLOCK_FUNCTIONS: readonly (readonly [string, string])[] = [
  ["a top-level `if` block", `if (flag) {\n  function Inner() { return <p id="g">Ghost text</p>; }\n  void Inner;\n}`],
  ["a `switch` case", `switch (Number(flag)) {\n  case 1: {\n    function Inner() { return <p id="c">Ghost text</p>; }\n    void Inner;\n  }\n}`],
  ["a nested block inside a function", `function Holder() {\n  {\n    function Inner() { return <p id="n">Ghost text</p>; }\n    void Inner;\n  }\n}\nvoid Holder;`],
];

for (const [description, prelude] of BLOCK_FUNCTIONS) {
  test(`a function declared in ${description} is not module scoped`, () => {
    const values = proposedText({
      "app/Inner.tsx": IMPORTED,
      "app/page.tsx": PAGE(
        `  return (\n    <section id="s">\n      <Inner />\n    </section>\n  );`,
        `${prelude}\n`,
      ),
    });
    assert.ok(values.includes("Imported text"), JSON.stringify(values));
    assert.ok(!values.includes("Ghost text"), JSON.stringify(values));
  });
}

/** Written directly at module level, it is module scoped and shadows the import. */
test("a function declared at module level shadows the import", () => {
  const values = proposedText({
    "app/Inner.tsx": IMPORTED,
    "app/page.tsx": PAGE(
      `  return (\n    <section id="s">\n      <Inner />\n    </section>\n  );`,
      `function Inner() { return <p id="m">Module text</p>; }\n`,
    ),
  });
  assert.ok(values.includes("Module text"), JSON.stringify(values));
  assert.ok(!values.includes("Imported text"), JSON.stringify(values));
});

/** A `var` in the same top-level block still hoists, which is the contrast. */
test("a `var` in a top-level block still reaches module scope", () => {
  const values = proposedText({
    "app/page.tsx": PAGE(
      `  return (\n    <section id="s">\n      <Inner />\n    </section>\n  );`,
      `if (flag) {\n  var Inner = () => <p id="v">Var text</p>;\n}\n`,
    ),
  });
  assert.ok(values.includes("Var text"), JSON.stringify(values));
});

/**
 * A `switch` has ONE lexical scope shared by every unbraced clause, not one
 * per clause. Treating each clause as a boundary lost a binding that falls
 * through to the clause using it.
 */
test("a binding in one switch clause is in scope in the next", () => {
  const values = proposedText({
    "app/page.tsx":
      `declare const which: string;\n` +
      `export default function Home() {\n  switch (which) {\n` +
      `    case "shown":\n      const Inner = () => <p id="sw">Switch text</p>;\n` +
      `    default:\n      return (\n        <section id="s">\n          <Inner />\n        </section>\n      );\n` +
      `  }\n}\n`,
  });
  assert.ok(values.includes("Switch text"), JSON.stringify(values));
});

/** A BRACED clause is its own scope, which is the other half of the rule. */
test("a binding braced inside one switch clause does not escape it", () => {
  const values = proposedText({
    "app/Inner.tsx": IMPORTED,
    "app/page.tsx":
      `import { Inner } from "./Inner";\ndeclare const which: string;\n` +
      `export default function Home() {\n  switch (which) {\n` +
      `    case "shown": {\n      const Inner = () => <p id="br">Braced text</p>;\n      void Inner;\n      break;\n    }\n` +
      `    default:\n      break;\n  }\n` +
      `  return (\n    <section id="s">\n      <Inner />\n    </section>\n  );\n}\n`,
  });
  assert.ok(values.includes("Imported text"), JSON.stringify(values));
  assert.ok(!values.includes("Braced text"), JSON.stringify(values));
});
