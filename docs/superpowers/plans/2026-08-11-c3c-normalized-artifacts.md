# C3C Normalized Managed-Site Artifacts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce immutable canonical contract/content artifact bytes and registry-compatible SHA-256 digests only after the complete parsed contract/content pair passes C3A and C3B semantics.

**Architecture:** One public normalization boundary accepts the already-parsed `ManagedSiteContractV1` and `ManagedSiteContentDocument`. It runs `validateManagedSiteContractV1ContentSemantics`, serializes the exact parsed inputs with the existing RFC 8785/JCS implementation, separately serializes the embedded asset manifest, hashes those exact UTF-8 strings without a domain prefix so the results match the registry database constraints, and returns a shallow graph of deeply frozen scalar metadata. Array order remains part of exact revision identity; this PR performs canonical serialization, not semantic reordering.

**Tech Stack:** TypeScript 5, Node.js `node:crypto`, existing managed-site C1-C3B validation and JCS utilities, Node test runner, GitHub Actions.

## Global Constraints

- One risk domain: normalized artifact construction only.
- No conformance CLI, framework adapter, filesystem/source dereference, Site Guard execution, registry write, UI, or publishing behavior.
- No change to `digestCanonicalJson`; persisted revision digests are raw SHA-256 of exact canonical text because `managed_site_*_revisions` verifies `digest(canonical_text, 'sha256')`.
- The only public production function is `normalizeManagedSiteArtifactsV1`.
- The function accepts parsed/frozen C2 values and must run C3A+C3B before producing any artifact.
- Canonical contract/content arrays preserve declared order. JCS sorts object properties only.
- Returned artifact objects and the root result are frozen and expose no mutable source graph.
- Every changed source or test file remains below 500 lines.
- Local execution is limited to Git/static checks; cloud CI is authoritative to protect workstation RAM.

---

### Task 1: Define the failing normalization contract

**Files:**
- Create: `packages/managed-site-contract/test/normalized-artifacts.test.ts`
- Modify: `packages/managed-site-contract/test/public-surface.test.ts`

**Interfaces:**
- Consumes: `parseManagedSiteContractV1`, `parseManagedSiteContentDocument`, and the conforming C3B fixture.
- Produces: the expected public signature and immutable artifact shapes for Task 2.

- [ ] **Step 1: Add the public API compile/runtime expectation**

Define the wished-for API:

```ts
const artifacts = normalizeManagedSiteArtifactsV1(contract, content);
assert.equal(artifacts.contract.schemaVersion, "1.0");
assert.equal(artifacts.contract.adapterKind, contract.adapter.kind);
assert.equal(artifacts.contract.adapterVersion, contract.adapter.adapterVersion);
assert.equal(artifacts.contract.canonicalContractJson, canonicalizeJson(contract));
assert.equal(artifacts.content.schemaVersion, "1.0");
assert.equal(artifacts.content.canonicalContentJson, canonicalizeJson(content));
assert.equal(
  artifacts.content.canonicalAssetManifestJson,
  canonicalizeJson(content.assetManifest),
);
```

Pin the return type as deeply readonly with `@ts-expect-error` assignments against the root and both nested records.

- [ ] **Step 2: Add exact digest and revision-identity tests**

Use a test-only `createHash("sha256").update(value, "utf8").digest("hex")` oracle to prove each digest hashes the returned exact string. Assert the contract artifact digest differs from the existing domain-separated `digestCanonicalJson(contract)`. Reorder two valid content values and prove both canonical content and `contentSha256` change while the parsed graphs remain semantically valid. With two valid manifest entries, reverse only the manifest and prove both content and manifest digests change.

- [ ] **Step 3: Add fail-closed and freeze tests**

Assert an invalid parsed contract/content relationship fails with the expected `CONTENT_*` error and returns no artifact. Recursively verify the root, `contract`, and `content` result records are frozen. Parse each canonical string with `JSON.parse` and assert deep equality with its source value.

- [ ] **Step 4: Push the red test-only commit**

Stage only the plan and test files and commit:

```bash
git add docs/superpowers/plans/2026-08-11-c3c-normalized-artifacts.md
git add packages/managed-site-contract/test/normalized-artifacts.test.ts
git add packages/managed-site-contract/test/public-surface.test.ts
git commit -m "test: define normalized managed-site artifacts"
git push -u origin peter/managed-site-normalized-artifacts
```

Open draft PR #13 (or the next assigned number). Cloud CI must fail specifically because `normalizeManagedSiteArtifactsV1` and its artifact types do not exist. Test/setup/type errors are not an acceptable red state.

### Task 2: Implement registry-compatible canonical artifacts

