import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const FIXTURE = "fixtures/astro-reference";
const BRIDGE_SOURCE = "https://app.gomega.ai/review-bridge/v10/review-bridge.js";
const BRIDGE_INTEGRITY =
  "sha384-/+5J7l1l8JNgnIgvgOqEHDgx92NrGmbjezpRb/MZb2y0RildsCcaOVu8+mLZbrmF";

function repositoryFile(path) {
  return new URL(`../${path}`, import.meta.url);
}

async function readSource(path) {
  return readFile(repositoryFile(path), "utf8");
}

async function readJson(path) {
  return JSON.parse(await readSource(path));
}

function collectResolverPaths(value, paths = new Set()) {
  if (value === null || typeof value !== "object") return paths;
  if (!Array.isArray(value) && value.kind === "json_pointer") {
    paths.add(value.path);
  }
  for (const child of Object.values(value)) collectResolverPaths(child, paths);
  return paths;
}

function generatedRoute(contract) {
  const page = contract.pages.find(
    (candidate) => candidate.route?.kind === "generated",
  );
  assert.notEqual(page, undefined);
  return page;
}

test("pins the isolated Astro 7 reference workspace", async () => {
  const [rootPackage, fixturePackage, astroConfig, tsconfig] =
    await Promise.all([
      readJson("package.json"),
      readJson(`${FIXTURE}/package.json`),
      readSource(`${FIXTURE}/astro.config.mjs`),
      readJson(`${FIXTURE}/tsconfig.json`),
    ]);

  assert.ok(rootPackage.workspaces.includes("fixtures/*"));
  assert.equal(fixturePackage.private, true);
  assert.equal(fixturePackage.dependencies.astro, "7.2.0");
  assert.equal(fixturePackage.devDependencies["@astrojs/check"], "0.9.10");
  assert.equal(fixturePackage.engines.node, ">=22.12.0");
  assert.match(astroConfig, /output:\s*"static"/u);
  assert.match(astroConfig, /publicDir:\s*"\.\.\/\.\.\/public"/u);
  assert.equal(tsconfig.extends, "astro/tsconfigs/strict");
});

test("defines one exact Astro contract and projected content checkpoint", async () => {
  const [contract, site, home, services, content, managedSource] =
    await Promise.all([
      readJson(`${FIXTURE}/src/content/managed-site.contract.json`),
      readJson(`${FIXTURE}/src/content/site.json`),
      readJson(`${FIXTURE}/src/content/pages/home.json`),
      readJson(`${FIXTURE}/src/content/collections/services.json`),
      readJson(`${FIXTURE}/src/content/managed-site.content.json`),
      readSource(`${FIXTURE}/src/lib/managed-site.ts`),
    ]);

  assert.deepEqual(contract.adapter, { kind: "astro", adapterVersion: "1.0" });
  assert.deepEqual(contract.bridge, {
    reviewProtocol: 1,
    editProtocol: 2,
    annotationVersion: 1,
    delivery: {
      version: "v10",
      src: BRIDGE_SOURCE,
      integrity: BRIDGE_INTEGRITY,
      crossOrigin: "anonymous",
      load: "head_defer",
    },
    framing: "authenticated_preview_gateway",
  });
  assert.deepEqual([...collectResolverPaths(contract)].sort(), [
    `${FIXTURE}/src/content/collections/services.json`,
    `${FIXTURE}/src/content/pages/home.json`,
    `${FIXTURE}/src/content/site.json`,
  ]);
  assert.equal(
    contract.pages.some(
      (page) => page.route?.kind === "static" && page.route.path === "/",
    ),
    true,
  );
  const generated = generatedRoute(contract);
  assert.deepEqual(generated.route.pattern, "/services/[slug]");
  const collection = contract.collections.find(
    (candidate) => candidate.id === generated.route.collectionId,
  );
  assert.notEqual(collection, undefined);
  const routeKey = collection?.itemFields.find(
    (field) => field.id === generated.route.routeKeyFieldId,
  );
  assert.deepEqual(
    {
      type: routeKey?.type,
      classification: routeKey?.classification,
      valueType: routeKey?.valueType,
      semantic: routeKey?.semantic,
    },
    {
      type: "internal_protected",
      classification: "internal_protected",
      valueType: "string",
      semantic: "route.slug",
    },
  );
  assert.equal(
    collection?.uniqueness.some(
      (rule) =>
        rule.comparison === "exact" &&
        rule.fieldIds.length === 1 &&
        rule.fieldIds[0] === routeKey?.id,
    ),
    true,
  );
  assert.equal(contract.internalSeo.pages.length, 1);
  assert.equal(contract.internalSeo.generatedPages.length, 1);
  assert.equal(typeof site.identity?.displayName, "string");
  assert.equal(Array.isArray(home.services?.order?.orderedItemIds), true);
  assert.equal(services.length >= 2, true);
  assert.equal(content.schemaVersion, "1.0");
  assert.equal(Array.isArray(content.values), true);
  assert.match(managedSource, /createManagedSiteAstroV1/u);
  for (const path of [
    "managed-site.contract.json",
    "site.json",
    "pages/home.json",
    "collections/services.json",
  ]) {
    assert.ok(managedSource.includes(path));
  }
});

