import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import type { JsonValue } from "@landing-pages-websites/managed-site-contract";

import { isJsonObject } from "../src/json-write.js";
import type { Proposal } from "../src/propose.js";
import { applyRewrite, planRewrite } from "../src/rewire.js";
import { CONTRACT_FILE, runtimeModule } from "../src/runtime-module.js";
import { configFor, run, workspace } from "./support/proposals.js";

/**
 * The claim under test: a rendered row is joined to a collection item by the
 * item's position in the SOURCE array, never by its position in the customer's
 * order.
 *
 * A converted collection's content document holds both. `items` is the
 * repository's own array, each entry carrying an `/id`, and it is what the
 * rewritten template maps over -- keeping each row's icon, key and click
 * behaviour from the code. `order.orderedItemIds` is the customer's
 * presentation order, and the editor rewrites it. They agree at conversion,
 * which is why nothing caught this: reading the Nth entry of the customer's
 * order gave the right item until the day someone reordered the collection,
 * and from then on a button kept one item's behaviour while displaying and
 * ANNOTATING another item's words. An editor click would then write the
 * customer's edit onto the wrong item.
 *
 * These tests run the generated runtime rather than reading its text, because
 * the defect is in what it resolves, not in what it says.
 */
const REVERSED = "reversed";
const AS_WRITTEN = "as written";

/**
 * The nearest `node_modules` above this file. The contract package is hoisted
 * to the workspace root, so it is not the package's own -- and a temporary
 * repository has none at all, which is why one is linked in.
 */
function installedPackages(): string {
  let directory = dirname(fileURLToPath(import.meta.url));
  while (!existsSync(join(directory, "node_modules"))) {
    const parent = dirname(directory);
    assert.notEqual(parent, directory, "no node_modules above this test");
    directory = parent;
  }
  return join(directory, "node_modules");
}

interface Converted {
  readonly proposal: Proposal;
  readonly runtimePath: string;
}

/**
 * A converted fixture on disk, with the customer's order left alone or
 * reversed. The runtime imports its documents at load, so the order has to be
 * decided before it is written.
 */
function convert(order: typeof REVERSED | typeof AS_WRITTEN): Converted {
  const space = workspace("clientcollection", configFor(["/"]));
  const proposal = run(space);
  const write = (path: string, value: unknown): void => {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify(value, null, 2), "utf8");
  };
  write(
    join(space.repositoryRoot, proposal.contentRoot, CONTRACT_FILE),
    proposal.contract,
  );
  for (const [path, document] of proposal.sourceDocuments) {
    write(
      join(space.repositoryRoot, path),
      order === REVERSED ? withReversedOrder(document) : document,
    );
  }
  // The generated runtime imports the contract package and is ESM.
  write(join(space.repositoryRoot, "package.json"), {
    name: "fixture",
    type: "module",
  });
  symlinkSync(installedPackages(), join(space.repositoryRoot, "node_modules"), "dir");
  const runtime = runtimeModule(proposal, proposal.contentRoot);
  const runtimePath = join(space.repositoryRoot, runtime.path);
  mkdirSync(dirname(runtimePath), { recursive: true });
  writeFileSync(runtimePath, runtime.text, "utf8");
  return { proposal, runtimePath };
}

/** Every `orderedItemIds` in a document, reversed, as an editor's reorder writes it. */
function withReversedOrder(value: JsonValue): JsonValue {
  if (Array.isArray(value)) return value.map(withReversedOrder);
  if (!isJsonObject(value)) return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [
      key,
      key === "orderedItemIds" && Array.isArray(entry)
        ? [...entry].reverse()
        : withReversedOrder(entry),
    ]),
  );
}

function collectionOf(proposal: Proposal): {
  readonly id: string;
  readonly fieldIds: readonly string[];
} {
  const collection = proposal.contract?.collections[0];
  assert.notEqual(collection, undefined, "the fixture declares a collection");
  return {
    id: collection?.id ?? "",
    fieldIds: (collection?.itemFields ?? []).map((field) => field.id),
  };
}

interface Runtime {
  managedItem(collectionId: string, index: number): { value(fieldId: string): string };
  managedItemsFor(
    collectionIds: readonly string[],
  ): Readonly<Record<string, readonly Readonly<Record<string, { value: string }>>[]>>;
}

function convertFixture(): { readonly read: (relative: string) => string } {
  const space = workspace("clientcollection", configFor(["/"]));
  applyRewrite(planRewrite(run(space), "@/src/content/managed-site"), "@/src/content/managed-site");
  return { read: (relative) => readFileSync(join(space.repositoryRoot, relative), "utf8") };
}

