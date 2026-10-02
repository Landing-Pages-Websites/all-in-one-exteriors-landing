import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import ts from "typescript";

import { renderAnchor } from "../src/anchors.js";
import { resolveStaticValue } from "../src/evaluate.js";
import { ModuleCache, parseModule } from "../src/scan.js";

/**
 * The claim under test: a value is read from the source only when every step
 * from the expression to a string literal is a NAMED source fact, and the whole
 * chain is decided by syntax alone. Anything else must resolve to null, because
 * a wrong reading here writes a customer's page content from a value the site
 * never rendered.
 *
 * The negatives are the point. Each one looks resolvable and is not.
 */

interface Repository {
  readonly files: Readonly<Record<string, string>>;
  /** Symlinks to create, as link path -> target, both relative to the root. */
  readonly symlinks?: Readonly<Record<string, string>>;
  /**
   * A second path to the same module, imported by a generated mutator. Two
   * paths to one file must be ONE declaration, or a write through the alias
   * never invalidates the read through the real path.
   */
  readonly mutateThrough?: string;
  /**
   * The directory treated as the repository root, relative to the scratch
   * directory. Defaults to the scratch directory itself. A nested root is how
   * a specifier that climbs OUT of the repository can be written at all.
   */
  readonly root?: string;
  /**
   * The exact source text of the JSX expression to resolve. Empty means
   * `probe.tsx` contains exactly one, and the helper refuses more — without
   * that check a probe with a nested expression silently tests the OUTER one
   * and passes for a reason the test never claimed.
   */
  readonly expression: string;
}

function writeRepository(repository: Repository): {
  readonly expression: ts.Expression;
  readonly root: string;
  readonly cache: ModuleCache;
  readonly probeModule: ReturnType<typeof parseModule>;
} {
  const scratch = mkdtempSync(join(tmpdir(), "managed-site-evaluate-"));
  for (const [relative, text] of Object.entries(repository.files)) {
    const file = join(scratch, relative);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, text, "utf8");
  }
  for (const [link, target] of Object.entries(repository.symlinks ?? {})) {
    const linkPath = join(scratch, link);
    mkdirSync(dirname(linkPath), { recursive: true });
    symlinkSync(target, linkPath);
  }
  if (repository.mutateThrough !== undefined) {
    writeFileSync(
      join(scratch, "mutate.ts"),
      `import { copy } from "./${repository.mutateThrough.replace(/\.ts$/u, "")}";\n` +
        `copy.title = "Rendered";\n`,
      "utf8",
    );
  }
  const root = repository.root === undefined ? scratch : join(scratch, repository.root);
  const probeFile = join(root, "probe.tsx");
  const probeModule = parseModule(probeFile);
  const expressions: ts.Expression[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isJsxExpression(node) && node.expression !== undefined) {
      expressions.push(node.expression);
    }
    ts.forEachChild(node, visit);
  };
  visit(probeModule.source);
  const wanted = repository.expression;
  const matches =
    wanted === ""
      ? expressions
      : expressions.filter((entry) => entry.getText(probeModule.source) === wanted);
  assert.equal(
    matches.length,
    1,
    wanted === ""
      ? `probe.tsx must contain exactly one JSX expression, found ${expressions.length}`
      : `probe.tsx must contain exactly one \`${wanted}\`, found ${matches.length}`,
  );
  return { expression: matches[0]!, root, cache: new ModuleCache(), probeModule };
}

function resolve(repository: Repository): { value: string; anchor: string } | null {
  const { expression, root, cache, probeModule } = writeRepository(repository);
  const resolution = resolveStaticValue(expression, { module: probeModule, repositoryRoot: root, cache });
  return resolution === null
    ? null
    : { value: resolution.value, anchor: renderAnchor(resolution.path) };
}

function probe(expression: string, extra = ""): string {
  return `${extra}\nexport function Probe() {\n  return <p>{${expression}}</p>;\n}\n`;
}

