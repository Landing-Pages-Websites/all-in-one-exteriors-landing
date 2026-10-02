import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import {
  parseManagedSiteContentDocument,
  parseManagedSiteContractV1,
  validateManagedSiteContractV1MigrationCompatibility,
} from "@landing-pages-websites/managed-site-contract";

import { fieldMigrationOutcome } from "../src/cli-migration.js";
import {
  buildFieldMigrationDeclaration,
  replacedFieldEvidence,
  type ReplacedFieldEvidence,
  type ReplacedFieldGroup,
  unresolvedRetirements,
} from "../src/field-migration.js";
import type { Proposal } from "../src/propose.js";

const H2 = "component:AboutPage/region:story/region:story-heading/role:h2";

describe("replaced-field evidence", () => {
  const evidence = replacedFieldEvidence(
    [
      { kind: "field", id: "field_a", anchor: `${H2}/text` },
      { kind: "field", id: "field_b", anchor: `${H2}/role:span/text` },
      { kind: "field", id: "field_c", anchor: `${H2}x/text` },
      { kind: "field", id: "field_d", anchor: "component:Old/region:gone/text" },
      { kind: "field", id: "field_e", anchor: "component:Kept/role:p/text" },
      { kind: "field", id: "field_f", anchor: "component:Nested/role:p/text" },
      { kind: "section", id: "section_a", anchor: `${H2}/section` },
    ],
    [
      { fieldId: "field_new", anchor: H2, minted: true },
      { fieldId: "field_outer", anchor: "component:Nested", minted: true },
      { fieldId: "field_inner", anchor: "component:Nested/role:p", minted: true },
      { fieldId: "field_kept", anchor: "component:Kept/role:p", minted: false },
    ],
  );

  it("groups retired fields under the nearest new field whose anchor contains them", () => {
    assert.deepEqual(
      evidence.groups.map((group) => [group.target, group.sources.map((source) => source.id)]),
      [["field_new", ["field_a", "field_b"]], ["field_inner", ["field_f"]]],
    );
  });

  it("leaves near-miss prefixes, orphans and fields under a reused id unclaimed", () => {
    assert.deepEqual(evidence.unclaimed.map((record) => record.id), ["field_c", "field_d", "field_e"]);
  });
});

const fixtureDirectory = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../managed-site-contract/test/fixtures/field-migration-73",
);

function fixture(name: string): Record<string, unknown> {
  return JSON.parse(readFileSync(resolve(fixtureDirectory, `${name}.json`), "utf8")) as Record<string, unknown>;
}

interface PlanStep {
  readonly target: string;
  readonly parts: readonly { readonly source?: string }[];
}

const recorded = fixture("migration");
const planSteps = recorded.steps as readonly PlanStep[];
const production = { contract: fixture("production.contract"), content: fixture("production.content") };

function evidenceOf(steps: readonly PlanStep[]): ReplacedFieldEvidence {
  const groups = steps.map((step) => ({
    target: step.target,
    sources: step.parts.flatMap((part) => (part.source === undefined ? [] : [part.source])),
  }));
  return {
    retired: groups.flatMap((group) =>
      group.sources.map((id) => ({ kind: "field" as const, id, anchor: `anchor:${group.target}/${id}` }))),
    groups: steps.map((step) => ({
      target: step.target,
      targetAnchor: `anchor:${step.target}`,
      sources: step.parts.flatMap((part) =>
        part.source === undefined ? [] : [{ id: part.source, anchor: `anchor:${step.target}/${part.source}` }],
      ),
    })),
    unclaimed: [],
  };
}

describe("unresolved retirements", () => {
  const plan = { bridge: recorded.bridge as { from: string; to: string }, steps: planSteps };
  const unclaimed = { kind: "field" as const, id: "field_dropped", anchor: "component:Gone/role:p/text" };

  function withUnclaimed(evidence: ReplacedFieldEvidence): ReplacedFieldEvidence {
    return { ...evidence, retired: [...evidence.retired, unclaimed], unclaimed: [unclaimed] };
  }

  it("names a retired field that nothing replaces, with no plan", () => {
    const evidence = withUnclaimed({ retired: [], groups: [], unclaimed: [] });
    assert.deepEqual(unresolvedRetirements(evidence, null).map((record) => record.id), ["field_dropped"]);
  });

  it("names it beside groups a plan resolves", () => {
    const evidence = withUnclaimed(evidenceOf(planSteps));
    const { declaration } = buildFieldMigrationDeclaration(plan, evidence, production);
    assert.deepEqual(unresolvedRetirements(evidence, declaration).map((record) => record.id), ["field_dropped"]);
  });

  it("names every source of a group the plan leaves out", () => {
    const evidence = evidenceOf(planSteps);
    const { declaration } = buildFieldMigrationDeclaration({ ...plan, steps: planSteps.slice(1) }, evidence, production);
    const expected = (planSteps[0]?.parts ?? []).flatMap((part) => (part.source === undefined ? [] : [part.source]));
    assert.deepEqual(unresolvedRetirements(evidence, declaration).map((record) => record.id), expected);
  });

  it("resolves nothing it was not asked to: a fully planned run has none", () => {
    const evidence = evidenceOf(planSteps);
    const { declaration } = buildFieldMigrationDeclaration(plan, evidence, production);
    assert.deepEqual(unresolvedRetirements(evidence, declaration), []);
  });

  it("counts an unclaimed field as unresolved when no plan is given, alongside groups", () => {
    assert.equal(unresolvedRetirements(withUnclaimed(evidenceOf(planSteps)), null).length, 70);
  });
});

