import { ManagedSiteContractError } from "./errors.js";
import type { ManagedSiteContractFacts } from "./contract-semantics-facts.js";
import { getStableIdKind } from "./ids.js";

function fail(code: string, message: string): never {
  throw new ManagedSiteContractError(code, message);
}

function pathAlias(path: string): string {
  return path.normalize("NFKC").toLowerCase();
}

function pointersOverlap(left: readonly string[], right: readonly string[]): boolean {
  const shorter = left.length <= right.length ? left : right;
  const longer = shorter === left ? right : left;
  return shorter.every((token, index) => token === longer[index]);
}

function samePointer(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((token, index) => token === right[index]);
}

function countDeclarations(facts: ManagedSiteContractFacts, kind: "alias" | "field"): ReadonlyMap<string, number> {
  const counts = new Map<string, number>();
  for (const declaration of facts.declarations) {
    if (declaration.kind === kind) counts.set(declaration.id, (counts.get(declaration.id) ?? 0) + 1);
  }
  return counts;
}

function aliasMembershipsByField(facts: ManagedSiteContractFacts): ReadonlyMap<string, string> {
  const fields = countDeclarations(facts, "field");
  const aliases = countDeclarations(facts, "alias");
  const groupsByField = new Map<string, number[]>();
  const invalidGroups = new Set<number>();
  for (const [index, group] of facts.aliases.entries()) {
    if (aliases.get(group.id) !== 1 || new Set(group.fieldIds).size !== group.fieldIds.length) invalidGroups.add(index);
    for (const fieldId of group.fieldIds) {
      if (fields.get(fieldId) !== 1) invalidGroups.add(index);
      const groups = groupsByField.get(fieldId) ?? [];
      groups.push(index);
      groupsByField.set(fieldId, groups);
    }
  }
  for (const groups of groupsByField.values()) {
    if (groups.length > 1) for (const group of groups) invalidGroups.add(group);
  }
  const memberships = new Map<string, string>();
  for (const [index, group] of facts.aliases.entries()) {
    if (!invalidGroups.has(index)) for (const fieldId of group.fieldIds) memberships.set(fieldId, group.location);
  }
  return memberships;
}

function shareExactAtomicAliasSource(
  left: ManagedSiteContractFacts["sources"][number],
  right: ManagedSiteContractFacts["sources"][number],
  memberships: ReadonlyMap<string, string>,
): boolean {
  if (left.owner !== "field" || right.owner !== "field" || left.id === right.id) return false;
  if (getStableIdKind(left.id) !== "field" || getStableIdKind(right.id) !== "field") return false;
  const leftGroup = memberships.get(left.id);
  return leftGroup !== undefined && leftGroup === memberships.get(right.id);
}

function sourcesOverlap(left: ManagedSiteContractFacts["sources"][number], right: ManagedSiteContractFacts["sources"][number]): boolean {
  return pathAlias(left.address.path) === pathAlias(right.address.path) && pointersOverlap(left.address.tokens, right.address.tokens);
}

export function validateManagedSiteContractSourceFacts(facts: ManagedSiteContractFacts): void {
  const paths = new Map<string, string>();
  for (const source of facts.sources) {
    const alias = pathAlias(source.address.path);
    const priorPath = paths.get(alias);
    if (priorPath !== undefined && priorPath !== source.address.path) fail("CONTRACT_SOURCE_PATH_ALIAS", `Source paths alias: ${source.address.path}`);
    paths.set(alias, source.address.path);
  }
  const memberships = aliasMembershipsByField(facts);
  for (const [index, source] of facts.sources.entries()) {
    for (const other of facts.sources.slice(index + 1)) {
      const exactAlias = samePointer(source.address.tokens, other.address.tokens) && shareExactAtomicAliasSource(source, other, memberships);
      if (sourcesOverlap(source, other) && !exactAlias) fail("CONTRACT_SOURCE_POINTER_OVERLAP", `Source pointers overlap at ${source.location}`);
    }
  }
}
