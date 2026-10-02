# Managed-Site Conformance CLI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a deterministic, framework-neutral command that reads exact generated contract/content JSON, runs C1-C3C, and emits one canonical normalized artifact line for Site Guard and adapter pipelines.

**Architecture:** A pure internal text boundary parses raw JSON with `parseJsonText`, validates the C2 roots, and delegates to `normalizeManagedSiteArtifactsV1`. A small injected-I/O runner owns exact arguments, stable exit codes, and canonical success/error envelopes. A separate executable shim supplies a bounded, fatal-UTF-8, regular-file-only reader and process streams; the package exposes the binary but no new root API.

**Tech Stack:** TypeScript 5, Node.js filesystem/TextDecoder/process APIs, existing managed-site contract package, Node test runner, npm package bins, GitHub Actions.

## Global Constraints

- One risk domain: framework-neutral conformance CLI only.
- Exact invocation: `gomega-managed-site-conformance --contract <path> --content <path>`.
- `--help` is the only alternate invocation; unknown, duplicate, missing, or positional arguments fail usage.
- Success writes one canonical JSON line to stdout and nothing to stderr.
- Failure writes one canonical `{code,message}` JSON line to stderr, no stack/raw input, and nothing to stdout.
- Exit classes: `0` success/help, `1` unexpected internal failure, `2` usage, `3` input I/O/encoding/size/type, `4` managed JSON/schema/semantic failure.
- Input files must be regular non-symlink files, no larger than `HARD_MAX_JSON_TEXT_BYTES`, and valid UTF-8 decoded with `fatal: true`.
- The CLI writes no files and has no GitHub, Vercel, registry, adapter, UI, or publishing behavior.
- No new runtime dependency and no new package-root function/type export.
- Every changed source/test file remains below 500 lines.
- Local execution remains Git/static only; cloud CI is authoritative under the workstation RAM guardrail.

---

### Task 1: Record the failing executable contract

**Files:**
- Create: `packages/managed-site-contract/test/conformance-cli.test.ts`
- Create: `packages/managed-site-contract/test/conformance-cli-files.test.ts`
- Modify: `packages/managed-site-contract/test/runtime.test.mjs`
- Modify: `packages/managed-site-contract/package.json`

**Interfaces:**
- Consumes: the conforming C3B fixture and C3C artifact output.
- Produces: exact runner/input interfaces and binary name required by Tasks 2-3.

- [ ] **Step 1: Add runner success and deterministic output tests**

Wish for this internal interface:

```ts
interface ManagedSiteConformanceCliIo {
  readonly readUtf8File: (path: string) => string;
  readonly writeStdout: (value: string) => void;
  readonly writeStderr: (value: string) => void;
}

runManagedSiteConformanceCli(
  ["--contract", "contract.json", "--content", "content.json"],
  io,
): 0 | 1 | 2 | 3 | 4;
```

Provide the conforming fixture as raw `JSON.stringify` text through fake I/O. Assert exactly one newline-terminated canonical artifact envelope on stdout, empty stderr, and deep equality with `normalizeManagedSiteArtifactsV1` after parsing.

- [ ] **Step 2: Add table-driven usage, input, and conformance failures**

Cover help, empty args, missing values, duplicate flags, unknown flags, extra positionals, reader failure, exact duplicate JSON keys, invalid schema, and valid local roots with a broken contract/content relationship. Assert zero reads for usage failures, stable exit class, one canonical error line, no stack, no raw input, and empty opposite stream.

Add a separate real-filesystem matrix proving a regular UTF-8 file succeeds, the exact hard cap succeeds, one byte over fails, invalid UTF-8 fails without replacement, and directory/symlink/missing paths fail identically without exposing their paths.

- [ ] **Step 3: Add the package-bin/runtime expectation**

Declare:

```json
"bin": {
  "gomega-managed-site-conformance": "./dist/conformance-cli.js"
}
```

Extend `runtime.test.mjs` to require the built bin target in the dry-run package manifest and invoke `node <bin> --help`, expecting the exact usage line and status `0`.

- [ ] **Step 4: Push the red test-only commit**

Commit the plan, package declaration, and tests. Open draft PR #14 (or the next assigned number). Cloud CI must fail specifically because the internal runner/executable modules do not exist or the declared bin target is absent; unrelated test/type errors are not an acceptable red state.

### Task 2: Implement the pure text boundary and CLI runner

**Files:**
- Create: `packages/managed-site-contract/src/conformance-input.ts`
- Create: `packages/managed-site-contract/src/conformance-cli-runner.ts`
- Test: `packages/managed-site-contract/test/conformance-cli.test.ts`

