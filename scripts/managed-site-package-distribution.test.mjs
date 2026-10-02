import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const PACKAGE_NAME = "@landing-pages-websites/managed-site-contract";

function repositoryFile(path) {
  return new URL(`../${path}`, import.meta.url);
}

async function readSource(path) {
  return readFile(repositoryFile(path), "utf8");
}

async function readJson(path) {
  return JSON.parse(await readSource(path));
}

test("pins one restricted GitHub Packages identity across the workspace", async () => {
  const [root, fixture, nextFixture, contract, conversion, lock] = await Promise.all([
    readJson("package.json"),
    readJson("fixtures/astro-reference/package.json"),
    readJson("fixtures/next-unconverted/package.json"),
    readJson("packages/managed-site-contract/package.json"),
    readJson("packages/managed-site-conversion/package.json"),
    readJson("package-lock.json"),
  ]);

  // Taken from the package rather than restated, so releasing a version needs
  // no edit here and every other reference is still held to it. Written as a
  // literal, this test asked to be updated in step with the thing it exists to
  // keep in step, and a pin left behind reads as a stale expectation.
  const PACKAGE_VERSION = contract.version;
  assert.match(PACKAGE_VERSION, /^\d+\.\d+\.\d+$/u);

  assert.equal(contract.name, PACKAGE_NAME);
  assert.equal(contract.private, undefined);
  assert.deepEqual(contract.publishConfig, {
    access: "restricted",
    registry: "https://npm.pkg.github.com",
  });
  assert.deepEqual(contract.repository, {
    type: "git",
    url: "git+https://github.com/Landing-Pages-Websites/site-starter.git",
    directory: "packages/managed-site-contract",
  });
  assert.equal(root.dependencies[PACKAGE_NAME], PACKAGE_VERSION);
  assert.equal(fixture.dependencies[PACKAGE_NAME], PACKAGE_VERSION);
  // The Next reference site declares what its converted runtime imports, as a
  // customer site must (the converter refuses one that does not).
  assert.equal(nextFixture.dependencies[PACKAGE_NAME], PACKAGE_VERSION);
  assert.equal(
    lock.packages["fixtures/next-unconverted"].dependencies[PACKAGE_NAME],
    PACKAGE_VERSION,
  );
  // The conversion workspace depends on it too and was absent here, which is
  // how a bump reached CI with one pin still on the previous version.
  assert.equal(conversion.dependencies[PACKAGE_NAME], PACKAGE_VERSION);
  assert.equal(
    lock.packages["packages/managed-site-conversion"].dependencies[
      PACKAGE_NAME
    ],
    PACKAGE_VERSION,
  );
  assert.equal(lock.packages[""].dependencies[PACKAGE_NAME], PACKAGE_VERSION);
  assert.equal(
    lock.packages["fixtures/astro-reference"].dependencies[PACKAGE_NAME],
    PACKAGE_VERSION,
  );
  assert.equal(
    lock.packages["packages/managed-site-contract"].name,
    PACKAGE_NAME,
  );
  assert.equal(
    lock.packages["packages/managed-site-contract"].version,
    PACKAGE_VERSION,
  );
  assert.equal(
    lock.packages[`node_modules/${PACKAGE_NAME}`].resolved,
    "packages/managed-site-contract",
  );
  assert.equal(
    JSON.stringify(lock).includes("@gomega/managed-site-contract"),
    false,
  );
});

test("publishes manually from main with the repository token only", async () => {
  const [workflow, npmConfig] = await Promise.all([
    readSource(".github/workflows/managed-site-contract-publish.yml"),
    readSource(".npmrc"),
  ]);

  assert.match(workflow, /workflow_dispatch:/u);
  assert.match(workflow, /packages:\s+write/u);
  assert.match(workflow, /environment:\s+managed-site-contract-release/u);
  assert.match(workflow, /test "\$GITHUB_REF" = "refs\/heads\/main"/u);
  assert.match(workflow, /registry-url:\s+https:\/\/npm\.pkg\.github\.com/u);
  assert.match(workflow, /scope:\s+"@landing-pages-websites"/u);
  assert.match(workflow, /npm ci/u);
  assert.match(workflow, /run type-check/u);
  assert.match(workflow, /run test/u);
  assert.match(workflow, /run build/u);
  assert.match(
    workflow,
    /npm publish --workspace @landing-pages-websites\/managed-site-contract --access restricted/u,
  );
  assert.match(workflow, /NODE_AUTH_TOKEN:\s+\$\{\{ github\.token \}\}/u);
  assert.equal(workflow.match(/NODE_AUTH_TOKEN/gu)?.length, 1);
  assert.doesNotMatch(workflow, /secrets\./u);
  assert.doesNotMatch(workflow, /pull_request:/u);
  assert.equal(
    npmConfig,
    "@landing-pages-websites:registry=https://npm.pkg.github.com\n",
  );
});
