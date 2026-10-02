import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  bridgeSrcFor,
  ManagedSiteContractError,
  mintStableId,
  parseManagedSiteContentDocument,
  parseManagedSiteContractV1,
  validateManagedSiteContractV1Compatibility,
  type SupportedBridgeVersion,
} from "../src/index.js";
import {
  allFields,
  fieldOf,
  migrationCase,
  parts,
  rebuildTarget,
  refreshFrom,
  stepFor,
  steps,
  valueOf,
  values,
  verifyCase,
  type Json,
  type MigrationCase,
} from "./field-migration-fixture.js";

/** Contact consent: before, " ", a source linked to /privacy, ".". */
const CONSENT = "field_tk0r2056bg83jtvsvja2xewfww";
/** Work page h2: source, " ", an italic source. */
const WORK_HEADING = "field_3wwrmr3zv9g5t0wj4epvf5aryw";
/** About page h2, on a different page from WORK_HEADING. */
const ABOUT_HEADING = "field_p8c9x5jef74wf1qvany0xvsvbw";
/** Privacy "last updated": plain text, source " " source. */
const PRIVACY_UPDATED = "field_qf3n1zzwxzmkprgmfay86mcsmm";
/** Impactivate h3 (FeatureRow): two plain-text sources, not in any outline. */
const FEATURE_ROW = "field_3jwcbzwrwy3ys170bxrh8r26pg";
/** Terms submissions: three plain-text sources, the middle one linked. */
const SUBMISSIONS = "field_5ag03dzvezj8zmpnjhj1jmkc98";
/** Home "why APM": two plain-text sources into a paragraph, on the home page. */
const MERGED_PARAGRAPH = "field_4894mzdqzb7qfxk8w3zyepj8qc";
/** Terms "see also": declared after SUBMISSIONS in the same section. */
const TERMS_SEE_ALSO = "field_qhbzxyghcvcknwd3by36qcgpbc";
/** A protected business-identity value no step touches. */
const LEGAL_NAME = "field_hbdw04cj6f53ny3f94qhmvx114";
const PRIVACY_PAGE = "page_k81xhbd2nmm13hmza7rdnnphsg";

type Mutation = (migration: MigrationCase) => void;

interface RefusalCase {
  readonly name: string;
  readonly code: string;
  readonly mutate: Mutation;
  /** Leave `from` as declared, so a production edit is a stale declaration. */
  readonly keepFrom?: boolean;
  readonly admitBridge?: () => boolean;
}

function sourceOf(migration: MigrationCase, target: string, index: number): string {
  return parts(stepFor(migration, target))[index].source as string;
}

function textNodes(migration: MigrationCase, target: string): Json[] {
  const document = valueOf(migration.candidateContent, target).value as Json;
  return ((document.content as Json[])[0].content as Json[]);
}

function setBridge(contract: Json, version: SupportedBridgeVersion): void {
  const delivery = (contract.bridge as Json).delivery as Json;
  delivery.version = version;
  delivery.src = bridgeSrcFor(version);
}

function sameBridgeAsCandidate(migration: MigrationCase): void {
  migration.productionContract.bridge = structuredClone(migration.candidateContract.bridge);
}

function declareBridge(migration: MigrationCase, from: string, to: string): void {
  migration.declaration.bridge = { from, to };
}

function seoPage(contract: Json, pageId: string): Json {
  const pages = (contract.internalSeo as Json).pages as Json[];
  const found = pages.find((page) => page.pageId === pageId);
  if (found === undefined) throw new Error(`No SEO page ${pageId}`);
  return found;
}

function outline(contract: Json, pageId: string): Json[] {
  return seoPage(contract, pageId).headingOutline as Json[];
}

/** The page that owns WORK_HEADING, whose outline lists it. */
function workPage(migration: MigrationCase): string {
  const owner = valueOf(migration.candidateContent, WORK_HEADING).owner as Json;
  return owner.pageId as string;
}

function identity(contract: Json): Json {
  return (contract.internalSeo as Json).businessIdentity as Json;
}

function pageOf(migration: MigrationCase, target: string): string {
  return (valueOf(migration.candidateContent, target).owner as Json).pageId as string;
}

/** Puts a target, and its first source in production, in the outline at a level. */
function outlineAt(migration: MigrationCase, target: string, level: number): void {
  const page = pageOf(migration, target);
  outline(migration.productionContract, page).push({ fieldId: sourceOf(migration, target, 0), semanticLevel: level });
  outline(migration.candidateContract, page).push({ fieldId: target, semanticLevel: level });
}

function intoBlock(migration: MigrationCase, target: string, block: Json): void {
  stepFor(migration, target).into = { type: "rich_text", block };
  rebuildTarget(migration, target);
}

function makePlainTextTarget(migration: MigrationCase, target: string): void {
  const field = fieldOf(migration.candidateContract, target);
  for (const key of Object.keys(field)) {
    if (!["id", "scope", "classification", "resolver", "usages", "presentation"].includes(key)) delete field[key];
  }
  Object.assign(field, {
    type: "plain_text",
    capabilities: ["text.edit"],
    semantic: "body",
    constraints: { minLength: 0, maxLength: 1000, newlines: "forbid" },
  });
  stepFor(migration, target).into = { type: "plain_text" };
  for (const part of parts(stepFor(migration, target))) delete part.marks;
}

function sourceIdsOf(migration: MigrationCase, target: string): string[] {
  return parts(stepFor(migration, target)).flatMap((part) => (part.source === undefined ? [] : [part.source as string]));
}

function otherPage(migration: MigrationCase, pageId: string): string {
  const found = (migration.productionContract.pages as Json[]).find((page) => page.id !== pageId);
  return found?.id as string;
}

/** Makes a step's sources and target site-scoped, shown on the given pages. */
function siteScoped(migration: MigrationCase, target: string, sourcePages: string[][], targetPages: string[]): void {
  const usages = (pages: string[]) => pages.map((pageId) => ({ pageId, itemId: null }));
  sourceIdsOf(migration, target).forEach((source, index) => {
    Object.assign(fieldOf(migration.productionContract, source), { scope: "site", usages: usages(sourcePages[index] ?? []) });
    valueOf(migration.productionContent, source).owner = { kind: "site" };
  });
  Object.assign(fieldOf(migration.candidateContract, target), { scope: "site", usages: usages(targetPages) });
  valueOf(migration.candidateContent, target).owner = { kind: "site" };
}

function setRole(contract: Json, fieldId: string, semantic: string): void {
  fieldOf(contract, fieldId).semantic = semantic;
}

function sectionHolding(contract: Json, fieldId: string): Json {
  const sections = (contract.pages as Json[]).flatMap((page) => page.sections as Json[]);
  const found = sections.find((section) => (section.fields as Json[]).some((field) => field.id === fieldId));
  if (found === undefined) throw new Error(`No section holds ${fieldId}`);
  return found;
}

