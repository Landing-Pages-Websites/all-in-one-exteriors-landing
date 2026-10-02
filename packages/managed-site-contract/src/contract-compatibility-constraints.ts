import type { ManagedCompatibilityFieldFact } from "./contract-compatibility-facts.js";
import type {
  ManagedCollectionDescriptor,
  ManagedCollectionItemField,
  ManagedFieldDescriptor,
} from "./fields.js";
import type { ManagedInternalProtectedField } from "./seo.js";
import { isAnyHttpsHost, type ManagedAssetSlotDescriptor } from "./values.js";

type RenderedOrItemField = ManagedFieldDescriptor | ManagedCollectionItemField;

export function includesAllValues<T>(
  candidate: readonly T[],
  production: readonly T[],
): boolean {
  const available = new Set(candidate);
  return production.every((value) => available.has(value));
}

function usageKey(usage: {
  readonly pageId: string;
  readonly itemId: string | null;
}): string {
  return `${usage.pageId}:${usage.itemId ?? "site"}`;
}

function usagesPreserved(
  production: readonly {
    readonly pageId: string;
    readonly itemId: string | null;
  }[],
  candidate: readonly {
    readonly pageId: string;
    readonly itemId: string | null;
  }[],
): boolean {
  return includesAllValues(candidate.map(usageKey), production.map(usageKey));
}

function textConstraintsWiden(
  production: {
    readonly minLength: number;
    readonly maxLength: number;
    readonly newlines: "forbid" | "allow";
  },
  candidate: {
    readonly minLength: number;
    readonly maxLength: number;
    readonly newlines: "forbid" | "allow";
  },
): boolean {
  return (
    candidate.minLength <= production.minLength &&
    candidate.maxLength >= production.maxLength &&
    (production.newlines === "forbid" || candidate.newlines === "allow")
  );
}

interface ExternalHostPolicy {
  readonly externalHostPolicy?: "declared" | "any_https";
  readonly allowedExternalHosts: readonly string[];
}

/**
 * Whether the candidate admits every external host production did. `any_https`
 * admits every DNS name, so it widens a declared list of DNS names; a list host it
 * would refuse (an IP literal, `localhost`) keeps it from widening. Production
 * `any_https` is narrowed by any declared list, however long.
 */
function externalHostsWiden(
  production: ExternalHostPolicy,
  candidate: ExternalHostPolicy,
): boolean {
  if (candidate.externalHostPolicy === "any_https") {
    return production.allowedExternalHosts.every(isAnyHttpsHost);
  }
  if (production.externalHostPolicy === "any_https") return false;
  return includesAllValues(
    candidate.allowedExternalHosts,
    production.allowedExternalHosts,
  );
}

/** An optional upper bound, where absent is unbounded and so the widest. */
function boundWidens(production: number | undefined, candidate: number | undefined): boolean {
  if (candidate === undefined) return true;
  return production !== undefined && candidate >= production;
}

interface HardBreakPolicy {
  readonly allowHardBreaks?: boolean;
  readonly maxHardBreaks?: number;
}

/**
 * Whether the candidate admits every break count production did. A field that
 * did not opt in admitted none, so any opt-in widens it, whatever its cap;
 * one that did must still opt in, with a cap no lower (absent is unbounded).
 */
function hardBreaksWiden(production: HardBreakPolicy, candidate: HardBreakPolicy): boolean {
  if (production.allowHardBreaks !== true) return true;
  return (
    candidate.allowHardBreaks === true &&
    boundWidens(production.maxHardBreaks, candidate.maxHardBreaks)
  );
}

function richTextConstraintsWiden(
  production: Extract<
    RenderedOrItemField,
    { readonly type: "rich_text" }
  >["constraints"],
  candidate: Extract<
    RenderedOrItemField,
    { readonly type: "rich_text" }
  >["constraints"],
): boolean {
  return (
    candidate.maxCharacters >= production.maxCharacters &&
    candidate.maxNodes >= production.maxNodes &&
    boundWidens(production.maxBlocks, candidate.maxBlocks) &&
    hardBreaksWiden(production, candidate) &&
    includesAllValues(candidate.allowedBlocks, production.allowedBlocks) &&
    includesAllValues(candidate.allowedMarks, production.allowedMarks) &&
    (!production.allowLinks || candidate.allowLinks) &&
    externalHostsWiden(production, candidate) &&
    includesAllValues(candidate.allowedTargets, production.allowedTargets)
  );
}