/** Values the tool MUST read, with the anchor each one is identified by. */
const RESOLVES: readonly (readonly [string, Repository, string, string])[] = [
  [
    "a module-level const string",
    { files: { "probe.tsx": probe("headline", `const headline = "Hello";`) }, expression: "" },
    "Hello",
    "each:headline",
  ],
  [
    "a property of a module-level object",
    {
      files: { "probe.tsx": probe("copy.title", `const copy = { title: "Hello" };`) },
      expression: "",
    },
    "Hello",
    "each:copy/prop:title",
  ],
  [
    "a deeply nested property",
    {
      files: {
        "probe.tsx": probe("ctas.primary.label", `const ctas = { primary: { label: "Go" } };`),
      },
      expression: "",
    },
    "Go",
    "each:ctas/prop:primary/prop:label",
  ],
  [
    "an object frozen with as const",
    {
      files: {
        "probe.tsx": probe("copy.title", `const copy = { title: "Hello" } as const;`),
      },
      expression: "",
    },
    "Hello",
    "each:copy/prop:title",
  ],
  [
    "a nested object frozen with as const at the leaf",
    {
      files: {
        "probe.tsx": probe(
          "scale.venues.value",
          `const scale = { venues: { value: "178+" as const } };`,
        ),
      },
      expression: "",
    },
    "178+",
    "each:scale/prop:venues/prop:value",
  ],
  [
    "a value behind satisfies",
    {
      files: {
        "probe.tsx": probe(
          "copy.title",
          `const copy = { title: "Hello" } satisfies Record<string, string>;`,
        ),
      },
      expression: "",
    },
    "Hello",
    "each:copy/prop:title",
  ],
  [
    "a parenthesised expression",
    { files: { "probe.tsx": probe("(copy).title", `const copy = { title: "Hi" };`) }, expression: "" },
    "Hi",
    "each:copy/prop:title",
  ],
  [
    "a string-literal key",
    {
      files: { "probe.tsx": probe(`copy["title"]`, `const copy = { title: "Hello" };`) },
      expression: "",
    },
    "Hello",
    "each:copy/prop:title",
  ],
  [
    "a quoted property name in the declaration",
    {
      files: { "probe.tsx": probe("copy.title", `const copy = { "title": "Hello" };`) },
      expression: "",
    },
    "Hello",
    "each:copy/prop:title",
  ],
  [
    "a shorthand property",
    {
      files: {
        "probe.tsx": probe("copy.title", `const title = "Hello";\nconst copy = { title };`),
      },
      expression: "",
    },
    "Hello",
    "each:copy/prop:title",
  ],
  [
    "a no-substitution template literal",
    {
      files: { "probe.tsx": probe("copy.title", "const copy = { title: `Hello` };") },
      expression: "",
    },
    "Hello",
    "each:copy/prop:title",
  ],
  [
    "a template literal whose substitutions all resolve",
    {
      files: {
        "probe.tsx": probe(
          "line",
          'const unit = "locations";\nconst count = "12.5M+";\nconst line = `${count} ${unit}`;',
        ),
      },
      expression: "",
    },
    "12.5M+ locations",
    "each:line",
  ],
  [
    "a named import from a repository module",
    {
      files: {
        "lib/content.ts": `export const ctas = { primary: { label: "Get Started" } };`,
        "probe.tsx": probe("ctas.primary.label", `import { ctas } from "./lib/content";`),
      },
      expression: "",
    },
    "Get Started",
    "each:ctas/prop:primary/prop:label",
  ],
  [
    "a named import through the @/ alias",
    {
      files: {
        "lib/content.ts": `export const ctas = { primary: { label: "Get Started" } };`,
        "probe.tsx": probe("ctas.primary.label", `import { ctas } from "@/lib/content";`),
      },
      expression: "",
    },
    "Get Started",
    "each:ctas/prop:primary/prop:label",
  ],
  [
    "an import renamed at the import site keeps the DECLARED name as its anchor",
    {
      files: {
        "lib/content.ts": `export const ctas = { primary: { label: "Go" } };`,
        "probe.tsx": probe("actions.primary.label", `import { ctas as actions } from "./lib/content";`),
      },
      expression: "",
    },
    "Go",
    "each:ctas/prop:primary/prop:label",
  ],
  [
    "a binding reached through a barrel re-export",
    {
      files: {
        "lib/content.ts": `export const ctas = { primary: { label: "Go" } };`,
        "lib/index.ts": `export { ctas } from "./content";`,
        "probe.tsx": probe("ctas.primary.label", `import { ctas } from "./lib";`),
      },
      expression: "",
    },
    "Go",
    "each:ctas/prop:primary/prop:label",
  ],
  [
    "a binding reached through a star re-export",
    {
      files: {
        "lib/content.ts": `export const ctas = { primary: { label: "Go" } };`,
        "lib/index.ts": `export * from "./content";`,
        "probe.tsx": probe("ctas.primary.label", `import { ctas } from "./lib";`),
      },
      expression: "",
    },
    "Go",
    "each:ctas/prop:primary/prop:label",
  ],
  [
    "a duplicate key resolves to the LAST one, as JavaScript does",
    {
      files: {
        "probe.tsx": probe("copy.title", `const copy = { title: "First", title: "Second" };`),
      },
      expression: "",
    },
    "Second",
    "each:copy/prop:title",
  ],
  [
    "a const exported by a separate export list, not an inline `export const`",
    {
      files: {
        "lib/content.ts": `const ctas = { primary: { label: "Go" } };\nexport { ctas };`,
        "probe.tsx": probe("ctas.primary.label", `import { ctas } from "./lib/content";`),
      },
      expression: "",
    },
    "Go",
    "each:ctas/prop:primary/prop:label",
  ],
  [
    "a const exported under an alias keeps its DECLARED name as the anchor",
    {
      files: {
        "lib/content.ts": `const ctas = { primary: { label: "Go" } };\nexport { ctas as actions };`,
        "probe.tsx": probe("actions.primary.label", `import { actions } from "./lib/content";`),
      },
      expression: "",
    },
    "Go",
    "each:ctas/prop:primary/prop:label",
  ],
  [
    "a barrel that renames on the way through still anchors on the declaration",
    {
      files: {
        "lib/content.ts": `export const ctas = { primary: { label: "Go" } };`,
        "lib/index.ts": `export { ctas as actions } from "./content";`,
        "probe.tsx": probe("actions.primary.label", `import { actions } from "./lib";`),
      },
      expression: "",
    },
    "Go",
    "each:ctas/prop:primary/prop:label",
  ],
  [
    "a reference in a TYPE position cannot mutate, so it is not an escape",
    {
      files: {
        "probe.tsx": probe(
          "copy.title",
          `const copy = { title: "Hello" };\ntype Same = typeof copy;\n` +
          `export function shape(value: Same): Same { return value; }`,
        ),
      },
      expression: "",
    },
    "Hello",
    "each:copy/prop:title",
  ],
  [
    "a value read through a barrel nobody writes to is still read",
    {
      files: {
        "lib/content.ts": `export const copy = { title: "Hello" };`,
        "lib/index.ts": `export * from "./content";`,
        "lib/read.ts": `import * as barrel from "./index";\nexport const shown = barrel.copy.title;`,
        "probe.tsx": probe("copy.title", `import { copy } from "./lib/index";`),
      },
      expression: "",
    },
    "Hello",
    "each:copy/prop:title",
  ],
  [
    "a sibling of a called receiver stays readable",
    {
      files: {
        "probe.tsx": probe(
          "copy.other.title",
          `const copy = {\n` +
          `  inner: { title: "Inner", mutate() { this.title = "x"; } },\n` +
          `  other: { title: "Other" },\n};\n` +
          `copy.inner.mutate();`,
        ),
      },
      expression: "",
    },
    "Other",
    "each:copy/prop:other/prop:title",
  ],
  [
    "a sibling path stays readable when only one branch is handed out",
    {
      files: {
        "Inner.tsx": `export function Inner({ cta }: { cta: { label: string } }) {\n  return <p>{cta.label}</p>;\n}\n`,
        "probe.tsx":
          `import { Inner } from "./Inner";\n` +
          `const ctas = { primary: { label: "Go" }, rfp: { label: "RFP" } };\n` +
          `export function Probe() {\n  return <div><Inner cta={ctas.primary} />{ctas.rfp.label}</div>;\n}\n`,
      },
      expression: "ctas.rfp.label",
    },
    "RFP",
    "each:ctas/prop:rfp/prop:label",
  ],
  [
    "a property whose value is an identifier declared in the SAME module as the object",
    {
      files: {
        "lib/content.ts": `const label = "Go";\nexport const ctas = { primary: label };`,
        "probe.tsx": probe("ctas.primary", `import { ctas } from "./lib/content";`),
      },
      expression: "",
    },
    "Go",
    "each:ctas/prop:primary",
  ],
];