/**
 * Puts WORK_HEADING's heading source, its outline entries and its step at the
 * given levels: the source declared at `source`, the step into `into`.
 */
function headingLevels(migration: MigrationCase, source: number, into: number): void {
  const heading = sourceOf(migration, WORK_HEADING, 0);
  fieldOf(migration.productionContract, heading).semanticLevel = source;
  const production = outline(migration.productionContract, workPage(migration)).find((entry) => entry.fieldId === heading);
  if (production !== undefined) production.semanticLevel = source;
  const candidate = outline(migration.candidateContract, workPage(migration)).find((entry) => entry.fieldId === WORK_HEADING);
  if (candidate !== undefined) candidate.semanticLevel = into;
  intoBlock(migration, WORK_HEADING, { type: "heading", level: into });
}

function addTombstone(contract: Json, id: string): void {
  (contract.tombstonedIds as string[]).push(id);
}

const refusals: readonly RefusalCase[] = [
  {
    name: "a dropped value: a source left out of its step",
    code: "MIGRATION_UNDECLARED_CHANGE",
    mutate(migration) {
      parts(stepFor(migration, WORK_HEADING)).splice(2, 1);
      rebuildTarget(migration, WORK_HEADING);
    },
  },
  {
    name: "a dropped value: a source's text missing from the target",
    code: "MIGRATION_TARGET_MISMATCH",
    mutate(migration) {
      textNodes(migration, WORK_HEADING).pop();
    },
  },
  {
    name: "a dropped value: the target value removed outright",
    code: "MIGRATION_TARGET_VALUE_MISSING",
    mutate(migration) {
      const content = values(migration.candidateContent);
      content.splice(content.indexOf(valueOf(migration.candidateContent, WORK_HEADING)), 1);
    },
  },
  {
    name: "lost marks: the italic run carries no mark",
    code: "MIGRATION_TARGET_MISMATCH",
    mutate(migration) {
      delete textNodes(migration, WORK_HEADING).at(-1)?.marks;
    },
  },
  {
    name: "lost marks: the italic moved onto the separator",
    code: "MIGRATION_TARGET_MISMATCH",
    mutate(migration) {
      const nodes = textNodes(migration, WORK_HEADING);
      const first = nodes[0];
      const italic = nodes[1];
      first.text = (first.text as string).trimEnd();
      italic.text = ` ${italic.text as string}`;
    },
  },
  {
    name: "a lost link: the link mark removed from the target",
    code: "MIGRATION_TARGET_MISMATCH",
    mutate(migration) {
      const link = textNodes(migration, CONSENT).find((node) => node.marks !== undefined);
      if (link !== undefined) delete link.marks;
    },
  },
  {
    name: "a lost link: the target keeps it but the declaration does not",
    code: "MIGRATION_TARGET_MISMATCH",
    mutate(migration) {
      delete parts(stepFor(migration, CONSENT))[2].marks;
    },
  },
  {
    name: "a hand-edited target: trailing space trimmed",
    code: "MIGRATION_TARGET_MISMATCH",
    mutate(migration) {
      const value = valueOf(migration.candidateContent, PRIVACY_UPDATED);
      value.value = (value.value as string).replace(" ", "");
    },
  },
  {
    name: "a hand-edited target: a quote changed",
    code: "MIGRATION_TARGET_MISMATCH",
    mutate(migration) {
      const node = textNodes(migration, WORK_HEADING)[0];
      node.text = `’${node.text as string}`;
    },
  },
  {
    name: "a hand-edited target: a character appended after the last part",
    code: "MIGRATION_TARGET_MISMATCH",
    mutate(migration) {
      const node = textNodes(migration, CONSENT).at(-1);
      if (node !== undefined) node.text = `${node.text as string}!`;
    },
  },
  {
    name: "reordered content: the declaration swaps its sources",
    code: "MIGRATION_TARGET_MISMATCH",
    mutate(migration) {
      const step = parts(stepFor(migration, WORK_HEADING));
      [step[0], step[2]] = [step[2], step[0]];
    },
  },
  {
    name: "a declared mark moved to the other source",
    code: "MIGRATION_TARGET_MISMATCH",
    mutate(migration) {
      const step = parts(stepFor(migration, WORK_HEADING));
      step[0].marks = step[2].marks;
      delete step[2].marks;
    },
  },
  {
    name: "a source claimed twice across steps",
    code: "MIGRATION_SOURCE_CLAIMED_TWICE",
    mutate(migration) {
      parts(stepFor(migration, ABOUT_HEADING)).push({ source: sourceOf(migration, WORK_HEADING, 0) });
    },
  },
  {
    name: "a source claimed twice in one step",
    code: "MIGRATION_SOURCE_CLAIMED_TWICE",
    mutate(migration) {
      parts(stepFor(migration, WORK_HEADING)).push({ source: sourceOf(migration, WORK_HEADING, 0) });
    },
  },
  {
    name: "a target claimed by two steps",
    code: "MIGRATION_TARGET_CLAIMED_TWICE",
    mutate(migration) {
      const copy = structuredClone(stepFor(migration, WORK_HEADING));
      copy.parts = [{ literal: "x" }, { source: sourceOf(migration, WORK_HEADING, 0) }];
      steps(migration).push(copy);
    },
  },
  {
    name: "a target that already exists: another step's source",
    code: "MIGRATION_TARGET_EXISTS",
    mutate(migration) {
      stepFor(migration, WORK_HEADING).target = sourceOf(migration, ABOUT_HEADING, 0);
    },
  },
  {
    name: "a target that already exists: a protected production field",
    code: "MIGRATION_TARGET_EXISTS",
    mutate(migration) {
      stepFor(migration, WORK_HEADING).target = LEGAL_NAME;
    },
  },
  {
    name: "a tombstoned target",
    code: "MIGRATION_TARGET_TOMBSTONED",
    mutate(migration) {
      addTombstone(migration.productionContract, WORK_HEADING);
    },
  },
  {
    name: "a target the candidate does not declare",
    code: "MIGRATION_TARGET_UNDECLARED",
    mutate(migration) {
      stepFor(migration, WORK_HEADING).target = mintStableId("field");
    },
  },
  {
    name: "a target of another type than declared",
    code: "MIGRATION_TARGET_TYPE_MISMATCH",
    mutate(migration) {
      stepFor(migration, WORK_HEADING).into = { type: "plain_text" };
      for (const part of parts(stepFor(migration, WORK_HEADING))) delete part.marks;
    },
  },
  {
    name: "a target that is not customer-editable",
    code: "MIGRATION_TARGET_NOT_EDITABLE",
    mutate(migration) {
      const target = fieldOf(migration.candidateContract, WORK_HEADING);
      target.classification = "code_owned_interface";
      target.capabilities = [];
    },
  },
  {
    name: "a bridge downgrade (v9 to v8)",
    code: "MIGRATION_BRIDGE_DOWNGRADE",
    mutate(migration) {
      const production = migration.productionContract.bridge;
      migration.productionContract.bridge = migration.candidateContract.bridge;
      migration.candidateContract.bridge = production;
      declareBridge(migration, "v9", "v8");
    },
  },
  {
    name: "a bridge gap (v7 to v9)",
    code: "MIGRATION_BRIDGE_GAP",
    mutate(migration) {
      setBridge(migration.productionContract, "v7");
      declareBridge(migration, "v7", "v9");
    },
  },
  {
    name: "an unsupported bridge: the platform does not serve it",
    code: "MIGRATION_BRIDGE_UNSUPPORTED",
    mutate() {},
    admitBridge: () => false,
  },
  {
    name: "an unsupported bridge: a version no contract may name",
    code: "MIGRATION_BRIDGE_UNSUPPORTED",
    mutate(migration) {
      declareBridge(migration, "v8", "v11");
    },
  },
  {
    name: "a bridge change with no declared step",
    code: "MIGRATION_BRIDGE_UNDECLARED",
    mutate(migration) {
      delete migration.declaration.bridge;
    },
  },
  {
    name: "a declared bridge step that is not the contracts' step",
    code: "MIGRATION_BRIDGE_MISMATCH",
    mutate(migration) {
      declareBridge(migration, "v7", "v8");
    },
  },
  {
    name: "a declared bridge step when the bridge is unchanged",
    code: "MIGRATION_BRIDGE_MISMATCH",
    mutate(migration) {
      sameBridgeAsCandidate(migration);
    },
  },
  {
    name: "a scope mismatch: a source from another page",
    code: "MIGRATION_SCOPE_MISMATCH",
    mutate(migration) {
      const moved = parts(stepFor(migration, ABOUT_HEADING)).splice(2, 1)[0];
      parts(stepFor(migration, WORK_HEADING)).push(moved);
    },
  },
  {
    name: "a scope mismatch: the target made site-scoped",
    code: "MIGRATION_SCOPE_MISMATCH",
    mutate(migration) {
      fieldOf(migration.candidateContract, WORK_HEADING).scope = "site";
      valueOf(migration.candidateContent, WORK_HEADING).owner = { kind: "site" };
    },
  },
  {
    name: "a stale from digest: production content edited afterwards",
    code: "MIGRATION_FROM_STALE",
    keepFrom: true,
    mutate(migration) {
      valueOf(migration.productionContent, LEGAL_NAME).value = "All Points Co. Ltd";
    },
  },
  {
    name: "a stale from digest: a different contract",
    code: "MIGRATION_FROM_STALE",
    keepFrom: true,
    mutate(migration) {
      (migration.declaration.from as Json).contractSha256 = "0".repeat(64);
    },
  },
  {
    name: "an undeclared changed value",
    code: "MIGRATION_UNDECLARED_CHANGE",
    mutate(migration) {
      valueOf(migration.candidateContent, LEGAL_NAME).value = "Somebody Else";
    },
  },
  {
    name: "a deferred op: split",
    code: "MIGRATION_TRANSFORM_DEFERRED",
    mutate(migration) {
      steps(migration).push({ op: "split", source: sourceOf(migration, WORK_HEADING, 0) });
    },
  },
  {
    name: "a deferred op: retire",
    code: "MIGRATION_TRANSFORM_DEFERRED",
    mutate(migration) {
      stepFor(migration, WORK_HEADING).op = "retire";
    },
  },
  {
    name: "a deferred op: rename",
    code: "MIGRATION_TRANSFORM_DEFERRED",
    mutate(migration) {
      stepFor(migration, WORK_HEADING).op = "rename";
    },
  },
  {
    name: "a deferred source: a protected field",
    code: "MIGRATION_TRANSFORM_DEFERRED",
    mutate(migration) {
      parts(stepFor(migration, WORK_HEADING)).push({ source: LEGAL_NAME });
    },
  },
  {
    name: "a literal link that violates the target's host policy",
    code: "MIGRATION_TARGET_CONSTRAINTS",
    mutate(migration) {
      parts(stepFor(migration, CONSENT))[3].marks = [
        { type: "link", destination: { kind: "external", url: "https://evil.example.com/" }, target: "same_window" },
      ];
      rebuildTarget(migration, CONSENT);
    },
  },
  {
    name: "a literal link that violates the target's window policy",
    code: "MIGRATION_TARGET_CONSTRAINTS",
    mutate(migration) {
      parts(stepFor(migration, CONSENT))[3].marks = [
        { type: "link", destination: { kind: "internal", pageId: PRIVACY_PAGE, fragment: null }, target: "new_window" },
      ];
      rebuildTarget(migration, CONSENT);
    },
  },
  {
    name: "a declared mark the target does not allow",
    code: "MIGRATION_TARGET_CONSTRAINTS",
    mutate(migration) {
      parts(stepFor(migration, CONSENT))[0].marks = [{ type: "bold" }];
      rebuildTarget(migration, CONSENT);
    },
  },
  {
    name: "a literal link to a page that does not exist",
    code: "CONTENT_LINK_PAGE_UNRESOLVED",
    mutate(migration) {
      parts(stepFor(migration, CONSENT))[3].marks = [
        { type: "link", destination: { kind: "internal", pageId: mintStableId("page"), fragment: null }, target: "same_window" },
      ];
      rebuildTarget(migration, CONSENT);
    },
  },
  {
    name: "a source value left in the candidate",
    code: "MIGRATION_SOURCE_VALUE_REMAINS",
    mutate(migration) {
      values(migration.candidateContent).push(
        structuredClone(valueOf(migration.productionContent, sourceOf(migration, WORK_HEADING, 0))),
      );
    },
  },
  {
    name: "a source the candidate does not tombstone",
    code: "MIGRATION_TOMBSTONES_INCOMPLETE",
    mutate(migration) {
      const source = sourceOf(migration, WORK_HEADING, 0);
      const tombstones = migration.candidateContract.tombstonedIds as string[];
      tombstones.splice(tombstones.indexOf(source), 1);
    },
  },
  {
    name: "a source production never declared",
    code: "MIGRATION_SOURCE_UNKNOWN",
    mutate(migration) {
      const unknown = mintStableId("field");
      parts(stepFor(migration, WORK_HEADING)).push({ source: unknown });
      addTombstone(migration.candidateContract, unknown);
    },
  },
  {
    name: "SEO: the merged heading dropped from the page outline",
    code: "MIGRATION_REFERENCE_CHANGED",
    mutate(migration) {
      const entries = outline(migration.candidateContract, workPage(migration));
      entries.splice(entries.findIndex((entry) => entry.fieldId === WORK_HEADING), 1);
    },
  },
  {
    name: "SEO: the merged heading's outline level changed",
    code: "MIGRATION_OUTLINE_LEVEL_MISMATCH",
    mutate(migration) {
      const entry = outline(migration.candidateContract, workPage(migration))
        .find((candidate) => candidate.fieldId === WORK_HEADING);
      if (entry !== undefined) entry.semanticLevel = 3;
    },
  },
  {
    name: "SEO: a page's whole outline emptied",
    code: "MIGRATION_REFERENCE_CHANGED",
    mutate(migration) {
      seoPage(migration.candidateContract, workPage(migration)).headingOutline = [];
    },
  },
  {
    // Since 0.16.0 contract semantics refuse this outline (a non-heading
    // field, or a level its heading field does not have) before the
    // migration rule sees it.
    name: "SEO: production outlined the heading at another level",
    code: "CONTRACT_SEO_FIELD_POLICY",
    mutate(migration) {
      const sources = new Set(parts(stepFor(migration, WORK_HEADING)).map((part) => part.source));
      const entry = outline(migration.productionContract, workPage(migration))
        .find((candidate) => sources.has(candidate.fieldId as string));
      if (entry === undefined) throw new Error("The work heading's sources are in its outline");
      entry.semanticLevel = 3;
    },
  },
  {
    name: "structure: a level-2 heading source merged into heading 3",
    code: "MIGRATION_SOURCE_STRUCTURE_LOST",
    mutate(migration) {
      intoBlock(migration, WORK_HEADING, { type: "heading", level: 3 });
    },
  },
  {
    name: "structure: a heading source merged into a paragraph",
    code: "MIGRATION_SOURCE_STRUCTURE_LOST",
    mutate(migration) {
      intoBlock(migration, WORK_HEADING, { type: "paragraph" });
    },
  },
  {
    name: "structure: a heading source merged into a bullet list",
    code: "MIGRATION_SOURCE_STRUCTURE_LOST",
    mutate(migration) {
      intoBlock(migration, WORK_HEADING, { type: "bullet_list" });
    },
  },
  {
    // Since 0.16.0 contract semantics refuse this outline (a non-heading
    // field, or a level its heading field does not have) before the
    // migration rule sees it.
    name: "structure: a heading source merged into plain text",
    code: "CONTRACT_SEO_FIELD_POLICY",
    mutate(migration) {
      makePlainTextTarget(migration, WORK_HEADING);
    },
  },
  {
    // Since 0.16.0 contract semantics refuse this outline (a non-heading
    // field, or a level its heading field does not have) before the
    // migration rule sees it.
    name: "structure: an outline level the target's heading does not render",
    code: "CONTRACT_SEO_FIELD_POLICY",
    mutate(migration) {
      outlineAt(migration, FEATURE_ROW, 2);
    },
  },
  {
    // Since 0.16.0 contract semantics refuse this outline (a non-heading
    // field, or a level its heading field does not have) before the
    // migration rule sees it.
    name: "structure: an outline entry for a target that renders a paragraph",
    code: "CONTRACT_SEO_FIELD_POLICY",
    mutate(migration) {
      outlineAt(migration, CONSENT, 2);
    },
  },
  {
    // Since 0.16.0 contract semantics refuse this outline (a non-heading
    // field, or a level its heading field does not have) before the
    // migration rule sees it.
    name: "structure: an outline entry for a target that renders plain text",
    code: "CONTRACT_SEO_FIELD_POLICY",
    mutate(migration) {
      outlineAt(migration, PRIVACY_UPDATED, 3);
    },
  },
  {
    name: "structure: a search-title source",
    code: "MIGRATION_TRANSFORM_DEFERRED",
    mutate(migration) {
      const source = sourceOf(migration, PRIVACY_UPDATED, 0);
      const field = fieldOf(migration.productionContract, source);
      Object.assign(field, { semantic: "seo_title", constraints: { ...(field.constraints as Json), maxLength: 320 } });
      (seoPage(migration.productionContract, pageOf(migration, PRIVACY_UPDATED)).metadata as Json).title = source;
    },
  },
  {
    name: "references: a source named by business identity",
    code: "MIGRATION_TRANSFORM_DEFERRED",
    mutate(migration) {
      identity(migration.productionContract).telephone = sourceOf(migration, MERGED_PARAGRAPH, 0);
      identity(migration.candidateContract).telephone = MERGED_PARAGRAPH;
    },
  },
  {
    name: "references: a source named by page JSON-LD",
    code: "MIGRATION_TRANSFORM_DEFERRED",
    mutate(migration) {
      const node = (id: string) => [{ schemaType: "LocalBusiness", required: true, sourceFieldIds: [id], requiredOutputProperties: ["name"] }];
      seoPage(migration.productionContract, workPage(migration)).jsonLd = node(sourceOf(migration, MERGED_PARAGRAPH, 0));
      seoPage(migration.candidateContract, workPage(migration)).jsonLd = node(MERGED_PARAGRAPH);
    },
  },
  {
    name: "references: a source named as a page's primary entity",
    code: "MIGRATION_TRANSFORM_DEFERRED",
    mutate(migration) {
      (seoPage(migration.productionContract, workPage(migration)).intent as Json).primaryEntity = sourceOf(migration, MERGED_PARAGRAPH, 2);
      (seoPage(migration.candidateContract, workPage(migration)).intent as Json).primaryEntity = MERGED_PARAGRAPH;
    },
  },
  {
    name: "references: a target newly named outside an outline",
    code: "MIGRATION_REFERENCE_CHANGED",
    mutate(migration) {
      (seoPage(migration.candidateContract, workPage(migration)).intent as Json).primaryEntity = MERGED_PARAGRAPH;
    },
  },
  {
    name: "references: a target newly added to an outline",
    code: "MIGRATION_REFERENCE_CHANGED",
    mutate(migration) {
      outline(migration.candidateContract, pageOf(migration, FEATURE_ROW)).push({ fieldId: FEATURE_ROW, semanticLevel: 3 });
    },
  },
  {
    // Since 0.16.0 contract semantics refuse this outline (a non-heading
    // field, or a level its heading field does not have) before the
    // migration rule sees it.
    name: "structure: one outline naming two sources of a step",
    code: "CONTRACT_SEO_FIELD_POLICY",
    mutate(migration) {
      const entries = outline(migration.productionContract, workPage(migration));
      const index = entries.findIndex((entry) => entry.fieldId === sourceOf(migration, WORK_HEADING, 0));
      entries.splice(index + 1, 0, { fieldId: sourceOf(migration, WORK_HEADING, 2), semanticLevel: 2 });
    },
  },
  {
    name: "structure: two headings merged into one",
    code: "MIGRATION_SOURCE_STRUCTURE_LOST",
    mutate(migration) {
      const label = fieldOf(migration.productionContract, sourceOf(migration, WORK_HEADING, 2));
      delete label.semantic;
      Object.assign(label, { type: "heading_text", semanticLevel: 2 });
      valueOf(migration.productionContent, label.id as string).type = "heading_text";
    },
  },
  {
    name: "usages: the target leaves a page its sources were shown on",
    code: "MIGRATION_SCOPE_MISMATCH",
    mutate(migration) {
      const a = pageOf(migration, PRIVACY_UPDATED);
      const b = otherPage(migration, a);
      siteScoped(migration, PRIVACY_UPDATED, [[a, b], [a, b]], [a]);
    },
  },
  {
    name: "usages: the target arrives on a page no source was shown on",
    code: "MIGRATION_SCOPE_MISMATCH",
    mutate(migration) {
      const a = pageOf(migration, PRIVACY_UPDATED);
      const b = otherPage(migration, a);
      siteScoped(migration, PRIVACY_UPDATED, [[a], [a]], [a, b]);
    },
  },
  {
    name: "usages: sources shown on different pages",
    code: "MIGRATION_SCOPE_MISMATCH",
    mutate(migration) {
      const a = pageOf(migration, PRIVACY_UPDATED);
      const b = otherPage(migration, a);
      siteScoped(migration, PRIVACY_UPDATED, [[a, b], [a]], [a, b]);
    },
  },
  {
    // Since 0.16.0 contract semantics refuse this outline (a non-heading
    // field, or a level its heading field does not have) before the
    // migration rule sees it.
    name: "structure: an outline names the plain source as the heading",
    code: "CONTRACT_SEO_FIELD_POLICY",
    mutate(migration) {
      const entries = outline(migration.productionContract, workPage(migration));
      const index = entries.findIndex((entry) => entry.fieldId === sourceOf(migration, WORK_HEADING, 0));
      entries.splice(index, 1, { fieldId: sourceOf(migration, WORK_HEADING, 2), semanticLevel: 2 });
      outline(migration.candidateContract, workPage(migration)).splice(index, 1, { fieldId: WORK_HEADING, semanticLevel: 2 });
    },
  },
  {
    name: "a source the candidate still declares",
    code: "MIGRATION_SOURCE_STILL_DECLARED",
    mutate(migration) {
      const source = sourceOf(migration, WORK_HEADING, 2);
      const kept = structuredClone(fieldOf(migration.productionContract, source));
      for (const page of migration.candidateContract.pages as Json[]) {
        for (const section of page.sections as Json[]) {
          const fields = section.fields as Json[];
          if (fields.some((field) => field.id === WORK_HEADING)) fields.push(kept);
        }
      }
      const tombstones = migration.candidateContract.tombstonedIds as string[];
      tombstones.splice(tombstones.indexOf(source), 1);
    },
  },
  {
    name: "the contract id changed",
    code: "MIGRATION_RUNTIME_CHANGED",
    mutate(migration) {
      migration.candidateContract.contractId = mintStableId("contract");
    },
  },
  {
    name: "the adapter changed",
    code: "MIGRATION_RUNTIME_CHANGED",
    mutate(migration) {
      migration.candidateContract.adapter = { kind: "astro", adapterVersion: "1.0" };
    },
  },
  {
    name: "semantics: body text promoted into a heading",
    code: "MIGRATION_SEMANTIC_CHANGED",
    mutate(migration) {
      stepFor(migration, CONSENT).into = { type: "rich_text", block: { type: "heading", level: 2 } };
    },
  },
  {
    name: "semantics: body text in a heading step beside a label",
    code: "MIGRATION_SEMANTIC_CHANGED",
    mutate(migration) {
      setRole(migration.productionContract, sourceOf(migration, FEATURE_ROW, 0), "body");
    },
  },
  ...(["phone", "email", "address", "legal"] as const).map((role) => ({
    name: `semantics: a ${role} source dropped into running text`,
    code: "MIGRATION_TRANSFORM_DEFERRED",
    mutate(migration: MigrationCase) {
      setRole(migration.productionContract, sourceOf(migration, PRIVACY_UPDATED, 0), role);
    },
  })),
  {
    name: "semantics: a plain-text target that claims a structured role",
    code: "MIGRATION_TRANSFORM_DEFERRED",
    mutate(migration) {
      setRole(migration.candidateContract, PRIVACY_UPDATED, "legal");
    },
  },
  {
    name: "level 1: a level-1 heading merged into heading 2",
    code: "MIGRATION_SOURCE_STRUCTURE_LOST",
    mutate(migration) {
      headingLevels(migration, 1, 2);
    },
  },
  {
    name: "level 1: a level-2 heading merged into heading 1",
    code: "MIGRATION_SOURCE_STRUCTURE_LOST",
    mutate(migration) {
      headingLevels(migration, 2, 1);
    },
  },
  {
    name: "level 1: a level-1 heading merged into a paragraph",
    code: "MIGRATION_SOURCE_STRUCTURE_LOST",
    mutate(migration) {
      headingLevels(migration, 1, 1);
      intoBlock(migration, WORK_HEADING, { type: "paragraph" });
    },
  },
  {
    name: "level 1: an outline giving a level-1 heading level 2",
    code: "MIGRATION_OUTLINE_LEVEL_MISMATCH",
    mutate(migration) {
      headingLevels(migration, 1, 1);
      const entry = outline(migration.candidateContract, workPage(migration)).find((candidate) => candidate.fieldId === WORK_HEADING);
      if (entry !== undefined) entry.semanticLevel = 2;
    },
  },
  {
    name: "level 4: a heading with no rich-text level merged into heading 3",
    code: "MIGRATION_SOURCE_STRUCTURE_LOST",
    mutate(migration) {
      headingLevels(migration, 4, 3);
    },
  },
  {
    name: "level 4: a step into a heading level the block does not admit",
    code: "MIGRATION_DECLARATION_INVALID",
    mutate(migration) {
      stepFor(migration, WORK_HEADING).into = { type: "rich_text", block: { type: "heading", level: 4 } };
    },
  },
  {
    name: "an empty declaration",
    code: "MIGRATION_DECLARATION_EMPTY",
    mutate(migration) {
      migration.declaration.steps = [];
      delete migration.declaration.bridge;
      migration.candidateContract = structuredClone(migration.productionContract);
      migration.candidateContent = structuredClone(migration.productionContent);
    },
  },
  {
    name: "a declaration with an unknown key",
    code: "MIGRATION_DECLARATION_INVALID",
    mutate(migration) {
      migration.declaration.note = "trust me";
    },
  },
];