describe("field migration declaration", () => {
  it("binds a person's plan to production and verifies against #73", () => {
    const { declaration, unplanned } = buildFieldMigrationDeclaration(
      { bridge: recorded.bridge as { from: string; to: string }, steps: planSteps },
      evidenceOf(planSteps),
      production,
    );
    assert.deepEqual(unplanned, []);
    assert.deepEqual(declaration.from, recorded.from);
    const proof = validateManagedSiteContractV1MigrationCompatibility(
      parseManagedSiteContractV1(production.contract),
      parseManagedSiteContentDocument(production.content),
      parseManagedSiteContractV1(fixture("candidate.contract")),
      parseManagedSiteContentDocument(fixture("candidate.content")),
      declaration,
      { admitBridge: () => true },
    );
    assert.equal(proof.steps.length, 34);
  });

  it("returns the groups the plan leaves out", () => {
    const { unplanned } = buildFieldMigrationDeclaration(
      { bridge: recorded.bridge as { from: string; to: string }, steps: planSteps.slice(1) },
      evidenceOf(planSteps),
      production,
    );
    assert.deepEqual(unplanned.map((group) => group.target), [planSteps[0]?.target]);
  });

  function withFirst(
    steps: readonly PlanStep[],
    change: (group: ReplacedFieldGroup) => ReplacedFieldGroup,
  ): ReplacedFieldEvidence {
    const evidence = evidenceOf(steps);
    const [first, ...rest] = evidence.groups;
    if (first === undefined) throw new Error("The fixture has steps");
    return { ...evidence, groups: [change(first), ...rest] };
  }

  const refused: readonly [string, (steps: PlanStep[]) => ReplacedFieldEvidence][] = [
    ["a step whose target replaced nothing", (steps) => evidenceOf(steps.slice(1))],
    ["a step consuming a field its anchor did not replace", (steps) =>
      withFirst(steps, (group) => ({ ...group, sources: group.sources.slice(1) }))],
    ["a step missing a field its anchor replaced", (steps) =>
      withFirst(steps, (group) => ({ ...group, sources: [...group.sources, { id: "field_extra", anchor: "x" }] }))],
  ];
  for (const [name, evidenceFor] of refused) {
    it(`refuses ${name}`, () => {
      assert.throws(() =>
        buildFieldMigrationDeclaration(
          { bridge: recorded.bridge as { from: string; to: string }, steps: planSteps },
          evidenceFor([...planSteps]),
          production,
        ),
      );
    });
  }
});

describe("the conversion's migration outcome", () => {
  function proposalRetiring(records: readonly { kind: "field"; id: string; anchor: string }[]): Proposal {
    return {
      fields: [],
      ledger: { retiredRecords: () => records, mintedThisRun: () => false },
    } as unknown as Proposal;
  }
  const noPlan = { planPath: null, productionContractPath: null, productionContentPath: null };

  it("fails the run and names a retired field nothing replaces", () => {
    const outcome = fieldMigrationOutcome(
      proposalRetiring([{ kind: "field", id: "field_dropped", anchor: "component:Gone/role:p/text" }]),
      noPlan,
    );
    assert.equal(outcome.unresolved, 1);
    assert.ok(outcome.lines.some((line) => line.includes("UNRESOLVED field field_dropped")));
    assert.equal(outcome.sidecar, null);
  });

  it("fails the run for a retired id of any kind, which no step can consume", () => {
    for (const kind of ["page", "section", "item", "asset", "collection"] as const) {
      const outcome = fieldMigrationOutcome(
        proposalRetiring([{ kind, id: `${kind}_gone`, anchor: `component:Gone/${kind}` } as never]),
        noPlan,
      );
      assert.equal(outcome.unresolved, 1, kind);
      assert.ok(outcome.lines.some((line) => line.includes(`UNRESOLVED ${kind} ${kind}_gone`)), kind);
    }
  });

  it("passes a run that retired nothing", () => {
    assert.equal(fieldMigrationOutcome(proposalRetiring([]), noPlan).unresolved, 0);
  });
});
