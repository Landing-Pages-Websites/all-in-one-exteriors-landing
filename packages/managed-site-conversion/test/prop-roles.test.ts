import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import ts from "typescript";

import { findComponentDeclarations } from "../src/extract.js";
import { propReadingOf, type PropRole } from "../src/prop-roles.js";
import { resolveTagAt, tagResolver } from "../src/reachability.js";
import { ModuleCache } from "../src/scan.js";

/**
 * The claim under test: what a prop IS can be read from what the receiving
 * component does with it. `title` is copy on one component and a tooltip on
 * another, so the name decides nothing and the body decides everything.
 *
 * The refusals matter more than the classifications. Reading a prop as content
 * when it is not puts a code value in front of a customer to edit; reading it
 * as code when it is copy hides the copy. Anything the source does not settle
 * must return null and go back to a human.
 */

function roleOf(
  files: Readonly<Record<string, string>>,
  component: string,
  prop: string,
  reactMajor = 19,
): PropRole | null {
  const root = mkdtempSync(join(tmpdir(), "managed-site-prop-roles-"));
  for (const [relative, text] of Object.entries(files)) {
    const file = join(root, relative);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, text, "utf8");
  }
  const cache = new ModuleCache();
  const resolver = tagResolver(root, cache);
  for (const relative of Object.keys(files)) {
    if (!relative.endsWith(".tsx")) continue;
    for (const declaration of findComponentDeclarations(cache.read(join(root, relative)))) {
      if (declaration.name !== component) continue;
      return (
        propReadingOf(declaration, prop, {
          resolver,
          refReachesComponents: reactMajor >= 19,
        })?.role ?? null
      );
    }
  }
  assert.fail(`component ${component} was not found`);
}

function only(body: string, signature = "{ value }: { value?: string }"): string {
  return `export function Target(${signature}) {\n  return ${body};\n}\n`;
}