function authorityKinds(
  authority: "internal_only" | "external_only" | "internal_or_external",
): readonly string[] {
  if (authority === "internal_only") return ["internal"];
  if (authority === "external_only") return ["external"];
  return ["internal", "external"];
}

function fragmentsWiden(
  production: Extract<
    RenderedOrItemField,
    { readonly type: "link" }
  >["constraints"],
  candidate: Extract<
    RenderedOrItemField,
    { readonly type: "link" }
  >["constraints"],
): boolean {
  if (production.fragmentPolicy === "forbid") return true;
  return (
    candidate.fragmentPolicy === "declared" &&
    includesAllValues(candidate.allowedFragments, production.allowedFragments)
  );
}

function linkConstraintsWiden(
  production: Extract<
    RenderedOrItemField,
    { readonly type: "link" }
  >["constraints"],
  candidate: Extract<
    RenderedOrItemField,
    { readonly type: "link" }
  >["constraints"],
): boolean {
  return (
    textConstraintsWiden(
      production.labelConstraints,
      candidate.labelConstraints,
    ) &&
    includesAllValues(
      authorityKinds(candidate.authority),
      authorityKinds(production.authority),
    ) &&
    includesAllValues(candidate.allowedSchemes, production.allowedSchemes) &&
    externalHostsWiden(production, candidate) &&
    fragmentsWiden(production, candidate) &&
    includesAllValues(candidate.allowedTargets, production.allowedTargets)
  );
}

function plainTextPolicyWiden(
  production: Extract<RenderedOrItemField, { readonly type: "plain_text" }>,
  candidate: RenderedOrItemField,
): boolean {
  return (
    candidate.type === "plain_text" &&
    candidate.semantic === production.semantic &&
    textConstraintsWiden(production.constraints, candidate.constraints)
  );
}

function headingTextPolicyWiden(
  production: Extract<RenderedOrItemField, { readonly type: "heading_text" }>,
  candidate: RenderedOrItemField,
): boolean {
  return (
    candidate.type === "heading_text" &&
    candidate.semanticLevel === production.semanticLevel &&
    textConstraintsWiden(production.constraints, candidate.constraints)
  );
}

function richTextPolicyWiden(
  production: Extract<RenderedOrItemField, { readonly type: "rich_text" }>,
  candidate: RenderedOrItemField,
): boolean {
  return (
    candidate.type === "rich_text" &&
    richTextConstraintsWiden(production.constraints, candidate.constraints)
  );
}

function linkPolicyWiden(
  production: Extract<RenderedOrItemField, { readonly type: "link" }>,
  candidate: RenderedOrItemField,
): boolean {
  return (
    candidate.type === "link" &&
    linkConstraintsWiden(production.constraints, candidate.constraints)
  );
}

function valuePolicyWiden(
  production: RenderedOrItemField,
  candidate: RenderedOrItemField,
): boolean {
  switch (production.type) {
    case "plain_text":
      return plainTextPolicyWiden(production, candidate);
    case "heading_text":
      return headingTextPolicyWiden(production, candidate);
    case "rich_text":
      return richTextPolicyWiden(production, candidate);
    case "link":
      return linkPolicyWiden(production, candidate);
    case "image":
      return (
        candidate.type === "image" &&
        candidate.assetSlotId === production.assetSlotId
      );
    case "collection":
      return (
        candidate.type === "collection" &&
        candidate.collectionId === production.collectionId
      );
    case "internal_protected":
      return (
        candidate.type === "internal_protected" &&
        candidate.valueType === production.valueType &&
        candidate.semantic === production.semantic
      );
  }
}

function authorityPreserved(
  production: RenderedOrItemField,
  candidate: RenderedOrItemField,
): boolean {
  const classificationPreserved =
    production.classification !== "customer_editable" ||
    candidate.classification === "customer_editable";
  return (
    classificationPreserved &&
    includesAllValues(candidate.capabilities, production.capabilities)
  );
}

function renderedFieldCompatible(
  production: ManagedFieldDescriptor,
  candidate: ManagedFieldDescriptor,
): boolean {
  return (
    production.scope === candidate.scope &&
    usagesPreserved(production.usages, candidate.usages) &&
    authorityPreserved(production, candidate) &&
    valuePolicyWiden(production, candidate)
  );
}

