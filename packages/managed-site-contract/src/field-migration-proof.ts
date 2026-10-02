import type { ManagedContentOwner } from "./content.js";
import type { ManagedSiteFieldMigrationBridgeStepV1 } from "./field-migration-bridge.js";
import type {
  ManagedSiteFieldMigrationBlockV1,
  ManagedSiteFieldMigrationMarkV1,
  ManagedSiteFieldMigrationStepV1,
} from "./field-migration-schema.js";
import type { ManagedSiteFieldMigrationMoveV1 } from "./field-migration-position.js";
import type { ManagedSiteFieldMigrationOutlineEntryV1 } from "./field-migration-references.js";
import type {
  ManagedSiteFieldMigrationH1AdoptionV1,
  ManagedSiteFieldMigrationSeoReorderV1,
} from "./field-migration-urls.js";
import {
  managedSiteFieldMigrationRole,
  type ManagedSiteFieldMigrationResolvedStepV1,
} from "./field-migration-steps.js";
import type { ManagedSiteFieldMigrationOffsetV1 } from "./field-migration-transform.js";
import type { ManagedLinkDestination, ManagedLinkTarget } from "./values.js";

/**
 * Material a migration adds that no production value held: it comes from the
 * declaration, which is to say from code. It is allowed, and every item is
 * listed so a reviewer sees each one.
 */
export type ManagedSiteFieldMigrationAddedItemV1 =
  | {
      readonly kind: "literal";
      readonly target: string;
      readonly part: number;
      readonly text: string;
    }
  | {
      readonly kind: "mark";
      readonly target: string;
      readonly part: number;
      readonly mark: "italic" | "bold";
    }
  | {
      /**
       * A `hard_break` the declaration put before this part: structure code
       * chose, between two lines of the target's block.
       */
      readonly kind: "hard_break";
      readonly target: string;
      readonly part: number;
    }
  | {
      readonly kind: "link";
      readonly target: string;
      readonly part: number;
      readonly destination: ManagedLinkDestination;
      readonly linkTarget: ManagedLinkTarget;
    }
  | {
      /**
       * The block the target renders, which code chose, and what each source
       * meant to a reader (`heading:2`, `label`, `body`, `rich_text`), so a
       * reviewer can tell a label made a heading from body text.
       */
      readonly kind: "block";
      readonly target: string;
      readonly block: ManagedSiteFieldMigrationBlockV1 | { readonly type: "plain_text" };
      readonly targetRole: string;
      readonly sources: readonly { readonly fieldId: string; readonly role: string }[];
    }
  | {
      /**
       * A plain-text target whose role differs from a source's: running text
       * relabelled (`body` made `label`, say). Allowed, and named here, since
       * a later change may treat the new role differently.
       */
      readonly kind: "role";
      readonly target: string;
      readonly from: readonly string[];
      readonly to: string;
    }
  | ManagedSiteFieldMigrationMoveV1
  | ManagedSiteFieldMigrationOutlineEntryV1
  | ManagedSiteFieldMigrationSeoReorderV1
  | ManagedSiteFieldMigrationH1AdoptionV1
  | {
      /**
       * The step's sources were not side by side in production's order: it
       * joins them in another order, or production declared other fields
       * between them, which now read before or after the whole target.
       */
      readonly kind: "reordered";
      readonly target: string;
      readonly declared: readonly string[];
      readonly production: readonly string[];
      readonly interleaved: readonly string[];
    };

export type ManagedSiteFieldMigrationPartProofV1 =
  | ({ readonly kind: "source"; readonly fieldId: string } & ManagedSiteFieldMigrationOffsetV1)
  | ({ readonly kind: "literal"; readonly text: string } & ManagedSiteFieldMigrationOffsetV1);

export interface ManagedSiteFieldMigrationStepProofV1 {
  readonly op: ManagedSiteFieldMigrationStepV1["op"];
  readonly target: string;
  readonly owner: ManagedContentOwner;
  readonly sources: readonly { readonly fieldId: string; readonly owner: ManagedContentOwner }[];
  readonly parts: readonly ManagedSiteFieldMigrationPartProofV1[];
}

/**
 * Production values are unchanged or consumed; candidate values are unchanged,
 * a step's target, or an addition listed in `additions`. Both sums hold.
 */
