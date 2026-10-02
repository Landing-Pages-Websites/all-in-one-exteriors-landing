import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { run } from "../src/parity-cli.js";

/**
 * The command itself, not the comparator behind it.
 *
 * The comparator had unit tests and the command had none, so its own work --
 * reading two build trees off disk, loading a contract, loading stylesheets,
 * and turning a report into an exit code -- was never executed by anything. A
 * gate nobody runs is not a gate, and a gate whose RUNNER is untested is the
 * same thing one layer down.
 */
interface Build {
  readonly pages: Readonly<Record<string, string>>;
  readonly css: string;
}

function tree(
  before: Build,
  after: Build,
): { before: string; after: string; cssBefore: string; cssAfter: string } {
  const root = mkdtempSync(join(tmpdir(), "parity-cli-"));
  const write = (build: Build, name: string): { html: string; css: string } => {
    const html = join(root, name, "app");
    const css = join(root, name, "css");
    mkdirSync(html, { recursive: true });
    mkdirSync(css, { recursive: true });
    for (const [page, text] of Object.entries(build.pages)) {
      const at = join(html, page);
      mkdirSync(join(at, ".."), { recursive: true });
      writeFileSync(at, text, "utf8");
    }
    writeFileSync(join(css, "style.css"), build.css, "utf8");
    return { html, css };
  };
  const one = write(before, "before");
  const two = write(after, "after");
  return {
    before: one.html,
    after: two.html,
    cssBefore: one.css,
    cssAfter: two.css,
  };
}

function contractAt(routes: readonly string[]): string {
  const root = mkdtempSync(join(tmpdir(), "parity-contract-"));
  const path = join(root, "managed-site.contract.json");
  writeFileSync(
    path,
    JSON.stringify({
      pages: routes.map((route) => ({
        route: { kind: "static", path: route },
      })),
    }),
    "utf8",
  );
  return path;
}

/** A page as the conversion leaves it: annotated, wrapped, otherwise identical. */
const CONVERTED = `<div class="contents" data-gomega-page-id="page_a"><main><h1 data-gomega-field-id="field_a">Signage that lasts</h1></main></div>`;
const ORIGINAL = `<main><h1>Signage that lasts</h1></main>`;
const BASE_CSS = ".a{color:red}";
const CONVERTED_CSS = ".a{color:red}.contents{display:contents}";

test("a conversion that changed nothing exits 0", () => {
  const at = tree(
    { pages: { "index.html": ORIGINAL }, css: BASE_CSS },
    { pages: { "index.html": CONVERTED }, css: CONVERTED_CSS },
  );
  assert.equal(
    run([
      at.before,
      at.after,
      "--contract",
      contractAt(["/"]),
      "--css",
      `${at.cssBefore},${at.cssAfter}`,
    ]),
    0,
  );
});

test("a changed word exits 1", () => {
  const at = tree(
    { pages: { "index.html": ORIGINAL }, css: BASE_CSS },
    {
      pages: { "index.html": CONVERTED.replace("lasts", "last") },
      css: CONVERTED_CSS,
    },
  );
  assert.equal(
    run([
      at.before,
      at.after,
      "--contract",
      contractAt(["/"]),
      "--css",
      `${at.cssBefore},${at.cssAfter}`,
    ]),
    1,
  );
});

test("a declared route with no file exits 1, and supplying it exits 0", () => {
  const missing = tree(
    { pages: { "index.html": ORIGINAL }, css: BASE_CSS },
    { pages: { "index.html": CONVERTED }, css: CONVERTED_CSS },
  );
  const contract = contractAt(["/", "/contact"]);
  assert.equal(
    run([
      missing.before,
      missing.after,
      "--contract",
      contract,
      "--css",
      `${missing.cssBefore},${missing.cssAfter}`,
    ]),
    1,
    "a route nothing compared is not a route it cleared",
  );
  const supplied = tree(
    {
      pages: { "index.html": ORIGINAL, "contact.html": ORIGINAL },
      css: BASE_CSS,
    },
    {
      pages: { "index.html": CONVERTED, "contact.html": CONVERTED },
      css: CONVERTED_CSS,
    },
  );
  assert.equal(
    run([
      supplied.before,
      supplied.after,
      "--contract",
      contract,
      "--css",
      `${supplied.cssBefore},${supplied.cssAfter}`,
    ]),
    0,
    "fetching it from a running build and dropping it in clears it",
  );
});

test("omitting --css is refused rather than passing", () => {
  const at = tree(
    { pages: { "index.html": ORIGINAL }, css: BASE_CSS },
    { pages: { "index.html": CONVERTED }, css: ".a{color:blue}" },
  );
  assert.equal(
    run([at.before, at.after, "--contract", contractAt(["/"])]),
    2,
    "absent stylesheets agree with absent stylesheets, which is not evidence",
  );
});

test("a stylesheet change the pages cannot show exits 1", () => {
  const at = tree(
    { pages: { "index.html": ORIGINAL }, css: BASE_CSS },
    {
      pages: { "index.html": CONVERTED },
      css: ".a{color:blue}.contents{display:contents}",
    },
  );
  assert.equal(
    run([
      at.before,
      at.after,
      "--contract",
      contractAt(["/"]),
      "--css",
      `${at.cssBefore},${at.cssAfter}`,
    ]),
    1,
  );
});

test("called without two trees it prints usage and exits 2", () => {
  assert.equal(run([]), 2);
});