/** [description, files, prop, expected role] */
const CASES: readonly (readonly [string, Readonly<Record<string, string>>, string, PropRole])[] = [
  [
    "a prop rendered as a child is content",
    { "Target.tsx": only("<p>{value}</p>") },
    "value",
    "content",
  ],
  [
    "a prop rendered inside a template literal is content",
    { "Target.tsx": only("<p>{`${value} today`}</p>") },
    "value",
    "content",
  ],
  [
    "a prop rendered in a conditional BRANCH is content",
    { "Target.tsx": only(`<p>{value ? value : "none"}</p>`) },
    "value",
    "content",
  ],
  [
    "a prop renamed while destructuring is still followed",
    {
      "Target.tsx": `export function Target({ value: heading }: { value?: string }) {\n  return <h2>{heading}</h2>;\n}\n`,
    },
    "value",
    "content",
  ],
  [
    "a prop read off a whole-props parameter is followed",
    {
      "Target.tsx": `export function Target(props: { value?: string }) {\n  return <p>{props.value}</p>;\n}\n`,
    },
    "value",
    "content",
  ],
  [
    "a prop reaching aria-label is an accessibility interface",
    { "Target.tsx": only("<p aria-label={value}>x</p>") },
    "value",
    "accessibility",
  ],
  [
    "a prop reaching alt is an accessibility interface",
    { "Target.tsx": only(`<img src="/a.png" alt={value} />`) },
    "value",
    "accessibility",
  ],
  [
    "a HOST element's alt keeps its fixed meaning",
    { "Target.tsx": only(`<img src="/a.png" alt={value} />`) },
    "value",
    "accessibility",
  ],
  [
    "a prop passed through a helper into a className is still code",
    {
      "Target.tsx":
        `import { cn } from "./cn";\n` +
        `export function Target({ value }: { value?: string }) {\n` +
        `  return <p className={cn("base", value)}>x</p>;\n}\n`,
      "cn.ts": `export function cn(...parts: (string | undefined)[]) { return parts.join(" "); }`,
    },
    "value",
    "code",
  ],
  [
    "a prop reaching className is code",
    { "Target.tsx": only("<p className={value}>x</p>") },
    "value",
    "code",
  ],
  [
    "a prop COMPARED to decide a class is code",
    {
      "Target.tsx": only(`<p className={value === "invert" ? "a" : "b"}>x</p>`),
    },
    "value",
    "code",
  ],
  [
    "a prop that is negated is code",
    { "Target.tsx": only("<p>{!value && <span>x</span>}</p>") },
    "value",
    "code",
  ],
  [
    "a prop gating an element with && is code, not the element's content",
    { "Target.tsx": only("<div>{value && <span>x</span>}</div>") },
    "value",
    "code",
  ],
  [
    "a prop aliased to a local and used as the tag is code",
    {
      "Target.tsx":
        `export function Target({ value }: { value?: string }) {\n` +
        `  const Tag = value;\n` +
        `  return <Tag>x</Tag>;\n}\n`,
    },
    "value",
    "code",
  ],
  [
    "a prop the component never reads is code, because it renders nothing",
    {
      "Target.tsx": `export function Target({ value }: { value?: string }) {\n  return <p>fixed</p>;\n}\n`,
    },
    "value",
    "code",
  ],
  [
    "a prop the component does not declare at all is code",
    {
      "Target.tsx": `export function Target({ other }: { other?: string }) {\n  return <p>{other}</p>;\n}\n`,
    },
    "value",
    "code",
  ],
  [
    "a prop passed to another component's content prop is content",
    {
      "Inner.tsx": `export function Inner({ label }: { label?: string }) {\n  return <p>{label}</p>;\n}\n`,
      "Target.tsx":
        `import { Inner } from "./Inner";\n` +
        `export function Target({ value }: { value?: string }) {\n` +
        `  return <Inner label={value} />;\n}\n`,
    },
    "value",
    "content",
  ],
  [
    "a prop passed through an array into a mapped render is content",
    {
      "Inner.tsx":
        `export function Inner({ lines }: { lines: string[] }) {\n` +
        `  return <p>{lines.map((line) => <span key={line}>{line}</span>)}</p>;\n}\n`,
      "Target.tsx":
        `import { Inner } from "./Inner";\n` +
        `export function Target({ value }: { value?: string }) {\n` +
        `  return <Inner lines={[value]} />;\n}\n`,
    },
    "value",
    "content",
  ],
  [
    "a JSX child handed to a component that never renders children is not copy",
    {
      "Sink.tsx": `export function Sink({ children }: { children?: unknown }) {\n  return <p>fixed</p>;\n}\n`,
      "Target.tsx":
        `import { Sink } from "./Sink";\n` +
        `export function Target({ value }: { value?: string }) {\n` +
        `  return <Sink>{value}</Sink>;\n}\n`,
    },
    "value",
    "code",
  ],
  [
    "a value rendered only inside a script element is not prose",
    {
      "Target.tsx":
        `export function Target({ value }: { value?: string }) {\n` +
        `  return <script>{value}</script>;\n}\n`,
    },
    "value",
    "code",
  ],
  [
    "a value rendered only inside a style element is not prose",
    {
      "Target.tsx":
        `export function Target({ value }: { value?: string }) {\n` +
        `  return <style>{value}</style>;\n}\n`,
    },
    "value",
    "code",
  ],
  [
    "a JSX child handed to a component that DOES render children is content",
    {
      "Shell.tsx": `export function Shell({ children }: { children?: unknown }) {\n  return <div>{children}</div>;\n}\n`,
      "Target.tsx":
        `import { Shell } from "./Shell";\n` +
        `export function Target({ value }: { value?: string }) {\n` +
        `  return <Shell>{value}</Shell>;\n}\n`,
    },
    "value",
    "content",
  ],
  [
    "a component free to render className as visible copy is asked, not skipped",
    {
      "Inner.tsx": `export function Inner({ className }: { className?: string }) {\n  return <p>{className}</p>;\n}\n`,
      "Target.tsx":
        `import { Inner } from "./Inner";\n` +
        `export function Target({ value }: { value?: string }) {\n` +
        `  return <Inner className={value} />;\n}\n`,
    },
    "value",
    "content",
  ],
  [
    "a prop passed to another component's accessibility prop stays accessibility",
    {
      "Inner.tsx": `export function Inner({ label }: { label?: string }) {\n  return <p aria-label={label}>x</p>;\n}\n`,
      "Target.tsx":
        `import { Inner } from "./Inner";\n` +
        `export function Target({ value }: { value?: string }) {\n` +
        `  return <Inner label={value} />;\n}\n`,
    },
    "value",
    "accessibility",
  ],
  [
    "a whole-props component reading a DIFFERENT property leaves this one unread",
    {
      "Target.tsx": `export function Target(props: { label?: string; value?: string }) {\n  return <p>{props.label}</p>;\n}\n`,
    },
    "value",
    "code",
  ],
  [
    "a whole-props component reading THIS property is still followed",
    {
      "Target.tsx": `export function Target(props: { value?: string }) {\n  return <p>{props.value}</p>;\n}\n`,
    },
    "value",
    "content",
  ],
  [
    "a component free to render `alt` as visible copy is asked, not assumed",
    {
      "Inner.tsx": `export function Inner({ alt }: { alt?: string }) {\n  return <p>{alt}</p>;\n}\n`,
      "Target.tsx":
        `import { Inner } from "./Inner";\n` +
        `export function Target({ value }: { value?: string }) {\n` +
        `  return <Inner alt={value} />;\n}\n`,
    },
    "value",
    "content",
  ],
  [
    "a component free to render `aria-label` as visible copy is asked too",
    {
      "Inner.tsx": `export function Inner(props: { "aria-label"?: string }) {\n  return <p>{props["aria-label"]}</p>;\n}\n`,
      "Target.tsx":
        `import { Inner } from "./Inner";\n` +
        `export function Target({ value }: { value?: string }) {\n` +
        `  return <Inner aria-label={value} />;\n}\n`,
    },
    "value",
    "content",
  ],
  [
    "a prop shown whenever present, behind a `||` fallback, is content",
    { "Target.tsx": only(`<p>{value || "Untitled"}</p>`) },
    "value",
    "content",
  ],
  [
    "a prop shown whenever present, behind a `??` fallback, is content",
    { "Target.tsx": only(`<p>{value ?? "Untitled"}</p>`) },
    "value",
    "content",
  ],
  [
    "the RIGHT side of a fallback is still the value",
    {
      "Target.tsx":
        `export function Target({ value, other }: { value?: string; other?: string }) {\n` +
        `  return <p>{other ?? value}</p>;\n}\n`,
    },
    "value",
    "content",
  ],
  [
    "a nested function declaration's parameter is not a reading of the prop",
    {
      "Target.tsx":
        `export function Target({ value }: { value?: string }) {\n` +
        `  function render(value: string) { return <p>{value}</p>; }\n` +
        `  return <>{render("x")}</>;\n}\n`,
    },
    "value",
    "code",
  ],
  [
    "a nested function declaration's own name does not shadow a different prop",
    {
      "Target.tsx":
        `export function Target({ value }: { value?: string }) {\n` +
        `  function render(line: string) { return <b>{line}</b>; }\n` +
        `  return <p>{render("x")}{value}</p>;\n}\n`,
    },
    "value",
    "content",
  ],
  [
    "a host handler's return is discarded, so JSX inside it renders nothing",
    {
      "Target.tsx":
        `export function Target({ value }: { value?: string }) {\n` +
        `  return <button onClick={() => <p>{value}</p>} />;\n}\n`,
    },
    "value",
    "code",
  ],
  [
    "a function whose result lands in rendered output still counts",
    {
      "Target.tsx":
        `export function Target({ value }: { value?: string }) {\n` +
        `  return <div>{(() => <p>{value}</p>)()}</div>;\n}\n`,
    },
    "value",
    "content",
  ],
  [
    "every reading agreeing on content is content",
    { "Target.tsx": only("<div><p>{value}</p><span>{value}</span></div>") },
    "value",
    "content",
  ],
];