export interface ManagedSiteFieldMigrationAccountingV1 {
  readonly productionValues: number;
  readonly unchanged: number;
  readonly consumed: number;
  readonly candidateValues: number;
  readonly targets: number;
  readonly added: number;
}

/** What the candidate adds beyond the migration, from the diff itself. */
export interface ManagedSiteFieldMigrationAdditionsV1 {
  readonly stableIds: readonly string[];
  readonly contentValues: readonly { readonly fieldId: string; readonly owner: ManagedContentOwner }[];
  readonly assetManifestEntries: number;
}

export interface ManagedSiteFieldMigrationProofV1 {
  readonly kind: "migrated";
  readonly declarationSha256: string;
  readonly bridge: ManagedSiteFieldMigrationBridgeStepV1 | null;
  readonly accounting: ManagedSiteFieldMigrationAccountingV1;
  readonly steps: readonly ManagedSiteFieldMigrationStepProofV1[];
  /** Material the declaration adds to its targets: literals, marks, links, blocks. */
  readonly added: readonly ManagedSiteFieldMigrationAddedItemV1[];
  /** Declarations, values and asset material the candidate adds outside any step. */
  readonly additions: ManagedSiteFieldMigrationAdditionsV1;
}

function markItem(
  target: string,
  part: number,
  mark: ManagedSiteFieldMigrationMarkV1,
): ManagedSiteFieldMigrationAddedItemV1 {
  if (mark.type === "link") {
    return { kind: "link", target, part, destination: mark.destination, linkTarget: mark.target };
  }
  return { kind: "mark", target, part, mark: mark.type };
}

function roleItem(
  resolved: ManagedSiteFieldMigrationResolvedStepV1,
): readonly ManagedSiteFieldMigrationAddedItemV1[] {
  if (resolved.target.type !== "plain_text") return [];
  const to = managedSiteFieldMigrationRole(resolved.target);
  const from = [...new Set(resolved.sources.map(managedSiteFieldMigrationRole))].sort();
  if (from.every((role) => role === to)) return [];
  return [{ kind: "role", target: resolved.step.target, from, to }];
}

function reorderedItem(
  resolved: ManagedSiteFieldMigrationResolvedStepV1,
): readonly ManagedSiteFieldMigrationAddedItemV1[] {
  const declared = resolved.sources.map((source) => source.id);
  const { productionOrder: production, interleaved } = resolved;
  const sameOrder = declared.every((id, index) => id === production[index]);
  if (sameOrder && interleaved.length === 0) return [];
  return [{ kind: "reordered", target: resolved.step.target, declared, production, interleaved }];
}

/**
 * Every hard break, literal, declared mark, link and block a step adds, in part order,
 * and its source order when that is not production's.
 */
export function managedSiteFieldMigrationAddedItems(
  resolved: ManagedSiteFieldMigrationResolvedStepV1,
): readonly ManagedSiteFieldMigrationAddedItemV1[] {
  const { step } = resolved;
  const { target } = step;
  const parts = step.parts.flatMap((part, index) => [
    ...(part.joinedBy === "hard_break"
      ? [{ kind: "hard_break" as const, target, part: index }]
      : []),
    ...("literal" in part
      ? [{ kind: "literal" as const, target, part: index, text: part.literal }]
      : []),
    ...(part.marks ?? []).map((mark) => markItem(target, index, mark)),
  ]);
  const block = {
    kind: "block" as const,
    target,
    block: step.into.type === "plain_text" ? { type: "plain_text" as const } : step.into.block,
    targetRole: managedSiteFieldMigrationRole(resolved.target),
    sources: resolved.sources.map((source) => ({ fieldId: source.id, role: managedSiteFieldMigrationRole(source) })),
  };
  return [block, ...roleItem(resolved), ...reorderedItem(resolved), ...parts];
}

export function managedSiteFieldMigrationStepProof(
  resolved: ManagedSiteFieldMigrationResolvedStepV1,
  offsets: readonly ManagedSiteFieldMigrationOffsetV1[],
): ManagedSiteFieldMigrationStepProofV1 {
  const { step, owner } = resolved;
  return {
    op: step.op,
    target: step.target,
    owner,
    sources: resolved.sources.map((source) => ({ fieldId: source.id, owner })),
    parts: step.parts.map((part, index) =>
      "literal" in part
        ? { kind: "literal", text: part.literal, ...offsets[index] }
        : { kind: "source", fieldId: part.source, ...offsets[index] },
    ),
  };
}