/**
 * Values the tool MUST refuse. Every one of these resolves to a real string at
 * runtime for at least some input, and reading it here would be a guess.
 */
const REFUSES: readonly (readonly [string, Repository])[] = [
  [
    "an array index, because position is not identity",
    {
      files: { "probe.tsx": probe("items[0].title", `const items = [{ title: "One" }];`) },
      expression: "",
    },
  ],
  [
    "a computed key that is not a literal",
    {
      files: {
        "probe.tsx": probe("copy[key]", `const key = "title";\nconst copy = { title: "Hello" };`),
      },
      expression: "",
    },
  ],
  [
    "an object built with a spread, because the value may come from elsewhere",
    {
      files: {
        "probe.tsx": probe(
          "copy.title",
          `const base = { title: "Base" };\nconst copy = { ...base, subtitle: "S" };`,
        ),
      },
      expression: "",
    },
  ],
  [
    "a spread that appears AFTER the key, which would overwrite it",
    {
      files: {
        "probe.tsx": probe(
          "copy.title",
          `const base = { title: "Base" };\nconst copy = { title: "Own", ...base };`,
        ),
      },
      expression: "",
    },
  ],
  [
    "a function call",
    {
      files: { "probe.tsx": probe("title()", `const title = () => "Hello";`) },
      expression: "",
    },
  ],
  [
    "a conditional",
    {
      files: {
        "probe.tsx": probe(
          "flag ? a : b",
          `const flag = true;\nconst a = "A";\nconst b = "B";`,
        ),
      },
      expression: "",
    },
  ],
  [
    "a concatenation, which is not a template literal",
    {
      files: {
        "probe.tsx": probe("a + b", `const a = "A";\nconst b = "B";`),
      },
      expression: "",
    },
  ],
  [
    "a nullish fallback",
    {
      files: {
        "probe.tsx": probe("a ?? b", `const a = "A";\nconst b = "B";`),
      },
      expression: "",
    },
  ],
  [
    "a leaf that is a number, which is not customer text",
    {
      files: { "probe.tsx": probe("copy.count", `const copy = { count: 3 };`) },
      expression: "",
    },
  ],
  [
    "a leaf that is still an object",
    {
      files: { "probe.tsx": probe("copy.inner", `const copy = { inner: { title: "T" } };`) },
      expression: "",
    },
  ],
  [
    "a property the object does not declare",
    {
      files: { "probe.tsx": probe("copy.missing", `const copy = { title: "T" };`) },
      expression: "",
    },
  ],
  [
    "a binding declared with let, which may be reassigned",
    {
      files: { "probe.tsx": probe("headline", `let headline = "Hello";`) },
      expression: "",
    },
  ],
  [
    "a binding declared with var, which may be reassigned",
    {
      files: { "probe.tsx": probe("headline", `var headline = "Hello";`) },
      expression: "",
    },
  ],
  [
    "a name shadowed by a destructured component prop",
    {
      files: {
        "probe.tsx":
          `const copy = { title: "Module" };\n` +
          `export function Probe({ copy }: { copy: { title: string } }) {\n` +
          `  return <p>{copy.title}</p>;\n}\n`,
      },
      expression: "",
    },
  ],
  [
    "a name shadowed by a whole-props parameter",
    {
      files: {
        "probe.tsx":
          `const copy = { title: "Module" };\n` +
          `export function Probe(copy: { title: string }) {\n` +
          `  return <p>{copy.title}</p>;\n}\n`,
      },
      expression: "",
    },
  ],
  [
    "a name shadowed by a local const inside the component",
    {
      files: {
        "probe.tsx":
          `const copy = { title: "Module" };\n` +
          `export function Probe(props: { t: string }) {\n` +
          `  const copy = { title: props.t };\n` +
          `  return <p>{copy.title}</p>;\n}\n`,
      },
      expression: "",
    },
  ],
  [
    "a name shadowed by a map callback parameter",
    {
      files: {
        "probe.tsx":
          `const copy = { title: "Module" };\n` +
          `export function Probe({ rows }: { rows: { title: string }[] }) {\n` +
          `  return <ul>{rows.map((copy) => <li>{copy.title}</li>)}</ul>;\n}\n`,
      },
      expression: "copy.title",
    },
  ],
  [
    "a binding imported from a package, which is not ours to read",
    {
      files: { "probe.tsx": probe("copy.title", `import { copy } from "some-package";`) },
      expression: "",
    },
  ],
  [
    "an import that does not resolve to a file",
    {
      files: { "probe.tsx": probe("copy.title", `import { copy } from "./missing";`) },
      expression: "",
    },
  ],
  [
    "a binding the target module does not export",
    {
      files: {
        "lib/content.ts": `const copy = { title: "T" };`,
        "probe.tsx": probe("copy.title", `import { copy } from "./lib/content";`),
      },
      expression: "",
    },
  ],
  [
    "a re-export cycle",
    {
      files: {
        "lib/a.ts": `export * from "./b";`,
        "lib/b.ts": `export * from "./a";`,
        "probe.tsx": probe("copy.title", `import { copy } from "./lib/a";`),
      },
      expression: "",
    },
  ],
  [
    "a template literal with one substitution that does not resolve",
    {
      files: {
        "probe.tsx": probe("line", "const line = `${Date.now()} locations`;"),
      },
      expression: "",
    },
  ],
  [
    "a getter, whose value is computed",
    {
      files: {
        "probe.tsx": probe("copy.title", `const copy = { get title() { return "T"; } };`),
      },
      expression: "",
    },
  ],
  [
    "a method, which is not a value",
    {
      files: {
        "probe.tsx": probe("copy.title", `const copy = { title() { return "T"; } };`),
      },
      expression: "",
    },
  ],
  [
    "an optional chain, which admits that the value may be absent",
    {
      files: { "probe.tsx": probe("copy?.title", `const copy = { title: "T" };`) },
      expression: "",
    },
  ],
  [
    "a non-null assertion, which admits the same",
    {
      files: { "probe.tsx": probe("copy!.title", `const copy = { title: "T" };`) },
      expression: "",
    },
  ],
  [
    "an object whose property is assigned after it is declared",
    {
      files: {
        "probe.tsx": probe(
          "copy.title",
          `const copy = { title: "Original" };\ncopy.title = "Rendered";`,
        ),
      },
      expression: "",
    },
  ],
  [
    "an object mutated by the module that imports it",
    {
      files: {
        "lib/content.ts": `export const copy = { title: "Original" };`,
        "probe.tsx": probe(
          "copy.title",
          `import { copy } from "./lib/content";\ncopy.title = "Rendered";`,
        ),
      },
      expression: "",
    },
  ],
  [
    "an object mutated by a THIRD module neither declares nor reads it",
    {
      files: {
        "lib/content.ts": `export const copy = { title: "Original" };`,
        "lib/mutate.ts": `import { copy } from "./content";\ncopy.title = "Rendered";`,
        "probe.tsx": probe("copy.title", `import { copy } from "./lib/content";`),
      },
      expression: "",
    },
  ],
  [
    "an object mutated through an element write",
    {
      files: {
        "probe.tsx": probe(
          "copy.title",
          `const copy = { title: "Original" };\ncopy["title"] = "Rendered";`,
        ),
      },
      expression: "",
    },
  ],
  [
    "an object handed to Object.assign as its target",
    {
      files: {
        "probe.tsx": probe(
          "copy.title",
          `const copy = { title: "Original" };\nObject.assign(copy, { title: "Rendered" });`,
        ),
      },
      expression: "",
    },
  ],
  [
    "an object whose property is deleted",
    {
      files: {
        "probe.tsx": probe(
          "copy.title",
          `const copy = { title: "Original" };\ndelete (copy as { title?: string }).title;`,
        ),
      },
      expression: "",
    },
  ],
  [
    "a name star-exported by two barrels, which cannot both be the answer",
    {
      files: {
        "lib/a.ts": `export const copy = { title: "A" };`,
        "lib/b.ts": `export const copy = { title: "B" };`,
        "lib/index.ts": `export * from "./a";\nexport * from "./b";`,
        "probe.tsx": probe("copy.title", `import { copy } from "./lib";`),
      },
      expression: "",
    },
  ],
  [
    "a name shadowed by a nested function declaration",
    {
      files: {
        "probe.tsx":
          `const copy = { title: "Module" };\n` +
          `export function Probe() {\n` +
          `  function copy() { return null; }\n` +
          `  return <p>{copy.title}</p>;\n}\n`,
      },
      expression: "copy.title",
    },
  ],
  [
    "a name shadowed by a nested class declaration",
    {
      files: {
        "probe.tsx":
          `const copy = { title: "Module" };\n` +
          `export function Probe() {\n` +
          `  class copy {}\n` +
          `  return <p>{copy.title}</p>;\n}\n`,
      },
      expression: "copy.title",
    },
  ],
  [
    "a name shadowed by a destructured catch binding",
    {
      files: {
        "probe.tsx":
          `const copy = { title: "Module" };\n` +
          `export function Probe() {\n` +
          `  try { JSON.parse("1"); } catch ({ copy }: any) { return <p>{copy.title}</p>; }\n` +
          `  return null;\n}\n`,
      },
      expression: "copy.title",
    },
  ],
  [
    "an object mutated through a local alias of the same declaration",
    {
      files: {
        "probe.tsx": probe(
          "copy.title",
          `const copy = { title: "Original" };\nconst alias = copy;\nalias.title = "Rendered";`,
        ),
      },
      expression: "",
    },
  ],
  [
    "an object mutated through an alias in a DIFFERENT module",
    {
      files: {
        "lib/content.ts": `export const copy = { title: "Original" };`,
        "lib/mutate.ts": `import { copy } from "./content";\nconst alias = copy;\nalias.title = "Rendered";`,
        "probe.tsx": probe("copy.title", `import { copy } from "./lib/content";`),
      },
      expression: "",
    },
  ],
  [
    "a module reached by climbing out of the repository root",
    {
      files: {
        "site/probe.tsx": probe("copy.title", `import { copy } from "../outside/content";`),
        "outside/content.ts": `export const copy = { title: "Outside" };`,
      },
      expression: "",
      root: "site",
    },
  ],
  [
    "an object aliased inside a function, where the alias is then written",
    {
      files: {
        "probe.tsx": probe(
          "copy.title",
          `const copy = { title: "Original" };\n` +
          `function mutate() { const alias = copy; alias.title = "Rendered"; }\n` +
          `mutate();`,
        ),
      },
      expression: "",
    },
  ],
  [
    "an object written through a namespace import",
    {
      files: {
        "lib/content.ts": `export const copy = { title: "Original" };`,
        "lib/mutate.ts": `import * as content from "./content";\ncontent.copy.title = "Rendered";`,
        "probe.tsx": probe("copy.title", `import { copy } from "./lib/content";`),
      },
      expression: "",
    },
  ],
  [
    "an object handed to a function, which may write through it",
    {
      files: {
        "probe.tsx": probe(
          "copy.title",
          `const copy = { title: "Original" };\n` +
          `function take(o: { title: string }) { o.title = "Rendered"; }\n` +
          `take(copy);`,
        ),
      },
      expression: "",
    },
  ],
  [
    "an object handed to a component as a whole",
    {
      files: {
        "Inner.tsx": `export function Inner({ cta }: { cta: { label: string } }) {\n  return <p>{cta.label}</p>;\n}\n`,
        "probe.tsx":
          `import { Inner } from "./Inner";\n` +
          `const ctas = { primary: { label: "Go" } };\n` +
          `export function Probe() {\n  return <div><Inner cta={ctas.primary} />{ctas.primary.label}</div>;\n}\n`,
      },
      expression: "ctas.primary.label",
    },
  ],
  [
    "an object returned from the module, which any caller may write through",
    {
      files: {
        "probe.tsx": probe(
          "copy.title",
          `const copy = { title: "Original" };\nexport function give() { return copy; }`,
        ),
      },
      expression: "",
    },
  ],
  [
    "a `__proto__` object-literal key, which sets a prototype and creates no property",
    {
      files: {
        "probe.tsx": probe(`copy["__proto__"]`, `const copy = { "__proto__": "Rendered" };`),
      },
      expression: "",
    },
  ],
  [
    "an object mutated from a module the specifier grammar would not resolve",
    {
      files: {
        "lib/content.ts": `export const copy = { title: "Original" };`,
        "tools/patch.mjs": `import { copy } from "../lib/content.ts";\ncopy.title = "Rendered";`,
        "probe.tsx": probe("copy.title", `import { copy } from "./lib/content";`),
      },
      expression: "",
    },
  ],
  [
    "an object whose module namespace is handed out whole",
    {
      files: {
        "lib/content.ts": `export const copy = { title: "Original" };`,
        "lib/mutate.ts":
          `import * as content from "./content";\n` +
          `function take(m: { copy: { title: string } }) { m.copy.title = "Rendered"; }\n` +
          `take(content);`,
        "probe.tsx": probe("copy.title", `import { copy } from "./lib/content";`),
      },
      expression: "",
    },
  ],
  [
    "an object reached by destructuring a module namespace",
    {
      files: {
        "lib/content.ts": `export const copy = { title: "Original" };`,
        "lib/mutate.ts":
          `import * as content from "./content";\n` +
          `const { copy: alias } = content;\nalias.title = "Rendered";`,
        "probe.tsx": probe("copy.title", `import { copy } from "./lib/content";`),
      },
      expression: "",
    },
  ],
  [
    "an object whose module is loaded by a dynamic import",
    {
      files: {
        "lib/content.ts": `export const copy = { title: "Original" };`,
        "lib/mutate.ts":
          `export async function patch() {\n` +
          `  const m = await import("./content");\n  m.copy.title = "Rendered";\n}`,
        "probe.tsx": probe("copy.title", `import { copy } from "./lib/content";`),
      },
      expression: "",
    },
  ],
  [
    "an object whose module is loaded by require",
    {
      files: {
        "lib/content.ts": `export const copy = { title: "Original" };`,
        "tools/patch.cjs":
          `const m = require("../lib/content");\nm.copy.title = "Rendered";`,
        "probe.tsx": probe("copy.title", `import { copy } from "./lib/content";`),
      },
      expression: "",
    },
  ],
  [
    "an object exported as default, under a name this tool refuses to follow",
    {
      files: {
        "probe.tsx":
          `const copy = { title: "Original" };\nexport { copy as default };\n` +
          `export function Probe() {\n  return <p>{copy.title}</p>;\n}\n`,
        "mutate.ts": `import copy from "./probe";\ncopy.title = "Rendered";`,
      },
      expression: "copy.title",
    },
  ],
  [
    "an object sent out by `export default`, the same way",
    {
      files: {
        "probe.tsx":
          `const copy = { title: "Original" };\nexport default copy;\n` +
          `export function Probe() {\n  return <p>{copy.title}</p>;\n}\n`,
        "mutate.ts": `import copy from "./probe";\ncopy.title = "Rendered";`,
      },
      expression: "copy.title",
    },
  ],
  [
    "an object handed out by an object-literal shorthand",
    {
      files: {
        "probe.tsx": probe(
          "copy.title",
          `const copy = { title: "Original" };\n` +
          `const wrapper = { copy };\nwrapper.copy.title = "Rendered";`,
        ),
      },
      expression: "",
    },
  ],
  [
    "an object written through a for-of assignment target",
    {
      files: {
        "probe.tsx": probe(
          "copy.title",
          `const copy = { title: "Original" };\nfor (copy.title of ["Rendered"]) {}`,
        ),
      },
      expression: "",
    },
  ],
  [
    "an object written through a for-in assignment target",
    {
      files: {
        "probe.tsx": probe(
          "copy.title",
          `const copy = { title: "Original" };\nfor (copy.title in { Rendered: 1 }) {}`,
        ),
      },
      expression: "",
    },
  ],
  [
    "an object written through an array destructuring assignment",
    {
      files: {
        "probe.tsx": probe(
          "copy.title",
          `const copy = { title: "Original" };\n[copy.title] = ["Rendered"];`,
        ),
      },
      expression: "",
    },
  ],
  [
    "an object written through an object destructuring assignment",
    {
      files: {
        "probe.tsx": probe(
          "copy.title",
          `const copy = { title: "Original" };\n({ t: copy.title } = { t: "Rendered" });`,
        ),
      },
      expression: "",
    },
  ],
  [
    "a namespace write reaching its declaration through a star barrel",
    {
      files: {
        "lib/content.ts": `export const copy = { title: "Original" };`,
        "lib/index.ts": `export * from "./content";`,
        "lib/mutate.ts": `import * as barrel from "./index";\nbarrel.copy.title = "Rendered";`,
        "probe.tsx": probe("copy.title", `import { copy } from "./lib/index";`),
      },
      expression: "",
    },
  ],
  [
    "a namespace write reaching its declaration through a named re-export",
    {
      files: {
        "lib/content.ts": `export const copy = { title: "Original" };`,
        "lib/index.ts": `export { copy } from "./content";`,
        "lib/mutate.ts": `import * as barrel from "./index";\nbarrel.copy.title = "Rendered";`,
        "probe.tsx": probe("copy.title", `import { copy } from "./lib/index";`),
      },
      expression: "",
    },
  ],
  [
    "a whole barrel handed out, which reaches the declarations it re-exports",
    {
      files: {
        "lib/content.ts": `export const copy = { title: "Original" };`,
        "lib/index.ts": `export * from "./content";`,
        "lib/mutate.ts":
          `import * as barrel from "./index";\n` +
          `function take(m: { copy: { title: string } }) { m.copy.title = "Rendered"; }\n` +
          `take(barrel);`,
        "probe.tsx": probe("copy.title", `import { copy } from "./lib/index";`),
      },
      expression: "",
    },
  ],
  [
    "an object whose method is called, since the method receives it as `this`",
    {
      files: {
        "probe.tsx": probe(
          "copy.inner.title",
          `const copy = { inner: { title: "Original", mutate() { this.title = "Rendered"; } } };\n` +
          `copy.inner.mutate();`,
        ),
      },
      expression: "",
    },
  ],
  [
    "an object reached through an `export * as` namespace re-export",
    {
      files: {
        "lib/content.ts": `export const copy = { title: "Original" };`,
        "lib/index.ts": `export * as content from "./content";`,
        "lib/mutate.ts":
          `import * as barrel from "./index";\nbarrel.content.copy.title = "Rendered";`,
        "probe.tsx": probe("copy.title", `import { copy } from "./lib/content";`),
      },
      expression: "",
    },
  ],
  [
    "a name shadowed by a named function expression's own binding",
    {
      files: {
        "probe.tsx":
          `const copy = { title: "Module" };\n` +
          `export const Probe = function copy() {\n` +
          `  return <p>{(copy as unknown as { title: string }).title}</p>;\n};\n`,
      },
      expression: "(copy as unknown as { title: string }).title",
    },
  ],
  [
    "an object written through a NAMED import of a namespace re-export",
    {
      files: {
        "lib/content.ts": `export const copy = { title: "Original" };`,
        "lib/index.ts": `export * as content from "./content";`,
        "lib/mutate.ts": `import { content } from "./index";\ncontent.copy.title = "Rendered";`,
        "probe.tsx": probe("copy.title", `import { copy } from "./lib/content";`),
      },
      expression: "",
    },
  ],
  [
    "the same, through an alias on the import",
    {
      files: {
        "lib/content.ts": `export const copy = { title: "Original" };`,
        "lib/index.ts": `export * as content from "./content";`,
        "lib/mutate.ts": `import { content as ns } from "./index";\nns.copy.title = "Rendered";`,
        "probe.tsx": probe("copy.title", `import { copy } from "./lib/content";`),
      },
      expression: "",
    },
  ],
  [
    "a name shadowed by the function declaration whose own body reads it",
    {
      files: {
        "probe.tsx":
          `const copy = { title: "Module" };\n` +
          `export function copy() {\n` +
          `  return <p>{(copy as unknown as { title: string }).title}</p>;\n}\n`,
      },
      expression: "(copy as unknown as { title: string }).title",
    },
  ],
  [
    "an object written through an in-repository symlink to the same module",
    {
      files: {
        "lib/content.ts": `export const copy = { title: "Original" };`,
        "probe.tsx": probe("copy.title", `import { copy } from "./lib/content";`),
      },
      symlinks: { "alias/content.ts": "../lib/content.ts" },
      mutateThrough: "alias/content.ts",
      expression: "",
    },
  ],
  [
    "a namespace forwarded by an export list, not by `export * as`",
    {
      files: {
        "lib/content.ts": `export const copy = { title: "Original" };`,
        "lib/index.ts": `import * as content from "./content";\nexport { content };`,
        "lib/mutate.ts": `import { content } from "./index";\ncontent.copy.title = "Rendered";`,
        "probe.tsx": probe("copy.title", `import { copy } from "./lib/content";`),
      },
      expression: "",
    },
  ],
  [
    "a namespace forwarded through a second barrel",
    {
      files: {
        "lib/content.ts": `export const copy = { title: "Original" };`,
        "lib/ns.ts": `export * as content from "./content";`,
        "lib/index.ts": `export { content } from "./ns";`,
        "lib/mutate.ts": `import { content } from "./index";\ncontent.copy.title = "Rendered";`,
        "probe.tsx": probe("copy.title", `import { copy } from "./lib/content";`),
      },
      expression: "",
    },
  ],
  [
    "a namespace forwarded under a new name on the way through",
    {
      files: {
        "lib/content.ts": `export const copy = { title: "Original" };`,
        "lib/ns.ts": `export * as content from "./content";`,
        "lib/index.ts": `export { content as bundle } from "./ns";`,
        "lib/mutate.ts": `import { bundle } from "./index";\nbundle.copy.title = "Rendered";`,
        "probe.tsx": probe("copy.title", `import { copy } from "./lib/content";`),
      },
      expression: "",
    },
  ],
  [
    "a namespace forwarded through a star re-export",
    {
      files: {
        "lib/content.ts": `export const copy = { title: "Original" };`,
        "lib/ns.ts": `export * as content from "./content";`,
        "lib/index.ts": `export * from "./ns";`,
        "lib/mutate.ts": `import { content } from "./index";\ncontent.copy.title = "Rendered";`,
        "probe.tsx": probe("copy.title", `import { copy } from "./lib/content";`),
      },
      expression: "",
    },
  ],
  [
    "an object handed out by a parameter's default value",
    {
      files: {
        "probe.tsx": probe(
          "copy.title",
          `const copy = { title: "Original" };\n` +
          `function mutate(value = copy) { value.title = "Rendered"; }\n` +
          `mutate();`,
        ),
      },
      expression: "",
    },
  ],
  [
    "an object handed out by a class field initializer",
    {
      files: {
        "probe.tsx": probe(
          "copy.title",
          `const copy = { title: "Original" };\n` +
          `export class Mutator { field = copy; }`,
        ),
      },
      expression: "",
    },
  ],
  [
    "an object handed out by a destructuring default",
    {
      files: {
        "probe.tsx": probe(
          "copy.title",
          `const copy = { title: "Original" };\n` +
          `const source: { a?: { title: string } } = {};\n` +
          `const { a = copy } = source;\na.title = "Rendered";`,
        ),
      },
      expression: "",
    },
  ],
  [
    "a name shadowed by a `var` nested below the block that hoists it",
    {
      files: {
        "probe.tsx":
          `const copy = { title: "Module" };\n` +
          `export function Probe() {\n` +
          `  if (Math.random() > 0) { var copy = { title: "Local" }; }\n` +
          `  return <p>{copy.title}</p>;\n}\n`,
      },
      expression: "copy.title",
    },
  ],
  [
    "a namespace forwarded by a star re-export, when the whole barrel is handed out",
    {
      files: {
        "lib/content.ts": `export const copy = { title: "Original" };`,
        "lib/ns.ts": `export * as content from "./content";`,
        "lib/index.ts": `export * from "./ns";`,
        "lib/mutate.ts":
          `import * as barrel from "./index";\n` +
          `function take(m: unknown) { (m as { content: { copy: { title: string } } })` +
          `.content.copy.title = "Rendered"; }\n` +
          `take(barrel);`,
        "probe.tsx": probe("copy.title", `import { copy } from "./lib/content";`),
      },
      expression: "",
    },
  ],
  [
    "a name shadowed by a const declared directly in a switch case",
    {
      files: {
        "probe.tsx":
          `const copy = { title: "Module" };\n` +
          `export function Probe({ kind }: { kind: string }) {\n` +
          `  switch (kind) {\n` +
          `    case "a":\n` +
          `      const copy = { title: "Local" };\n` +
          `      return <p>{copy.title}</p>;\n` +
          `    default:\n      return null;\n  }\n}\n`,
      },
      expression: "copy.title",
    },
  ],
  [
    "an object exported under a second name, which hands it out",
    {
      files: {
        "lib/content.ts":
          `export const copy = { title: "Original" };\nexport const alias = copy;`,
        "lib/mutate.ts": `import { alias } from "./content";\nalias.title = "Rendered";`,
        "probe.tsx": probe("copy.title", `import { copy } from "./lib/content";`),
      },
      expression: "",
    },
  ],
  [
    "a namespace held by a local export list, when the module is loaded whole",
    {
      files: {
        "lib/content.ts": `export const copy = { title: "Original" };`,
        "lib/index.ts": `import * as content from "./content";\nexport { content };`,
        "lib/mutate.ts":
          `export async function patch() {\n` +
          `  const m = await import("./index");\n` +
          `  m.content.copy.title = "Rendered";\n}`,
        "probe.tsx": probe("copy.title", `import { copy } from "./lib/content";`),
      },
      expression: "",
    },
  ],
  [
    "a name that is declared nowhere",
    { files: { "probe.tsx": probe("missingEntirely") }, expression: "" },
  ],
  [
    "a default import, whose only name is the importer's own alias",
    {
      files: {
        "lib/content.ts": `export default { title: "T" };`,
        "probe.tsx": probe("copy.title", `import copy from "./lib/content";`),
      },
      expression: "",
    },
  ],
  [
    "a namespace import, which names a module and not a binding",
    {
      files: {
        "lib/content.ts": `export const copy = { title: "T" };`,
        "probe.tsx": probe("content.copy.title", `import * as content from "./lib/content";`),
      },
      expression: "",
    },
  ],
  [
    "an empty string, which is an absence rather than content",
    { files: { "probe.tsx": probe("copy.title", `const copy = { title: "" };`) }, expression: "" },
  ],
  [
    "a name shadowed by a for-of binding, declared outside the body block",
    {
      files: {
        "probe.tsx":
          `const copy = { title: "Module" };\n` +
          `export function Probe({ rows }: { rows: { title: string }[] }) {\n` +
          `  const out = [];\n` +
          `  for (const copy of rows) { out.push(<li>{copy.title}</li>); }\n` +
          `  return <ul>{out}</ul>;\n}\n`,
      },
      expression: "copy.title",
    },
  ],
  [
    "a name shadowed by a destructured for-of binding",
    {
      files: {
        "probe.tsx":
          `const title = "Module";\n` +
          `export function Probe({ rows }: { rows: { title: string }[] }) {\n` +
          `  const out = [];\n` +
          `  for (const { title } of rows) { out.push(<li>{title}</li>); }\n` +
          `  return <ul>{out}</ul>;\n}\n`,
      },
      expression: "title",
    },
  ],
  [
    "a name shadowed by a destructured const inside the component",
    {
      files: {
        "probe.tsx":
          `const title = "Module";\n` +
          `export function Probe(props: { t: string }) {\n` +
          `  const { t: title } = props;\n` +
          `  return <p>{title}</p>;\n}\n`,
      },
      expression: "title",
    },
  ],
  [
    "two module bindings of the same name, which cannot both be the answer",
    {
      files: {
        "probe.tsx": probe(
          "copy.title",
          `const copy = { title: "First" };\nconst copy2 = 1;\nconst copy = { title: "Second" };`,
        ),
      },
      expression: "",
    },
  ],
];

