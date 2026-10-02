import {
  managedSiteFieldMigrationFromV1,
  parseManagedSiteContentDocument,
  parseManagedSiteContractV1,
  parseManagedSiteFieldMigrationV1,
  type ManagedSiteFieldMigrationV1,
} from "@landing-pages-websites/managed-site-contract";

import type { LedgerRecord } from "./id-ledger.js";

/**
 * Which retired fields a new field replaced, read from the one structural fact
 * the converter owns: anchors. A field anchored at an element replaces the
 * retired fields anchored BENEATH it (`…/role:h2` replaces `…/role:h2/text` and
 * `…/role:h2/role:span/text`), which is exactly what happens when a formatted
 * block that used to be one field per run becomes one rich-text field.
 *
 * That says WHICH fields merged, never HOW: the order of the parts, the
 * separators between them and the mark each one takes are not in any anchor,
 * so the converter does not guess them. A person writes them in a migration
 * plan, and this module only checks the plan against the grouping and binds it
 * to the production artifacts it was written for.
 */
export interface ReplacedFieldGroup {
  readonly target: string;
  readonly targetAnchor: string;
  readonly sources: readonly { readonly id: string; readonly anchor: string }[];
}

export interface ReplacedFieldEvidence {
  /**
   * Every id this run retired, of any kind, whatever became of it. Only a
   * field can be consumed by a step, so a retired page, section, item, asset
   * or collection is always unresolved.
   */
  readonly retired: readonly LedgerRecord[];
  readonly groups: readonly ReplacedFieldGroup[];
  /** Retired fields no new field's anchor contains: retirements, not merges. */
  readonly unclaimed: readonly LedgerRecord[];
}

export interface ProposedField {
  readonly fieldId: string;
  readonly anchor: string;
  readonly minted: boolean;
}

function containingField(
  record: LedgerRecord,
  fields: readonly ProposedField[],
): ProposedField | undefined {
  return fields
    .filter((field) => record.anchor.startsWith(`${field.anchor}/`))
    .sort((left, right) => right.anchor.length - left.anchor.length)[0];
}

/**
 * Groups this run's retired field records under the new field whose anchor is
 * their nearest ancestor. A field the ledger already knew is never a target:
 * a migration target must be new, so its retired descendants stay unclaimed.
 */
export function replacedFieldEvidence(
  retired: readonly LedgerRecord[],
  fields: readonly ProposedField[],
): ReplacedFieldEvidence {
  const groups = new Map<string, ReplacedFieldGroup>();
  const unclaimed: LedgerRecord[] = [];
  for (const record of retired.filter((entry) => entry.kind === "field")) {
    const owner = containingField(record, fields);
    if (owner === undefined || !owner.minted) {
      unclaimed.push(record);
      continue;
    }
    const group = groups.get(owner.fieldId) ?? { target: owner.fieldId, targetAnchor: owner.anchor, sources: [] };
    groups.set(owner.fieldId, { ...group, sources: [...group.sources, { id: record.id, anchor: record.anchor }] });
  }
  return { retired, groups: [...groups.values()], unclaimed };
}

/**
 * Retired ids no declared step consumes. Read from every field the run
 * retired, not from the evidence's buckets, so a field is unresolved unless a
 * step names it, whichever bucket it fell into or any bucket added later.
 */
export function unresolvedRetirements(
  evidence: ReplacedFieldEvidence,
  declaration: ManagedSiteFieldMigrationV1 | null,
): readonly LedgerRecord[] {
  const consumed = new Set<string>(declaration?.steps.flatMap(stepSources) ?? []);
  return evidence.retired.filter((record) => !consumed.has(record.id));
}

export interface FieldMigrationPlan {
  readonly bridge?: { readonly from: string; readonly to: string };
  readonly steps: readonly unknown[];
}

export interface ProductionArtifacts {
  readonly contract: unknown;
  readonly content: unknown;
}

function sameMembers(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && [...left].sort().join() === [...right].sort().join();
}

function stepSources(step: ManagedSiteFieldMigrationV1["steps"][number]): readonly string[] {
  return step.parts.flatMap((part) => ("source" in part ? [part.source] : []));
}

function assertPlanMatchesEvidence(
  declaration: ManagedSiteFieldMigrationV1,
  evidence: ReplacedFieldEvidence,
): void {
  const groups = new Map(evidence.groups.map((group) => [group.target, group]));
  for (const step of declaration.steps) {
    const group = groups.get(step.target);
    if (group === undefined) {
      throw new Error(`Migration plan names ${step.target}, which this conversion did not mint over retired fields`);
    }
    if (!sameMembers(stepSources(step), group.sources.map((source) => source.id))) {
      throw new Error(`Migration plan for ${step.target} does not consume exactly the fields its anchor replaced`);
    }
  }
}

/**
 * The sidecar for a plan a person wrote: bound by digest to the production
 * contract and content it migrates, parsed by the contract package's own
 * schema, and refused unless each step consumes exactly the fields its target's
 * anchor replaced. Groups the plan leaves out are returned, for the report.
 */
export function buildFieldMigrationDeclaration(
  plan: FieldMigrationPlan,
  evidence: ReplacedFieldEvidence,
  production: ProductionArtifacts,
): { readonly declaration: ManagedSiteFieldMigrationV1; readonly unplanned: readonly ReplacedFieldGroup[] } {
  const from = managedSiteFieldMigrationFromV1(
    parseManagedSiteContractV1(production.contract),
    parseManagedSiteContentDocument(production.content),
  );
  const declaration = parseManagedSiteFieldMigrationV1({
    schemaVersion: "1.0",
    from,
    ...(plan.bridge === undefined ? {} : { bridge: plan.bridge }),
    steps: plan.steps,
  });
  assertPlanMatchesEvidence(declaration, evidence);
  const planned = new Set<string>(declaration.steps.map((step) => step.target));
  return { declaration, unplanned: evidence.groups.filter((group) => !planned.has(group.target)) };
}