/** [description, files, prop] — each must refuse. */
const REFUSALS: readonly (readonly [string, Readonly<Record<string, string>>, string])[] = [
  [
    "a component that spreads the rest of its props, which may carry this one onward",
    {
      "Target.tsx":
        `export function Target({ value, ...rest }: { value?: string }) {\n` +
        `  return <p {...rest}>{value}</p>;\n}\n`,
    },
    "value",
  ],
  [
    "a prop whose readings disagree — shown once, tested once",
    {
      "Target.tsx": only(`<div><p>{value}</p><span className={value}>x</span></div>`),
    },
    "value",
  ],
  [
    "a prop handed to a call whose result is SHOWN, since it may be a key rather than the text",
    {
      "Target.tsx":
        `import { format } from "./util";\n` +
        `export function Target({ value }: { value?: string }) {\n` +
        `  return <p>{format(value)}</p>;\n}\n`,
      "util.ts": `export function format(x?: string) { return x ?? ""; }`,
    },
    "value",
  ],
  [
    "a prop handed to a call whose result is SHOWN through an alt attribute",
    {
      "Target.tsx":
        `import { format } from "./util";\n` +
        `export function Target({ value }: { value?: string }) {\n` +
        `  return <img src="/a.png" alt={format(value)} />;\n}\n`,
      "util.ts": `export function format(x?: string) { return x ?? ""; }`,
    },
    "value",
  ],
  [
    "a prop passed to a component declared outside this repository",
    {
      "Target.tsx":
        `import { Widget } from "some-package";\n` +
        `export function Target({ value }: { value?: string }) {\n` +
        `  return <Widget label={value} />;\n}\n`,
    },
    "value",
  ],
  [
    "a prop passed to a component whose own prop refuses",
    {
      "Inner.tsx":
        `import { format } from "./util";\n` +
        `export function Inner({ label }: { label?: string }) {\n` +
        `  return <p>{format(label)}</p>;\n}\n`,
      "util.ts": `export function format(x?: string) { return x ?? ""; }`,
      "Target.tsx":
        `import { Inner } from "./Inner";\n` +
        `export function Target({ value }: { value?: string }) {\n` +
        `  return <Inner label={value} />;\n}\n`,
    },
    "value",
  ],
  [
    "a prop landing on a host attribute nothing classifies",
    { "Target.tsx": only("<p data-thing={value}>x</p>") },
    "value",
  ],
  [
    "a component taking two parameters, which is not the shape props arrive in",
    {
      "Target.tsx":
        `export function Target({ value }: { value?: string }, extra: string) {\n` +
        `  return <p>{value}{extra}</p>;\n}\n`,
    },
    "value",
  ],
  [
    "a prop destructured into a nested pattern, whose parts this does not track",
    {
      "Target.tsx":
        `export function Target({ value: { inner } }: { value: { inner: string } }) {\n` +
        `  return <p>{inner}</p>;\n}\n`,
    },
    "value",
  ],
  [
    "a callback handed to a component, which only that component's body could settle",
    {
      "Inner.tsx": `export function Inner({ render }: { render: () => unknown }) {\n  return <div>{String(render)}</div>;\n}\n`,
      "Target.tsx":
        `import { Inner } from "./Inner";\n` +
        `export function Target({ value }: { value?: string }) {\n` +
        `  return <Inner render={() => <p>{value}</p>} />;\n}\n`,
    },
    "value",
  ],
  [
    "a receiver that forwards its whole props onward, which the child may use as behaviour",
    {
      "Child.tsx": `export function Child({ title }: { title?: string }) {\n  return <p className={title}>x</p>;\n}\n`,
      "Target.tsx":
        `import { Child } from "./Child";\n` +
        `export function Target(props: { value?: string }) {\n` +
        `  return <div>{props.value}<Child {...props} /></div>;\n}\n`,
    },
    "value",
  ],
  [
    "a receiver that forwards its props through an alias",
    {
      "Child.tsx": `export function Child({ value }: { value?: string }) {\n  return <p className={value}>x</p>;\n}\n`,
      "Target.tsx":
        `import { Child } from "./Child";\n` +
        `export function Target(props: { value?: string }) {\n` +
        `  const forwarded = props;\n` +
        `  return <><p>{props.value}</p><Child {...forwarded} /></>;\n}\n`,
    },
    "value",
  ],
  [
    "a receiver that forwards its props through a chain of aliases",
    {
      "Child.tsx": `export function Child({ value }: { value?: string }) {\n  return <p className={value}>x</p>;\n}\n`,
      "Target.tsx":
        `import { Child } from "./Child";\n` +
        `export function Target(props: { value?: string }) {\n` +
        `  const a = props;\n  const b = a;\n` +
        `  return <><p>{props.value}</p><Child {...b} /></>;\n}\n`,
    },
    "value",
  ],
  [
    "a map whose callback is not written inline",
    {
      "Inner.tsx":
        `const render = (line: string) => <span>{line}</span>;\n` +
        `export function Inner({ lines }: { lines: string[] }) {\n` +
        `  return <p>{lines.map(render)}</p>;\n}\n`,
      "Target.tsx":
        `import { Inner } from "./Inner";\n` +
        `export function Target({ value }: { value?: string }) {\n` +
        `  return <Inner lines={[value]} />;\n}\n`,
    },
    "value",
  ],
];

/**
 * A reference is a place the value is USED. Every other appearance of the name
 * is a mention, and counting one makes the readings disagree with themselves:
 * a host attribute NAMED `title` is undecidable, so a component that renders
 * `{title}` as text and also writes `title="tooltip"` on a host element read as
 * a conflict and refused the field it should have proposed.
 *
 * The exclusions are not a list here — `scopes.js` already owns that predicate
 * for the escape analysis, and this asks the same one.
 */
const MENTIONS: readonly (readonly [string, string])[] = [
  ["a host attribute of the same name", `<article title="tooltip"><h2>{title}</h2></article>`],
  ["a property key of the same name", `<h2>{JSON.stringify({ title: 1 }) ? title : title}</h2>`],
  ["a property read of the same name", `<h2>{({ title: "x" }).title ? title : title}</h2>`],
];

for (const [description, body] of MENTIONS) {
  test(`does not count ${description} as a read`, () => {
    const role = roleOf(
      {
        "Target.tsx":
          `export function Target({ title }: { title?: string }) {\n  return ${body};\n}\n`,
      },
      "Target",
      "title",
    );
    assert.equal(role, "content");
  });
}

/**
 * A whole-props parameter can be read through a binding it creates. Treating
 * those as zero references answered `code` — "this prop renders nothing" — for
 * a prop the component visibly renders, which hides a customer's copy rather
 * than reporting it.
 */