for (const [description, repository, value, anchor] of RESOLVES) {
  test(`resolves ${description}`, () => {
    const resolution = resolve(repository);
    assert.notEqual(resolution, null, `expected a resolution for: ${description}`);
    assert.equal(resolution?.value, value);
    assert.equal(resolution?.anchor, anchor);
  });
}

for (const [description, repository] of REFUSES) {
  test(`refuses ${description}`, () => {
    assert.equal(resolve(repository), null);
  });
}

/**
 * An export specifier has TWO names: the one the outside asks for, and the one
 * this module declared. `export { copy as label }` makes those differ, and a
 * reader that wanted one and used the other looked up nothing.
 *
 * The escape index is where that mattered. Handing a whole namespace to
 * something opaque must escape every declaration behind it, but the barrel's
 * public name is `label` while the lookup was made under `copy` — so it found
 * no export, recorded no escape, and a later read of `label.title` resolved
 * source text a mutator had already replaced.
 */
test("a namespace handed out escapes a binding re-exported under an alias", () => {
  assert.equal(
    resolve({
      files: {
        "content.ts": `export const copy = { title: "Original" };\n`,
        "barrel.ts": `import { copy } from "./content";\nexport { copy as label };\n`,
        "hand-out.ts":
          `import * as barrel from "./barrel";\n` +
          `declare function sink(value: unknown): void;\nsink(barrel);\n`,
        "probe.tsx": `import { label } from "./barrel";\n` + probe("label.title"),
      },
      expression: "",
    }),
    null,
  );
});