function assertRefused(entry: RefusalCase): void {
  const migration = migrationCase();
  entry.mutate(migration);
  if (entry.keepFrom !== true) refreshFrom(migration);
  assert.throws(
    () => verifyCase(migration, entry.admitBridge),
    (error: unknown) => {
      assert.ok(error instanceof ManagedSiteContractError, String(error));
      assert.equal(error.code, entry.code, error.message);
      return true;
    },
  );
}

describe("field migration: All Points Media #73", () => {
  it("verifies all 34 targets and accounts for every production value", () => {
    const proof = verifyCase(migrationCase());
    assert.equal(proof.steps.length, 34);
    assert.deepEqual(proof.accounting, {
      productionValues: 118, unchanged: 49, consumed: 69, candidateValues: 83, targets: 34, added: 0,
    });
    assert.deepEqual(proof.additions, { stableIds: [], contentValues: [], assetManifestEntries: 0 });
    assert.equal(new Set(proof.steps.flatMap((step) => step.sources.map((s) => s.fieldId))).size, 69);
    assert.deepEqual(proof.bridge, { from: "v8", to: "v9" });
    assert.match(proof.declarationSha256, /^[a-f0-9]{64}$/);
  });

  it("lists every added literal, mark, link and block", () => {
    const { added } = verifyCase(migrationCase());
    const count = (kind: string) => added.filter((item) => item.kind === kind).length;
    assert.equal(count("literal"), 37);
    assert.deepEqual(
      added.filter((item) => item.kind === "literal").map((item) => item.kind === "literal" && item.text).sort(),
      [...Array(34).fill(" "), ".", ".", "."].sort(),
    );
    assert.equal(count("link"), 4);
    assert.equal(count("mark"), 28);
    assert.equal(count("block"), 34);
    assert.equal(count("role"), 2);
    // #73 merges across sections twice: the later source's text now renders
    // in its target's section, and the proof says so.
    assert.deepEqual(
      added.flatMap((item) => (item.kind === "moved" ? [[item.target, item.field, item.from.sectionId, item.to.sectionId]] : [])),
      [
        ["field_9xwe3dqd8haknzmf5y0vt045e4", "field_mvttyvbky9va30rerffs0pcrq8",
          "section_yw7pnwtsnn5e1ydzpm5q4qjn8m", "section_4d2dxt0wfby8a2atta7t2829v0"],
        ["field_qf3n1zzwxzmkprgmfay86mcsmm", "field_23ykx7gg37yf0bv1d3t2g5kpvm",
          "section_gvy362bwwk1hcvs67p57rmdjmg", "section_erfsknprdckjjtsah452aqsyj4"],
      ],
    );
    for (const item of added) {
      if (item.kind === "link") assert.equal(item.destination.kind, "internal");
    }
  });

  it("records each part's offsets in the target", () => {
    const proof = verifyCase(migrationCase());
    for (const step of proof.steps) {
      let cursor = 0;
      for (const part of step.parts) {
        assert.equal(part.start, cursor);
        assert.ok(part.end >= part.start);
        cursor = part.end;
      }
    }
  });

  it("is refused by the ordinary compatibility rule, unchanged", () => {
    const migration = migrationCase();
    assert.throws(
      () =>
        validateManagedSiteContractV1Compatibility(
          parseManagedSiteContractV1(migration.productionContract),
          parseManagedSiteContentDocument(migration.productionContent),
          parseManagedSiteContractV1(migration.candidateContract),
          parseManagedSiteContentDocument(migration.candidateContent),
        ),
      { code: "COMPATIBILITY_RUNTIME_CHANGED" },
    );
  });

  it("verifies the same migration without a bridge change", () => {
    const migration = migrationCase();
    sameBridgeAsCandidate(migration);
    delete migration.declaration.bridge;
    refreshFrom(migration);
    assert.equal(verifyCase(migration).bridge, null);
  });

  it("lists, rather than hides, a value the candidate adds outside any step", () => {
    const migration = migrationCase();
    const added = structuredClone(fieldOf(migration.candidateContract, WORK_HEADING));
    const id = mintStableId("field");
    Object.assign(added, { id, resolver: { ...(added.resolver as Json), pointer: "/added/text" } });
    for (const page of migration.candidateContract.pages as Json[]) {
      for (const section of page.sections as Json[]) {
        const fields = section.fields as Json[];
        if (fields.some((field) => field.id === WORK_HEADING)) fields.push(added);
      }
    }
    const value = structuredClone(valueOf(migration.candidateContent, WORK_HEADING));
    value.fieldId = id;
    values(migration.candidateContent).push(value);
    const proof = verifyCase(migration);
    assert.deepEqual(proof.additions.stableIds, [id]);
    assert.deepEqual(proof.additions.contentValues.map((entry) => entry.fieldId), [id]);
    assert.equal(proof.accounting.added, 1);
    assert.equal(proof.accounting.candidateValues, 84);
  });

  it("returns a deeply frozen proof", () => {
    const proof = verifyCase(migrationCase());
    assert.ok(Object.isFrozen(proof.steps[0]?.parts[0]));
    assert.ok(Object.isFrozen(proof.additions.contentValues));
  });

  it("lists sources joined in another order than production's", () => {
    const cases: readonly [string, (migration: MigrationCase) => void, readonly number[]][] = [
      ["two sources swapped", (migration) => {
        const list = parts(stepFor(migration, WORK_HEADING));
        [list[0], list[2]] = [list[2], list[0]];
      }, [1, 0]],
      ["three sources rotated", (migration) => {
        const list = parts(stepFor(migration, SUBMISSIONS));
        list.push(list.shift() as Json);
      }, [1, 2, 0]],
      ["the separator moved with the swap", (migration) => {
        const list = parts(stepFor(migration, FEATURE_ROW));
        stepFor(migration, FEATURE_ROW).parts = [list[2], list[0], list[1]];
      }, [1, 0]],
    ];
    for (const [name, mutate, permutation] of cases) {
      const migration = migrationCase();
      mutate(migration);
      const target = [WORK_HEADING, SUBMISSIONS, FEATURE_ROW][cases.findIndex((entry) => entry[0] === name)];
      const original = parts(stepFor(migrationCase(), target)).flatMap((part) => (part.source === undefined ? [] : [part.source as string]));
      rebuildTarget(migration, target);
      refreshFrom(migration);
      const reordered = verifyCase(migration).added.filter((item) => item.kind === "reordered");
      assert.deepEqual(reordered, [{
        kind: "reordered",
        target,
        declared: permutation.map((index) => original[index]),
        production: original,
        interleaved: [],
      }], name);
    }
  });

  it("lists a field production declared between a step's sources", () => {
    const migration = migrationCase();
    const first = sourceOf(migration, PRIVACY_UPDATED, 0);
    const between = mintStableId("field");
    const field = { ...structuredClone(fieldOf(migration.productionContract, first)), id: between };
    field.resolver = { ...(field.resolver as Json), pointer: "/between/text" };
    for (const contract of [migration.productionContract, migration.candidateContract]) {
      const sections = (contract.pages as Json[]).flatMap((page) => page.sections as Json[]);
      const holder = sections.find((section) => (section.fields as Json[]).some((entry) => entry.id === first))
        ?? sections.find((section) => (section.fields as Json[]).some((entry) => entry.id === PRIVACY_UPDATED));
      const fields = holder?.fields as Json[];
      const at = fields.findIndex((entry) => entry.id === first);
      fields.splice(at === -1 ? fields.length : at + 1, 0, structuredClone(field));
    }
    for (const content of [migration.productionContent, migration.candidateContent]) {
      values(content).push({ ...structuredClone(valueOf(migration.productionContent, first)), fieldId: between });
    }
    refreshFrom(migration);
    const reordered = verifyCase(migration).added.filter((item) => item.kind === "reordered");
    assert.equal(reordered.length, 1);
    assert.deepEqual(reordered[0]?.kind === "reordered" && reordered[0].interleaved, [between]);
  });

  it("still admits an SEO edit the ordinary policy admits", () => {
    const migration = migrationCase();
    (seoPage(migration.candidateContract, workPage(migration)).sitemap as Json).priority = 0.1;
    assert.equal(verifyCase(migration).steps.length, 34);
  });

  it("merges a level-1 heading into a level-1 heading, outline included", () => {
    const migration = migrationCase();
    headingLevels(migration, 1, 1);
    refreshFrom(migration);
    const block = verifyCase(migration).added.find((item) => item.kind === "block" && item.target === WORK_HEADING);
    assert.ok(block?.kind === "block");
    assert.deepEqual(block.block, { type: "heading", level: 1 });
    assert.deepEqual(block.sources.map((source) => source.role), ["heading:1", "label"]);
  });

  it("names each source's role in its block item", () => {
    const { added } = verifyCase(migrationCase());
    const blockOf = (target: string) => added.find((item) => item.kind === "block" && item.target === target);
    const heading = blockOf(WORK_HEADING);
    assert.ok(heading?.kind === "block");
    assert.deepEqual(heading.sources.map((source) => source.role), ["heading:2", "label"]);
    assert.equal(heading.targetRole, "rich_text");
    const plain = blockOf(PRIVACY_UPDATED);
    assert.ok(plain?.kind === "block");
    assert.deepEqual(plain.block, { type: "plain_text" });
    assert.equal(plain.targetRole, "label");
  });

  it("names a plain-text target whose role differs from its sources'", () => {
    const roles = (migration: MigrationCase) => verifyCase(migration).added
      .flatMap((item) => (item.kind === "role" && item.target === PRIVACY_UPDATED ? [[item.from, item.to]] : []));
    assert.deepEqual(roles(migrationCase()), [[["body"], "label"]]);
    const relabelled = migrationCase();
    setRole(relabelled.candidateContract, PRIVACY_UPDATED, "body");
    assert.deepEqual(roles(relabelled), []);
    const mixed = migrationCase();
    setRole(mixed.productionContract, sourceOf(mixed, PRIVACY_UPDATED, 0), "caption");
    refreshFrom(mixed);
    assert.deepEqual(roles(mixed), [[["body", "caption"], "label"]]);
  });

  it("admits a caption made a heading, and names it", () => {
    const migration = migrationCase();
    setRole(migration.productionContract, sourceOf(migration, FEATURE_ROW, 0), "caption");
    refreshFrom(migration);
    const block = verifyCase(migration).added.find((item) => item.kind === "block" && item.target === FEATURE_ROW);
    assert.ok(block?.kind === "block");
    assert.deepEqual(block.sources.map((source) => source.role), ["caption", "label"]);
  });

  function movesOf(migration: MigrationCase): string[][] {
    const baseline = new Set(verifyCase(migrationCase()).added.map((item) => JSON.stringify(item)));
    return verifyCase(migration).added
      .filter((item) => item.kind === "moved" && !baseline.has(JSON.stringify(item)))
      .flatMap((item) => (item.kind === "moved" ? [[item.target, item.field]] : []));
  }

  function sectionsOf(contract: Json): Json[] {
    return (contract.pages as Json[]).flatMap((page) => page.sections as Json[]);
  }

  it("lists, and admits, text a reader now sees somewhere else", () => {
    const cases: readonly [string, (migration: MigrationCase) => string[][]][] = [
      ["a target moved to the page's other section: both sources moved", (migration) => {
        const from = sectionHolding(migration.candidateContract, PRIVACY_UPDATED);
        const page = (migration.candidateContract.pages as Json[])
          .find((entry) => (entry.sections as Json[]).includes(from)) as Json;
        const to = (page.sections as Json[]).find((section) => section !== from && (section.fields as Json[]).length > 0) as Json;
        const fields = from.fields as Json[];
        (to.fields as Json[]).push(...fields.splice(fields.findIndex((field) => field.id === PRIVACY_UPDATED), 1));
        return sourceIdsOf(migration, PRIVACY_UPDATED).map((source) => [PRIVACY_UPDATED, source]);
      }],
      ["two targets swapped in their section: both are named", (migration) => {
        const fields = sectionHolding(migration.candidateContract, SUBMISSIONS).fields as Json[];
        [fields[0], fields[1]] = [fields[1], fields[0]];
        return [[SUBMISSIONS, SUBMISSIONS], [TERMS_SEE_ALSO, TERMS_SEE_ALSO]];
      }],
      ["a target moved ahead of another section's field: only its sources", (migration) => {
        const page = (migration.candidateContract.pages as Json[])
          .find((entry) => (entry.sections as Json[]).filter((section) => (section.fields as Json[]).length > 0).length >= 2) as Json;
        const [first, second] = (page.sections as Json[]).filter((section) => (section.fields as Json[]).length > 0);
        const moved = (second?.fields as Json[]).shift() as Json;
        (first?.fields as Json[]).unshift(moved);
        return sourceIdsOf(migration, moved.id as string).map((source) => [moved.id as string, source]);
      }],
    ];
    for (const [name, mutate] of cases) {
      const migration = migrationCase();
      const expected = mutate(migration);
      const moves = movesOf(migration);
      assert.deepEqual(moves.sort(), expected.sort(), name);
    }
  });

  /**
   * Adds unchanged fields to both sides: in production into `productionSection`
   * at `productionAt`, in the candidate into `candidateSection` at `candidateAt`.
   */
  function addUnchanged(
    migration: MigrationCase,
    template: string,
    placements: readonly { readonly production: number; readonly candidate: number }[],
    holders: { readonly production: string; readonly candidate: string },
  ): string[] {
    return placements.map(({ production, candidate }) => {
      const id = mintStableId("field");
      const field = { ...structuredClone(fieldOf(migration.productionContract, template)), id };
      field.resolver = { ...(field.resolver as Json), pointer: `/unchanged/${id}` };
      (sectionHolding(migration.productionContract, holders.production).fields as Json[]).splice(production, 0, structuredClone(field));
      (sectionHolding(migration.candidateContract, holders.candidate).fields as Json[]).splice(candidate, 0, structuredClone(field));
      const value = { ...structuredClone(valueOf(migration.productionContent, template)), fieldId: id };
      values(migration.productionContent).push(value);
      values(migration.candidateContent).push(structuredClone(value));
      return id;
    });
  }

  function targetMoves(migration: MigrationCase, target: string): string[][] {
    refreshFrom(migration);
    return verifyCase(migration).added.flatMap((item) =>
      item.kind === "moved" && item.target === target && item.field === target ? [[item.from.sectionId, item.to.sectionId]] : []);
  }

  it("names a target moved past an unchanged neighbour, and only then", () => {
    const first = (migration: MigrationCase) => sourceOf(migration, WORK_HEADING, 0);
    const holders = (migration: MigrationCase) => ({ production: first(migration), candidate: WORK_HEADING });
    const cases: readonly [string, readonly { production: number; candidate: number }[], number][] = [
      ["[S1,S2,U] to [U,T]", [{ production: 2, candidate: 0 }], 1],
      ["[U,S1,S2] to [T,U]", [{ production: 0, candidate: 1 }], 1],
      ["[S1,S2,U1,U2] to [U1,T,U2]", [{ production: 2, candidate: 0 }, { production: 3, candidate: 2 }], 1],
      ["[U,S1,S2] to [U,T]: not moved", [{ production: 0, candidate: 0 }], 0],
      ["[S1,S2,U] to [T,U]: not moved", [{ production: 2, candidate: 1 }], 0],
    ];
    for (const [name, placements, expected] of cases) {
      const migration = migrationCase();
      addUnchanged(migration, first(migration), placements, holders(migration));
      assert.equal(targetMoves(migration, WORK_HEADING).length, expected, name);
    }
  });

  it("ranks a target by its source in the target's own section", () => {
    const target = "field_9xwe3dqd8haknzmf5y0vt045e4";
    const cases: readonly [string, number, number][] = [
      ["[S2,U] to [U,T]: moved", 1, 0],
      ["[S2,U] to [T,U]: not moved", 1, 1],
    ];
    for (const [name, productionAt, candidateAt] of cases) {
      const migration = migrationCase();
      const later = sourceIdsOf(migration, target).find((source) =>
        sectionHolding(migration.productionContract, source).id === sectionHolding(migration.candidateContract, target).id) as string;
      addUnchanged(migration, later, [{ production: productionAt, candidate: candidateAt }], { production: later, candidate: target });
      assert.equal(targetMoves(migration, target).length, name.endsWith("not moved") ? 0 : 1, name);
    }
  });

  it("names no move for a site-scoped target, whose usages are bound instead", () => {
    const migration = migrationCase();
    const page = pageOf(migration, PRIVACY_UPDATED);
    siteScoped(migration, PRIVACY_UPDATED, [[page], [page]], [page]);
    const from = sectionHolding(migration.candidateContract, PRIVACY_UPDATED).fields as Json[];
    const field = from.splice(from.findIndex((entry) => entry.id === PRIVACY_UPDATED), 1)[0] as Json;
    (sectionHolding(migration.candidateContract, WORK_HEADING).fields as Json[]).push(field);
    refreshFrom(migration);
    assert.deepEqual(verifyCase(migration).added.filter((item) => item.kind === "moved" && item.target === PRIVACY_UPDATED), []);
  });

  it("names no move for a target declared off the page it renders on", () => {
    const migration = migrationCase();
    const from = sectionHolding(migration.candidateContract, WORK_HEADING).fields as Json[];
    const field = from.splice(from.findIndex((entry) => entry.id === WORK_HEADING), 1)[0] as Json;
    (sectionHolding(migration.candidateContract, ABOUT_HEADING).fields as Json[]).push(field);
    assert.deepEqual(verifyCase(migration).added.filter((item) => item.kind === "moved" && item.target === WORK_HEADING), []);
  });

  it("names no move for a neighbour's change", () => {
    const cases: readonly [string, (migration: MigrationCase) => void][] = [
      ["a field added before a target", (migration) => {
        const added = structuredClone(fieldOf(migration.candidateContract, WORK_HEADING));
        const id = mintStableId("field");
        Object.assign(added, { id, resolver: { ...(added.resolver as Json), pointer: "/added/text" } });
        (sectionHolding(migration.candidateContract, WORK_HEADING).fields as Json[]).unshift(added);
        values(migration.candidateContent).push({ ...structuredClone(valueOf(migration.candidateContent, WORK_HEADING)), fieldId: id });
      }],
      ["production moved another step's later source ahead of a target", (migration) => {
        const later = sourceIdsOf(migration, "field_9xwe3dqd8haknzmf5y0vt045e4")[1] as string;
        const from = sectionHolding(migration.productionContract, later).fields as Json[];
        const field = from.splice(from.findIndex((entry) => entry.id === later), 1)[0] as Json;
        const into = sectionsOf(migration.productionContract)
          .find((section) => (section.fields as Json[]).some((entry) => entry.id === sourceIdsOf(migration, SUBMISSIONS)[0])) as Json;
        (into.fields as Json[]).unshift(field);
        refreshFrom(migration);
      }],
    ];
    for (const [name, mutate] of cases) {
      const migration = migrationCase();
      mutate(migration);
      const moves = movesOf(migration).filter(([target]) => target !== "field_9xwe3dqd8haknzmf5y0vt045e4");
      assert.deepEqual(moves, [], name);
    }
  });

  it("lists no reordering when sources keep production's order", () => {
    assert.equal(verifyCase(migrationCase()).added.filter((item) => item.kind === "reordered").length, 0);
  });

  it("covers every field the fixture retires", () => {
    const migration = migrationCase();
    const retired = new Set(migration.candidateContract.tombstonedIds as string[]);
    const declared = new Set(allFields(migration.productionContract).map((field) => field.id));
    assert.deepEqual([...retired].filter((id) => !declared.has(id)), []);
  });
});

describe("field migration refusals", () => {
  for (const entry of refusals) {
    it(`${entry.code}: ${entry.name}`, () => assertRefused(entry));
  }
});
