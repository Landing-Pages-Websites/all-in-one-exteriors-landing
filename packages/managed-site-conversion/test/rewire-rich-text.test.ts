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
 * The claim under test: a formatted block is converted into ONE field that the
 * rewritten site renders through the elements it already used, and the field's
 * policy admits exactly what that block held.
 *
 * The contract side and the rewrite side are asserted from one run, because the
 * rewrite reads ids the same run minted. What renders is proven end to end by
 * the parity gate over `fixtures/next-unconverted`; this pins the shape of the
 * code and the policy that gate relies on, plus the two refusals the gate cannot
 * see because the reference site holds neither shape.
 */
const RUNTIME = "@/src/content/managed-site";
const WORKSPACE_MODULES = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "node_modules");

interface DraftField {
  readonly id: string;
  readonly type: string;
  readonly capabilities: readonly string[];
  readonly constraints?: Readonly<Record<string, unknown>>;
}

const space = workspace("formattedblocks", configFor(["/"]));
const proposal = run(space);
const plan = planRewrite(proposal, RUNTIME);
applyRewrite(plan, RUNTIME);
const page = readFileSync(join(space.repositoryRoot, "app/page.tsx"), "utf8");
const aside = readFileSync(join(space.repositoryRoot, "components/Aside.tsx"), "utf8");

const draft = proposal.contractDraft as unknown as {
  readonly pages: readonly { readonly sections: readonly { readonly fields: readonly DraftField[] }[] }[];
};
const richFields = draft.pages
  .flatMap((each) => each.sections)
  .flatMap((each) => each.fields)
  .filter((field) => field.type === "rich_text");

function fieldHolding(blockType: string): DraftField {
  const found = richFields.filter((field) => {
    const value = proposal.contentDraft.values.find((each) => each.fieldId === field.id);
    const document = value?.value as { readonly content: readonly { readonly type: string }[] };
    return document.content.length === 1 && document.content[0]?.type === blockType;
  });
  assert.ok(found.length >= 1, `no rich-text field holding one ${blockType}`);
  return found[0]!;
}

test("the contract the run proposed validates", () => {
  assert.notEqual(proposal.contract, null, JSON.stringify(proposal.report.findings, null, 2));
});

test("a formatted heading is one heading field, and only that", () => {
  const heading = fieldHolding("heading");
  assert.deepEqual(heading.constraints?.allowedBlocks, ["heading"]);
  assert.equal(heading.constraints?.maxBlocks, 1);
  assert.deepEqual(heading.constraints?.allowedMarks, ["italic"]);
  assert.equal(heading.constraints?.allowLinks, false);
  assert.deepEqual([...heading.capabilities].sort(), ["rich_text.mark.italic", "text.edit"]);
});

test("a paragraph with a link allows exactly the host and target it used", () => {
  const paragraphs = richFields.filter((field) => field.constraints?.allowLinks === true);
  assert.equal(paragraphs.length, 1);
  const paragraph = paragraphs[0]!;
  assert.deepEqual(paragraph.constraints?.allowedBlocks, ["paragraph"]);
  assert.equal(paragraph.constraints?.maxBlocks, 1);
  assert.deepEqual(paragraph.constraints?.allowedExternalHosts, ["example.com"]);
  assert.deepEqual(paragraph.constraints?.allowedTargets, ["new_window"]);
  assert.ok(paragraph.capabilities.includes("rich_text.link.edit"));
});

test("every proposed value is one its own field admits", () => {
  for (const field of richFields) {
    const value = proposal.contentDraft.values.find((each) => each.fieldId === field.id);
    assert.ok(value !== undefined, `no value for ${field.id}`);
    validateManagedFieldValue(field, value);
  }
});

test("the block's children become one read, each mark through the source's element", () => {
  const heading = fieldHolding("heading").id;
  assert.ok(
    page.includes(`<h2 {...managedRichTextAttributes("${heading}")}>`),
    `the heading element carries the annotation:\n${page}`,
  );
  assert.ok(
    page.includes(
      `{managedRichText("${heading}", { italic: (children) => ` +
        `<span className="italic text-accent" data-gomega-mark="italic">{children}</span> }).content}`,
    ),
    `the heading renders its italic through the source's span:\n${page}`,
  );
  assert.doesNotMatch(page, /Custom signage/u, "no source text is left beside the read");
  assert.match(
    page,
    /link: \(children, link\) => <a href=\{link\.href\} target=\{link\.target\} rel="noopener" data-gomega-mark="link">\{children\}<\/a>/u,
  );
  assert.match(page, /^import \{ managedPage, managedRichText, managedRichTextAttributes \} from "@\/src\/content\/managed-site";$/mu);
});

