import { canonicalizeJson } from "./canonical.js";
import {
  validateParsedManagedCollectionValue,
  type ManagedSiteContentValue,
} from "./content.js";
import {
  contentSemanticFail,
  contentValueKey,
  type ManagedContentSemanticFacts,
  type ManagedResolvedContentValue,
} from "./content-semantics-facts.js";
import { ManagedSiteContractError } from "./errors.js";
import type { ManagedCollectionDescriptor } from "./fields.js";
import type { StableId } from "./ids.js";

interface ManagedCollectionState {
  readonly descriptor: ManagedCollectionDescriptor;
  readonly itemIds: readonly StableId<"item">[];
}

const GENERATED_ROUTE_KEY_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MAX_GENERATED_ROUTE_KEY_CHARACTERS = 200;

function arraysEqual(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function validateCollectionPolicy(
  descriptor: ManagedCollectionDescriptor,
  value: ManagedSiteContentValue,
): void {
  try {
    validateParsedManagedCollectionValue(descriptor, value);
  } catch (error) {
    if (error instanceof ManagedSiteContractError) {
      contentSemanticFail("CONTENT_COLLECTION_POLICY", error.message);
    }
    throw error;
  }
}

function collectionDescriptor(
  facts: ManagedContentSemanticFacts,
  resolved: ManagedResolvedContentValue,
): ManagedCollectionDescriptor | null {
  if (resolved.kind !== "field" || resolved.descriptor.type !== "collection") {
    return null;
  }
  const descriptor = facts.collections.get(resolved.descriptor.collectionId);
  if (descriptor === undefined) {
    contentSemanticFail(
      "CONTENT_COLLECTION_UNRESOLVED",
      `Collection field does not resolve: ${resolved.descriptor.collectionId}`,
    );
  }
  return descriptor;
}

function collectionState(
  facts: ManagedContentSemanticFacts,
  resolved: ManagedResolvedContentValue,
): ManagedCollectionState | null {
  const descriptor = collectionDescriptor(facts, resolved);
  if (descriptor === null) return null;
  if (resolved.value.type !== "collection") {
    contentSemanticFail(
      "CONTENT_VALUE_POLICY",
      `Collection field ${resolved.descriptor.id} has a non-collection value`,
    );
  }
  validateCollectionPolicy(descriptor, resolved.value);
  return { descriptor, itemIds: resolved.value.value.orderedItemIds };
}

function collectCollectionStates(
  facts: ManagedContentSemanticFacts,
): ReadonlyMap<string, ManagedCollectionState> {
  const states = new Map<string, ManagedCollectionState>();
  for (const resolved of facts.resolvedValues) {
    const candidate = collectionState(facts, resolved);
    if (candidate === null) continue;
    const current = states.get(candidate.descriptor.id);
    if (current !== undefined && !arraysEqual(current.itemIds, candidate.itemIds)) {
      contentSemanticFail(
        "CONTENT_COLLECTION_ORDER_CONFLICT",
        `Collection ${candidate.descriptor.id} has conflicting ordered views`,
      );
    }
    if (current === undefined) states.set(candidate.descriptor.id, candidate);
  }
  return states;
}

function stableSuffix(id: string): string {
  return id.slice(id.indexOf("_") + 1);
}

function assertActiveItemIdentity(
  facts: ManagedContentSemanticFacts,
  itemId: StableId<"item">,
): void {
  if (facts.tombstones.has(itemId)) {
    contentSemanticFail(
      "CONTENT_ITEM_TOMBSTONED",
      `Active item is tombstoned: ${itemId}`,
    );
  }
  const kind = facts.contractIdKindsBySuffix.get(stableSuffix(itemId));
  if (kind !== undefined && kind !== "item") {
    contentSemanticFail(
      "CONTENT_ID_CROSS_KIND_COLLISION",
      `Active item reuses ${kind} identity entropy`,
    );
  }
}

function indexActiveItems(
  facts: ManagedContentSemanticFacts,
  states: ReadonlyMap<string, ManagedCollectionState>,
): ReadonlyMap<string, ManagedCollectionDescriptor> {
  const active = new Map<string, ManagedCollectionDescriptor>();
  for (const state of states.values()) {
    for (const itemId of state.itemIds) {
      assertActiveItemIdentity(facts, itemId);
      const existing = active.get(itemId);
      if (existing !== undefined && existing.id !== state.descriptor.id) {
        contentSemanticFail(
          "CONTENT_ITEM_COLLECTION_CONFLICT",
          `Item ${itemId} belongs to more than one collection`,
        );
      }
      active.set(itemId, state.descriptor);
    }
  }
  return active;
}

function validateItemValueOwners(
  facts: ManagedContentSemanticFacts,
  active: ReadonlyMap<string, ManagedCollectionDescriptor>,
): void {
  for (const resolved of facts.resolvedValues) {
    if (resolved.kind !== "collection_item") continue;
    const owner = resolved.value.owner;
    if (owner.kind !== "collection_item") continue;
    const activeCollection = active.get(owner.itemId);
    if (activeCollection === undefined) {
      contentSemanticFail(
        "CONTENT_ITEM_ORPHAN",
        `Item value is not present in an ordered collection: ${owner.itemId}`,
      );
    }
    if (activeCollection.id !== resolved.collection.id) {
      contentSemanticFail(
        "CONTENT_ITEM_COLLECTION_CONFLICT",
        `Item value belongs to the wrong collection: ${owner.itemId}`,
      );
    }
  }
}

function requiredItemValue(
  facts: ManagedContentSemanticFacts,
  collection: ManagedCollectionDescriptor,
  itemId: StableId<"item">,
  fieldId: StableId<"field">,
): ManagedResolvedContentValue {
  const key = contentValueKey(fieldId, {
    kind: "collection_item",
    collectionId: collection.id,
    itemId,
  });
  const resolved = facts.valuesByKey.get(key);
  if (resolved === undefined) {
    contentSemanticFail(
      "CONTENT_ITEM_VALUE_MISSING",
      `Item ${itemId} is missing field ${fieldId}`,
    );
  }
  return resolved;
}

function validateItemCompleteness(
  facts: ManagedContentSemanticFacts,
  states: ReadonlyMap<string, ManagedCollectionState>,
): void {
  for (const state of states.values()) {
    for (const itemId of state.itemIds) {
      for (const field of state.descriptor.itemFields) {
        requiredItemValue(facts, state.descriptor, itemId, field.id);
      }
    }
  }
}

function validateUsageItems(
  facts: ManagedContentSemanticFacts,
  active: ReadonlyMap<string, ManagedCollectionDescriptor>,
): void {
  for (const field of facts.nonItemFields) {
    for (const usage of field.usages) {
      if (usage.itemId !== null) {
        validateUsageItem(facts, active, usage.pageId, usage.itemId);
      }
    }
  }
}

function validateUsageItem(
  facts: ManagedContentSemanticFacts,
  active: ReadonlyMap<string, ManagedCollectionDescriptor>,
  pageId: StableId<"page">,
  itemId: StableId<"item">,
): void {
  const collection = active.get(itemId);
  if (collection === undefined) {
    contentSemanticFail(
      "CONTENT_USAGE_ITEM_UNRESOLVED",
      `Field usage item is not active: ${itemId}`,
    );
  }
  const page = facts.pages.get(pageId);
  if (page?.route.kind !== "generated") {
    contentSemanticFail(
      "CONTENT_USAGE_ITEM_SCOPE",
      `Field usage item is attached to a non-generated page: ${itemId}`,
    );
  }
  if (page.route.collectionId !== collection.id) {
    contentSemanticFail(
      "CONTENT_USAGE_ITEM_SCOPE",
      `Field usage item belongs to another generated route: ${itemId}`,
    );
  }
}

function uniquenessPart(
  comparison: "exact" | "case_folded",
  resolved: ManagedResolvedContentValue,
): string {
  if (comparison === "exact") return canonicalizeJson(resolved.value.value);
  const descriptor =
    resolved.kind === "protected" ? null : resolved.descriptor;
  if (
    descriptor === null ||
    (descriptor.type !== "plain_text" && descriptor.type !== "heading_text") ||
    (resolved.value.type !== "plain_text" && resolved.value.type !== "heading_text")
  ) {
    contentSemanticFail(
      "CONTENT_COLLECTION_UNIQUENESS_POLICY",
      "Case-folded uniqueness requires text item fields",
    );
  }
  return resolved.value.value.toLowerCase();
}

function validateUniquenessRule(
  facts: ManagedContentSemanticFacts,
  state: ManagedCollectionState,
  fieldIds: readonly StableId<"field">[],
  comparison: "exact" | "case_folded",
): void {
  const seen = new Set<string>();
  for (const itemId of state.itemIds) {
    const parts = fieldIds.map((fieldId) =>
      uniquenessPart(
        comparison,
        requiredItemValue(facts, state.descriptor, itemId, fieldId),
      ),
    );
    const key = canonicalizeJson(parts);
    if (seen.has(key)) {
      contentSemanticFail(
        "CONTENT_COLLECTION_UNIQUENESS",
        `Collection ${state.descriptor.id} violates a uniqueness rule`,
      );
    }
    seen.add(key);
  }
}

function validateCollectionUniqueness(
  facts: ManagedContentSemanticFacts,
  states: ReadonlyMap<string, ManagedCollectionState>,
): void {
  for (const state of states.values()) {
    for (const rule of state.descriptor.uniqueness) {
      validateUniquenessRule(facts, state, rule.fieldIds, rule.comparison);
    }
  }
}

function validateGeneratedRouteKeys(
  facts: ManagedContentSemanticFacts,
  states: ReadonlyMap<string, ManagedCollectionState>,
): void {
  for (const page of facts.pages.values()) {
    if (page.route.kind !== "generated") continue;
    const state = states.get(page.route.collectionId);
    if (state === undefined) {
      contentSemanticFail(
        "CONTENT_GENERATED_ROUTE_KEY",
        `Generated route collection has no active content: ${page.route.collectionId}`,
      );
    }
    for (const itemId of state.itemIds) {
      const resolved = requiredItemValue(
        facts,
        state.descriptor,
        itemId,
        page.route.routeKeyFieldId,
      );
      if (
        resolved.value.type !== "internal_protected" ||
        resolved.value.valueType !== "string" ||
        typeof resolved.value.value !== "string" ||
        resolved.value.value.length > MAX_GENERATED_ROUTE_KEY_CHARACTERS ||
        !GENERATED_ROUTE_KEY_PATTERN.test(resolved.value.value)
      ) {
        contentSemanticFail(
          "CONTENT_GENERATED_ROUTE_KEY",
          `Generated route key is not a canonical slug: ${itemId}`,
        );
      }
    }
  }
}

export function validateManagedContentCollections(
  facts: ManagedContentSemanticFacts,
): void {
  const states = collectCollectionStates(facts);
  const active = indexActiveItems(facts, states);
  validateItemValueOwners(facts, active);
  validateItemCompleteness(facts, states);
  validateUsageItems(facts, active);
  validateCollectionUniqueness(facts, states);
  validateGeneratedRouteKeys(facts, states);
}