/** The same barrel, with nothing handing the namespace out, still reads. */
test("a binding re-exported under an alias is read when nothing hands it out", () => {
  const resolved = resolve({
    files: {
      "content.ts": `export const copy = { title: "Original" };\n`,
      "barrel.ts": `import { copy } from "./content";\nexport { copy as label };\n`,
      "probe.tsx": `import { label } from "./barrel";\n` + probe("label.title"),
    },
    expression: "",
  });
  assert.equal(resolved?.value, "Original");
});

/**
 * A lowercase JSX tag names an ELEMENT, not a binding.
 *
 * React reads it as a string, so `<main>` is not a use of anything called
 * `main`. Counting it as one made the escape index believe a module-level
 * `main` had been handed out, and every read of it was refused — the safe
 * direction, but wrong, and it hides copy the site plainly renders.
 */
test("a host tag sharing a binding's name does not hand that binding out", () => {
  const resolved = resolve({
    files: {
      "probe.tsx":
        `const main = { title: "Hello" };\n` +
        `export function Probe() {\n  return <main>{main.title}</main>;\n}\n`,
      },
    expression: "main.title",
  });
  assert.equal(resolved?.value, "Hello");
});

/** A CAPITALISED tag is a use of the binding it names, and still escapes. */
test("a component tag sharing a binding's name does hand it out", () => {
  assert.equal(
    resolve({
      files: {
        "probe.tsx":
          `const Main = { title: "Hello" } as unknown as () => JSX.Element;\n` +
          `export function Probe() {\n  return <div><Main />{(Main as any).title}</div>;\n}\n`,
      },
      expression: "(Main as any).title",
    }),
    null,
  );
});

