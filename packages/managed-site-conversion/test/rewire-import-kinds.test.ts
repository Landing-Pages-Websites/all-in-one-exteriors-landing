import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import ts from "typescript";

import { applyRewrite, planRewrite } from "../src/rewire.js";
import { configFor, run, workspace } from "./support/proposals.js";

/**
 * The claim under test: a value this rewrite calls is never added to an
 * `import type`.
 *
 * Merging imports by name closed one hole and opened this one. A module that
 * already reads `import type { ManagedFields } from "<runtime>"` -- which is
 * every module a previous run gave the client prop to, so every re-run sees
 * them -- would have `managedText` appended to that same clause. An
 * `import type` clause is ERASED, so the file compiles as far as the type
 * checker letting a value through, and then calls a name that is not there.
 *
 * The rule is one-directional and the fixture says why: a TYPE may be added to
 * a value import, so only the value-into-type direction is refused, and the
 * runtime gets an import of its own.
 *
 * The fixture holds BOTH kinds from the runtime, which is the variant the first
 * fix missed: reading only the FIRST matching declaration found the type-only
 * one, discarded it as unusable for a value, and inserted a second value import
 * of `managedText` -- a name the file already imported, and a duplicate
 * identifier. Names are aggregated across every declaration now, and a value is
 * appended to a clause that can carry one.
 */
const RUNTIME = "@/src/content/managed-site";

function converted(): string {
  const space = workspace("typeonlyimport", configFor(["/"]));
  applyRewrite(planRewrite(run(space), RUNTIME), RUNTIME);
  return readFileSync(join(space.repositoryRoot, "app/page.tsx"), "utf8");
}

const page = converted();

test("a runtime call is never appended to an import type", () => {
  const source = ts.createSourceFile(
    "page.tsx",
    page,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  for (const statement of source.statements) {
    if (
      !ts.isImportDeclaration(statement) ||
      statement.importClause?.isTypeOnly !== true
    ) {
      continue;
    }
    const bindings = statement.importClause.namedBindings;
    const names =
      bindings !== undefined && ts.isNamedImports(bindings)
        ? bindings.elements.map((element) => element.name.text)
        : [];
    for (const name of names) {
      assert.equal(
        name.startsWith("managed") && name !== "ManagedFields",
        false,
        `${name} is called as a value, and an import type is erased:\n${page}`,
      );
    }
  }
});

test("a name already imported is not imported twice", () => {
  const value = page.match(
    /^import \{ [^}]*\} from "@\/src\/content\/managed-site";$/gmu,
  );
  assert.equal(value?.length, 1, `one value import, not two:\n${page}`);
  assert.equal(
    (page.match(/\bmanagedText\b(?=[,\s}])/gu) ?? []).length,
    1,
    `managedText must be imported exactly once:\n${page}`,
  );
});

test("the runtime it calls is imported as a value", () => {
  assert.match(
    page,
    /^import \{ managed\w+(?:, managed\w+)* \} from "@\/src\/content\/managed-site";$/mu,
    `the calls need a value import of their own:\n${page}`,
  );
  assert.match(
    page,
    /^import type \{ ManagedFields \} from "@\/src\/content\/managed-site";$/mu,
    `and the type import the file already had must survive:\n${page}`,
  );
});

/**
 * The other direction of the same rule, and the reason it is a refusal rather
 * than an insertion. A file that type-imports the very name the rewrite calls
 * cannot be given a value import of it: TypeScript reports `Duplicate
 * identifier` for a name bound by both, so emitting one would trade a silent
 * runtime failure for a compile error. Counting the type-only binding as
 * "already imported" is the silent failure; the run stops instead, naming the
 * file, and writes nothing.
 */
test("a value the file type-imports stops the run rather than being written twice", () => {
  const space = workspace("typeonlyvalue", configFor(["/"]));
  const page = join(space.repositoryRoot, "app/page.tsx");
  const before = readFileSync(page, "utf8");
  assert.throws(
    () => {
      applyRewrite(planRewrite(run(space), RUNTIME), RUNTIME);
    },
    /managedText.*as a TYPE/su,
    "the refusal must name the binding and why it cannot be written",
  );
  assert.equal(
    readFileSync(page, "utf8"),
    before,
    "and the file must be left exactly as it was",
  );
});

/**
 * The same conflict written the other way. TypeScript has two spellings for a
 * type-only binding and only one of them marks the CLAUSE: `import type { x }`
 * is a type-only declaration, while `import { type x, y }` is an ordinary
 * import carrying a type-only specifier. Reading `isTypeOnly` on the
 * declaration alone treated the second as supplying a value, so a generated
 * call got neither an import nor the refusal — the specifier is erased just the
 * same, and the call was left unbound.
 */
test("a per-specifier type modifier is a type-only binding too", () => {
  const space = workspace("inlinetypevalue", configFor(["/"]));
  const page = join(space.repositoryRoot, "app/page.tsx");
  const before = readFileSync(page, "utf8");
  assert.throws(
    () => {
      applyRewrite(planRewrite(run(space), RUNTIME), RUNTIME);
    },
    /managedText.*as a TYPE/su,
    "an erased specifier cannot supply the value the rewrite calls",
  );
  assert.equal(
    readFileSync(page, "utf8"),
    before,
    "and nothing may be written",
  );
});

/**
 * A refusal has to mean nothing was written, not that the rest was.
 *
 * Files were transformed and written one at a time, so a conflict found while
 * walking them left every earlier file already changed -- and `cli.ts` aborts
 * before writing the contract and the runtime, so the site was left importing
 * artifacts that do not exist. That is a worse state than either finishing or
 * refusing. Every file is staged and parsed before any of them is written now.
 *
 * The fixture's `Banner` is a receiver the rewrite WOULD edit, so it is the
 * evidence: it is untouched only because the page's conflict stopped the run
 * before the first write.
 */
test("a conflict in one file leaves every other file untouched", () => {
  const space = workspace("inlinetypevalue", configFor(["/"]));
  const banner = join(space.repositoryRoot, "components/Banner.tsx");
  const before = readFileSync(banner, "utf8");
  assert.equal(
    before.includes("headlineAttributes"),
    false,
    "the fixture must start unedited",
  );
  assert.throws(() => {
    applyRewrite(planRewrite(run(space), RUNTIME), RUNTIME);
  });
  assert.equal(
    readFileSync(banner, "utf8"),
    before,
    "a file the rewrite would otherwise edit must be left exactly as it was",
  );
});

test("the rewritten file still parses", () => {
  const source = ts.createSourceFile(
    "page.tsx",
    page,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const diagnostics =
    (source as unknown as { parseDiagnostics?: readonly ts.Diagnostic[] })
      .parseDiagnostics ?? [];
  assert.deepEqual(
    diagnostics.map((diagnostic) =>
      ts.flattenDiagnosticMessageText(diagnostic.messageText, " "),
    ),
    [],
  );
});
