import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  fieldOf,
  migrationCase,
  parts,
  rebuildTarget,
  refreshFrom,
  stepFor,
  valueOf,
  verifyCase,
  type Json,
  type MigrationCase,
} from "./field-migration-fixture.js";

/**
 * The verifier's side of a hard break join, on All Points Media #73's real
 * production values: Work "gallery heading", a source, " ", an italic source.
 * The case joins the italic source with a break instead of a space.
 */
const HEADING = "field_3wwrmr3zv9g5t0wj4epvf5aryw";
const ITALIC = { type: "italic" };
const BREAK = { type: "hard_break" };

function constraintsOf(migration: MigrationCase): Json {
  return fieldOf(migration.candidateContract, HEADING).constraints as Json;
}

function inlines(migration: MigrationCase): Json[] {
  const document = valueOf(migration.candidateContent, HEADING).value as Json;
  return (document.content as Json[])[0].content as Json[];
}

/** The step joins its italic source with a break; the target opts in and holds the F value. */
function joinedWithBreak(allow: Json = { allowHardBreaks: true, maxHardBreaks: 1 }): MigrationCase {
  const migration = migrationCase();
  const step = parts(stepFor(migration, HEADING));
  step.splice(1, 1);
  step[1].joinedBy = "hard_break";
  Object.assign(constraintsOf(migration), allow);
  rebuildTarget(migration, HEADING);
  return migration;
}

/** Verifies against production as the case left it, so a production edit is not a stale declaration. */
function verified(migration: MigrationCase): ReturnType<typeof verifyCase> {
  refreshFrom(migration);
  return verifyCase(migration);
}

function refusedWith(migration: MigrationCase): string | undefined {
  try {
    verified(migration);
    return undefined;
  } catch (error) {
    // A candidate that is not even a valid content document never reaches the
    // verifier: the parse refuses it first, with a schema error and no code.
    return (error as { code?: string }).code ?? "CANDIDATE_UNPARSEABLE";
  }
}

describe("a declared hard break join, verified", () => {
  it("is admitted, listed in the proof, and the break is where it was declared", () => {
    const migration = joinedWithBreak();
    assert.deepEqual(inlines(migration).map((node) => node.type), ["text", "hard_break", "text"]);
    const proof = verifyCase(migration);
    assert.deepEqual(
      proof.added.filter((item) => item.kind === "hard_break"),
      [{ kind: "hard_break", target: HEADING, part: 1 }],
    );
    const step = proof.steps.find((entry) => entry.target === HEADING);
    assert.deepEqual(step?.parts.map(({ start, end }) => [start, end]), [[0, 17], [17, 28]]);
  });

  it("is admitted at the cap exactly", () => {
    assert.doesNotThrow(() => verifyCase(joinedWithBreak({ allowHardBreaks: true, maxHardBreaks: 1 })));
    assert.doesNotThrow(() => verifyCase(joinedWithBreak({ allowHardBreaks: true })));
  });

  it("keeps a step with no join exactly as it was", () => {
    const proof = verifyCase(migrationCase());
    assert.deepEqual(proof.added.filter((item) => item.kind === "hard_break"), []);
  });
});

