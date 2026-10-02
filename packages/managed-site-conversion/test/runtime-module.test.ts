import assert from "node:assert/strict";
import test from "node:test";
import ts from "typescript";

import { runtimeModule } from "../src/runtime-module.js";
import { configFor, run, workspace } from "./support/proposals.js";

/**
 * The runtime is GENERATED, so its defects are defects in a template and no
 * type-checker in this package ever sees them: the module is text until a
 * converted site compiles it. These assertions read the emitted source.
 *
 * The one that matters is the item record. It is built EAGERLY, for every item
 * of a collection at once, so a field whose value is not text throws for every
 * item before the component it is for renders anything. A link item field is
 * ordinary -- `<a href={item.href}><span>{item.title}</span></a>` gives a
 * collection one link field and one text field -- and `itemPropertyReads` only
 * looks at JSX children, so nothing about the link refuses the collection. The
 * server path reads one field at a time and never asks for it, which is why
 * only the client record needs the restriction.
 */
function generated(fixture: string): string {
  const space = workspace(fixture, configFor(["/"]));
  return runtimeModule(run(space), "src/content").text;
}

const emitted = generated("clientcollection");

test("the generated runtime parses", () => {
  const source = ts.createSourceFile(
    "managed-site.ts",
    emitted,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const diagnostics =
    (source as unknown as { parseDiagnostics?: readonly ts.Diagnostic[] })
      .parseDiagnostics ?? [];
  assert.deepEqual(
    diagnostics.map((one) =>
      ts.flattenDiagnosticMessageText(one.messageText, " "),
    ),
    [],
    `a template can be wrong in ways only a parser notices:\n${emitted}`,
  );
});

test("a client collection can carry a field whose value is not text", () => {
  // The shape the restriction is FOR: `<a href={item.href}><span>{item.title}</span></a>`
  // gives the collection a link item field beside its text ones, and nothing
  // about the link refuses the collection -- `itemPropertyReads` only looks at
  // JSX children. Without the filter the record throws for every item.
  const space = workspace("clientcollectionlink", configFor(["/"]));
  const draft = run(space).contractDraft as {
    readonly collections?: readonly {
      readonly itemFields: readonly { readonly type: string }[];
    }[];
  };
  const types = (draft.collections ?? []).flatMap((one) =>
    one.itemFields.map((field) => field.type),
  );
  assert.equal(
    types.includes("link"),
    true,
    `the fixture must actually produce a link item field: ${types.join(", ")}`,
  );
  assert.equal(types.includes("plain_text"), true, "beside text ones");
});

test("the item record asks only for fields it can represent", () => {
  assert.match(
    emitted,
    /const textFields = \[\.\.\.fields\]\.filter\(\s*\(\[, type\]\) => type === "plain_text" \|\| type === "heading_text",\s*\)/u,
    `a link item field's value is an object and would throw for every item:\n${emitted}`,
  );
  assert.match(
    emitted,
    /textFields\.map\(\(\[fieldId, type\]\) =>/u,
    "and the record is built from those, not from every declared field",
  );
});

test("it imports every content document the proposal produced", () => {
  const space = workspace("clientcollection", configFor(["/"]));
  const proposal = run(space);
  const emitted = runtimeModule(proposal, "src/content").text;
  for (const path of proposal.sourceDocuments.keys()) {
    const specifier = `./${path.replace(/^src\/content\//u, "")}`;
    assert.equal(
      emitted.includes(`from "${specifier}"`),
      true,
      `${path} is projected but never imported:\n${emitted}`,
    );
  }
});

test("it is written beside the contract it reads", () => {
  const space = workspace("clientcollection", configFor(["/"]));
  const emitted = runtimeModule(run(space), "src/content");
  assert.equal(emitted.path, "src/content/managed-site.ts");
  assert.match(emitted.text, /from "\.\/managed-site\.contract\.json"/u);
});
