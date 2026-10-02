import type { JsonValue } from "./json.js";

/**
 * How one SEO section's facts are compared, derived by its caller from the
 * schema and the occurrence registry rather than listed per field.
 */
export interface ManagedSeoFactRules {
  /** Array paths (`a.b[].c`, relative to an entry) whose order is not identity. */
  readonly orderFree: ReadonlySet<string>;
  /** Paths whose values are not compared at all. */
  readonly notCompared: ReadonlySet<string>;
  /** Whether a null or absent production value is an open slot a candidate may fill. */
  readonly openNull: boolean;
}

/**
 * A production SEO list whose items the candidate keeps but in another order:
 * the items as production orders them and as the candidate does. Admitted for
 * a list whose order is not identity, and listed so a reviewer sees it.
 */
export interface ManagedSiteSeoReorderV1 {
  readonly path: string;
  readonly from: readonly JsonValue[];
  readonly to: readonly JsonValue[];
}

type Matcher = (production: unknown, candidate: unknown) => boolean;

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isEmpty(value: unknown): boolean {
  return value === null || value === undefined;
}

function join(path: string, key: string): string {
  return path === "" ? key : `${path}.${key}`;
}

/** Production's items in order within the candidate, earliest match first. */
function subsequence(production: readonly unknown[], candidate: readonly unknown[], match: Matcher): number[] | null {
  const assigned: number[] = [];
  let next = 0;
  for (const item of production) {
    while (next < candidate.length && !match(item, candidate[next])) next += 1;
    if (next === candidate.length) return null;
    assigned.push(next);
    next += 1;
  }
  return assigned;
}

function augment(
  index: number,
  edges: readonly (readonly number[])[],
  owner: (number | undefined)[],
  seen: Set<number>,
): boolean {
  for (const target of edges[index] ?? []) {
    if (seen.has(target)) continue;
    seen.add(target);
    const holder = owner[target];
    if (holder === undefined || augment(holder, edges, owner, seen)) {
      owner[target] = index;
      return true;
    }
  }
  return false;
}

/**
 * Each production item kept by a distinct candidate item, in any order: a
 * maximum bipartite matching, so a match is found whenever one exists.
 */
function matching(production: readonly unknown[], candidate: readonly unknown[], match: Matcher): number[] | null {
  const edges = production.map((item) => candidate.flatMap((next, index) => (match(item, next) ? [index] : [])));
  const owner: (number | undefined)[] = [];
  for (const index of production.keys()) {
    if (!augment(index, edges, owner, new Set())) return null;
  }
  const assigned: number[] = [];
  owner.forEach((holder, target) => {
    if (holder !== undefined) assigned[holder] = target;
  });
  return assigned;
}

function isLevelOne(item: unknown): boolean {
  return isRecord(item) && item.semanticLevel === 1;
}

function isOutline(items: readonly unknown[]): boolean {
  return items.some((item) => isRecord(item) && typeof item.semanticLevel === "number");
}

function indexesWhere(items: readonly unknown[], test: (item: unknown) => boolean): number[] {
  return items.flatMap((item, index) => (test(item) ? [index] : []));
}

/** In order if it can be, else in any order: so a list reads as moved only when it must. */
function preferInOrder(production: readonly unknown[], candidate: readonly unknown[], match: Matcher): number[] | null {
  return subsequence(production, candidate, match) ?? matching(production, candidate, match);
}

/** The outline cut at its level 1 entries: the H1s, and the runs between them. */
function cutAtLevelOne(items: readonly unknown[]): { readonly ones: number[]; readonly runs: number[][] } {
  const ones = indexesWhere(items, isLevelOne);
  const runs: number[][] = [[]];
  items.forEach((item, index) => (isLevelOne(item) ? runs.push([]) : runs[runs.length - 1]?.push(index)));
  return { ones, runs };
}

/**
 * An outline that had no H1 may gain one: a page declaring the H1 it already
 * shows. Whether that is admitted is the H1 rule's (it lists it); here every
 * production section must still be kept, in order when it can be, and the new
 * H1 takes the H1's place, before every section production had.
 */
function withFirstH1(production: readonly unknown[], candidate: readonly unknown[], match: Matcher): number[] | null {
  const sections = indexesWhere(candidate, (item) => !isLevelOne(item));
  const found = preferInOrder(production, sections.map((index) => candidate[index]), match);
  if (found === null) return null;
  const assigned = found.map((position) => sections[position] ?? -1);
  const lastOne = Math.max(-1, ...indexesWhere(candidate, isLevelOne));
  return assigned.every((index) => index > lastOne) ? assigned : null;
}

