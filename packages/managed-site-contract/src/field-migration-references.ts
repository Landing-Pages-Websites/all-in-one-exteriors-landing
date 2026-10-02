import { canonicalizeJson } from "./canonical.js";
import {
  isGlobalFieldReference,
  managedSiteContractWithRenamedFieldReferences,
  valueAtOccurrenceLocation,
} from "./contract-occurrence-location.js";
import { collectManagedSiteContractOccurrences } from "./contract-occurrence-registry.js";
import type { ManagedSiteContractV1 } from "./contract.js";
import { ManagedSiteContractError } from "./errors.js";
import type { ManagedSiteFieldMigrationResolvedStepV1 } from "./field-migration-steps.js";

function fail(code: string, message: string): never {
  throw new ManagedSiteContractError(code, message);
}

interface FieldReference {
  readonly id: string;
  readonly location: string;
  /** The record holding the reference, e.g. one heading-outline entry. */
  readonly record: unknown;
  /** Where the record sits, from which its list and owner are read on demand. */
  readonly recordLocation: string;
}

interface ReferenceList {
  /** The list by its owner's stable id, so moving the owner moves nothing. */
  readonly key: string;
  readonly value: unknown;
}

function parentLocation(location: string): string {
  return location.slice(0, location.lastIndexOf("."));
}

function ownId(value: unknown): string | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const id = record.pageId ?? record.id;
  return typeof id === "string" ? id : null;
}

/**
 * A list's key: its nearest owner with a stable id (a page's `pageId`, an
 * alias group's `id`), then the path from that owner, so the key survives the
 * owner moving within its own list. A list with no such owner keys by where it
 * sits, which is as stable as anything that owner-less can be.
 */
function listKey(contract: ManagedSiteContractV1, listLocation: string): string {
  const steps = listLocation.split(".");
  for (let length = steps.length - 1; length > 0; length -= 1) {
    const id = ownId(valueAtOccurrenceLocation(contract, steps.slice(0, length).join(".")));
    if (id !== null) return [id, ...steps.slice(length)].join(".");
  }
  return listLocation;
}

/** The list a reference's record sits in, or null for a lone record. */
function listOf(contract: ManagedSiteContractV1, reference: FieldReference): ReferenceList | null {
  const indexed = /^(.*)\[\d+\]$/u.exec(reference.recordLocation);
  if (indexed === null) return null;
  return { key: listKey(contract, indexed[1]), value: valueAtOccurrenceLocation(contract, indexed[1]) };
}

/**
 * Every place a field id is a global reference, read through the occurrence
 * registry, which is the authority on where a contract can name a field.
 * Collection-scoped references name item fields, which a migration never
 * retires, so only global ones can name a source or a target.
 */
function fieldReferences(contract: ManagedSiteContractV1): readonly FieldReference[] {
  return collectManagedSiteContractOccurrences(contract)
    .filter(isGlobalFieldReference)
    .map((occurrence) => {
      const recordLocation = parentLocation(occurrence.location);
      return {
        id: occurrence.id,
        location: occurrence.location,
        record: valueAtOccurrenceLocation(contract, recordLocation),
        recordLocation,
      };
    });
}

const OUTLINE_ENTRY = /\.headingOutline\[\d+\]\.fieldId$/u;

/**
 * A heading-outline entry, by where the registry found it rather than by its
 * shape, and the heading level it gives the field it names.
 */
function outlineLevel(reference: FieldReference): number | null {
  if (!OUTLINE_ENTRY.test(reference.location)) return null;
  const record = reference.record as Record<string, unknown> | null;
  return typeof record?.semanticLevel === "number" ? record.semanticLevel : null;
}

/**
 * Only a heading-outline entry may follow a merge: it names a heading, and the
 * target is a heading at that level. Any other reference (JSON-LD, intent,
 * business identity, an alias group) reads the field's VALUE, and a merged
 * target holds more than any one source did, so following it would change
 * what a crawler reads. Those are deferred. One outline may name a step's
 * sources once, because the step renders one heading.
 */