const INDIRECT_READS: readonly (readonly [string, string, PropRole | null])[] = [
  ["a destructured local", `const { value } = props;\n  return <p>{value}</p>;`, "content"],
  ["a renamed destructured local", `const { value: shown } = props;\n  return <p>{shown}</p>;`, "content"],
  ["an alias of the props object", `const alias = props;\n  return <p>{alias.value}</p>;`, "content"],
  ["a destructure off an alias", `const alias = props;\n  const { value } = alias;\n  return <p>{value}</p>;`, "content"],
  ["a destructured local used as a class name", `const { value } = props;\n  return <p className={value} />;`, "code"],
];

for (const [description, body, expected] of INDIRECT_READS) {
  test(`follows a prop read through ${description}`, () => {
    const role = roleOf(
      { "Target.tsx": `export function Target(props: { value?: string }) {\n  ${body}\n}\n` },
      "Target",
      "value",
    );
    assert.equal(role, expected);
  });
}

/**
 * A rest element binds keys this reader cannot name, so it cannot follow what
 * they carry. `const { known, ...rest } = props` then `<Child {...rest} />`
 * hands `value` to a child that may use it as behaviour, while the local
 * `{props.value}` still reads as text.
 */
test("refuses a prop whose object is destructured with a rest element", () => {
  const role = roleOf(
    {
      "Child.tsx": `export function Child({ value }: { value?: string }) {\n  return <i data-x={value} />;\n}\n`,
      "Target.tsx":
        `import { Child } from "./Child";\n` +
        `export function Target(props: { known?: string; value?: string }) {\n` +
        `  const { known, ...rest } = props;\n` +
        `  return <div>{props.value}{known}<Child {...rest} /></div>;\n}\n`,
    },
    "Target",
    "value",
  );
  assert.equal(role, null);
});

/**
 * The receiver side of the same React fact. A `ref` React consumes never
 * reaches the component, so what that component does with a prop of that name
 * says nothing about the value written here — and asking it anyway would let a
 * component that renders `{ref}` turn an inert handle into "content".
 */
const REF_BY_REACT: readonly (readonly [string, number, PropRole | null])[] = [
  ["React 19 asks the receiver", 19, "content"],
  ["React 18 does not, because the value never arrives", 18, "code"],
];

for (const [description, major, expected] of REF_BY_REACT) {
  test(`a prop forwarded as a component ref: ${description}`, () => {
    const role = roleOf(
      {
        "Inner.tsx": `export function Inner({ ref }: { ref?: string }) {\n  return <p>{ref}</p>;\n}\n`,
        "Target.tsx":
          `import { Inner } from "./Inner";\n` +
          `export function Target({ value }: { value?: string }) {\n  return <Inner ref={value} />;\n}\n`,
      },
      "Target",
      "value",
      major,
    );
    assert.equal(role, expected);
  });
}

/** A `ref` on a HOST element is a handle at every React version. */
test("a prop forwarded as a host ref is code", () => {
  const role = roleOf(
    {
      "Target.tsx":
        `export function Target({ value }: { value?: string }) {\n  return <p ref={value} />;\n}\n`,
    },
    "Target",
    "value",
  );
  assert.equal(role, "code");
});

/**
 * Which declaration a tag names is a LEXICAL question, and the two heuristics
 * standing in for it were wrong in opposite directions.
 *
 * "Any binding means unresolvable" rejected a local component this reader can
 * read perfectly well. "The name matches mine means recursion" accepted a
 * parameter that shadows the component's own name. The rule that answers both:
 * a tag resolves to the declaration its NEAREST binding names, and to nothing
 * when that binding is not a component in this repository.
 */
const TAG_BINDINGS: readonly (readonly [string, string, PropRole | null])[] = [
  [
    "a component declared in the enclosing scope",
    `const Inner = ({ label }: { label?: string }) => <p>{label}</p>;\n` +
      `  return <Inner label={value} />;`,
    "content",
  ],
  [
    "a function component declared in the enclosing scope",
    `function Inner({ label }: { label?: string }) { return <p>{label}</p>; }\n` +
      `  return <Inner label={value} />;`,
    "content",
  ],
  [
    "a local that is not a component this reader can read",
    `const Inner = makeInner();\n  return <Inner label={value} />;`,
    null,
  ],
];

for (const [description, body, expected] of TAG_BINDINGS) {
  test(`resolves a tag to ${description}`, () => {
    const role = roleOf(
      {
        "Target.tsx":
          `declare function makeInner(): (p: { label?: string }) => JSX.Element;\n` +
          `export function Target({ value }: { value?: string }) {\n  ${body}\n}\n`,
      },
      "Target",
      "value",
    );
    assert.equal(role, expected);
  });
}

/**
 * A parameter that shares the component's own name shadows it, so the JSX
 * renders the PARAMETER. Exempting the own name from the shadowing check made
 * the reader describe a prop of a component the page never renders.
 */
test("refuses a tag a same-name parameter shadows, even the component's own", () => {
  const role = roleOf(
    {
      "Target.tsx":
        `export const Target = ({ Target, title }: { Target?: unknown; title?: string }) => (\n` +
        `  <><p>{title}</p><Target title={title} /></>\n);\n`,
    },
    "Target",
    "title",
  );
  assert.equal(role, null);
});

/**
 * A value read through a key this reader cannot name is a value it cannot
 * follow. `alias[key]` hands out an unknown property, so the object has
 * escaped — even though a direct `props.value` read still looks like text.
 */
const UNKNOWN_KEYS: readonly (readonly [string, string])[] = [
  ["a computed element access", `const key = pick();\n  const forwarded = props[key];\n  return <div>{props.value}<Child value={forwarded} /></div>;`],
  ["an optional computed access", `const key = pick();\n  const forwarded = props?.[key];\n  return <div>{props.value}<Child value={forwarded} /></div>;`],
  ["a numeric index", `const forwarded = props[0];\n  return <div>{props.value}<Child value={forwarded} /></div>;`],
];

for (const [description, body] of UNKNOWN_KEYS) {
  test(`refuses a prop whose object is read through ${description}`, () => {
    const role = roleOf(
      {
        "Child.tsx": `export function Child({ value }: { value?: string }) {\n  return <i data-x={value} />;\n}\n`,
        "Target.tsx":
          `import { Child } from "./Child";\n` +
          `declare function pick(): string;\n` +
          `export function Target(props: { value?: string }) {\n  ${body}\n}\n`,
      },
      "Target",
      "value",
    );
    assert.equal(role, null);
  });
}