const asWritten = convert(AS_WRITTEN);
const reversed = convert(REVERSED);
const asWrittenRuntime = (await import(asWritten.runtimePath)) as Runtime;
const reversedRuntime = (await import(reversed.runtimePath)) as Runtime;

const SLIDES = [
  ["Where the network reaches", "Venue types"],
  ["Who it reaches", "Audiences"],
] as const;

test("the fixture's two items are distinguishable, or nothing below can fail", () => {
  const { id, fieldIds } = collectionOf(asWritten.proposal);

  assert.deepEqual(
    [0, 1].map((index) =>
      fieldIds.map((fieldId) => asWrittenRuntime.managedItem(id, index).value(fieldId)),
    ),
    SLIDES.map((slide) => [...slide]),
  );
});

test("reordering the collection does not move what a server row renders", () => {
  const { id, fieldIds } = collectionOf(reversed.proposal);

  assert.deepEqual(
    [0, 1].map((index) =>
      fieldIds.map((fieldId) => reversedRuntime.managedItem(id, index).value(fieldId)),
    ),
    SLIDES.map((slide) => [...slide]),
    "row 0 still renders the first item of the source array",
  );
});

test("reordering the collection does not move what a client row is handed", () => {
  const { id, fieldIds } = collectionOf(reversed.proposal);
  const items = reversedRuntime.managedItemsFor([id])[id] ?? [];

  assert.equal(items.length, 2);
  assert.deepEqual(
    items.map((item) => fieldIds.map((fieldId) => item[fieldId]?.value)),
    SLIDES.map((slide) => [...slide]),
    "the prop the client component receives is in source order too",
  );
});

/**
 * The server and client paths must agree item for item. They are separate
 * resolvers -- one reads a field at a time, the other builds the whole record
 * eagerly -- so a fix applied to one alone would show a component its own two
 * halves disagreeing.
 */
test("the server and client paths resolve the same item at the same index", () => {
  const { id, fieldIds } = collectionOf(reversed.proposal);
  const items = reversedRuntime.managedItemsFor([id])[id] ?? [];

  for (const [index, item] of items.entries()) {
    for (const fieldId of fieldIds) {
      const threaded = item[fieldId]?.value;
      if (threaded === undefined) continue;
      assert.equal(threaded, reversedRuntime.managedItem(id, index).value(fieldId));
    }
  }
});

/**
 * A collection's shape belongs to the code, and the contract says so.
 *
 * The rewritten template maps the repository's own array -- that is where each
 * row's icon, key and click behaviour come from -- so the rendered order is the
 * source order and the rendered count is the source length. The collection
 * field was nonetheless declared customer_editable with `collection.reorder`,
 * `collection.add` and `collection.remove`, offering three controls the site
 * cannot honour: a customer could reorder a collection in the editor and watch
 * the live page not move.
 *
 * Fixing the item IDENTITY, above, stopped a row showing another item's words.
 * It did not make the order the customer's, and the contract still said it was.
 */
test("a converted collection grants no capability the page cannot perform", () => {
  const proposal = run(workspace("clientcollection", configFor(["/"])));
  const collectionFields = (proposal.contract?.pages ?? [])
    .flatMap((page) => page.sections)
    .flatMap((section) => section.fields)
    .filter((field) => field.type === "collection");

  assert.equal(collectionFields.length, 1, "the fixture has one collection");
  for (const field of collectionFields) {
    assert.deepEqual(field.capabilities, [], "no reorder, no add, no remove");
    assert.equal(
      field.classification,
      "code_owned_interface",
      "and it is not offered as the customer's, which the standard would refuse with no capabilities",
    );
  }
});

/** The items are still the customer's, or the whole collection is pointless. */
test("the items of a code-owned collection are still editable", () => {
  const proposal = run(workspace("clientcollection", configFor(["/"])));
  const collection = proposal.contract?.collections[0];

  assert.notEqual(collection, undefined);
  const editable = (collection?.itemFields ?? []).filter(
    (field) => field.classification === "customer_editable",
  );
  assert.ok(editable.length > 0, "item text stays the customer's");
  for (const field of editable) {
    assert.deepEqual(field.capabilities, ["text.edit"]);
  }
});

/**
 * And the rewriter still rewires them. The binding it walks is the
 * COLLECTION's, so gating on that field's own classification -- now code-owned
 * -- stopped every collection being rewritten at all, which no test caught
 * until this one.
 */
test("a code-owned collection's items are still rewritten", () => {
  const { read } = convertFixture();

  assert.match(read("components/Carousel.tsx"), /managedItems\?\.\[/u);
  assert.match(read("app/page.tsx"), /managedItemsFor\(\[/u);
});