/**
 * A `switch` shares one scope across its unbraced clauses, and shadowing has
 * to see that. `case "shown": const copy = …` falling through to a clause that
 * renders `{copy.title}` shadows the module's `copy` — reading only the
 * clause the reference sits in missed it and resolved the module value, which
 * publishes text the page never shows.
 */
test("a binding in an earlier switch clause shadows the module's", () => {
  assert.equal(
    resolve({
      files: {
        "probe.tsx":
          `const copy = { title: "Module" };\ndeclare const which: string;\n` +
          `export function Probe() {\n  switch (which) {\n` +
          `    case "shown":\n      const copy = { title: "Local" };\n` +
          `    default:\n      return <p>{copy.title}</p>;\n  }\n}\n`,
      },
      expression: "copy.title",
    }),
    null,
  );
});

/** A BRACED clause does not shadow the clause after it. */
test("a binding braced inside a switch clause does not shadow a later one", () => {
  const resolved = resolve({
    files: {
      "probe.tsx":
        `const copy = { title: "Module" };\ndeclare const which: string;\n` +
        `export function Probe() {\n  switch (which) {\n` +
        `    case "shown": {\n      const copy = { title: "Local" };\n      void copy;\n      break;\n    }\n` +
        `    default:\n      break;\n  }\n  return <p>{copy.title}</p>;\n}\n`,
    },
    expression: "copy.title",
  });
  assert.equal(resolved?.value, "Module");
});