/** A string-literal key IS a named read, and stays one. */
test("reads a prop through a string-literal element access", () => {
  const role = roleOf(
    {
      "Target.tsx":
        `export function Target(props: { value?: string }) {\n  return <p>{props["value"]}</p>;\n}\n`,
    },
    "Target",
    "value",
  );
  assert.equal(role, "content");
});

/**
 * A spread AFTER an attribute may replace it, so what the receiver actually
 * gets is not decided here. The caller side has refused this since it was
 * written; the receiver side classified from the attribute anyway.
 */
const LATER_SPREAD: readonly (readonly [string, string])[] = [
  ["a component attribute", `<Child label={value} {...rest} />`],
  ["a host attribute", `<p className={value} {...rest} />`],
];

for (const [description, body] of LATER_SPREAD) {
  test(`refuses a value a later spread may replace on ${description}`, () => {
    const role = roleOf(
      {
        "Child.tsx": `export function Child({ label }: { label?: string }) {\n  return <p>{label}</p>;\n}\n`,
        "Target.tsx":
          `import { Child } from "./Child";\n` +
          `declare const rest: Record<string, unknown>;\n` +
          `export function Target({ value }: { value?: string }) {\n  return ${body};\n}\n`,
      },
      "Target",
      "value",
    );
    assert.equal(role, null);
  });
}

/** A spread BEFORE the attribute cannot replace it, so the reading stands. */
test("reads a value a spread before it cannot replace", () => {
  const role = roleOf(
    {
      "Child.tsx": `export function Child({ label }: { label?: string }) {\n  return <p>{label}</p>;\n}\n`,
      "Target.tsx":
        `import { Child } from "./Child";\n` +
        `declare const rest: Record<string, unknown>;\n` +
        `export function Target({ value }: { value?: string }) {\n` +
        `  return <Child {...rest} label={value} />;\n}\n`,
    },
    "Target",
    "value",
  );
  assert.equal(role, "content");
});

/**
 * A prop name that is not a valid identifier can only be written as a string
 * literal, and this reader already knew that on one side: `props["aria-label"]`
 * has always been a read. The destructuring side rejected the same name, so
 * `aria-label` — the commonest such prop there is — came back undecidable from
 * a component that plainly renders it.
 */
const QUOTED_PROPS: readonly (readonly [string, string])[] = [
  ["a quoted parameter destructuring", `export function Target({ "aria-label": label }: Record<string, string>) {\n  return <p>{label}</p>;\n}\n`],
  ["a quoted body destructuring", `export function Target(props: Record<string, string>) {\n  const { "aria-label": label } = props;\n  return <p>{label}</p>;\n}\n`],
  ["a quoted read", `export function Target(props: Record<string, string>) {\n  return <p>{props["aria-label"]}</p>;\n}\n`],
];

for (const [description, source] of QUOTED_PROPS) {
  test(`reads a prop named through ${description}`, () => {
    assert.equal(roleOf({ "Target.tsx": source }, "Target", "aria-label"), "content");
  });
}

/**
 * A COMPUTED key is the one spelling that names nothing here. It is the reason
 * the check exists at all, so it is asserted rather than left to the type.
 */
test("refuses a prop destructured under a computed key", () => {
  const role = roleOf(
    {
      "Target.tsx":
        `declare const key: string;\n` +
        `export function Target({ [key]: label }: Record<string, string>) {\n` +
        `  return <p>{label}</p>;\n}\n`,
    },
    "Target",
    "aria-label",
  );
  assert.equal(role, null);
});

/** The same name still classifies rather than merely resolving. */
test("a quoted prop landing in a class name is code", () => {
  const role = roleOf(
    {
      "Target.tsx":
        `export function Target({ "data-tone": tone }: Record<string, string>) {\n` +
        `  return <p className={tone} />;\n}\n`,
    },
    "Target",
    "data-tone",
  );
  assert.equal(role, "code");
});

/**
 * A destructuring is safe only when this reader can name every key it takes
 * and follow every binding it creates. The predicate that ACCEPTS one and the
 * predicate that FOLLOWS it are the same one, or the object is accepted as
 * read while a binding out of it goes unwatched.
 */
const UNFOLLOWABLE: readonly (readonly [string, string])[] = [
  ["a computed key", `const { [runtimeKey]: forwarded } = props;`],
  ["a nested pattern", `const { nested: { forwarded } } = props;`],
  ["an array pattern", `const { list: [forwarded] } = props;`],
];

for (const [description, body] of UNFOLLOWABLE) {
  test(`refuses a prop whose object is destructured with ${description}`, () => {
    const role = roleOf(
      {
        "Child.tsx": `export function Child({ value }: { value?: string }) {\n  return <i data-x={value} />;\n}\n`,
        "Target.tsx":
          `import { Child } from "./Child";\n` +
          `declare const runtimeKey: string;\n` +
          `export function Target(props: any) {\n  ${body}\n` +
          `  return <div>{props.value}<Child value={forwarded} /></div>;\n}\n`,
      },
      "Target",
      "value",
    );
    assert.equal(role, null);
  });
}

/**
 * The reader has to agree with the walk that produces the fields. Extraction
 * never enters an `aria-hidden` subtree, so text found there is not content a
 * customer can edit — proposing a field for it offers an edit to markup the
 * model deliberately excludes.
 */
const HIDDEN: readonly (readonly [string, string])[] = [
  ["an aria-hidden ancestor", `<div aria-hidden><p>{label}</p></div>`],
  ["an aria-hidden element itself", `<p aria-hidden>{label}</p>`],
  ["an opaque tag", `<script>{label}</script>`],
];

for (const [description, body] of HIDDEN) {
  test(`does not read text under ${description} as content`, () => {
    const role = roleOf(
      {
        "Target.tsx":
          `export function Target({ label }: { label?: string }) {\n  return ${body};\n}\n`,
      },
      "Target",
      "label",
    );
    assert.notEqual(role, "content");
  });
}

/** The same text NOT hidden is content, so the rows above fail for their own
 * reason rather than because the shape never resolved. */
