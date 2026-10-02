import {
  collectManagedSiteContractOccurrences,
  type ManagedSiteContractOccurrence,
} from "./contract-occurrence-registry.js";
import type { ManagedSiteContractV1 } from "./contract.js";
import { ManagedSiteContractError } from "./errors.js";
import { copyJsonValue } from "./json.js";

const INDEXED_STEP = /^(.+)\[(\d+)\]$/u;

interface Slot {
  readonly holder: unknown;
  readonly key: string | number;
}

function child(value: unknown, key: string | number): unknown {
  if (typeof key === "number") return Array.isArray(value) ? value[key] : undefined;
  return value !== null && typeof value === "object" ? (value as Record<string, unknown>)[key] : undefined;
}

/** Each step of an occurrence location (`a.b[2].c`) as the key it reads. */
function locationKeys(location: string): readonly (string | number)[] {
  return location.split(".").flatMap((step) => {
    const indexed = INDEXED_STEP.exec(step);
    return indexed === null ? [step] : [indexed[1], Number(indexed[2])];
  });
}

/** The value at an occurrence location, or undefined where the path does not reach. */
export function valueAtOccurrenceLocation(root: unknown, location: string): unknown {
  return locationKeys(location).reduce<unknown>((value, key) => child(value, key), root);
}

function slotAt(root: unknown, location: string): Slot {
  const keys = locationKeys(location);
  const holder = keys.slice(0, -1).reduce<unknown>((value, key) => child(value, key), root);
  return { holder, key: keys[keys.length - 1] };
}

/**
 * A global field reference: the only place a migration's rename applies, and
 * the only place its reference rules look. Collection-scoped references name
 * item fields, which a migration never retires, and every other occurrence
 * names another kind of id.
 */
export function isGlobalFieldReference(
  occurrence: ManagedSiteContractOccurrence,
): occurrence is ManagedSiteContractOccurrence & { readonly role: "reference" } {
  return occurrence.role === "reference" && occurrence.idKind === "field" && occurrence.scope === "global";
}

/**
 * `contract` read with a migration applied: each retired field renamed to its
 * target where the occurrence registry finds a global field reference, and
 * nowhere else. Any other string equal to a retired id (a JSON-LD literal, a
 * key the registry does not declare) is kept verbatim, so a candidate that
 * changes it is compared against the original and refused.
 */
export function managedSiteContractWithRenamedFieldReferences(
  contract: ManagedSiteContractV1,
  renames: ReadonlyMap<string, string>,
): ManagedSiteContractV1 {
  if (renames.size === 0) return contract;
  const renamed = copyJsonValue(contract);
  for (const occurrence of collectManagedSiteContractOccurrences(contract)) {
    const target = renames.get(occurrence.id);
    if (target === undefined || !isGlobalFieldReference(occurrence)) continue;
    const { holder, key } = slotAt(renamed, occurrence.location);
    if (child(holder, key) !== occurrence.id) {
      throw new ManagedSiteContractError("CONTRACT_OCCURRENCE_UNCLASSIFIED", `Occurrence location does not hold its id: ${occurrence.location}`);
    }
    (holder as Record<string | number, unknown>)[key] = target;
  }
  return renamed;
}