function assertSourceReferences(
  production: ManagedSiteContractV1,
  references: readonly FieldReference[],
  steps: readonly ManagedSiteFieldMigrationResolvedStepV1[],
): void {
  for (const resolved of steps) {
    const { step, sources } = resolved;
    const ids = new Set<string>(sources.map((source) => source.id));
    const named = references.filter((reference) => ids.has(reference.id));
    const outside = named.find((reference) => outlineLevel(reference) === null);
    if (outside !== undefined) {
      fail("MIGRATION_TRANSFORM_DEFERRED", `Source ${outside.id} is referenced outside a heading outline`);
    }
    assertOneBlock(production, resolved, named);
  }
}

type ResolvedSource = ManagedSiteFieldMigrationResolvedStepV1["sources"][number];

/**
 * A heading field no outline names: the outline is the contract's statement
 * of the headings a page has, so such a field is a line of a heading, not a
 * heading the contract can see. Production declares each line of a split
 * heading (a TextReveal, a `<br>`) as its own field of the heading's level.
 */
function isUnoutlinedHeadingLine(source: ResolvedSource, outlinedIds: ReadonlySet<string>): boolean {
  return source.type === "heading_text" && !outlinedIds.has(source.id);
}

function sectionIdOf(contract: ManagedSiteContractV1, fieldId: string): string | undefined {
  return contract.pages
    .flatMap((page) => page.sections)
    .find((section) => section.fields.some((field) => field.id === fieldId))?.id;
}

/**
 * The lines of one heading are one section's neighbours: a heading drawn over
 * several fields is declared as consecutive fields of one section, with
 * nothing between them. Fields in two sections, or with another field
 * between, are two things the page shows, and an outline that does not name
 * them is no evidence they are one heading.
 */
function assertLinesAreNeighbours(
  production: ManagedSiteContractV1,
  resolved: ManagedSiteFieldMigrationResolvedStepV1,
  lines: readonly ResolvedSource[],
): void {
  const sections = new Set(lines.map((line) => sectionIdOf(production, line.id)));
  if (sections.size !== 1 || sections.has(undefined) || resolved.interleaved.length > 0) {
    fail(
      "MIGRATION_SOURCE_STRUCTURE_LOST",
      `${resolved.step.target} joins heading fields that are not consecutive in one section`,
    );
  }
}

/**
 * The lines are joined only as the declaration says: between two consecutive
 * lines there is a hard break (`joinedBy`) or a literal part, never nothing.
 * Without one, F would write their text end to end and the boundary between
 * the lines, which production's fields kept, would be gone unannounced.
 */
function assertLinesAreSeparated(
  resolved: ManagedSiteFieldMigrationResolvedStepV1,
  lines: readonly ResolvedSource[],
): void {
  const ids = new Set(lines.map((line) => line.id));
  const { parts, target } = resolved.step;
  const lineAt = parts.flatMap((part, index) => ("source" in part && ids.has(part.source) ? [index] : []));
  lineAt.slice(1).forEach((index, at) => {
    const adjacent = index - (lineAt[at] ?? index) === 1;
    if (adjacent && parts[index]?.joinedBy !== "hard_break") {
      fail("MIGRATION_SOURCE_STRUCTURE_LOST", `${target} joins heading lines with nothing declared between them`);
    }
  });
}

/**
 * A rich-text block is one block a reader sees, and so is any field an
 * outline names as a heading, whatever its type. Two of them in one step would
 * become one block, and the boundary between them would be lost, which is a
 * dropped outline entry when the outline names both. A `heading_text` no
 * outline names is a line, and the lines of one heading are one block however
 * many fields they are, provided they are consecutive fields of one section
 * (`assertLinesAreNeighbours`); they may not join a block the outline does
 * see, and they all sit at one level, because the target is one heading
 * (checked with each source's structure).
 */