test("the same text outside a hidden subtree is content", () => {
  const role = roleOf(
    {
      "Target.tsx":
        `export function Target({ label }: { label?: string }) {\n` +
        `  return <div><p>{label}</p></div>;\n}\n`,
    },
    "Target",
    "label",
  );
  assert.equal(role, "content");
});

/**
 * A binding is identified by its DECLARATION, not by its spelling.
 *
 * The indirect-read follow collected alias and destructured names as strings
 * and then asked whether anything between the use and the component root
 * rebound that string. That is wrong in both directions: the block declaring
 * the alias lies between its own use and the root, so a valid read was
 * rejected as shadowed; and an unrelated nested binding of the same spelling
 * was accepted, letting a name leak to a reference that never read the prop.
 */
const BINDING_IDENTITY: readonly (readonly [string, string, PropRole | null])[] = [
  [
    "an alias declared in a nested block is read there",
    `if (ok) {\n    const local = props;\n    return <p>{local.value}</p>;\n  }\n  return null;`,
    "content",
  ],
  [
    "a destructure inside a nested block is read there",
    `if (ok) {\n    const { value } = props;\n    return <p>{value}</p>;\n  }\n  return null;`,
    "content",
  ],
  [
    "an alias of something else does not lend its name to the prop",
    `const alias = props;\n  if (ok) {\n    const alias = unrelated;\n    const { value } = alias;\n    return <p>{value}</p>;\n  }\n  return <i className={alias.value} />;`,
    "code",
  ],
  [
    "a name shadowed after the destructure is not the prop",
    `const { value } = props;\n  if (ok) {\n    const value = unrelated.other;\n    return <p>{value}</p>;\n  }\n  return <i className={value} />;`,
    "code",
  ],
  [
    "a sibling block's binding does not reach this reference",
    `if (ok) {\n    const local = props;\n    return <i className={local.value} />;\n  }\n` +
      `  if (!ok) {\n    return <p>{local.value}</p>;\n  }\n  return null;`,
    "code",
  ],
  [
    "the outer alias still reads outside the shadowing block",
    `const alias = props;\n  if (ok) {\n    const alias2 = unrelated;\n    return <i className={alias2.value} />;\n  }\n  return <p>{alias.value}</p>;`,
    "content",
  ],
];

for (const [description, body, expected] of BINDING_IDENTITY) {
  test(`binds by declaration: ${description}`, () => {
    const role = roleOf(
      {
        "Target.tsx":
          `declare const ok: boolean;\n` +
          `declare const unrelated: { value?: string; other?: string };\n` +
          `export function Target(props: { value?: string }) {\n  ${body}\n}\n`,
      },
      "Target",
      "value",
    );
    assert.equal(role, expected);
  });
}

/**
 * A lowercase JSX tag names an ELEMENT, not a binding. React reads it as a
 * string, so `<main>` is not a use of anything called `main` — and counting it
 * as one made a component that renders `{main}` disagree with itself and
 * refuse the field it should have proposed.
 */
const TAG_NAMES: readonly (readonly [string, string, PropRole | null])[] = [
  ["a host tag sharing the prop's name", `<div><main>{main}</main></div>`, "content"],
  ["a self-closing host tag", `<div><main />{main}</div>`, "content"],
];

for (const [description, body, expected] of TAG_NAMES) {
  test(`ignores ${description}`, () => {
    assert.equal(
      roleOf(
        { "Target.tsx": `export function Target({ main }: { main?: string }) {\n  return ${body};\n}\n` },
        "Target",
        "main",
      ),
      expected,
    );
  });
}

/** A COMPONENT tag name IS a use of the binding, and stays one. */
test("a prop used as a component tag is code", () => {
  const role = roleOf(
    {
      "Target.tsx":
        `export function Target({ Tag }: { Tag?: any }) {\n  return <Tag />;\n}\n`,
    },
    "Target",
    "Tag",
  );
  assert.equal(role, "code");
});

/**
 * A dotted tag is a namespace read, and a nearer binding of its ROOT shadows
 * it exactly as any other name. Resolving the member first skipped the
 * shadowing check entirely and classified from a component nothing renders.
 */
test("refuses a member tag whose root a parameter shadows", () => {
  const role = roleOf(
    {
      "ui.tsx": `export function Card({ label }: { label?: string }) {\n  return <p>{label}</p>;\n}\n`,
      "Target.tsx":
        `import * as UI from "./ui";\nvoid UI;\n` +
        `export function Target({ UI, value }: { UI?: any; value?: string }) {\n` +
        `  return <UI.Card label={value} />;\n}\n`,
    },
    "Target",
    "value",
  );
  assert.equal(role, null);
});

/** The same member tag with no shadowing still resolves. */
test("reads a member tag whose root nothing shadows", () => {
  const role = roleOf(
    {
      "ui.tsx": `export function Card({ label }: { label?: string }) {\n  return <p>{label}</p>;\n}\n`,
      "Target.tsx":
        `import * as UI from "./ui";\n` +
        `export function Target({ value }: { value?: string }) {\n` +
        `  return <UI.Card label={value} />;\n}\n`,
    },
    "Target",
    "value",
  );
  assert.equal(role, "content");
});

/**
 * A transparent wrapper around a local component is still that component.
 * `namedFunctionsOf` unwraps `as`, `satisfies` and parentheses to find the
 * function; the resolver compared against the ORIGINAL initializer, so the two
 * disagreed and a local tag reported unresolved.
 */
const WRAPPED: readonly (readonly [string, string])[] = [
  ["an `as` assertion", `(({ label }: { label?: string }) => <p>{label}</p>) as any`],
  ["parentheses", `(({ label }: { label?: string }) => <p>{label}</p>)`],
  ["a `satisfies` clause", `(({ label }: { label?: string }) => <p>{label}</p>) satisfies any`],
];

for (const [description, initializer] of WRAPPED) {
  test(`resolves a local component behind ${description}`, () => {
    const role = roleOf(
      {
        "Target.tsx":
          `export function Target({ value }: { value?: string }) {\n` +
          `  const Inner = ${initializer};\n  return <Inner label={value} />;\n}\n`,
      },
      "Target",
      "value",
    );
    assert.equal(role, "content");
  });
}

/**
 * A `for` initializer's binding is scoped to the LOOP, condition included.
 * Recording it against the surrounding block put the condition outside the
 * alias's scope, so a prop the loop tests read as unread there — and if the
 * body also renders it, the reading saw only the text use and called a
 * behaviour-controlling prop editable content.
 */