**Interfaces:**
- `conformManagedSiteJsonText(contractText: string, contentText: string): ManagedSiteNormalizedArtifactsV1` is internal-only.
- `runManagedSiteConformanceCli(argv, io): ManagedSiteConformanceExitCode` is internal-only and dependency-injected.

- [ ] **Step 1: Parse raw text through the complete trust chain**

`conformManagedSiteJsonText` must call `parseJsonText` for both files, then `parseManagedSiteContractV1`, `parseManagedSiteContentDocument`, and `normalizeManagedSiteArtifactsV1`. It returns only the already-frozen C3C result. Duplicate keys and hostile JSON must fail at C1 before schema/semantics.

- [ ] **Step 2: Implement exact argument parsing**

Accept only the two required flags once each in either order, or exactly `--help`. Reject empty paths, values beginning with `--`, missing/extra/duplicate/unknown arguments, and positionals before any read. Keep usage text in one named constant shared with the executable/runtime assertion.

- [ ] **Step 3: Implement stable success and failure envelopes**

On success, write `canonicalizeJson(artifacts) + "\n"`. Map `ManagedSiteContractError` to exit `4` with its stable code/message. Wrap reader failures as `CONFORMANCE_INPUT_IO` exit `3`. Map unexpected failures to `CONFORMANCE_INTERNAL` exit `1` with a fixed message. Usage emits `CONFORMANCE_USAGE` exit `2`. Never include raw JSON, filesystem exception detail, or stacks.

- [ ] **Step 4: Push the runner implementation commit**

Commit only the two source modules and focused test adjustments. Cloud type-check and unit tests must pass before adding the executable shim.

### Task 3: Add the bounded executable and package proof

**Files:**
- Create: `packages/managed-site-contract/src/conformance-cli.ts`
- Create: `packages/managed-site-contract/src/conformance-cli-files.ts`
- Modify: `packages/managed-site-contract/test/runtime.test.mjs`
- Modify: `packages/managed-site-contract/package.json`

**Interfaces:**
- Consumes: `runManagedSiteConformanceCli` and `MANAGED_SITE_CONFORMANCE_USAGE`.
- Produces: installed binary `gomega-managed-site-conformance` at `./dist/conformance-cli.js`.

- [ ] **Step 1: Implement bounded regular-file reads**

The executable reader must use `lstatSync` before reading, reject symlinks/non-files, reject a pre-read size above `HARD_MAX_JSON_TEXT_BYTES`, read one `Buffer`, recheck actual byte length, and decode with `new TextDecoder("utf-8", { fatal: true })`. Convert every filesystem/encoding failure to `ManagedSiteContractError("CONFORMANCE_INPUT_IO", "Unable to read <contract|content> input")` without provider detail.

- [ ] **Step 2: Add the executable shim**

Use a Node shebang, call the runner with `process.argv.slice(2)`, write through `process.stdout.write`/`process.stderr.write`, and assign the returned code to `process.exitCode`. The shim exports nothing and performs no work beyond this wiring.

- [ ] **Step 3: Prove the packed runtime**

The existing runtime build/pack test must prove the bin target exists in `dist` and the dry-run tar manifest, then invoke its `--help` path with stock Node. The full semantic path remains covered by the injected unit test using exact raw fixture text.

- [ ] **Step 4: Push the executable implementation commit**

Commit the shim, package bin, and runtime proof. Cloud CI must pass starter behavior, package type-check, unit/runtime tests, fixed-point schema build, lint, and production starter build.

### Task 4: Simplify, review, and merge

**Files:**
- Review: every file in `origin/main...HEAD`.
- Modify only for a class-wide defect.

**Interfaces:**
- Consumes: exact-head cloud evidence and the complete CLI diff.
- Produces: a merge-ready one-domain PR with no unresolved Important/Critical finding.

- [ ] **Step 1: Run static simplify and self-attack**

Check functions over 30 lines, duplicate error/output logic, `any`, debug artifacts, mutable exports, unbounded reads, symlink/non-file handling, invalid UTF-8, duplicate JSON keys, flag permutations, writer failures, secret-bearing errors, and bin packaging. Add table-driven cases for every discovered defect class before changing production.

- [ ] **Step 2: Perform the fresh local static deep review**

Run only `git diff --check`, status, focused `rg`, `wc -l`, and source/diff inspection. Do not run local Node/Jest/TypeScript/lint/build/browser processes.

- [ ] **Step 3: Publish evidence and merge**

Update the PR description with the red/green run IDs, exact head, all cloud steps, output/exit contracts, diff scope, and static review result. Mark ready only when exact-head CI is green. Site-starter receives fresh local deep review instead of Tommy. Squash-merge, record the merge SHA, and clean only this verified worktree/local branch.
