export { canonicalizeJson } from "./canonical.js";
export {
  MANAGED_SITE_CONTRACT_DIGEST_DOMAIN,
  digestCanonicalJson,
} from "./digest.js";
export { ManagedSiteContractError } from "./errors.js";
export {
  STABLE_ID_KINDS,
  assertDistinctStableIds,
  getStableIdKind,
  mintStableId,
  parseStableId,
} from "./ids.js";
export {
  HARD_MAX_JSON_DEPTH,
  HARD_MAX_JSON_NODES,
  parseJsonValue,
} from "./json.js";
export { HARD_MAX_JSON_TEXT_BYTES, parseJsonText } from "./json-text.js";
export {
  MANAGED_SITE_CONTENT_V1_SCHEMA_ID,
  MANAGED_SITE_CONTRACT_V1_SCHEMA_ID,
  MANAGED_SITE_JSON_SCHEMA_BUNDLE_V1,
} from "./json-schema-bundle.js";
export {
  validateManagedSiteContentDocumentJsonSchema,
  validateManagedSiteContractV1JsonSchema,
} from "./json-schema-validator.js";
export {
  MAX_REPOSITORY_PATH_BYTES,
  MAX_REPOSITORY_PATH_SEGMENT_BYTES,
  assertDistinctRepositoryPaths,
  parseJsonPointer,
  parseRepositoryPath,
  parseSourceAddress,
} from "./source.js";

export {
  parseManagedInternalString,
  parseManagedInternalStringList,
  parseManagedSiteContentDocument,
  parseManagedSiteContentValue,
  validateManagedCollectionValue,
  validateManagedFieldValue,
} from "./content.js";
export { validateManagedSiteContractV1ContentSemantics } from "./content-semantics.js";
export { validateManagedSiteContractV1Compatibility } from "./contract-compatibility-policy.js";
export {
  MANAGED_SITE_FIELD_MIGRATION_FILE,
  MANAGED_SITE_FIELD_MIGRATION_OPS,
  parseManagedSiteFieldMigrationV1,
} from "./field-migration-schema.js";
export {
  applyManagedSiteFieldMigrationStepV1,
  readBackManagedSiteFieldMigrationStepV1,
} from "./field-migration-transform.js";
export {
  managedSiteFieldMigrationFromV1,
  validateManagedSiteContractV1MigrationCompatibility,
} from "./field-migration-verify.js";
export {
  bridgeSrcFor,
  CURRENT_BRIDGE_SRC,
  CURRENT_BRIDGE_VERSION,
  isSupportedBridgeVersion,
  parseManagedSiteContractV1,
  SUPPORTED_BRIDGE_VERSIONS,
} from "./contract.js";
export { validateManagedSiteContractV1Semantics } from "./contract-semantics.js";
export { normalizeManagedSiteArtifactsV1 } from "./normalized-artifacts.js";
export {
  deriveManagedSiteGuardContractFactsV1,
  deriveManagedSiteGuardPolicyFactsV1,
} from "./site-guard-policy-facts.js";
export { createManagedSiteAstroV1 } from "./astro-adapter.js";
export { createManagedSiteNextV1 } from "./next-adapter.js";
export {
  managedSiteFieldAttributesV1,
  managedSitePageAttributesV1,
} from "./next-adapter-annotations.js";
export { projectManagedSiteContentDocumentV1 } from "./source-projection.js";
export {
  MANAGED_FIELD_CAPABILITIES,
  MANAGED_FIELD_SCOPES,
  MANAGED_SEO_TEXT_SEMANTICS,
  MAX_MANAGED_SEO_TEXT_CHARACTERS,
  parseManagedCollectionBounds,
  parseManagedCollectionDescriptor,
  parseManagedFieldDescriptor,
  parseManagedLinkLabelConstraints,
  parseManagedRichTextConstraints,
  parseManagedTextConstraints,
} from "./fields.js";
export {
  MANAGED_RICH_TEXT_HEADING_LEVELS,
  MANAGED_RICH_TEXT_MAX_HARD_BREAKS,
  MAX_RICH_TEXT_BYTES,
  MAX_RICH_TEXT_DEPTH,
  MAX_RICH_TEXT_NODES,
  parseManagedRichTextDocument,
} from "./rich-text.js";
export {
  groupManagedRichTextInlines,
  MANAGED_RICH_TEXT_BREAK_ATTRIBUTE,
  MANAGED_RICH_TEXT_MARK_ATTRIBUTE,
  managedRichTextBlockInlines,
  managedRichTextBreakAttributesV1,
  managedRichTextLinkAttributesV1,
  managedRichTextMarkAttributesV1,
} from "./rich-text-render.js";
export {
  MANAGED_PAGE_PURPOSES,
  parseManagedInternalProtectedField,
  parseManagedPerformanceBudget,
  parseManagedSitemapPolicy,
  parseManagedSiteSeoDescriptor,
} from "./seo.js";
export {
  hasUnsafeTextCharacter,
  isManagedServedAssetPath,
  MANAGED_SERVED_ASSET_ROOT,
  MAX_LINK_LABEL_CHARACTERS,
  MAX_URL_VALUE_CHARACTERS,
  parseManagedAbsoluteHttpsUrl,
  resolveManagedImageAltText,
  validateManagedImageValue,
} from "./values.js";