describe("a declared hard break join, refused", () => {
  const refusals: readonly [string, string, () => MigrationCase][] = [
    ["a target without the opt-in", "MIGRATION_TARGET_CONSTRAINTS", () =>
      joinedWithBreak({ allowHardBreaks: false })],
    ["a target whose opt-in is absent", "MIGRATION_TARGET_CONSTRAINTS", () => {
      const migration = joinedWithBreak();
      delete constraintsOf(migration).allowHardBreaks;
      delete constraintsOf(migration).maxHardBreaks;
      return migration;
    }],
    ["more breaks than the cap", "MIGRATION_TARGET_CONSTRAINTS", () => {
      const migration = joinedWithBreak({ allowHardBreaks: true, maxHardBreaks: 1 });
      const step = parts(stepFor(migration, HEADING));
      step.push({ literal: "x", joinedBy: "hard_break" });
      return migration;
    }],
    ["a break the candidate dropped", "MIGRATION_TARGET_MISMATCH", () => {
      const migration = joinedWithBreak();
      const nodes = inlines(migration);
      nodes.splice(1, 1);
      nodes[0].text = `${nodes[0].text as string}${nodes[1].text as string}`;
      nodes.splice(1, 1);
      return migration;
    }],
    ["a break the candidate moved a character", "MIGRATION_TARGET_MISMATCH", () => {
      const migration = joinedWithBreak();
      const [first, , second] = inlines(migration);
      second.text = `${(first.text as string).slice(-1)}${second.text as string}`;
      first.text = (first.text as string).slice(0, -1);
      return migration;
    }],
    ["a break the candidate added though no part declares one", "MIGRATION_TARGET_MISMATCH", () => {
      const migration = migrationCase();
      Object.assign(constraintsOf(migration), { allowHardBreaks: true, maxHardBreaks: 1 });
      const nodes = inlines(migration);
      const [first, italic] = nodes;
      nodes.splice(0, nodes.length, { ...first, text: (first.text as string).trimEnd() }, BREAK, italic);
      return migration;
    }],
    ["a break the candidate wrote at the edge", "CANDIDATE_UNPARSEABLE", () => {
      const migration = joinedWithBreak();
      inlines(migration).unshift(BREAK);
      return migration;
    }],
    ["the parts in the other order", "MIGRATION_TARGET_MISMATCH", () => {
      const migration = joinedWithBreak();
      const step = parts(stepFor(migration, HEADING));
      const [first, second] = step;
      delete first.marks;
      step.splice(0, 2, { source: second.source }, { source: first.source, marks: [ITALIC], joinedBy: "hard_break" });
      return migration;
    }],
    ["the italic dropped from the part after the break", "MIGRATION_TARGET_MISMATCH", () => {
      const migration = joinedWithBreak();
      delete inlines(migration)[2].marks;
      return migration;
    }],
    ["a hard break node that carries text", "CANDIDATE_UNPARSEABLE", () => {
      const migration = joinedWithBreak();
      inlines(migration)[1].text = "\n";
      return migration;
    }],
  ];
  for (const [name, code, build] of refusals) {
    it(`refuses ${name} with ${code}`, () => assert.equal(refusedWith(build()), code));
  }
});

/**
 * The heading rules a line-split headline meets (All Points Media #76): the
 * lines are `heading_text` fields no outline names, and the target is a rich
 * text H1 that content semantics require an outline entry for.
 */
const WORK_SOURCE = "field_rj3z8a7m5c29jzebda454ehjzr";
const WORK_SECOND = "field_tqc63fy1zttm8c1rzvaa5qjq3w";
const WORK_PAGE = "page_95xvhcrhz1q3rw0s49f4a94xtw";

function outlineOf(contract: Json): Json[] {
  const pages = (contract.internalSeo as Json).pages as Json[];
  return (pages.find((page) => page.pageId === WORK_PAGE) as Json).headingOutline as Json[];
}

function dropEntry(outline: Json[], fieldId: string): void {
  const at = outline.findIndex((entry) => entry.fieldId === fieldId);
  if (at >= 0) outline.splice(at, 1);
}

function setBlock(migration: MigrationCase, block: Json): void {
  stepFor(migration, HEADING).into = { type: "rich_text", block };
  const field = fieldOf(migration.candidateContract, HEADING);
  (field.constraints as Json).allowedBlocks = ["heading"];
}

/** The second source made a heading line too: two `heading_text` fields at level 2, as the converter writes a split heading. */
function twoHeadingLines(migration: MigrationCase, level: 1 | 2 | 3 = 2): void {
  const first = fieldOf(migration.productionContract, WORK_SOURCE);
  const second = fieldOf(migration.productionContract, WORK_SECOND);
  for (const key of ["semantic"]) delete second[key];
  Object.assign(second, { type: "heading_text", semanticLevel: first.semanticLevel });
  valueOf(migration.productionContent, WORK_SECOND).type = "heading_text";
  void level;
}

