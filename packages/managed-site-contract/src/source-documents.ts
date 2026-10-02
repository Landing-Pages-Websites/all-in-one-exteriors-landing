import { ManagedSiteContractError } from "./errors.js";
import { parseJsonValue, type JsonValue } from "./json.js";
import { hasExactJsonKeys, isJsonRecord } from "./json-record.js";
import {
  assertDistinctRepositoryPaths,
  parseJsonPointer,
  type JsonPointer,
  type RepositoryPath,
} from "./source.js";
import type { JsonPointerSourceResolver } from "./values.js";

export interface ManagedSiteSourceDocumentV1 {
  readonly path: string;
  readonly value: unknown;
}

type Consumption = "structure" | "subtree";

interface ParsedSourceDocument {
  readonly path: string;
  readonly value: JsonValue;
}

class SourceDocumentState {
  public readonly structuralAddresses = new Set<string>();
  public readonly subtreeAddresses: Array<readonly string[]> = [];
  public used = false;

  public constructor(
    public readonly path: RepositoryPath,
    public readonly value: JsonValue,
  ) {}
}

export interface ProjectedSourceLocation {
  readonly document: SourceDocumentState;
  readonly tokens: readonly string[];
  readonly value: JsonValue;
}

const CANONICAL_ARRAY_INDEX = /^(?:0|[1-9]\d*)$/u;

function fail(code: string, message: string): never {
  throw new ManagedSiteContractError(code, message);
}

function parsedDocument(value: JsonValue): ParsedSourceDocument {
  if (!isJsonRecord(value)) {
    return fail(
      "SOURCE_DOCUMENT_INVALID",
      "Source documents must be exact records",
    );
  }
  if (
    !hasExactJsonKeys(value, ["path", "value"]) ||
    typeof value.path !== "string"
  ) {
    return fail(
      "SOURCE_DOCUMENT_INVALID",
      "Source documents must be exact records",
    );
  }
  return { path: value.path, value: value.value };
}

function parseDocuments(input: unknown): readonly ParsedSourceDocument[] {
  const parsed = parseJsonValue(input);
  if (!Array.isArray(parsed)) {
    return fail("SOURCE_DOCUMENT_INVALID", "Source documents must be an array");
  }
  return parsed.map(parsedDocument);
}

function dataProperty(value: JsonValue, token: string): JsonValue {
  if (value === null || typeof value !== "object") {
    return fail("SOURCE_POINTER_UNRESOLVED", "Source pointer does not resolve");
  }
  if (Array.isArray(value) && !CANONICAL_ARRAY_INDEX.test(token)) {
    return fail("SOURCE_POINTER_UNRESOLVED", "Source pointer does not resolve");
  }
  const descriptor = Object.getOwnPropertyDescriptor(value, token);
  if (descriptor === undefined || !("value" in descriptor)) {
    return fail("SOURCE_POINTER_UNRESOLVED", "Source pointer does not resolve");
  }
  return descriptor.value as JsonValue;
}

function addressKey(tokens: readonly string[]): string {
  return JSON.stringify(tokens);
}

function mark(location: ProjectedSourceLocation, consumption: Consumption): void {
  location.document.used = true;
  if (consumption === "structure") {
    location.document.structuralAddresses.add(addressKey(location.tokens));
  } else {
    location.document.subtreeAddresses.push(location.tokens);
  }
}

function resolveTokens(
  base: ProjectedSourceLocation,
  tokens: readonly string[],
  consumption: Consumption,
): ProjectedSourceLocation {
  let value = base.value;
  for (const token of tokens) value = dataProperty(value, token);
  const location = {
    document: base.document,
    tokens: Object.freeze([...base.tokens, ...tokens]),
    value,
  };
  mark(location, consumption);
  return location;
}

function isPrefix(prefix: readonly string[], value: readonly string[]): boolean {
  return (
    prefix.length <= value.length &&
    prefix.every((token, index) => token === value[index])
  );
}

function isConsumedSubtree(
  document: SourceDocumentState,
  tokens: readonly string[],
): boolean {
  return document.subtreeAddresses.some((address) => isPrefix(address, tokens));
}

function children(value: JsonValue): ReadonlyArray<readonly [string, JsonValue]> {
  if (value === null || typeof value !== "object") return [];
  return Object.keys(value).map((key) => [key, dataProperty(value, key)] as const);
}

function assertClassified(
  document: SourceDocumentState,
  value: JsonValue,
  tokens: readonly string[],
): void {
  if (isConsumedSubtree(document, tokens)) return;
  const entries = children(value);
  if (entries.length === 0) {
    if (document.structuralAddresses.has(addressKey(tokens))) return;
    return fail("SOURCE_VALUE_UNCLASSIFIED", "Source value is not classified");
  }
  for (const [token, child] of entries) {
    assertClassified(document, child, [...tokens, token]);
  }
}

export class ManagedSiteSourceResolver {
  private readonly documents: ReadonlyMap<string, SourceDocumentState>;

  public constructor(input: readonly ManagedSiteSourceDocumentV1[]) {
    const parsed = parseDocuments(input);
    const paths = assertDistinctRepositoryPaths(parsed.map(({ path }) => path));
    this.documents = new Map(
      parsed.map((document, index) => [
        paths[index],
        new SourceDocumentState(paths[index], document.value),
      ]),
    );
  }

  public resolve(
    resolver: JsonPointerSourceResolver,
    consumption: Consumption = "subtree",
  ): ProjectedSourceLocation {
    const document = this.documents.get(resolver.path);
    if (document === undefined) {
      return fail(
        "SOURCE_DOCUMENT_MISSING",
        "Contract source document is missing",
      );
    }
    const root = { document, tokens: Object.freeze([]), value: document.value };
    return resolveTokens(
      root,
      parseJsonPointer(resolver.pointer).tokens,
      consumption,
    );
  }

  public resolveRelative(
    base: ProjectedSourceLocation,
    pointer: JsonPointer,
    consumption: Consumption = "subtree",
  ): ProjectedSourceLocation {
    return resolveTokens(base, parseJsonPointer(pointer).tokens, consumption);
  }

  public resolveIndex(
    base: ProjectedSourceLocation,
    index: number,
  ): ProjectedSourceLocation {
    return resolveTokens(base, [String(index)], "structure");
  }

  public assertComplete(): void {
    for (const document of this.documents.values()) {
      if (!document.used) {
        return fail(
          "SOURCE_DOCUMENT_UNUSED",
          "Source document is not referenced",
        );
      }
      assertClassified(document, document.value, []);
    }
  }
}
