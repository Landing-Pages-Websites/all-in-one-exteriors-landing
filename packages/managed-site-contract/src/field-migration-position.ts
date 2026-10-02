import type { ManagedSiteContractV1 } from "./contract.js";
import type { ManagedSiteFieldMigrationResolvedStepV1 } from "./field-migration-steps.js";

/** Where a field is declared: its page, its section, and its index there. */
export interface ManagedSiteFieldMigrationPlaceV1 {
  readonly pageId: string;
  readonly sectionId: string;
  readonly position: number;
}

interface Placement extends ManagedSiteFieldMigrationPlaceV1 {
  /** Its index in the whole contract's declaration order. */
  readonly rank: number;
}

/**
 * Text a reader now sees somewhere else. `field` is a source whose text now
 * renders in its target's section, or a target declared out of production's
 * order within its section; `from` is where production had it.
 */
export interface ManagedSiteFieldMigrationMoveV1 {
  readonly kind: "moved";
  readonly target: string;
  readonly field: string;
  readonly from: ManagedSiteFieldMigrationPlaceV1;
  readonly to: ManagedSiteFieldMigrationPlaceV1;
}

function placements(contract: ManagedSiteContractV1): ReadonlyMap<string, Placement> {
  const placed = new Map<string, Placement>();
  for (const page of contract.pages) {
    for (const section of page.sections) {
      section.fields.forEach((field, position) =>
        placed.set(field.id, { pageId: page.id, sectionId: section.id, position, rank: placed.size }));
    }
  }
  return placed;
}

function place({ pageId, sectionId, position }: Placement): ManagedSiteFieldMigrationPlaceV1 {
  return { pageId, sectionId, position };
}

function sameSection(left: Placement, right: Placement): boolean {
  return left.pageId === right.pageId && left.sectionId === right.sectionId;
}

interface Ranked {
  readonly id: string;
  readonly rank: number;
  readonly target: boolean;
}

/**
 * Indices of the increasing subsequence of ranks that keeps the most
 * unchanged fields, then the most targets. When a target and its neighbour
 * are out of order with each other, the target is the one left out, so a
 * moved target is never hidden by blaming the field beside it.
 */
function keptInOrder(ranked: readonly Ranked[]): ReadonlySet<number> {
  const weightOf = (entry: Ranked) => (entry.target ? 1 : ranked.length + 1);
  const best: number[] = [];
  const previous: number[] = [];
  ranked.forEach((entry, index) => {
    best[index] = weightOf(entry);
    previous[index] = -1;
    for (let before = 0; before < index; before += 1) {
      const candidate = best[before] + weightOf(entry);
      if (ranked[before].rank < entry.rank && candidate > best[index]) {
        best[index] = candidate;
        previous[index] = before;
      }
    }
  });
  let end = -1;
  best.forEach((weight, index) => {
    if (end === -1 || weight > best[end]) end = index;
  });
  const kept = new Set<number>();
  for (let index = end; index !== -1; index = previous[index]) kept.add(index);
  return kept;
}

/**
 * The targets left out of order, and every kept target whose order with one
 * of them is inverted: when two targets swap, both moved, and which one the
 * subsequence happened to keep must not decide which one is named.
 */
function outOfOrderTargets(ranked: readonly Ranked[], kept: ReadonlySet<number>): ReadonlySet<number> {
  const dropped = ranked.flatMap((entry, index) => (entry.target && !kept.has(index) ? [index] : []));
  const named = new Set(dropped);
  for (const index of dropped) {
    ranked.forEach((entry, other) => {
      const inverted = (other < index) !== (entry.rank < ranked[index].rank);
      if (entry.target && kept.has(other) && inverted) named.add(other);
    });
  }
  return named;
}

/**
 * The production field a candidate field stands for in its section: itself,
 * or for a target the first of its sources that production declared in that
 * same section. A target with no source there is reported per source instead.
 */
function anchorIn(
  section: { readonly id: string },
  id: string,
  production: ReadonlyMap<string, Placement>,
  sourcesOf: ReadonlyMap<string, readonly string[]>,
): Placement | undefined {
  const sources = sourcesOf.get(id);
  if (sources === undefined) {
    const was = production.get(id);
    return was?.sectionId === section.id ? was : undefined;
  }
  return sources.map((source) => production.get(source)).find((was) => was?.sectionId === section.id);
}

/**
 * Within each candidate section, the fields production also had keep
 * production's order unless they moved. The fewest out of order are found by
 * the subsequence above, so a field added or retired beside a target never
 * makes the target look moved, and a target that did move is always named.
 * Only targets are reported: other fields are the ordinary policy's business.
 */
function targetsOutOfOrder(
  candidate: ManagedSiteContractV1,
  production: ReadonlyMap<string, Placement>,
  sourcesOf: ReadonlyMap<string, readonly string[]>,
): ReadonlyMap<string, Placement> {
  const moved = new Map<string, Placement>();
  for (const section of candidate.pages.flatMap((page) => page.sections)) {
    const ranked = section.fields.flatMap((field): Ranked[] => {
      const id: string = field.id;
      const was = anchorIn(section, id, production, sourcesOf);
      return was === undefined ? [] : [{ id, rank: was.rank, target: sourcesOf.has(id) }];
    });
    for (const index of outOfOrderTargets(ranked, keptInOrder(ranked))) {
      const entry = ranked[index];
      const was = anchorIn(section, entry.id, production, sourcesOf);
      if (was !== undefined) moved.set(entry.id, was);
    }
  }
  return moved;
}

/**
 * Every place a merge moves text a reader sees: each source that rendered in
 * another section than its target's, and each target declared out of
 * production's order within its section. A merge across sections is
 * legitimate (#73 has two), so a move is listed, never refused. Sections and
 * pages keep their own order under the ordinary policy, as for any change. A
 * site-scoped field is declared in one section but read on every page it is
 * used on, at a place code decides, so its declaration place says nothing a
 * reader sees; its usages are bound exactly instead (MIGRATION_SCOPE_MISMATCH).
 */
export function managedSiteFieldMigrationMoves(
  production: ManagedSiteContractV1,
  candidate: ManagedSiteContractV1,
  steps: readonly ManagedSiteFieldMigrationResolvedStepV1[],
): readonly ManagedSiteFieldMigrationMoveV1[] {
  const before = placements(production);
  const after = placements(candidate);
  // A field is read on its usage page. A declaration on any other page, or a
  // site-scoped one, says nothing about where a reader sees it, so only
  // page-scoped steps declared on their own page, before and after, report.
  const pageSteps = steps.filter(({ target, owner }) =>
    target.scope === "page" && owner.kind === "page" && after.get(target.id)?.pageId === owner.pageId);
  const sourcesOf = new Map(pageSteps.map(({ step, productionOrder }) => [step.target as string, productionOrder]));
  const outOfOrder = targetsOutOfOrder(candidate, before, sourcesOf);
  return pageSteps.flatMap(({ step, productionOrder }) => {
    const to = after.get(step.target);
    if (to === undefined) return [];
    const moves = productionOrder.flatMap((source) => {
      const from = before.get(source);
      return from === undefined || from.pageId !== to.pageId || sameSection(from, to)
        ? []
        : [{ kind: "moved" as const, target: step.target, field: source, from: place(from), to: place(to) }];
    });
    const anchor = outOfOrder.get(step.target);
    const reordered = anchor === undefined
      ? []
      : [{ kind: "moved" as const, target: step.target, field: step.target, from: place(anchor), to: place(to) }];
    return [...moves, ...reordered];
  });
}
