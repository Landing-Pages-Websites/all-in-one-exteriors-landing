import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { parseStableId } from "@landing-pages-websites/managed-site-contract";

import { IdLedger } from "../src/id-ledger.js";
import { propose, type Proposal } from "../src/propose.js";
import type { FindingCode } from "../src/report.js";
import { run, workspace, type Workspace } from "./support/proposals.js";

const CONFIG = {
  contentRoot: "src/content",
  assetRoot: "public",
  bridge: {
    version: "v10",
    src: "https://app.gomega.ai/review-bridge/v10/review-bridge.js",
    integrity: "sha384-/+5J7l1l8JNgnIgvgOqEHDgx92NrGmbjezpRb/MZb2y0RildsCcaOVu8+mLZbrmF",
    crossOrigin: "anonymous",
    load: "head_defer",
  },
  businessIdentity: {
    legalName: "Fixture Ltd",
    displayName: "Fixture",
    telephone: "+15555550100",
    email: "hello@example.com",
    description: "A fixture business.",
    sameAs: ["https://example.com/"],
  },
  pages: {
    "/": {
      purpose: "landing",
      canonical: "https://example.com/",
      sitemap: { included: true, changeFrequency: "monthly", priority: 0.5 },
      performanceBudget: {
        maxLcpMilliseconds: 2500,
        maxCls: 0.1,
        maxInpMilliseconds: 200,
        maxPageBytes: 2097152,
      },
    },
  },
};

function site(withConfig: boolean): Workspace {
  return workspace("site", withConfig ? CONFIG : null);
}

function codes(proposal: Proposal): ReadonlySet<FindingCode> {
  return new Set(proposal.report.findings.map((finding) => finding.code));
}

test("a fully supplied proposal satisfies the platform's own validators", () => {
  const proposal = run(site(true));
  assert.equal(proposal.validationError, null);
  assert.notEqual(proposal.contract, null);
});

test("without operator input the contract is withheld, not defaulted", () => {
  const proposal = run(site(false));
  assert.equal(proposal.contract, null);
  const reported = codes(proposal);
  assert.ok(reported.has("SEO_INPUT_REQUIRED"));
});

test("it proposes the values it can name and refuses the rest", () => {
  const proposal = run(site(true));
  const contract = proposal.contract;
  assert.notEqual(contract, null);
  if (contract === null) return;
  const fields = contract.pages.flatMap((page) =>
    page.sections.flatMap((section) => section.fields),
  );
  const byPointer = new Map<string, (typeof fields)[number]>(
    fields.map((field) => [field.resolver.pointer, field]),
  );

  // Named regions and durable link targets are proposed.
  assert.ok(byPointer.has("/home/services/h2/text"));
  assert.ok(byPointer.has("/home/services/p/text"));
  // Named by their role, because neither `#contact` nor `/hero.png` may name a
  // field this tool lets the customer rewrite.
  assert.ok(byPointer.has("/home/services/a/link"));
  assert.ok(byPointer.has("/home/services/img/image"));
  // A module constant's NAME is not the customer's to change, so it still tells
  // the header's third link apart from the other two.
  assert.ok(byPointer.has("/chrome/header/a/bookUrl/link"));
  // The element is part of the address, so two components taking the same
  // prop on one page cannot claim it.
  // The nav is named by its own `aria-label`, so the address says "primary"
  // rather than repeating the tag — two navs on a page are now distinct.
  assert.ok(byPointer.has("/chrome/header/primary/navAriaLabel/text"));

  // The unnamed section's twin paragraphs are not.
  assert.equal(
    fields.filter((field) => field.resolver.pointer === "/home/p/text").length,
    0,
  );
  // The nav's two fragment links differ only by a destination the customer may
  // rewrite, so neither is proposed and both are reported.
  assert.equal(
    fields.filter((field) => field.resolver.pointer.startsWith("/chrome/header/primary/a")).length,
    0,
  );
  const reported = codes(proposal);
  assert.ok(reported.has("AMBIGUOUS_ANCHOR"));
  assert.ok(reported.has("NO_DURABLE_ANCHOR"));
  assert.ok(reported.has("COLLECTION_ITEM_IMAGE_UNSUPPORTED"));
});

test("accessibility labels and self links stay out of customer authority", () => {
  const proposal = run(site(true));
  const contract = proposal.contract;
  assert.notEqual(contract, null);
  if (contract === null) return;
  const fields = contract.pages.flatMap((page) =>
    page.sections.flatMap((section) => section.fields),
  );
  const codeOwned = fields
    .filter((field) => field.classification === "code_owned_interface")
    .map((field) => field.resolver.pointer)
    .sort();
  assert.deepEqual(codeOwned, [
    "/chrome/header/a/self/link",
    "/chrome/header/primary/navAriaLabel/text",
    // A collection's ORDER and length, which the rewritten template takes from
    // the repository's own array along with each row's icon, key and click
    // behaviour. The items' text is the customer's; the shape is not, and a
    // contract that said otherwise offered reorder, add and remove controls
    // the page cannot honour.
    "/home/steps/steps/collection/order",
  ]);
  for (const field of fields) {
    if (field.classification !== "code_owned_interface") continue;
    assert.deepEqual(field.capabilities, [], "code-owned fields must grant nothing");
  }
});