test("a formatted block in a client component is refused and left as written", () => {
  assert.ok(
    plan.refusals.some((refusal) => refusal.why === "client component holds a rich_text"),
    JSON.stringify(plan.refusals, null, 2),
  );
  assert.match(aside, /Held in a <em>client<\/em> component\./u);
  assert.doesNotMatch(aside, /managedRichText/u);
});

test("a list document is refused by the rewrite, not rendered in place", () => {
  assert.ok(
    plan.refusals.some(
      (refusal) => refusal.why === "rich text that is not one inline block is not rewired",
    ),
    JSON.stringify(plan.refusals, null, 2),
  );
  assert.match(page, /First <em>term<\/em>/u);
});

/**
 * The contract admits a prose link to any live page, so a customer can turn an
 * external link into one to a page of this site. The generated runtime must
 * render that, not throw: it resolves the page's path from the contract.
 */
test("the generated runtime renders a customer's internal link edit", async () => {
  const contract = proposal.contract as unknown as {
    readonly pages: readonly {
      readonly id: string;
      readonly route: { readonly kind: string; readonly path?: string };
      readonly sections: readonly { readonly fields: readonly DraftField[] }[];
    }[];
  };
  const home = contract.pages.find((one) => one.route.path === "/");
  assert.ok(home !== undefined);
  const linked = richFields.find((field) => field.constraints?.allowLinks === true)!;
  const binding = proposal.fields.find((one) => one.fieldId === linked.id);
  assert.ok(binding !== undefined);
  const sourcePath = binding.sourcePath;
  const edited = structuredClone(proposal.sourceDocuments.get(sourcePath)) as Record<string, unknown>;
  const document = binding.pointer
    .split("/")
    .slice(1)
    .reduce<unknown>((node, key) => (node as Record<string, unknown>)[key], edited) as {
    readonly content: readonly { readonly content: { marks?: { type: string; destination?: unknown }[] }[] }[];
  };
  const linkMark = document.content[0]!.content
    .flatMap((node) => node.marks ?? [])
    .find((mark) => mark.type === "link")!;
  linkMark.destination = { kind: "internal", pageId: home.id, fragment: "work" };
  validateManagedFieldValue(linked, {
    fieldId: linked.id,
    owner: { kind: "page", pageId: home.id },
    type: "rich_text",
    value: document,
  });

  const root = space.repositoryRoot;
  const contentRoot = proposal.contentRoot;
  mkdirSync(join(root, contentRoot), { recursive: true });
  writeFileSync(join(root, contentRoot, CONTRACT_FILE), JSON.stringify(proposal.contract));
  for (const [path, value] of proposal.sourceDocuments) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), JSON.stringify(path === sourcePath ? edited : value));
  }
  const runtime = runtimeModule(proposal, contentRoot);
  writeFileSync(join(root, runtime.path), runtime.text);
  // The runtime imports the contract package and React, as a converted site's
  // does; the scratch copy resolves them from this workspace.
  symlinkSync(WORKSPACE_MODULES, join(root, "node_modules"), "dir");
  writeFileSync(join(root, "package.json"), JSON.stringify({ type: "module" }));
  const generated = (await import(pathToFileURL(join(root, runtime.path)).href)) as {
    managedRichText: (
      id: string,
      templates: Record<string, unknown>,
    ) => { readonly content: ReactNode };
  };
  const html = renderToStaticMarkup(
    createElement(Fragment, null, generated.managedRichText(linked.id, {}).content),
  );
  assert.match(html, /<a href="\/#work" target="_blank" rel="noopener noreferrer" data-gomega-mark="link">show the work<\/a>/u, html);
});

/**
 * A link field's label is plain text, so a formatted label cannot be written
 * back without losing what the page shows, and the field does not offer it.
 * A plain label still is.
 */
test("a formatted link label is rewritten in place inside the link", () => {
  assert.match(
    page,
    /<a id="learn" href="https:\/\/example\.com\/learn" \{\.\.\.managedRichTextAttributes\("field_[a-z0-9]+"\)\}>\{managedRichText\("field_[a-z0-9]+", \{ italic: \(children\) => <span className="italic" data-gomega-mark="italic">\{children\}<\/span> \}\)\.content\}<\/a>/u,
    page,
  );
});

test("a formatted link label is not offered on the link field; a plain one is", () => {
  const links = draft.pages
    .flatMap((each) => each.sections)
    .flatMap((each) => each.fields)
    .filter((field) => field.type === "link");
  const labelled = (label: string): DraftField => {
    const found = links.find((field) => {
      const value = proposal.contentDraft.values.find((each) => each.fieldId === field.id);
      return (value?.value as { readonly label?: string } | undefined)?.label === label;
    });
    assert.ok(found !== undefined, `no link labelled ${label}`);
    return found;
  };
  assert.equal(labelled("Learn more").capabilities.includes("link.label.edit"), false);
  assert.equal(labelled("Plain link").capabilities.includes("link.label.edit"), true);
});