test("an alias declared in a for initializer is in scope in the condition", () => {
  const role = roleOf(
    {
      "Target.tsx":
        `export function Target(props: { value?: string }) {\n` +
        `  for (const alias = props; alias.value === "admin"; ) {\n    break;\n  }\n` +
        `  return <p>{props.value}</p>;\n}\n`,
    },
    "Target",
    "value",
  );
  // Tested in the condition and rendered in the body: the readings disagree.
  assert.equal(role, null);
});

/** Without the loop test, the same render is plainly content. */
test("the same render with no loop test is content", () => {
  const role = roleOf(
    {
      "Target.tsx":
        `export function Target(props: { value?: string }) {\n` +
        `  return <p>{props.value}</p>;\n}\n`,
    },
    "Target",
    "value",
  );
  assert.equal(role, "content");
});

/**
 * A rest parameter holds the argument LIST, not the props object. Reading
 * `props.title` off one yields `undefined`, so a field built from a caller's
 * literal there edits text the page never shows.
 */
test("refuses a rest-parameter component", () => {
  const role = roleOf(
    {
      "Target.tsx":
        `export function Target(...props: { title?: string }[]) {\n  return <p>{props.title}</p>;\n}\n`,
    },
    "Target",
    "title",
  );
  assert.equal(role, null);
});

/** The same component with an ordinary parameter still reads. */
test("reads an ordinary props parameter", () => {
  const role = roleOf(
    {
      "Target.tsx":
        `export function Target(props: { title?: string }) {\n  return <p>{props.title}</p>;\n}\n`,
    },
    "Target",
    "title",
  );
  assert.equal(role, "content");
});

/**
 * Running a function is not the same as rendering what it returns, and that
 * boundary has to be seen wherever a function body is written. A private list
 * of three kinds missed a method, a constructor and an accessor — so a value
 * in child position inside a handler the DOM never renders read as content,
 * and a field was proposed for text no visitor can see.
 */
const FUNCTION_BODIES: readonly (readonly [string, string])[] = [
  [
    "a method",
    `const h = { onClick() { return <p>{value}</p>; } };\n  return <button onClick={h.onClick}>Go</button>;`,
  ],
  [
    "a getter",
    `const h = { get onClick() { return () => <p>{value}</p>; } };\n  return <button onClick={h.onClick}>Go</button>;`,
  ],
];

for (const [description, body] of FUNCTION_BODIES) {
  test(`does not read a value discarded inside ${description} as content`, () => {
    const role = roleOf(
      { "Target.tsx": `export function Target({ value }: { value?: string }) {\n  ${body}\n}\n` },
      "Target",
      "value",
    );
    assert.notEqual(role, "content");
  });
}

/** The same value rendered directly is content, so the rows above fail for
 * their own reason rather than because the shape never resolved. */
test("the same value rendered directly is content", () => {
  const role = roleOf(
    { "Target.tsx": `export function Target({ value }: { value?: string }) {\n  return <p>{value}</p>;\n}\n` },
    "Target",
    "value",
  );
  assert.equal(role, "content");
});

/**
 * `props?.value` is a read of `value`. The value RESOLVER refuses optional
 * chaining, because a path that may be undefined cannot name the string the
 * page renders — but this reader asks a different question, "is this prop
 * used", and the answer is yes. Missing it would mean a prop read only that
 * way looked unread, and a component's copy would be classified as code.
 */
const OPTIONAL_READS: readonly (readonly [string, string, PropRole])[] = [
  ["an optional property read", `<p>{props?.value}</p>`, "content"],
  ["an optional string-literal read", `<p>{props?.["value"]}</p>`, "content"],
  ["an optional read landing in a class name", `<p className={props?.value} />`, "code"],
];

for (const [description, body, expected] of OPTIONAL_READS) {
  test(`reads a prop through ${description}`, () => {
    assert.equal(
      roleOf(
        { "Target.tsx": `export function Target(props: { value?: string }) {\n  return ${body};\n}\n` },
        "Target",
        "value",
      ),
      expected,
    );
  });
}

for (const [description, files, prop, expected] of CASES) {
  test(`reads ${description}`, () => {
    assert.equal(roleOf(files, "Target", prop), expected);
  });
}

for (const [description, files, prop] of REFUSALS) {
  test(`refuses ${description}`, () => {
    assert.equal(roleOf(files, "Target", prop), null);
  });
}

test("a name rebound inside the body is not a reading of the prop", () => {
  const role = roleOf(
    {
      "Target.tsx":
        `export function Target({ value }: { value?: string }) {\n` +
        `  return <ul>{["a"].map((value) => <li key={value} className={value}>x</li>)}</ul>;\n}\n`,
    },
    "Target",
    "value",
  );
  // The only textual `value` uses inside belong to the map parameter, so the
  // prop itself is never read and renders nothing.
  assert.equal(role, "code");
});

/**
 * A props object that gets anywhere other than a property read is out of this
 * reader's sight, and what a child does with it is then half the answer.
 *
 * Enumerating the ways to forward it — a JSX spread, an object spread,
 * `Object.assign`, a call, a return, an array — cannot terminate. Each row
 * here is one shape that escapes, and each renders `props.value` locally as
 * text, so the ONLY thing that can refuse it is the escape.
 */
const ESCAPES: readonly (readonly [string, string])[] = [
  ["a JSX spread", `const forwarded = props;\n  return <div>{props.value}<Child {...forwarded} /></div>;`],
  ["an Object.assign copy", `const forwarded = Object.assign({}, props);\n  return <div>{props.value}<Child {...forwarded} /></div>;`],
  ["a call argument", `wrap(props);\n  return <div>{props.value}</div>;`],
  ["a JSX attribute", `return <div>{props.value}<Child data={props} /></div>;`],
  ["an array element", `const all = [props];\n  return <div>{props.value}<Child {...all[0]} /></div>;`],
  ["an object property", `const box = { inner: props };\n  return <div>{props.value}<Child {...box.inner} /></div>;`],
  ["a shorthand property", `const box = { props };\n  return <div>{props.value}<Child {...box.props} /></div>;`],
];