function itemFieldCompatible(
  production: ManagedCollectionItemField,
  candidate: ManagedCollectionItemField,
): boolean {
  return (
    authorityPreserved(production, candidate) &&
    valuePolicyWiden(production, candidate)
  );
}

function protectedFieldCompatible(
  production: ManagedInternalProtectedField,
  candidate: ManagedInternalProtectedField,
): boolean {
  return (
    production.scope === candidate.scope &&
    production.valueType === candidate.valueType &&
    production.semantic === candidate.semantic &&
    usagesPreserved(production.usages, candidate.usages)
  );
}

export function isCompatibilityFieldWidened(
  production: ManagedCompatibilityFieldFact,
  candidate: ManagedCompatibilityFieldFact,
): boolean {
  if (production.kind !== candidate.kind) return false;
  if (production.kind === "rendered" && candidate.kind === "rendered") {
    return renderedFieldCompatible(production.descriptor, candidate.descriptor);
  }
  if (production.kind === "item" && candidate.kind === "item") {
    return itemFieldCompatible(production.descriptor, candidate.descriptor);
  }
  if (production.kind === "protected" && candidate.kind === "protected") {
    return protectedFieldCompatible(
      production.descriptor,
      candidate.descriptor,
    );
  }
  return false;
}

function uniquenessKey(
  rule: ManagedCollectionDescriptor["uniqueness"][number],
): string {
  return `${rule.comparison}:${[...rule.fieldIds].sort().join(",")}`;
}

export function isCompatibilityCollectionWidened(
  production: ManagedCollectionDescriptor,
  candidate: ManagedCollectionDescriptor,
): boolean {
  const productionRules = production.uniqueness.map(uniquenessKey);
  const candidateRules = candidate.uniqueness.map(uniquenessKey);
  return (
    production.itemIdPolicy === candidate.itemIdPolicy &&
    candidate.minItems <= production.minItems &&
    candidate.maxItems >= production.maxItems &&
    includesAllValues(productionRules, candidateRules) &&
    production.deletion.whenReferenced === candidate.deletion.whenReferenced &&
    (!production.deletion.restorable || candidate.deletion.restorable)
  );
}

function ratioIncluded(
  candidate: ManagedAssetSlotDescriptor["aspectRatios"],
  production: ManagedAssetSlotDescriptor["aspectRatios"][number],
): boolean {
  return candidate.some(
    (ratio) =>
      ratio.width / ratio.height === production.width / production.height,
  );
}

function policyValues(
  policy: "forbidden" | "optional" | "required",
): readonly string[] {
  if (policy === "forbidden") return ["null"];
  if (policy === "required") return ["value"];
  return ["null", "value"];
}

function sameAssetSemantics(
  production: ManagedAssetSlotDescriptor["semantics"],
  candidate: ManagedAssetSlotDescriptor["semantics"],
): boolean {
  if (production.kind !== candidate.kind) return false;
  if (production.kind !== "fixed_alt") return true;
  return (
    candidate.kind === "fixed_alt" && candidate.altText === production.altText
  );
}

export function isCompatibilityAssetWidened(
  production: ManagedAssetSlotDescriptor,
  candidate: ManagedAssetSlotDescriptor,
): boolean {
  return (
    sameAssetSemantics(production.semantics, candidate.semantics) &&
    includesAllValues(
      candidate.acceptedMimeTypes,
      production.acceptedMimeTypes,
    ) &&
    includesAllValues(candidate.outputMimeTypes, production.outputMimeTypes) &&
    candidate.minWidth <= production.minWidth &&
    candidate.maxWidth >= production.maxWidth &&
    candidate.minHeight <= production.minHeight &&
    candidate.maxHeight >= production.maxHeight &&
    production.aspectRatios.every((ratio) =>
      ratioIncluded(candidate.aspectRatios, ratio),
    ) &&
    includesAllValues(
      policyValues(candidate.cropPolicy),
      policyValues(production.cropPolicy),
    ) &&
    includesAllValues(
      policyValues(candidate.focalPointPolicy),
      policyValues(production.focalPointPolicy),
    ) &&
    candidate.maxBytes >= production.maxBytes
  );
}
