import assert from "node:assert/strict";
import { mkdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import { createElement, Fragment, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { validateManagedFieldValue } from "@landing-pages-websites/managed-site-contract";

import { applyRewrite, planRewrite } from "../src/rewire.js";
import { CONTRACT_FILE, runtimeModule } from "../src/runtime-module.js";
import { configFor, run, workspace } from "./support/proposals.js";

/**
 * The claim under test: a block drawn on several lines converts into ONE field
 * whose line breaks are `hard_break` nodes, its policy opts into breaks because
 * the block had them, the rewrite renders each break through the source's own
 * `<br>`, and the generated runtime draws a break the customer adds (or a block
 * with no break template) as `<br data-gomega-break="">`.
 */
const RUNTIME = "@/src/content/managed-site";
const WORKSPACE_MODULES = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "node_modules");

interface DraftField {
  readonly id: string;
  readonly type: string;
  readonly constraints?: Readonly<Record<string, unknown>>;
}

const space = workspace("linebreaks", configFor(["/"]));
const proposal = run(space);
const plan = planRewrite(proposal, RUNTIME);
applyRewrite(plan, RUNTIME);
const page = readFileSync(join(space.repositoryRoot, "app/page.tsx"), "utf8");

const draft = proposal.contractDraft as unknown as {
  readonly pages: readonly { readonly sections: readonly { readonly fields: readonly DraftField[] }[] }[];
};
const richFields = draft.pages
  .flatMap((each) => each.sections)
  .flatMap((each) => each.fields)
  .filter((field) => field.type === "rich_text");

function valueOf(field: DraftField): { readonly content: readonly { readonly type: string; readonly content: unknown }[] } {
  const value = proposal.contentDraft.values.find((each) => each.fieldId === field.id);
  assert.ok(value !== undefined, `no value for ${field.id}`);
  return value.value as { readonly content: readonly { readonly type: string; readonly content: unknown }[] };
}

function fieldHolding(blockType: string): DraftField {
  const found = richFields.find((field) => valueOf(field).content[0]?.type === blockType);
  assert.ok(found !== undefined, `no rich-text field holding a ${blockType}`);
  return found;
}

test("the contract the run proposed validates", () => {
  assert.notEqual(proposal.contract, null, JSON.stringify(proposal.report.findings, null, 2));
});

test("a heading drawn on two lines is one heading whose break is a node", () => {
  const heading = fieldHolding("heading");
  assert.deepEqual(valueOf(heading).content, [
    {
      type: "heading",
      attrs: { level: 1 },
      content: [
        { type: "text", text: "Grow your" },
        { type: "hard_break" },
        { type: "text", text: "business " },
        { type: "text", text: "with us", marks: [{ type: "italic" }] },
      ],
    },
  ]);
});

test("a field opts into breaks exactly when its block had one, with no cap", () => {
  assert.equal(richFields.length, 2);
  for (const field of richFields) {
    assert.equal(field.constraints?.allowHardBreaks, true, field.id);
    assert.equal("maxHardBreaks" in (field.constraints ?? {}), false, field.id);
    validateManagedFieldValue(field, proposal.contentDraft.values.find((each) => each.fieldId === field.id)!);
  }
});

test("each break renders through the source's own <br>, class kept", () => {
  const heading = fieldHolding("heading").id;
  assert.ok(
    page.includes(
      `{managedRichText("${heading}", { italic: (children) => ` +
        `<span className="italic" data-gomega-mark="italic">{children}</span>, ` +
        `hard_break: () => <br data-gomega-break="" /> }).content}`,
    ),
    page,
  );
  assert.ok(page.includes(`hard_break: () => <br className="hidden md:block" data-gomega-break="" />`), page);
  assert.doesNotMatch(page, /Grow your/u, "no source text is left beside the read");
});

test("the generated runtime draws breaks through a template, and as <br data-gomega-break> without one", async () => {
  const root = space.repositoryRoot;
  const contentRoot = proposal.contentRoot;
  mkdirSync(join(root, contentRoot), { recursive: true });
  writeFileSync(join(root, contentRoot, CONTRACT_FILE), JSON.stringify(proposal.contract));
  for (const [path, value] of proposal.sourceDocuments) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), JSON.stringify(value));
  }
  const runtime = runtimeModule(proposal, contentRoot);
  writeFileSync(join(root, runtime.path), runtime.text);
  symlinkSync(WORKSPACE_MODULES, join(root, "node_modules"), "dir");
  writeFileSync(join(root, "package.json"), JSON.stringify({ type: "module" }));
  const generated = (await import(pathToFileURL(join(root, runtime.path)).href)) as {
    managedRichText: (id: string, templates: Record<string, unknown>) => { readonly content: ReactNode };
    managedRichTextBlocks: (id: string) => { readonly value: ReactNode };
  };
  const html = (node: ReactNode): string => renderToStaticMarkup(createElement(Fragment, null, node));
  const heading = fieldHolding("heading").id;

  assert.equal(
    html(generated.managedRichText(heading, {}).content),
    `Grow your<br data-gomega-break=""/>business <em data-gomega-mark="italic">with us</em>`,
  );
  assert.equal(
    html(
      generated.managedRichText(heading, {
        hard_break: () => createElement("span", { className: "line-end", "data-gomega-break": "" }),
      }).content,
    ),
    `Grow your<span class="line-end" data-gomega-break=""></span>business <em data-gomega-mark="italic">with us</em>`,
  );
  const paragraph = fieldHolding("paragraph").id;
  assert.equal(
    html(generated.managedRichTextBlocks(paragraph).value),
    `<p><strong data-gomega-mark="bold">Open late,<br data-gomega-break=""/>every day</strong> of the week.</p>`,
  );
});