for (const [description, body] of ESCAPES) {
  test(`refuses a prop whose object escapes through ${description}`, () => {
    const role = roleOf(
      {
        "Child.tsx": `export function Child({ value }: { value?: string }) {\n  return <i data-x={value} />;\n}\n`,
        "Target.tsx":
          `import { Child } from "./Child";\n` +
          `declare function wrap(x: unknown): void;\n` +
          `export function Target(props: { value?: string }) {\n  ${body}\n}\n`,
      },
      "Target",
      "value",
    );
    assert.equal(role, null);
  });
}

/** Reading properties off it — however many times — is not an escape. */
test("reads a prop whose object is only ever read from", () => {
  const role = roleOf(
    {
      "Target.tsx":
        `export function Target(props: { value?: string; other?: string }) {\n` +
        `  const alias = props;\n  const { other } = alias;\n` +
        `  return <p title={other}>{props.value}{alias["value"]}</p>;\n}\n`,
    },
    "Target",
    "value",
  );
  assert.equal(role, "content");
});

/**
 * A tag is whatever the nearest lexical binding says it is. `resolveTagAt`
 * stopped at the component's own declaration, so a name bound by an ENCLOSING
 * component was invisible and the module's import answered instead —
 * describing a prop of a component this page never renders.
 */
test("refuses a tag a name in an enclosing scope owns", () => {
  const role = roleOf(
    {
      "Inner.tsx": `export function Inner({ title }: { title?: string }) {\n  return <p>{title}</p>;\n}\n`,
      "Target.tsx":
        `import { Inner } from "./Inner";\n` +
        `export function Outer({ Inner }: { Inner?: unknown }) {\n` +
        `  const Target = ({ title }: { title?: string }) => <Inner title={title} />;\n` +
        `  return <Target title="x" />;\n}\n`,
    },
    "Target",
    "title",
  );
  assert.equal(role, null);
});

test("refuses a tag a const in an enclosing scope owns", () => {
  const role = roleOf(
    {
      "Inner.tsx": `export function Inner({ title }: { title?: string }) {\n  return <p>{title}</p>;\n}\n`,
      "Target.tsx":
        `import { Inner } from "./Inner";\n` +
        `export function Outer() {\n` +
        `  const Inner = (p: { title?: string }) => <i data-x={p.title} />;\n` +
        `  const Target = ({ title }: { title?: string }) => <Inner title={title} />;\n` +
        `  return <Target title="x" />;\n}\n`,
    },
    "Target",
    "title",
  );
  assert.equal(role, null);
});

/**
 * A component rendering ITSELF is not a component shadowing its own name. The
 * tag has to keep resolving, or a recursive component becomes unreadable — so
 * this asks `resolveTagAt` the question directly rather than through a role,
 * which the depth limit would answer either way.
 */
for (const [shape, source] of [
  ["a function declaration", `export function Target({ depth }: { depth?: number }) {\n  return <div>{depth ? <Target /> : null}</div>;\n}\n`],
  ["an arrow binding", `export const Target = ({ depth }: { depth?: number }) => <div>{depth ? <Target /> : null}</div>;\n`],
] as const) {
  test(`still resolves a component that renders itself as ${shape}`, () => {
    const root = mkdtempSync(join(tmpdir(), "managed-site-recursion-"));
    writeFileSync(join(root, "Target.tsx"), source, "utf8");
    const cache = new ModuleCache();
    const resolver = tagResolver(root, cache);
    const [declaration] = findComponentDeclarations(cache.read(join(root, "Target.tsx")));
    assert.ok(declaration !== undefined);
    const found = findFirstJsxTag(declaration.jsxRoot, "Target");
    assert.ok(found !== null, "the recursive tag was not found");
    assert.equal(resolveTagAt(resolver, "Target", found, declaration)?.name, "Target");
  });
}

function findFirstJsxTag(root: ts.Node, tag: string): ts.Node | null {
  let found: ts.Node | null = null;
  const visit = (node: ts.Node): void => {
    if (found !== null) return;
    if (
      (ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node)) &&
      node.tagName.getText() === tag
    ) {
      found = node;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(root);
  return found;
}

/**
 * A value that SELECTS something is being consulted, not shown.
 *
 * `variants[variant]` reads the value's identity to pick a different value,
 * which is the same act as `variant === "primary"` — already read as code. The
 * design-system `variant` prop is the commonest shape there is on a real site,
 * and it was undecided on every one of its call sites.
 *
 * What the selection RESULT is used for makes no difference: the key is code
 * whether the lookup lands in a class name or is rendered as text, because the
 * thing rendered is the table's entry, never the key.
 */
const SELECTORS: readonly (readonly [string, string])[] = [
  ["an element access key in a class name", `<p className={STYLES[value]} />`],
  ["an element access key rendered as text", `<p>{STYLES[value]}</p>`],
  ["an element access key inside a call", `<p className={join(STYLES[value])} />`],
  ["an optional element access key", `<p className={STYLES?.[value]} />`],
  ["a computed property name", `<p className={({ [value]: "x" }).x} />`],
];

for (const [description, body] of SELECTORS) {
  test(`reads ${description} as code`, () => {
    const role = roleOf(
      {
        "Target.tsx":
          `const STYLES: Record<string, string> = { a: "x" };\n` +
          `declare function join(x: string): string;\n` +
          `export function Target({ value }: { value?: string }) {\n  return ${body};\n}\n`,
      },
      "Target",
      "value",
    );
    assert.equal(role, "code");
  });
}

/** The OBJECT of an access is not the key, and reading a property off the prop
 * itself settles nothing about the prop. */
test("refuses a prop that is itself indexed", () => {
  const role = roleOf(
    {
      "Target.tsx":
        `export function Target({ value }: { value?: string[] }) {\n` +
        `  return <p>{value[0]}</p>;\n}\n`,
    },
    "Target",
    "value",
  );
  assert.equal(role, null);
});

/** Shown in one place and used as a key in another: the uses disagree. */
test("refuses a prop both rendered and used as a key", () => {
  const role = roleOf(
    {
      "Target.tsx":
        `const STYLES: Record<string, string> = { a: "x" };\n` +
        `export function Target({ value }: { value?: string }) {\n` +
        `  return <p className={STYLES[value]}>{value}</p>;\n}\n`,
    },
    "Target",
    "value",
  );
  assert.equal(role, null);
});