function assertOneBlock(
  production: ManagedSiteContractV1,
  resolved: ManagedSiteFieldMigrationResolvedStepV1,
  outlined: readonly FieldReference[],
): void {
  const { sources, step } = resolved;
  const outlinedIds = new Set(outlined.map((reference) => reference.id));
  const lines = sources.filter((source) => isUnoutlinedHeadingLine(source, outlinedIds));
  const others = sources.filter(
    (source) => !lines.includes(source) && (source.type === "rich_text" || outlinedIds.has(source.id)),
  );
  const blocks = others.length + (lines.length > 0 ? 1 : 0);
  if (blocks > 1) {
    fail("MIGRATION_SOURCE_STRUCTURE_LOST", `${step.target} would join ${blocks} blocks into one`);
  }
  if (lines.length > 1) {
    assertLinesAreNeighbours(production, resolved, lines);
    assertLinesAreSeparated(resolved, lines);
  }
}

/**
 * For each list that names one of `ids`, by its key, only the entries that
 * name one of them, in list order. Every other entry, and every list naming
 * none of them, is the ordinary policy's business, so an unrelated heading
 * added to the same outline blocks nothing. An entry names an id when the
 * registry finds the reference in it, never by a key read off its shape.
 */
function migratedEntries(
  contract: ManagedSiteContractV1,
  references: readonly FieldReference[],
  ids: ReadonlySet<string>,
): ReadonlyMap<string, readonly unknown[]> {
  const naming = references.filter(({ id }) => ids.has(id));
  const records = new Set(naming.map(({ record }) => record));
  const lists = new Map<string, readonly unknown[]>();
  for (const reference of naming) {
    const list = listOf(contract, reference);
    if (list === null || !Array.isArray(list.value)) continue;
    lists.set(list.key, list.value.filter((entry: unknown) => records.has(entry)));
  }
  return lists;
}

function sortedCanonical(entries: readonly unknown[]): string {
  return canonicalizeJson(entries.map((entry) => canonicalizeJson(entry)).sort());
}

/**
 * An outline entry a rich-text H1 target needs and no source gave it. Content
 * semantics (0.16.1) require every rich-text field holding a level 1 heading
 * to be outlined at level 1 (`CONTENT_RICH_TEXT_H1_UNDECLARED`), but a page's
 * H1 was never outlined when its lines were `heading_text` fields, since those
 * are H1 sources by their own level. So a migration that makes the H1 a
 * rich-text field must add the entry, and refusing it would refuse a result
 * the contract itself requires. Listed in the proof, one per target and
 * outline. Whether the page's H1 is the same one, or a page that had none may
 * adopt one (listed as `h1_adopted`), is the H1 rule's, which holds it exactly.
 */
export interface ManagedSiteFieldMigrationOutlineEntryV1 {
  readonly kind: "outline_entry";
  readonly target: string;
  readonly outline: string;
  readonly semanticLevel: 1;
}

function entryFieldId(entry: unknown): string | null {
  const id = (entry as { readonly fieldId?: unknown } | null)?.fieldId;
  return typeof id === "string" ? id : null;
}

/**
 * The candidate's migrated entries with the level 1 entries a rich-text H1
 * target needs set aside, and those set aside. At most one per target, and
 * only for a target no production entry named a source of.
 */
function setAsideRequiredH1Entries(
  key: string,
  expected: readonly unknown[],
  actual: readonly unknown[],
  h1Targets: ReadonlySet<string>,
): { readonly rest: readonly unknown[]; readonly added: readonly ManagedSiteFieldMigrationOutlineEntryV1[] } {
  const named = new Set(expected.map(entryFieldId));
  const added: ManagedSiteFieldMigrationOutlineEntryV1[] = [];
  const rest = actual.filter((entry) => {
    const target = entryFieldId(entry);
    const level = (entry as { readonly semanticLevel?: unknown }).semanticLevel;
    if (target === null || level !== 1 || !h1Targets.has(target) || named.has(target)) return true;
    named.add(target);
    added.push({ kind: "outline_entry", target, outline: key, semanticLevel: 1 });
    return false;
  });
  return { rest, added };
}

