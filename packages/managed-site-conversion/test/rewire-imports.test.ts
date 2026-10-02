import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import ts from "typescript";

import { applyRewrite, planRewrite } from "../src/rewire.js";
import { configFor, run, workspace } from "./support/proposals.js";

/**
 * The claim under test: the imports this rewrite adds land after the ones
 * already there, whatever shape those are in.
 *
 * The insertion point was the last line STARTING with `import`, which is not
 * the last line OF an import: a multi-line one
 *
 *     import {
 *       Eyebrow,
 *     } from "./Eyebrow";
 *
 * has exactly one such line, its first, so the new import was spliced between
 * `import {` and its own specifiers -- a file that no longer parses, from a
 * detail of formatting that nothing about the rewrite depends on. Prettier
 * writes that shape as soon as an import list is long enough, so it is a
 * question of when rather than whether.
 *
 * The assertion is on the PARSE, not on a line number, because what is being
 * claimed is that the file still means what it says.
 */
const RUNTIME = "@/src/content/managed-site";

/**
 * The fixture's page ALREADY imports `managedText` from the runtime, which is
 * the case that made the old check wrong: it asked whether the file imported
 * from that module at all, so a file holding one name was treated as holding
 * every name, and the `managedPage` the page root needs was never imported.
 */

test("an added import lands after a multi-line one", () => {
  const space = workspace("multilineimport", configFor(["/"]));
  applyRewrite(planRewrite(run(space), RUNTIME), RUNTIME);
  const file = join(space.repositoryRoot, "app/page.tsx");
  const text = readFileSync(file, "utf8");
  const source = ts.createSourceFile(
    file,
    text,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const diagnostics = (
    source as unknown as { parseDiagnostics?: readonly ts.Diagnostic[] }
  ).parseDiagnostics;
  assert.deepEqual(
    (diagnostics ?? []).map((diagnostic) =>
      ts.flattenDiagnosticMessageText(diagnostic.messageText, " "),
    ),
    [],
    `the rewritten file must still parse:\n${text}`,
  );
  const imports = source.statements.filter(ts.isImportDeclaration);
  assert.equal(
    imports.length,
    2,
    `the original import must survive beside the added one:\n${text}`,
  );
  // Exactly the names the file calls, and no others: importing the runtime's
  // whole surface made every rewritten file name four functions to use one,
  // and suppressing the import on the module PATH left a file that already
  // imported one of them without the one it had just been given.
  const runtimeImport =
    /import \{ ([^}]+) \} from "@\/src\/content\/managed-site";/u.exec(text);
  assert.notEqual(
    runtimeImport,
    null,
    `the runtime must be imported:\n${text}`,
  );
  const imported = (runtimeImport?.[1] ?? "").split(", ").sort();
  const called = [
    "managedFieldsFor",
    "managedItem",
    "managedPage",
    "managedText",
  ]
    .filter((name) => text.includes(`${name}(`))
    .sort();
  assert.deepEqual(imported, called, `imported must equal called:\n${text}`);
  // The same fixture states the second defect it found, which is not about
  // imports at all: the page's module and its values' module reach the writer
  // spelled differently when the repository is under a symlink, and the file
  // was read, edited and written TWICE -- the second pass applying offsets
  // taken from text the first had already changed. macOS puts every temporary
  // directory under a symlink, so every fixture in this suite is the case.
  assert.match(
    text,
    /<div className="contents" \{\.\.\.managedPage\("page_[a-z0-9]+"\)\}>\s*<main>/u,
    `the page root must wrap the page, not land inside an import:\n${text}`,
  );
});