test("internal SEO values never reach a customer-editable field", () => {
  const proposal = run(site(true));
  const contract = proposal.contract;
  assert.notEqual(contract, null);
  if (contract === null) return;
  const editablePointers = new Set(
    contract.pages
      .flatMap((page) => page.sections.flatMap((section) => section.fields))
      .map((field) => field.resolver.pointer),
  );
  for (const field of contract.internalSeo.protectedFields) {
    assert.equal(field.classification, "internal_protected");
    assert.ok(!editablePointers.has(field.resolver.pointer));
  }
  const semantics = contract.internalSeo.protectedFields.map((field) => field.semantic);
  assert.ok(semantics.includes("seo.title"));
  assert.ok(semantics.includes("seo.indexing"));
});

test("re-running keeps every ID and mints nothing new", () => {
  const space = site(true);
  const first = run(space);
  first.ledger.save(space.ledgerPath);
  const before = readFileSync(space.ledgerPath, "utf8");

  const second = run(space);
  second.ledger.save(space.ledgerPath);
  assert.equal(readFileSync(space.ledgerPath, "utf8"), before);

  const idsOf = (proposal: Proposal): readonly string[] =>
    (proposal.contract?.pages ?? [])
      .flatMap((page) => page.sections.flatMap((section) => section.fields))
      .map((field) => field.id)
      .sort();
  assert.deepEqual(idsOf(second), idsOf(first));
});

test("a removed value is tombstoned, never recycled", () => {
  const space = site(true);
  const first = run(space);
  first.ledger.save(space.ledgerPath);
  const removed = first.contract?.pages
    .flatMap((page) => page.sections.flatMap((section) => section.fields))
    .find((field) => field.resolver.pointer === "/home/services/p/text");
  assert.ok(removed !== undefined);

  const page = join(space.repositoryRoot, "app", "page.tsx");
  writeFileSync(
    page,
    readFileSync(page, "utf8").replace(
      "<p>One survey becomes a year of proof.</p>",
      "",
    ),
    "utf8",
  );
  const second = run(space);
  second.ledger.save(space.ledgerPath);
  assert.ok(second.contract?.tombstonedIds.includes(removed.id));
});

test("the ledger refuses to rebind an anchor to a different kind", () => {
  const ledger = IdLedger.empty();
  const anchor = "component:A/region:x/role:h2/text";
  const first = ledger.resolve("field", anchor);
  assert.equal(parseStableId(first, "field"), first);
  assert.throws(() => ledger.resolve("section", anchor), /refusing to rebind/u);
});

test("copy edits do not renumber the contract", () => {
  const space = site(true);
  const first = run(space);
  first.ledger.save(space.ledgerPath);
  const page = join(space.repositoryRoot, "app", "page.tsx");
  writeFileSync(
    page,
    readFileSync(page, "utf8").replace("What we do", "Something else entirely"),
    "utf8",
  );
  const second = run(space);
  const pointerFor = (proposal: Proposal, id: string): string | undefined =>
    proposal.contract?.pages
      .flatMap((entry) => entry.sections.flatMap((section) => section.fields))
      .find((field) => field.id === id)?.resolver.pointer;
  const heading = first.contract?.pages
    .flatMap((entry) => entry.sections.flatMap((section) => section.fields))
    .find((field) => field.resolver.pointer === "/home/services/h2/text");
  assert.ok(heading !== undefined);
  assert.equal(pointerFor(second, heading.id), "/home/services/h2/text");
});

test("collections carry item identity in the content, not in array order", () => {
  const proposal = run(site(true));
  const collection = proposal.contract?.collections[0];
  assert.ok(collection !== undefined);
  assert.equal(collection.itemIdPolicy, "server_minted");
  assert.equal(collection.itemIdPointer, "/id");
  const document = proposal.sourceDocuments.get("src/content/pages/home.json");
  assert.ok(document !== undefined);
  const serialised = JSON.stringify(document);
  assert.ok(serialised.includes('"id":"item_'));
});

test("missing routes make no proposal at all", () => {
  const empty = mkdtempSync(join(tmpdir(), "managed-site-empty-"));
  mkdirSync(join(empty, "app"), { recursive: true });
  assert.throws(
    () =>
      propose({
        repositoryRoot: join(empty, "missing"),
        configPath: null,
        ledgerPath: join(empty, "idmap.json"),
      }),
    /app directory/u,
  );
});