test("renders only validated models through static and generated Astro pages", async () => {
  const [layout, homePage, servicePage, richText, styles] = await Promise.all([
    readSource(`${FIXTURE}/src/layouts/ManagedLayout.astro`),
    readSource(`${FIXTURE}/src/pages/index.astro`),
    readSource(`${FIXTURE}/src/pages/services/[slug].astro`),
    readSource(`${FIXTURE}/src/components/ManagedRichText.astro`),
    readSource(`${FIXTURE}/src/styles/global.css`),
  ]);
  const renderSource = [layout, homePage, servicePage, richText].join("\n");

  assert.match(layout, /managedSitePageAttributesV1/u);
  assert.match(layout, /is:inline/u);
  assert.ok(layout.includes(BRIDGE_SOURCE));
  assert.ok(layout.includes(BRIDGE_INTEGRITY));
  assert.match(homePage, /managedAstroHome/u);
  assert.match(homePage, /managedSiteFieldAttributesV1/u);
  // The same rule as the Next starter: a value inside a collection item is named
  // by its field and its item, or it is not addressable from the page at all.
  assert.match(
    homePage,
    /managedSiteFieldAttributesV1\(service\.heading\.fieldId, service\.itemId\)/u,
  );
  assert.match(
    homePage,
    /managedSiteFieldAttributesV1\(service\.summary\.fieldId, service\.itemId\)/u,
  );
  // The generated service route renders the same item's fields, so every value
  // it annotates is item-owned. A page-owned annotation there names a column and
  // leaves the row unaddressable, which is the whole defect one route over.
  for (const field of ["heading", "summary", "image", "body"]) {
    assert.match(
      servicePage,
      new RegExp(
        `managedSiteFieldAttributesV1\\(service\\.${field}\\.fieldId, service\\.itemId\\)`,
        "u",
      ),
      `the generated service route must name the item for ${field}`,
    );
  }
  // Nothing on that route is page-owned, so a bare annotation is a miss.
  assert.doesNotMatch(
    servicePage,
    /managedSiteFieldAttributesV1\(service\.[a-z]+\.fieldId\)/u,
  );
  assert.match(servicePage, /GetStaticPaths/u);
  assert.match(servicePage, /getStaticPaths/u);
  assert.match(servicePage, /managedAstroServicePaths/u);
  assert.match(servicePage, /managedSiteFieldAttributesV1/u);
  assert.match(renderSource, /application\/ld\+json/u);
  assert.doesNotMatch(renderSource, /set:html/u);
  assert.doesNotMatch(
    renderSource,
    /content\/(?:site|pages|collections).*\.json/u,
  );
  assert.match(styles, /prefers-reduced-motion/u);
  assert.match(styles, /:focus-visible/u);
});

test("makes projection, conformance, Astro check, and Astro build required", async () => {
  const [rootPackage, fixturePackage, checker, workflow] = await Promise.all([
    readJson("package.json"),
    readJson(`${FIXTURE}/package.json`),
    readSource(`${FIXTURE}/scripts/check-managed-site.mjs`),
    readSource(".github/workflows/site-starter-ci.yml"),
  ]);

  for (const script of [
    "conformance:astro-reference",
    "check:astro-reference",
    "build:astro-reference",
  ]) {
    assert.equal(typeof rootPackage.scripts[script], "string");
    assert.ok(workflow.includes(`npm run ${script}`));
  }
  assert.match(fixturePackage.scripts.conformance, /check-managed-site\.mjs/u);
  assert.match(checker, /createManagedSiteAstroV1/u);
  assert.match(checker, /canonicalizeJson/u);
  assert.match(checker, /gomega-managed-site-conformance/u);
  assert.doesNotMatch(checker, /writeFile|appendFile/u);
});

/**
 * The built HTML is tracked, so it is a deliverable: consuming or deploying it
 * runs whatever bridge it names, not whatever the source says. It had drifted
 * twice over -- still naming v6 after the layout moved to v7, and carrying no
 * item annotations at all after the templates started emitting them -- so the
 * artifact was describing a reference that no longer existed.
 *
 * Asserted against the same constants the source is, rather than against
 * whatever the file happens to contain, so a source change without a rebuild
 * fails here instead of shipping.
 */
test("the tracked Astro output matches the source it was built from", async () => {
  const pages = await Promise.all([
    readSource(`${FIXTURE}/dist/index.html`),
    readSource(`${FIXTURE}/dist/services/finish-repairs/index.html`),
    readSource(`${FIXTURE}/dist/services/seasonal-home-care/index.html`),
  ]);

  for (const page of pages) {
    assert.ok(
      page.includes(BRIDGE_SOURCE),
      "built page names the promoted bridge",
    );
    assert.ok(page.includes(BRIDGE_INTEGRITY), "built page pins its integrity");
    // Every bridge the page names is the promoted one; derived from the
    // constant so promoting the next version cannot leave this pinned to the
    // last.
    const promoted = BRIDGE_SOURCE.match(/review-bridge\/(v[0-9]+)\//u)[1];
    for (const [, version] of page.matchAll(/review-bridge\/(v[0-9]+)\//gu)) {
      assert.equal(version, promoted, "built page names no superseded delivery");
    }
    // Every value the reference renders inside a collection item is annotated
    // with the item that owns it, or an editor reading the page cannot tell two
    // rows apart. A rebuild is what puts them here.
    assert.match(page, /data-gomega-item-id="item_/u);
  }
  // A mark renders through the site's own element and names itself on it, so
  // an editor previewing a change can find and reuse that element. The
  // reference's service bodies carry marks, so a rebuild that dropped the
  // annotation shows here.
  assert.ok(
    pages.some((page) => /<(strong|em)[^>]* data-gomega-mark="(bold|italic)"/u.test(page)),
    "built rich text names its marks",
  );
});
