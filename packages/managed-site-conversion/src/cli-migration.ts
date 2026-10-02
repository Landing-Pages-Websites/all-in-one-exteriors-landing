import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";

import {
  canonicalizeJson,
  MANAGED_SITE_FIELD_MIGRATION_FILE,
} from "@landing-pages-websites/managed-site-contract";

import { renderAnchor } from "./anchors.js";
import {
  buildFieldMigrationDeclaration,
  replacedFieldEvidence,
  unresolvedRetirements,
  type FieldMigrationPlan,
  type ReplacedFieldEvidence,
} from "./field-migration.js";
import type { Proposal } from "./propose.js";

export interface FieldMigrationOptions {
  readonly planPath: string | null;
  readonly productionContractPath: string | null;
  readonly productionContentPath: string | null;
}

export interface FieldMigrationOutcome {
  /** Lines for the run summary. */
  readonly lines: readonly string[];
  /** Retired fields no declared step consumes: the conversion is not finished. */
  readonly unresolved: number;
  /** The canonical sidecar text, or null when this run writes none. */
  readonly sidecar: string | null;
}

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf8")) as unknown;
}

function evidenceFor(proposal: Proposal): ReplacedFieldEvidence {
  return replacedFieldEvidence(
    proposal.ledger.retiredRecords(),
    proposal.fields.map((field) => ({
      fieldId: field.fieldId,
      anchor: renderAnchor(field.candidate.anchor),
      minted: proposal.ledger.mintedThisRun(field.fieldId),
    })),
  );
}

function describeEvidence(evidence: ReplacedFieldEvidence): string[] {
  return [
    ...evidence.groups.map(
      (group) =>
        `field migration: ${group.target} replaces ${group.sources.map((source) => source.id).join(", ")}`,
    ),
    ...evidence.unclaimed.map(
      (record) => `field migration: ${record.id} is retired and nothing replaces it (${record.anchor})`,
    ),
  ];
}

function unresolvedLines(
  records: readonly { readonly kind: string; readonly id: string; readonly anchor: string }[],
): string[] {
  return records.map(
    (record) =>
      `field migration: UNRESOLVED ${record.kind} ${record.id} (${record.anchor}) is retired and no declared step consumes it`,
  );
}

function requiredPath(path: string | null, flag: string): string {
  if (path === null) throw new Error(`--migration-plan needs ${flag}`);
  return path;
}

/**
 * What this conversion replaced, and the sidecar for it when a person has
 * written the plan. Without a plan, every replacement is reported and left
 * unresolved: the merge's order, separators and marks are not in the source
 * the converter reads, so it never writes them itself.
 */
export function fieldMigrationOutcome(
  proposal: Proposal,
  options: FieldMigrationOptions,
): FieldMigrationOutcome {
  const evidence = evidenceFor(proposal);
  const lines = describeEvidence(evidence);
  if (options.planPath === null) {
    const unresolved = unresolvedRetirements(evidence, null);
    return { lines: [...lines, ...unresolvedLines(unresolved)], unresolved: unresolved.length, sidecar: null };
  }
  const { declaration, unplanned } = buildFieldMigrationDeclaration(
    readJson(options.planPath) as FieldMigrationPlan,
    evidence,
    {
      contract: readJson(requiredPath(options.productionContractPath, "--production-contract")),
      content: readJson(requiredPath(options.productionContentPath, "--production-content")),
    },
  );
  const unresolved = unresolvedRetirements(evidence, declaration);
  return {
    lines: [
      ...lines,
      ...unplanned.map((group) => `field migration: no plan step for ${group.target}`),
      ...unresolvedLines(unresolved),
    ],
    unresolved: unresolved.length,
    sidecar: `${JSON.stringify(JSON.parse(canonicalizeJson(declaration)), null, 2)}\n`,
  };
}

/** A run writes the sidecar or removes it, so a stale one never stands beside it. */
export function sidecarPath(directory: string): string {
  return join(directory, MANAGED_SITE_FIELD_MIGRATION_FILE);
}

export function removeSidecar(directory: string): void {
  rmSync(sidecarPath(directory), { force: true });
}