**Files:**
- Create: `packages/managed-site-contract/src/normalized-artifacts.ts`
- Modify: `packages/managed-site-contract/src/index.ts`
- Test: `packages/managed-site-contract/test/normalized-artifacts.test.ts`
- Test: `packages/managed-site-contract/test/public-surface.test.ts`

**Interfaces:**
- Consumes: `validateManagedSiteContractV1ContentSemantics`, `canonicalizeJson`, `ManagedSiteContractV1`, and `ManagedSiteContentDocument`.
- Produces:

```ts
export interface ManagedSiteContractArtifactV1 {
  readonly schemaVersion: "1.0";
  readonly adapterKind: "nextjs" | "astro";
  readonly adapterVersion: "1.0";
  readonly canonicalContractJson: string;
  readonly contractSha256: string;
}

export interface ManagedSiteContentArtifactV1 {
  readonly schemaVersion: "1.0";
  readonly canonicalContentJson: string;
  readonly contentSha256: string;
  readonly canonicalAssetManifestJson: string;
  readonly assetManifestSha256: string;
}

export interface ManagedSiteNormalizedArtifactsV1 {
  readonly contract: ManagedSiteContractArtifactV1;
  readonly content: ManagedSiteContentArtifactV1;
}

export function normalizeManagedSiteArtifactsV1(
  contract: ManagedSiteContractV1,
  content: ManagedSiteContentDocument,
): ManagedSiteNormalizedArtifactsV1;
```

- [ ] **Step 1: Implement exact-text hashing**

Add a private helper that hashes the already-canonical string, not the source value:

```ts
function sha256Text(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}
```

Do not reuse `digestCanonicalJson`, because its domain prefix intentionally produces a different identity than the database revision constraint.

- [ ] **Step 2: Implement the validation-first artifact builder**

The public function must:

1. call `validateManagedSiteContractV1ContentSemantics(contract, content)`;
2. canonicalize `contract`, `content`, and `content.assetManifest` exactly once each;
3. construct and freeze the contract record;
4. construct and freeze the content record; and
5. freeze and return the root record.

No parsed input, source path, resolver index, or private semantic fact may be returned.

- [ ] **Step 3: Export the function and readonly types from the package root**

Add the production function to the root function inventory and export only the three artifact interfaces. Do not export `sha256Text` or any internal serializer.

- [ ] **Step 4: Push the green implementation commit**

Stage the exact source/test files and commit:

```bash
git add packages/managed-site-contract/src/normalized-artifacts.ts
git add packages/managed-site-contract/src/index.ts
git add packages/managed-site-contract/test/normalized-artifacts.test.ts
git add packages/managed-site-contract/test/public-surface.test.ts
git commit -m "feat: normalize managed-site revision artifacts"
git push origin peter/managed-site-normalized-artifacts
```

Cloud CI must pass starter behavior, package type-check, all package tests, fixed-point schema build, lint, and production starter build.

### Task 3: Simplify, self-attack, and ship

**Files:**
- Review: every file in `origin/main...HEAD`
- Modify only if a class-wide defect is found.

**Interfaces:**
- Consumes: the complete Task 2 diff and exact-head cloud evidence.
- Produces: a merge-ready one-domain PR with no unresolved Important/Critical finding.

- [ ] **Step 1: Run the simplify review statically**

Check for duplicate canonicalization/hashing, functions longer than 30 lines, unsafe casts, `any`, debug artifacts, exported internals, mutable result records, and hidden semantic reordering. Keep all source/test files below 500 lines.

- [ ] **Step 2: Self-attack the artifact identity class**

Verify at least these adjacent variants:

- object property insertion order yields the same canonical text;
- valid array reordering yields a different exact revision identity;
- manifest-only changes alter both the embedded content digest and manifest digest;
- semantic failure occurs before artifact construction;
- raw database-compatible SHA differs from the existing domain-separated helper; and
- every returned object is frozen and contains scalar metadata only.

- [ ] **Step 3: Perform the fresh local static deep review**

Run only short Git/static commands:

```bash
git diff --check origin/main...HEAD
git status --short --branch
rg -n '\bany\b|console\.|debugger|@ts-ignore|eslint-disable|TODO|FIXME' \
  packages/managed-site-contract/src/normalized-artifacts.ts \
  packages/managed-site-contract/test/normalized-artifacts.test.ts
wc -l packages/managed-site-contract/src/normalized-artifacts.ts \
  packages/managed-site-contract/test/normalized-artifacts.test.ts
```

Do not run a local Node, Jest, TypeScript, lint, build, or browser process.

- [ ] **Step 4: Publish exact-head evidence and merge**

Update the PR description with the red and green cloud run IDs, exact head SHA, passed job steps, scope, and local static review result. Mark the PR ready only when exact-head CI is green. Site-starter receives fresh local deep review instead of Tommy. Squash-merge, record the merge SHA, and clean only this verified feature worktree/local branch.
