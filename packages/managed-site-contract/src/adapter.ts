import {
  createManagedSiteValueReader,
  type ManagedSiteValueErrorCodes,
  type ManagedSiteValueReader,
} from "./adapter-values.js";
import type { ManagedSiteContentDocument } from "./content.js";
import {
  parseManagedSiteContractV1,
  type ManagedSiteAdapterDescriptor,
  type ManagedSiteContractV1,
} from "./contract.js";
import { ManagedSiteContractError } from "./errors.js";
import { parseJsonValue, type JsonValue } from "./json.js";
import { hasExactJsonKeys, isJsonRecord } from "./json-record.js";
import {
  normalizeManagedSiteArtifactsV1,
  type ManagedSiteNormalizedArtifactsV1,
} from "./normalized-artifacts.js";
import type { ManagedSiteSourceDocumentV1 } from "./source-documents.js";
import { projectManagedSiteContentDocumentV1 } from "./source-projection.js";

export interface ManagedSiteV1 {
  readonly contract: ManagedSiteContractV1;
  readonly content: ManagedSiteContentDocument;
  readonly artifacts: ManagedSiteNormalizedArtifactsV1;
  readonly readValue: ManagedSiteValueReader;
}

export interface CreateManagedSiteV1Input {
  readonly contract: unknown;
  readonly sourceDocuments: readonly ManagedSiteSourceDocumentV1[];
}

export interface ManagedSiteAdapterErrorCodes extends ManagedSiteValueErrorCodes {
  readonly inputInvalid: string;
  readonly kindMismatch: string;
}

export interface ManagedSiteAdapterOptions {
  readonly kind: ManagedSiteAdapterDescriptor["kind"];
  readonly errors: ManagedSiteAdapterErrorCodes;
}

const ADAPTER_LABELS = {
  astro: { input: "Astro", contract: "Astro" },
  nextjs: { input: "Next", contract: "Next.js" },
} as const satisfies Record<
  ManagedSiteAdapterDescriptor["kind"],
  { readonly input: string; readonly contract: string }
>;

function fail(code: string, message: string): never {
  throw new ManagedSiteContractError(code, message);
}

function isJsonArray(value: JsonValue): value is readonly JsonValue[] {
  return Array.isArray(value);
}

function sourceDocument(
  value: JsonValue,
  invalidCode: string,
  adapterName: string,
): ManagedSiteSourceDocumentV1 {
  if (
    !isJsonRecord(value) ||
    !hasExactJsonKeys(value, ["path", "value"]) ||
    typeof value.path !== "string"
  ) {
    return fail(invalidCode, `${adapterName} adapter input is invalid`);
  }
  return { path: value.path, value: value.value };
}

function parseCreateInput(
  input: unknown,
  invalidCode: string,
  adapterName: string,
): CreateManagedSiteV1Input {
  const value = parseJsonValue(input);
  if (
    !isJsonRecord(value) ||
    !hasExactJsonKeys(value, ["contract", "sourceDocuments"]) ||
    !isJsonArray(value.sourceDocuments)
  ) {
    return fail(invalidCode, `${adapterName} adapter input is invalid`);
  }
  return {
    contract: value.contract,
    sourceDocuments: value.sourceDocuments.map((document) =>
      sourceDocument(document, invalidCode, adapterName),
    ),
  };
}

function assertAdapterKind(
  contract: ManagedSiteContractV1,
  options: ManagedSiteAdapterOptions,
): void {
  if (contract.adapter.kind !== options.kind) {
    throw new ManagedSiteContractError(
      options.errors.kindMismatch,
      `Managed-site contract does not declare the ${ADAPTER_LABELS[options.kind].contract} adapter`,
    );
  }
}

export function createManagedSiteAdapterV1(
  input: CreateManagedSiteV1Input,
  options: ManagedSiteAdapterOptions,
): ManagedSiteV1 {
  const adapterName = ADAPTER_LABELS[options.kind].input;
  const parsedInput = parseCreateInput(
    input,
    options.errors.inputInvalid,
    adapterName,
  );
  const contract = parseManagedSiteContractV1(parsedInput.contract);
  assertAdapterKind(contract, options);
  const content = projectManagedSiteContentDocumentV1(
    contract,
    parsedInput.sourceDocuments,
  );
  return Object.freeze({
    contract,
    content,
    artifacts: normalizeManagedSiteArtifactsV1(contract, content),
    readValue: createManagedSiteValueReader(
      content,
      options.errors,
      adapterName,
    ),
  });
}
