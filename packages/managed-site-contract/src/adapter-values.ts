import type {
  ManagedContentOwner,
  ManagedSiteContentDocument,
  ManagedSiteContentValue,
} from "./content.js";
import { ManagedSiteContractError } from "./errors.js";
import { parseStableId, type StableId } from "./ids.js";
import { parseJsonValue, type JsonValue } from "./json.js";
import {
  hasExactJsonKeys,
  isJsonRecord,
  type JsonRecord,
} from "./json-record.js";

type ManagedSiteContentValueType = ManagedSiteContentValue["type"];

export interface ManagedSiteValueSelector<
  Type extends ManagedSiteContentValueType = ManagedSiteContentValueType,
> {
  readonly fieldId: StableId<"field">;
  readonly owner: ManagedContentOwner;
  readonly type: Type;
}

export type ManagedSiteValueReader = <Type extends ManagedSiteContentValueType>(
  selector: ManagedSiteValueSelector<Type>,
) => Extract<ManagedSiteContentValue, { readonly type: Type }>;

export interface ManagedSiteValueErrorCodes {
  readonly selectorInvalid: string;
  readonly valueMissing: string;
  readonly valueType: string;
}

function fail(code: string, message: string): never {
  throw new ManagedSiteContractError(code, message);
}

function invalidSelector(code: string, adapterName: string): never {
  return fail(code, `${adapterName} adapter selector is invalid`);
}

function pageOwner(value: JsonRecord): ManagedContentOwner | null {
  if (
    value.kind !== "page" ||
    !hasExactJsonKeys(value, ["kind", "pageId"]) ||
    typeof value.pageId !== "string"
  ) {
    return null;
  }
  return { kind: "page", pageId: parseStableId(value.pageId, "page") };
}

function collectionItemOwner(value: JsonRecord): ManagedContentOwner | null {
  if (
    value.kind !== "collection_item" ||
    !hasExactJsonKeys(value, ["kind", "collectionId", "itemId"]) ||
    typeof value.collectionId !== "string" ||
    typeof value.itemId !== "string"
  ) {
    return null;
  }
  return {
    kind: "collection_item",
    collectionId: parseStableId(value.collectionId, "collection"),
    itemId: parseStableId(value.itemId, "item"),
  };
}

function parseOwner(
  value: JsonValue,
  invalidCode: string,
  adapterName: string,
): ManagedContentOwner {
  if (!isJsonRecord(value) || typeof value.kind !== "string") {
    return invalidSelector(invalidCode, adapterName);
  }
  if (value.kind === "site" && hasExactJsonKeys(value, ["kind"])) {
    return { kind: "site" };
  }
  const owner = pageOwner(value) ?? collectionItemOwner(value);
  if (owner !== null) return owner;
  return invalidSelector(invalidCode, adapterName);
}

function parseSelector(
  input: unknown,
  invalidCode: string,
  adapterName: string,
): ManagedSiteValueSelector {
  const value = parseJsonValue(input);
  if (
    !isJsonRecord(value) ||
    !hasExactJsonKeys(value, ["fieldId", "owner", "type"]) ||
    typeof value.fieldId !== "string" ||
    typeof value.type !== "string"
  ) {
    return invalidSelector(invalidCode, adapterName);
  }
  return {
    fieldId: parseStableId(value.fieldId, "field"),
    owner: parseOwner(value.owner, invalidCode, adapterName),
    type: value.type as ManagedSiteContentValueType,
  };
}

function ownerKey(owner: ManagedContentOwner): string {
  switch (owner.kind) {
    case "site":
      return "site";
    case "page":
      return `page:${owner.pageId}`;
    case "collection_item":
      return `item:${owner.collectionId}:${owner.itemId}`;
  }
}

function valueKey(fieldId: StableId<"field">, owner: ManagedContentOwner): string {
  return `${fieldId}|${ownerKey(owner)}`;
}

function indexValues(
  content: ManagedSiteContentDocument,
): ReadonlyMap<string, ManagedSiteContentValue> {
  return new Map(
    content.values.map((value) => [valueKey(value.fieldId, value.owner), value]),
  );
}

export function createManagedSiteValueReader(
  content: ManagedSiteContentDocument,
  codes: ManagedSiteValueErrorCodes,
  adapterName: string,
): ManagedSiteValueReader {
  const values = indexValues(content);
  return <Type extends ManagedSiteContentValueType>(
    input: ManagedSiteValueSelector<Type>,
  ): Extract<ManagedSiteContentValue, { readonly type: Type }> => {
    const selector = parseSelector(input, codes.selectorInvalid, adapterName);
    const value = values.get(valueKey(selector.fieldId, selector.owner));
    if (value === undefined) {
      return fail(codes.valueMissing, "Managed-site value is missing");
    }
    if (value.type !== selector.type) {
      return fail(codes.valueType, "Managed-site value type conflicts");
    }
    return value as Extract<ManagedSiteContentValue, { readonly type: Type }>;
  };
}
