import * as z from "zod";

import type { DeepReadonly } from "./deep-readonly.js";
import {
  managedCollectionDescriptorSchema,
  managedFieldDescriptorSchema,
} from "./fields.js";
import { parseSchemaInput } from "./schema-input.js";
import {
  MANAGED_SITE_ROOT_SEMANTICS,
  withManagedSiteJsonSchemaSemantic,
} from "./schema-semantics.js";
import { managedSiteSeoDescriptorSchema } from "./seo.js";
import {
  managedGeneratedRoutePatternSchema,
  managedAssetSlotDescriptorSchema,
  managedPresentationSchema,
  managedStaticRoutePathSchema,
  stableIdSchema,
} from "./values.js";

export const managedSiteAdapterDescriptorSchema = z.strictObject({
  kind: z.enum(["nextjs", "astro"]),
  adapterVersion: z.literal("1.0"),
});

/**
 * The review-bridge versions a contract may name, oldest first. Each version is
 * delivered by exactly one URL, derived from the version, so a descriptor that
 * names one version and loads another's asset is refused. Exported because the
 * conversion proposer must accept exactly what this parser accepts: a loader
 * that admitted a version this schema rejects would turn a clear config error
 * into a contract that silently fails to parse.
 *
 * More than one version is accepted because sites certified on an older bridge
 * keep validating until they move. Moving a site between versions changes its
 * bridge descriptor, which the compatibility policy reports as
 * `COMPATIBILITY_RUNTIME_CHANGED`. A site moves by re-enrolling, or (since
 * 0.15.0) by a declared field migration, whose bridge step must be exactly the
 * next version in this list and admitted by the platform. Dropping a version
 * from this list refuses every contract that still names it.
 *
 * The asset is immutable per version and never rebuilt, so promoting the next
 * bridge is a change here and nowhere else.
 */
export const SUPPORTED_BRIDGE_VERSIONS = ["v7", "v8", "v9", "v10"] as const;
export type SupportedBridgeVersion = (typeof SUPPORTED_BRIDGE_VERSIONS)[number];

/** The version new sites and templates install. Always the newest supported. */
export const CURRENT_BRIDGE_VERSION = "v10" satisfies SupportedBridgeVersion;

export function bridgeSrcFor<V extends SupportedBridgeVersion>(
  version: V,
): `https://app.gomega.ai/review-bridge/${V}/review-bridge.js` {
  return `https://app.gomega.ai/review-bridge/${version}/review-bridge.js`;
}

export const CURRENT_BRIDGE_SRC = bridgeSrcFor(CURRENT_BRIDGE_VERSION);

export function isSupportedBridgeVersion(value: unknown): value is SupportedBridgeVersion {
  return (SUPPORTED_BRIDGE_VERSIONS as readonly unknown[]).includes(value);
}

function bridgeDeliverySchemaFor<V extends SupportedBridgeVersion>(version: V) {
  return z.strictObject({
    version: z.literal(version),
    src: z.literal(bridgeSrcFor(version)),
    integrity: z.string().regex(/^sha384-[A-Za-z0-9+/]{64}$/),
    crossOrigin: z.literal("anonymous"),
    load: z.literal("head_defer"),
  });
}

type BridgeDeliverySchema<V> = V extends SupportedBridgeVersion
  ? ReturnType<typeof bridgeDeliverySchemaFor<V>>
  : never;

function bridgeDeliverySchemasFor<const T extends readonly SupportedBridgeVersion[]>(
  versions: T,
): { readonly [K in keyof T]: BridgeDeliverySchema<T[K]> } {
  // `map` loses the tuple's per-position types; the mapped return type restores
  // them, so each branch below still carries its own version and src literals.
  return versions.map(bridgeDeliverySchemaFor) as unknown as {
    readonly [K in keyof T]: BridgeDeliverySchema<T[K]>;
  };
}

// One strict branch per version, discriminated on `version`, so the JSON Schema
// artifact binds each version to its own src exactly as the parser does.
const managedSiteBridgeDeliverySchema = z.discriminatedUnion(
  "version",
  bridgeDeliverySchemasFor(SUPPORTED_BRIDGE_VERSIONS),
);

export const managedSiteBridgeDescriptorSchema = z.strictObject({
  reviewProtocol: z.literal(1),
  editProtocol: z.literal(2),
  annotationVersion: z.literal(1),
  delivery: managedSiteBridgeDeliverySchema,
  framing: z.literal("authenticated_preview_gateway"),
});

export const managedPageRouteSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("static"), path: managedStaticRoutePathSchema }),
  z.strictObject({
    kind: z.literal("generated"),
    pattern: managedGeneratedRoutePatternSchema,
    collectionId: stableIdSchema("collection"),
    routeKeyFieldId: stableIdSchema("field"),
  }),
]);

export const managedSectionDescriptorSchema = z.strictObject({
  id: stableIdSchema("section"),
  presentation: managedPresentationSchema,
  fields: z.array(managedFieldDescriptorSchema),
});

export const managedPageDescriptorSchema = z.strictObject({
  id: stableIdSchema("page"),
  presentation: managedPresentationSchema,
  route: managedPageRouteSchema,
  sections: z.array(managedSectionDescriptorSchema),
});

export const managedAtomicAliasGroupSchema = z.strictObject({
  id: stableIdSchema("alias"),
  fieldIds: z.array(stableIdSchema("field")).min(1),
});

const anyStableIdSchema = z.union([
  stableIdSchema("contract"),
  stableIdSchema("page"),
  stableIdSchema("section"),
  stableIdSchema("field"),
  stableIdSchema("collection"),
  stableIdSchema("item"),
  stableIdSchema("asset"),
  stableIdSchema("alias"),
]);

export const managedSiteContractV1Schema = withManagedSiteJsonSchemaSemantic(
  MANAGED_SITE_ROOT_SEMANTICS.ManagedSiteContractV1,
  z.strictObject({
    schemaVersion: z.literal("1.0"),
    contractId: stableIdSchema("contract"),
    adapter: managedSiteAdapterDescriptorSchema,
    bridge: managedSiteBridgeDescriptorSchema,
    pages: z.array(managedPageDescriptorSchema),
    collections: z.array(managedCollectionDescriptorSchema),
    assets: z.array(managedAssetSlotDescriptorSchema),
    internalSeo: managedSiteSeoDescriptorSchema,
    atomicAliasGroups: z.array(managedAtomicAliasGroupSchema),
    tombstonedIds: z.array(anyStableIdSchema),
  }),
);

export type ManagedSiteAdapterDescriptor = DeepReadonly<z.infer<
  typeof managedSiteAdapterDescriptorSchema
>>;
export type ManagedSiteBridgeDescriptor = DeepReadonly<z.infer<
  typeof managedSiteBridgeDescriptorSchema
>>;
export type ManagedPageRoute = DeepReadonly<z.infer<typeof managedPageRouteSchema>>;
export type ManagedSectionDescriptor = DeepReadonly<z.infer<
  typeof managedSectionDescriptorSchema
>>;
export type ManagedPageDescriptor = DeepReadonly<z.infer<typeof managedPageDescriptorSchema>>;
export type ManagedAtomicAliasGroup = DeepReadonly<z.infer<
  typeof managedAtomicAliasGroupSchema
>>;
export type ManagedSiteContractV1 = DeepReadonly<z.infer<typeof managedSiteContractV1Schema>>;

export function parseManagedSiteContractV1(input: unknown): ManagedSiteContractV1 {
  return parseSchemaInput(managedSiteContractV1Schema, input);
}