export type { DeepReadonly } from "./deep-readonly.js";
export type { StableId, StableIdKind } from "./ids.js";
export type { JsonParseLimits, JsonPrimitive, JsonValue } from "./json.js";
export type { JsonTextParseLimits } from "./json-text.js";
export type { ManagedSiteSourceDocumentV1 } from "./source-documents.js";
export type {
  CreateManagedSiteAstroV1Input,
  ManagedSiteAstroV1,
} from "./astro-adapter.js";
export type {
  CreateManagedSiteNextV1Input,
  ManagedSiteNextV1,
} from "./next-adapter.js";
export type {
  ManagedSiteFieldAttributesV1,
  ManagedSitePageAttributesV1,
} from "./next-adapter-annotations.js";
export type {
  ManagedSiteValueReader,
  ManagedSiteValueSelector,
} from "./adapter-values.js";
export type {
  ManagedSiteNextValueReader,
  ManagedSiteNextValueSelector,
} from "./next-adapter-values.js";
export type { ManagedSiteContractSemanticResult } from "./contract-semantics.js";
export type { ManagedSiteContractCompatibilityV1 } from "./contract-compatibility-policy.js";
export type { ManagedSiteBridgeAdmission } from "./field-migration-bridge.js";
export type {
  ManagedSiteFieldMigrationBlockV1,
  ManagedSiteFieldMigrationMarkV1,
  ManagedSiteFieldMigrationPartV1,
  ManagedSiteFieldMigrationStepV1,
  ManagedSiteFieldMigrationV1,
} from "./field-migration-schema.js";
export type {
  ManagedSiteFieldMigrationAccountingV1,
  ManagedSiteFieldMigrationAddedItemV1,
  ManagedSiteFieldMigrationAdditionsV1,
  ManagedSiteFieldMigrationPartProofV1,
  ManagedSiteFieldMigrationProofV1,
  ManagedSiteFieldMigrationStepProofV1,
} from "./field-migration-proof.js";
export type {
  ManagedSiteFieldMigrationOffsetV1,
  ManagedSiteFieldMigrationReadBackV1,
  ManagedSiteFieldMigrationResultV1,
  ManagedSiteFieldMigrationRunV1,
} from "./field-migration-transform.js";
export type { ManagedSiteFieldMigrationOptionsV1 } from "./field-migration-verify.js";
export type {
  ManagedSiteFieldMigrationMoveV1,
  ManagedSiteFieldMigrationPlaceV1,
} from "./field-migration-position.js";
export type {
  ManagedSiteFieldMigrationH1AdoptionV1,
  ManagedSiteFieldMigrationSeoReorderV1,
} from "./field-migration-urls.js";
export type { ManagedSiteH1AdoptionV1 } from "./contract-compatibility-h1.js";
export {
  managedPageH1Fields,
  managedRenderedH1Sources,
  managedRichTextHoldsLevelOneHeading,
  managedRichTextLevelOneHeadingCount,
  managedSeoPageIds,
} from "./rendered-headings.js";
export type { ManagedRenderedH1Sources } from "./rendered-headings.js";
export type { ManagedSiteRedirectChangeV1 } from "./contract-compatibility-routes.js";
export type { ManagedSiteSeoReorderV1 } from "./contract-compatibility-seo-facts.js";
export type { ManagedSiteJsonSchemaBundleV1 } from "./json-schema-bundle.js";
export type {
  ManagedSiteJsonSchemaIssue,
  ManagedSiteJsonSchemaValidationResult,
} from "./json-schema-validator.js";
export type {
  ManagedSiteContentArtifactV1,
  ManagedSiteContractArtifactV1,
  ManagedSiteNormalizedArtifactsV1,
} from "./normalized-artifacts.js";
export type {
  ManagedSiteGuardAssetFactV1,
  ManagedSiteGuardContractFactsV1,
  ManagedSiteGuardPolicyFactsV1,
} from "./site-guard-policy-facts.js";
export type {
  JsonPointer,
  ParsedJsonPointer,
  RepositoryPath,
  SourceAddress,
} from "./source.js";
export type {
  ManagedContentOwner,
  ManagedInternalValueType,
  ManagedSiteAssetManifestEntry,
  ManagedSiteContentDocument,
  ManagedSiteContentValue,
} from "./content.js";
export type {
  ManagedAtomicAliasGroup,
  ManagedPageDescriptor,
  ManagedPageRoute,
  ManagedSectionDescriptor,
  ManagedSiteAdapterDescriptor,
  ManagedSiteBridgeDescriptor,
  ManagedSiteContractV1,
  SupportedBridgeVersion,
} from "./contract.js";
export type {
  ManagedCollectionBounds,
  ManagedCollectionDescriptor,
  ManagedCollectionItemField,
  ManagedContentClassification,
  ManagedFieldCapability,
  ManagedFieldDescriptor,
  ManagedFieldScope,
  ManagedInternalProtectedCollectionItemField,
  ManagedRichTextConstraints,
  ManagedSeoTextSemantic,
  ManagedTextConstraints,
} from "./fields.js";
export type {
  ManagedRichTextBlock,
  ManagedRichTextDocument,
  ManagedRichTextHardBreak,
  ManagedRichTextInline,
  ManagedRichTextMark,
  ManagedRichTextHeadingLevel,
  ManagedRichTextText,
  ManagedRichTextMarkKind,
} from "./rich-text.js";
export type {
  ManagedRichTextBreakAttributesV1,
  ManagedRichTextLinkAttributesV1,
  ManagedRichTextMarkAttributesV1,
  ManagedRichTextPagePathResolver,
  ManagedRichTextSpan,
} from "./rich-text-render.js";
export type {
  ManagedGeneratedPageSeoDescriptor,
  ManagedInternalProtectedField,
  ManagedPagePurpose,
  ManagedPerformanceBudget,
  ManagedSitemapPolicy,
  ManagedSiteSeoDescriptor,
} from "./seo.js";
export type {
  JsonPointerSourceResolver,
  ManagedAssetSlotDescriptor,
  ManagedFieldUsage,
  ManagedImageValue,
  ManagedLinkDestination,
  ManagedLinkTarget,
  ManagedPresentation,
} from "./values.js";