/** Heading lines at `level`, none outlined, the step into a heading of the same level with its outline entry (or none). */
function headline(migration: MigrationCase, level: 1 | 2 | 3, entry: boolean): void {
  twoHeadingLines(migration);
  fieldOf(migration.productionContract, WORK_SOURCE).semanticLevel = level;
  fieldOf(migration.productionContract, WORK_SECOND).semanticLevel = level;
  dropEntry(outlineOf(migration.productionContract), WORK_SOURCE);
  dropEntry(outlineOf(migration.candidateContract), HEADING);
  if (entry) outlineOf(migration.candidateContract).unshift({ fieldId: HEADING, semanticLevel: level });
  parts(stepFor(migration, HEADING)).splice(0, 3, { source: WORK_SOURCE }, { source: WORK_SECOND, joinedBy: "hard_break" });
  setBlock(migration, { type: "heading", level });
  Object.assign(constraintsOf(migration), { allowHardBreaks: true, maxHardBreaks: 1 });
  rebuildTarget(migration, HEADING);
}

describe("joining the lines of one heading", () => {
  it("admits two heading_text lines no outline names, at level 2, and lists the block", () => {
    const migration = migrationCase();
    headline(migration, 2, false);
    const block = verified(migration).added.find((item) => item.kind === "block" && item.target === HEADING);
    assert.deepEqual(block?.kind === "block" && block.sources.map((source) => source.role), ["heading:2", "heading:2"]);
  });

  it("admits heading lines separated by a declared literal instead of a break", () => {
    const migration = migrationCase();
    headline(migration, 2, false);
    const step = parts(stepFor(migration, HEADING));
    step.splice(1, 1, { literal: " " }, { source: WORK_SECOND });
    rebuildTarget(migration, HEADING);
    assert.doesNotThrow(() => verified(migration));
  });

  it("admits a level 1 headline and lists the outline entry its rich-text H1 needs", () => {
    const migration = migrationCase();
    headline(migration, 1, true);
    assert.deepEqual(
      verified(migration).added.filter((item) => item.kind === "outline_entry"),
      [{ kind: "outline_entry", target: HEADING, outline: `${WORK_PAGE}.headingOutline`, semanticLevel: 1 }],
    );
  });

  it("admits labels made the page's first H1, listed as an adoption with its outline entry", () => {
    const migration = migrationCase();
    headline(migration, 1, true);
    const second = fieldOf(migration.productionContract, WORK_SECOND);
    const first = fieldOf(migration.productionContract, WORK_SOURCE);
    for (const field of [first, second]) {
      delete field.semanticLevel;
      Object.assign(field, { type: "plain_text", semantic: "label" });
    }
    for (const id of [WORK_SOURCE, WORK_SECOND]) valueOf(migration.productionContent, id).type = "plain_text";
    const added = verified(migration).added;
    assert.equal(added.filter((item) => item.kind === "outline_entry").length, 1);
    assert.equal(added.filter((item) => item.kind === "h1_adopted").length, 1);
  });

  it("lists no entry when production's source was already outlined at level 1", () => {
    const migration = migrationCase();
    fieldOf(migration.productionContract, WORK_SOURCE).semanticLevel = 1;
    for (const entry of outlineOf(migration.productionContract)) {
      if (entry.fieldId === WORK_SOURCE) entry.semanticLevel = 1;
    }
    for (const entry of outlineOf(migration.candidateContract)) {
      if (entry.fieldId === HEADING) entry.semanticLevel = 1;
    }
    setBlock(migration, { type: "heading", level: 1 });
    rebuildTarget(migration, HEADING);
    assert.deepEqual(verified(migration).added.filter((item) => item.kind === "outline_entry"), []);
  });

  const refusals: readonly [string, string, () => MigrationCase][] = [
    ["a level 1 rich-text H1 with no outline entry, which content semantics need", "CONTENT_RICH_TEXT_H1_UNDECLARED", () => {
      const migration = migrationCase();
      headline(migration, 1, false);
      return migration;
    }],
    ["a level 1 entry written twice", "CONTRACT_SEO_FIELD_POLICY", () => {
      const migration = migrationCase();
      headline(migration, 1, true);
      outlineOf(migration.candidateContract).unshift({ fieldId: HEADING, semanticLevel: 1 });
      return migration;
    }],
    ["a level 1 entry at another level", "MIGRATION_OUTLINE_LEVEL_MISMATCH", () => {
      const migration = migrationCase();
      headline(migration, 1, true);
      outlineOf(migration.candidateContract)[0].semanticLevel = 2;
      return migration;
    }],
    ["an outline entry added for a level 2 target no source was outlined for", "MIGRATION_REFERENCE_CHANGED", () => {
      const migration = migrationCase();
      headline(migration, 2, true);
      return migration;
    }],
    ["heading lines from two sections", "MIGRATION_SOURCE_STRUCTURE_LOST", () => {
      const migration = migrationCase();
      headline(migration, 2, false);
      const sections = (migration.productionContract.pages as Json[]).flatMap((page) => page.sections as Json[]);
      const holder = sections.find((section) => (section.fields as Json[]).some((field) => field.id === WORK_SECOND)) as Json;
      const other = sections.find((section) => section !== holder) as Json;
      const fields = holder.fields as Json[];
      (other.fields as Json[]).push(fields.splice(fields.findIndex((field) => field.id === WORK_SECOND), 1)[0]);
      return migration;
    }],
    ["heading lines with another field between them", "MIGRATION_SOURCE_STRUCTURE_LOST", () => {
      const migration = migrationCase();
      headline(migration, 2, false);
      const sections = (migration.productionContract.pages as Json[]).flatMap((page) => page.sections as Json[]);
      const holder = sections.find((section) => (section.fields as Json[]).some((field) => field.id === WORK_SOURCE)) as Json;
      const fields = holder.fields as Json[];
      const between = sections.find((section) => section !== holder && (section.fields as Json[]).length > 0) as Json;
      // A field of another section, moved between the two lines: production declares it there.
      fields.splice(1, 0, (between.fields as Json[]).shift() as Json);
      return migration;
    }],
    ["adjacent heading lines with nothing declared between them", "MIGRATION_SOURCE_STRUCTURE_LOST", () => {
      const migration = migrationCase();
      headline(migration, 2, false);
      const step = parts(stepFor(migration, HEADING));
      delete step[1].joinedBy;
      return migration;
    }],
    ["a heading line the outline names joined to one it does not", "MIGRATION_SOURCE_STRUCTURE_LOST", () => {
      const migration = migrationCase();
      headline(migration, 2, false);
      outlineOf(migration.productionContract).unshift({ fieldId: WORK_SOURCE, semanticLevel: 2 });
      return migration;
    }],
    ["two heading lines at different levels", "MIGRATION_SOURCE_STRUCTURE_LOST", () => {
      const migration = migrationCase();
      headline(migration, 2, false);
      fieldOf(migration.productionContract, WORK_SECOND).semanticLevel = 3;
      return migration;
    }],
    ["a heading line joined to rich text", "MIGRATION_SOURCE_STRUCTURE_LOST", () => {
      const migration = migrationCase();
      headline(migration, 2, false);
      const second = fieldOf(migration.productionContract, WORK_SECOND);
      for (const key of ["semanticLevel"]) delete second[key];
      Object.assign(second, { type: "rich_text", constraints: { allowedBlocks: ["heading"], allowedMarks: [], allowLinks: false, allowedExternalHosts: [], allowedTargets: [], maxBlocks: 1, maxCharacters: 160, maxNodes: 50 } });
      valueOf(migration.productionContent, WORK_SECOND).value = {
        type: "doc", content: [{ type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "real world." }] }],
      };
      valueOf(migration.productionContent, WORK_SECOND).type = "rich_text";
      return migration;
    }],
  ];
  for (const [name, code, build] of refusals) {
    it(`refuses ${name} with ${code}`, () => assert.equal(refusedWith(build()), code));
  }
});
