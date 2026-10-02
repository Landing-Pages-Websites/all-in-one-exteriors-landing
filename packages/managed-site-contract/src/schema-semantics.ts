import * as z from "zod";

export const MANAGED_SITE_SEMANTIC_KEYWORD = "gomegaSemanticV1";
export const MANAGED_SITE_ROOT_SEMANTICS = Object.freeze({
  ManagedSiteContractV1: "managed-site-contract-v1-root",
  ManagedSiteContentDocument: "managed-site-content-document-root",
} as const);
export const MANAGED_SITE_SEMANTIC_IDS = Object.freeze([
  "absolute-https-url",
  "asset-slot",
  "bounded-json-depth-8",
  "collection-descriptor",
  "content-value",
  "external-destination-url",
  "field-descriptor",
  "generated-route",
  ...Object.values(MANAGED_SITE_ROOT_SEMANTICS),
  "opaque-json",
  "presentation",
  "static-route",
] as const);

export type ManagedSiteSemanticId = (typeof MANAGED_SITE_SEMANTIC_IDS)[number];

const semanticSchemas = new Map<ManagedSiteSemanticId, z.ZodType>();

export function withManagedSiteJsonSchemaSemantic<T extends z.ZodType>(
  id: ManagedSiteSemanticId,
  schema: T,
): T {
  if (semanticSchemas.has(id)) {
    throw new Error(`Duplicate managed-site JSON Schema semantic: ${id}`);
  }
  const decorated = schema.meta({ [MANAGED_SITE_SEMANTIC_KEYWORD]: id }) as T;
  semanticSchemas.set(id, decorated);
  return decorated;
}

export function getManagedSiteSemanticSchema(
  id: ManagedSiteSemanticId,
): z.ZodType {
  const schema = semanticSchemas.get(id);
  if (schema === undefined) {
    throw new Error(`Unregistered managed-site JSON Schema semantic: ${id}`);
  }
  return schema;
}
