# C3A Contract Self-Conformance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add framework-neutral `ManagedSiteContractV1` semantic self-conformance validation and C3B-deferred contract facts.

**Architecture:** A typed fact collector is the only contract traversal. Small validators consume its facts in deterministic order, and a narrow orchestration function exposes the validated deferred facts without exposing Zod schemas.

**Tech Stack:** TypeScript, Node test runner via `tsx`, existing C1 ID/source primitives, C2 parsed contract types.

## Global Constraints

- Start from C2B `bba32a3d42ba3445ac466b49613a012dfc292ed5`.
- Contract-only; no content documents, encoders, schema generation, adapters, UI, filesystem reads, dependencies, or lockfile changes.
- Use only C1 kinds: contract, page, section, field, collection, item, asset, alias.
- Deterministic `ManagedSiteContractError` codes and order.
- Keep every file under 500 lines and the PR under 1,200 handwritten lines / 13 files.
- Run all focused commands with `NODE_OPTIONS='--max-old-space-size=768 --max-semi-space-size=16'`.

---

### Task 1: Contract-fact model and exhaustive collector

**Files:**
- Create: `packages/managed-site-contract/src/contract-semantics-facts.ts`
- Test: `packages/managed-site-contract/test/contract-semantics.test.ts`

**Produces:** Internal immutable declarations, references, resolver, route, alias, tombstone, and C3B-deferred facts for a parsed `ManagedSiteContractV1`.

- [ ] **Step 1: Write the failing fixture test.**

```ts
it("collects every C1 occurrence from a conforming every-variant contract", () => {
  const result = collectManagedSiteContractV1Facts(parseManagedSiteContractV1(conformingContract()));
  assert.deepEqual(result.deferred, {
    itemReferences: ["item_..."],
    contentOwnedAssets: [],
  });
});
```

- [ ] **Step 2: Run it and confirm failure because the internal collector is absent.**

Run: `NODE_OPTIONS='--max-old-space-size=768 --max-semi-space-size=16' npm run test:unit -- --test-concurrency=1`

- [ ] **Step 3: Implement only typed fact collection and exhaustive switches; do not create a root/public entry point.**

- [ ] **Step 4: Re-run the focused test and confirm it passes.**

### Task 2: Identity, reference, and alias validation

**Files:**
- Create: `packages/managed-site-contract/src/contract-semantics-identity.ts`
- Modify: `packages/managed-site-contract/src/contract-semantics-facts.ts`
- Test: `packages/managed-site-contract/test/contract-semantics.test.ts`

**Consumes:** Collector declaration/reference/alias/tombstone facts.

**Produces:** Deterministic rejection of duplicate/cross-kind/live-vs-tombstone IDs, wrong/unresolved/tombstoned/scope-invalid references, and alias overlap.

- [ ] **Step 1: Write literal table cases for every reference family and identity collision.**

```ts
for (const { name, mutate, code } of identityCases) {
  it(name, () => assertCode(() => validateManagedSiteContractV1Semantics(mutate(conformingContract())), code));
}
```

- [ ] **Step 2: Run and confirm each case fails before implementation.**

- [ ] **Step 3: Implement declaration registry, exact reference lookup, scope checks, and alias membership checks.**

- [ ] **Step 4: Re-run the matrix and confirm it passes.**

### Task 3: Source and route validation plus narrow orchestration

**Files:**
- Create: `packages/managed-site-contract/src/contract-semantics-source.ts`
- Create: `packages/managed-site-contract/src/contract-semantics-routes.ts`
- Create: `packages/managed-site-contract/src/contract-semantics.ts`
- Modify: `packages/managed-site-contract/src/index.ts`
- Test: `packages/managed-site-contract/test/contract-semantics.test.ts`

**Consumes:** Collected source and route facts plus validated live declaration map.

**Produces:** Public validator only if index convention requires it; otherwise internal narrow seam; errors for source aliases/pointer overlap and static/generated/redirect collisions.

- [ ] **Step 1: Add failing literal table matrices for paths/pointers and route collisions/non-collisions.**
- [ ] **Step 2: Run and confirm failure.**
- [ ] **Step 3: Implement non-overlap and route-key ownership checks, then call validators in the documented order.**
- [ ] **Step 4: Re-run focused tests; assert invalid contracts throw before a dummy later encoder callback could run.**

### Task 4: Simplify, review, and verification

**Files:** All changed C3A files only.

- [ ] **Step 1: Simplify changed files; split any function over 30 lines and remove duplication.**
- [ ] **Step 2: Run the code-reviewer report and address errors or material warnings.**
- [ ] **Step 3: Run focused serial tests, type-check, lint, and package build with the required memory cap.**
- [ ] **Step 4: Stage each C3A file explicitly, commit `feat: validate managed-site contract semantics`, push the branch, and open a PR without requesting Tommy.**

## Plan Self-Review

- C3A identity, reference, alias, source, and route requirements map to Tasks 1–3.
- C3B-only item/value/asset concerns remain deferred by Task 1 and excluded elsewhere.
- No placeholders, non-contract work, or dependency/schema-generation tasks are included.