/**
 * The migrated entries must match production's, renamed, as a set, plus the
 * level 1 entries a rich-text H1 target needs. Where they now sit, relative
 * to each other and to every other entry, is the ordinary SEO rule's: it
 * compares the whole outline with the migration applied and lists any reorder,
 * as it does for any change.
 */
function compareOutline(
  key: string,
  expected: readonly unknown[] | undefined,
  actual: readonly unknown[] | undefined,
  h1Targets: ReadonlySet<string>,
): readonly ManagedSiteFieldMigrationOutlineEntryV1[] {
  const { rest, added } = setAsideRequiredH1Entries(key, expected ?? [], actual ?? [], h1Targets);
  if (sortedCanonical(expected ?? []) !== sortedCanonical(rest)) {
    fail("MIGRATION_REFERENCE_CHANGED", `Outline ${key} does not name the migrated fields production did, at their levels`);
  }
  return added;
}

function targetLevel(step: ManagedSiteFieldMigrationResolvedStepV1["step"]): number | null {
  return step.into.type === "rich_text" && step.into.block.type === "heading" ? step.into.block.level : null;
}

/** A target is named only by outline entries, at the level it renders. */
function assertTargetReferences(
  references: readonly FieldReference[],
  steps: readonly ManagedSiteFieldMigrationResolvedStepV1[],
): void {
  for (const { step } of steps) {
    for (const reference of references.filter(({ id }) => id === step.target)) {
      const level = outlineLevel(reference);
      if (level === null) {
        fail("MIGRATION_REFERENCE_CHANGED", `Target ${step.target} is referenced outside a heading outline`);
      }
      if (level !== targetLevel(step)) {
        fail("MIGRATION_OUTLINE_LEVEL_MISMATCH", `An outline gives ${step.target} a level its block does not render`);
      }
    }
  }
}

/**
 * Every outline that named a source names its target instead, at the same
 * level; and no outline names a target that production did not name a source
 * in. Where the entries sit, and every other SEO fact, is compared by the
 * ordinary rule with the migration applied, so a migration narrows nothing
 * else and a reorder is listed the same way on both paths. Returns the level 1
 * entries a rich-text H1 target adds, for the proof to list.
 */
export function assertManagedSiteFieldMigrationReferencesV1(
  production: ManagedSiteContractV1,
  candidate: ManagedSiteContractV1,
  steps: readonly ManagedSiteFieldMigrationResolvedStepV1[],
): readonly ManagedSiteFieldMigrationOutlineEntryV1[] {
  const productionReferences = fieldReferences(production);
  const candidateReferences = fieldReferences(candidate);
  assertSourceReferences(production, productionReferences, steps);
  assertTargetReferences(candidateReferences, steps);
  // Production read with the migration applied, renamed only where the
  // registry finds a global field reference: a target names exactly the
  // entries that named its sources, and every other string stays verbatim.
  const targets = managedSiteFieldMigrationRenames(steps);
  const targetIds = new Set(targets.values());
  const migrated = managedSiteContractWithRenamedFieldReferences(production, targets);
  const expected = migratedEntries(migrated, fieldReferences(migrated), targetIds);
  const actual = migratedEntries(candidate, candidateReferences, targetIds);
  const keys = [...new Set([...expected.keys(), ...actual.keys()])].sort();
  const h1Targets = new Set(steps.filter(({ step }) => targetLevel(step) === 1).map(({ step }) => step.target));
  return keys.flatMap((key) => compareOutline(key, expected.get(key), actual.get(key), h1Targets));
}

/** Each retired source's target: how production reads with the migration applied. */
export function managedSiteFieldMigrationRenames(
  steps: readonly ManagedSiteFieldMigrationResolvedStepV1[],
): ReadonlyMap<string, string> {
  return new Map(steps.flatMap(({ step, sources }) => sources.map((source) => [source.id, step.target] as const)));
}