/**
 * An outline's level 1 entries are the page's H1: kept exactly, in order, none
 * added, and each in its place, so each run of sections between them is
 * matched only within the same run. Sections may reorder inside a run.
 */
function outlineAssignment(production: readonly unknown[], candidate: readonly unknown[], match: Matcher): number[] | null {
  const before = cutAtLevelOne(production);
  const after = cutAtLevelOne(candidate);
  if (before.ones.length === 0) return withFirstH1(production, candidate, match);
  if (before.ones.length !== after.ones.length) return null;
  const assigned: number[] = [];
  for (const [at, one] of before.ones.entries()) {
    const target = after.ones[at] ?? -1;
    if (!match(production[one], candidate[target])) return null;
    assigned[one] = target;
  }
  for (const [at, run] of before.runs.entries()) {
    const targets = after.runs[at] ?? [];
    const runAssigned = preferInOrder(run.map((index) => production[index]), targets.map((index) => candidate[index]), match);
    if (runAssigned === null) return null;
    run.forEach((index, position) => void (assigned[index] = targets[runAssigned[position] ?? -1] ?? -1));
  }
  return assigned;
}

/**
 * Where each production item sits in the candidate, or null if one is lost.
 * Order is identity unless the list is order-free; even then an in-order
 * assignment is preferred, so a list reads as moved only when no in-order one
 * exists.
 */
function assignment(
  production: readonly unknown[],
  candidate: readonly unknown[],
  rules: ManagedSeoFactRules,
  path: string,
): number[] | null {
  const match: Matcher = (left, right) => isPreservedBy(left, right, rules, `${path}[]`);
  if (!rules.orderFree.has(path)) return subsequence(production, candidate, match);
  if (isOutline(production) || isOutline(candidate)) return outlineAssignment(production, candidate, match);
  return preferInOrder(production, candidate, match);
}

/**
 * Whether the candidate keeps every production fact. A scalar is kept exactly
 * and a record keeps each key, including keys only the candidate has. A null
 * or absent value is a fact unless the section's slots are open. An array
 * keeps every item; it may gain items, and where order is not identity its
 * items may move.
 */
export function isPreservedBy(production: unknown, candidate: unknown, rules: ManagedSeoFactRules, path = ""): boolean {
  if (rules.notCompared.has(path)) return true;
  if (isEmpty(production)) return rules.openNull || isEmpty(candidate);
  if (Array.isArray(production)) {
    return Array.isArray(candidate) && assignment(production, candidate, rules, path) !== null;
  }
  if (isRecord(production)) {
    if (!isRecord(candidate)) return false;
    const keys = new Set([...Object.keys(production), ...Object.keys(candidate)]);
    return [...keys].every((key) => isPreservedBy(production[key], candidate[key], rules, join(path, key)));
  }
  return production === candidate;
}

interface ReorderWalk {
  readonly rules: ManagedSeoFactRules;
  readonly path: string;
  readonly display: string;
}

function arrayReorders(production: readonly unknown[], candidate: readonly unknown[], walk: ReorderWalk): ManagedSiteSeoReorderV1[] {
  const assigned = assignment(production, candidate, walk.rules, walk.path) ?? [];
  const moved = assigned.some((target, index) => index > 0 && target < (assigned[index - 1] ?? -1));
  const order = [...assigned].sort((left, right) => left - right);
  const own = moved
    ? [{ path: walk.display, from: production as JsonValue[], to: order.map((index) => candidate[index]) as JsonValue[] }]
    : [];
  const nested = production.flatMap((item, index) => collectSeoReorders(item, candidate[assigned[index] ?? -1], {
    rules: walk.rules,
    path: `${walk.path}[]`,
    display: `${walk.display}[${index}]`,
  }));
  return [...own, ...nested];
}

/** Every reorder a preserved candidate makes, for the lists that admit one. */
export function collectSeoReorders(production: unknown, candidate: unknown, walk: ReorderWalk): ManagedSiteSeoReorderV1[] {
  if (walk.rules.notCompared.has(walk.path) || isEmpty(production)) return [];
  if (Array.isArray(production) && Array.isArray(candidate)) return arrayReorders(production, candidate, walk);
  if (!isRecord(production) || !isRecord(candidate)) return [];
  return Object.keys(production).flatMap((key) => collectSeoReorders(production[key], candidate[key], {
    rules: walk.rules,
    path: join(walk.path, key),
    display: `${walk.display}.${key}`,
  }));
}
