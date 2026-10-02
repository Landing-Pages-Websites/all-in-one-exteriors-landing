import * as z from "zod";

import type { DeepReadonly } from "./deep-readonly.js";
import { managedInternalValueTypeSchema } from "./internal-value-types.js";
import {
  MANAGED_RICH_TEXT_BLOCK_KINDS,
  MANAGED_RICH_TEXT_MAX_HARD_BREAKS,
  managedRichTextMarkKindSchema,
} from "./rich-text.js";
import { withManagedSiteJsonSchemaSemantic } from "./schema-semantics.js";
import { parseSchemaInput } from "./schema-input.js";
import {
  jsonPointerSchema,
  jsonPointerSourceResolverSchema,
  MAX_LINK_LABEL_CHARACTERS,
  managedFieldUsageSchema,
  managedFragmentSchema,
  managedLinkTargetSchema,
  managedPresentationSchema,
  stableIdSchema,
  type ManagedFieldUsage,
} from "./values.js";

export const MANAGED_FIELD_SCOPES = Object.freeze(["site", "page"] as const);
export const managedFieldScopeSchema = z.enum(MANAGED_FIELD_SCOPES);

export const MANAGED_FIELD_CAPABILITIES = Object.freeze([
  "text.edit",
  "rich_text.mark.bold",
  "rich_text.mark.italic",
  "rich_text.link.edit",
  "link.label.edit",
  "link.destination.edit",
  "link.target.edit",
  "image.upload",
  "image.crop",
  "image.focal_point.edit",
  "image.alt.edit",
  "collection.reorder",
  "collection.add",
  "collection.remove",
] as const);

export const managedFieldCapabilitySchema = z.enum(MANAGED_FIELD_CAPABILITIES);
export const managedContentClassificationSchema = z.enum([
  "customer_editable",
  "internal_protected",
  "code_owned_interface",
]);
export const managedRenderedClassificationSchema =
  managedContentClassificationSchema.exclude(["internal_protected"]);

const capabilitySchema = z.array(managedFieldCapabilitySchema);
const textConstraintsSchema = z
  .strictObject({
    minLength: z.number().int().nonnegative(),
    maxLength: z.number().int().positive().max(131_072),
    newlines: z.enum(["forbid", "allow"]),
  })
  .refine((constraints) => constraints.minLength <= constraints.maxLength);
const linkLabelConstraintsSchema = textConstraintsSchema.refine(
  (constraints) => constraints.maxLength <= MAX_LINK_LABEL_CHARACTERS,
);

/**
 * The constraint bounds, parseable on their own.
 *
 * A migration tool takes these limits from an operator long before any field
 * descriptor exists, and would otherwise have to restate the maxima and the
 * minimum-below-maximum rule to check them at its own boundary. A restatement
 * drifts; this parses the same schema the descriptor is held to, so a limit that
 * loads there cannot fail here.
 */
export type ManagedTextConstraints = DeepReadonly<z.infer<typeof textConstraintsSchema>>;
export type ManagedRichTextConstraints = DeepReadonly<
  z.infer<typeof richTextConstraintsSchema>
>;

export function parseManagedTextConstraints(input: unknown): ManagedTextConstraints {
  return parseSchemaInput(textConstraintsSchema, input);
}

export function parseManagedLinkLabelConstraints(input: unknown): ManagedTextConstraints {
  return parseSchemaInput(linkLabelConstraintsSchema, input);
}

export function parseManagedRichTextConstraints(input: unknown): ManagedRichTextConstraints {
  return parseSchemaInput(richTextConstraintsSchema, input);
}

const commonFieldShape = {
  id: stableIdSchema("field"),
  scope: managedFieldScopeSchema,
  classification: managedRenderedClassificationSchema,
  capabilities: capabilitySchema,
  resolver: jsonPointerSourceResolverSchema,
  usages: z.array(managedFieldUsageSchema).min(1),
  presentation: managedPresentationSchema,
};

const commonItemFieldShape = {
  id: stableIdSchema("field"),
  classification: managedRenderedClassificationSchema,
  capabilities: capabilitySchema,
  itemPointer: jsonPointerSchema,
  presentation: managedPresentationSchema,
};

const internalProtectedItemFieldSchema = z.strictObject({
  id: stableIdSchema("field"),
  type: z.literal("internal_protected"),
  classification: z.literal("internal_protected"),
  capabilities: z.array(managedFieldCapabilitySchema).length(0),
  valueType: managedInternalValueTypeSchema,
  semantic: z.string().min(1).max(256),
  itemPointer: jsonPointerSchema,
  presentation: managedPresentationSchema,
});

/**
 * A page's search title and description as ordinary customer-editable text.
 * Where such a field may sit, and which metadata may name it, is decided in
 * `contract-semantics-seo-metadata.ts`; what its value may hold, in `content.ts`.
 */
export const MANAGED_SEO_TEXT_SEMANTICS = Object.freeze(["seo_title", "seo_description"] as const);
export type ManagedSeoTextSemantic = (typeof MANAGED_SEO_TEXT_SEMANTICS)[number];

/**
 * The most characters a contract may let a customer put in a search title or
 * description. Generous on purpose: a faithful conversion keeps a shipped value
 * as long as it already is (All Points Media's /privacy description is 216),
 * and a shorter length is the editor's recommendation, not this contract's rule.
 */
export const MAX_MANAGED_SEO_TEXT_CHARACTERS = 320;

export function isManagedSeoTextSemantic(semantic: string): semantic is ManagedSeoTextSemantic {
  return (MANAGED_SEO_TEXT_SEMANTICS as readonly string[]).includes(semantic);
}

const plainTextSemanticSchema = z.enum([
  "body",
  "label",
  "caption",
  "address",
  "phone",
  "email",
  "legal",
  ...MANAGED_SEO_TEXT_SEMANTICS,
]);

/** What a plain-text field means to a reader, read from the schema. */
export const MANAGED_PLAIN_TEXT_SEMANTICS = Object.freeze([...plainTextSemanticSchema.options]);
export type ManagedPlainTextSemantic = (typeof MANAGED_PLAIN_TEXT_SEMANTICS)[number];

const plainTextShape = {
  type: z.literal("plain_text"),
  semantic: plainTextSemanticSchema,
  constraints: textConstraintsSchema,
};

const headingTextShape = {
  type: z.literal("heading_text"),
  semanticLevel: z.number().int().min(1).max(6),
  constraints: textConstraintsSchema,
};

const uniqueHostsSchema = z
  .array(z.hostname().refine((host) => host === host.toLowerCase()))
  .refine(hasUniqueValues);

/**
 * Which external hosts a link may name. Absent is `declared`, exactly as before
 * the policy existed: only `allowedExternalHosts`. `any_https` is any DNS name
 * (see `isAdmittedExternalHost`) and states no host list of its own, so a list
 * beside it is a contract saying two things and is refused, as megaseo-web's CMS
 * refuses it.
 */
const externalHostPolicySchema = z.enum(["declared", "any_https"]);

interface ExternalHostPolicyInput {
  readonly externalHostPolicy?: "declared" | "any_https";
  readonly allowedExternalHosts: readonly string[];
}

function hostPolicyConflicts(constraints: ExternalHostPolicyInput): boolean {
  return (
    constraints.externalHostPolicy === "any_https" &&
    constraints.allowedExternalHosts.length > 0
  );
}

const richTextConstraintsSchema = z
  .strictObject({
    maxCharacters: z.number().int().positive().max(131_072),
    maxNodes: z.number().int().positive().max(2_000),
    // Top-level blocks only, derived from the document schema. A field lists the
    // blocks it opts into, so one that does not name `heading` or `blockquote`
    // refuses them: nothing reaches a renderer by omission.
    allowedBlocks: z.array(z.enum(MANAGED_RICH_TEXT_BLOCK_KINDS)).min(1),
    // How many top-level blocks a value may hold. Absent is unbounded, exactly
    // as every field was before this existed. A field rendered inside one site
    // element -- a heading, a paragraph, a button -- is `1`: a second block has
    // nowhere to render there.
    maxBlocks: z.number().int().positive().max(2_000).optional(),
    // Whether a value may hold `hard_break` nodes. Absent means false, exactly
    // as every field was before breaks existed, so a site whose renderer
    // predates them is never handed one because its contract said nothing.
    allowHardBreaks: z.boolean().optional(),
    // How many breaks the whole value may hold. Absent is unbounded (the node
    // limit still holds), as an absent `maxBlocks` is; a cap is meaningful only
    // beside the opt-in.
    maxHardBreaks: z.number().int().min(1).max(MANAGED_RICH_TEXT_MAX_HARD_BREAKS).optional(),
    allowedMarks: z.array(managedRichTextMarkKindSchema),
    allowLinks: z.boolean(),
    allowedExternalHosts: uniqueHostsSchema,
    externalHostPolicy: externalHostPolicySchema.optional(),
    allowedTargets: z.array(managedLinkTargetSchema),
  })
  .superRefine((constraints, context) => {
    const unique =
      hasUniqueValues(constraints.allowedBlocks) &&
      hasUniqueValues(constraints.allowedMarks) &&
      hasUniqueValues(constraints.allowedTargets);
    if (!unique) {
      context.addIssue({ code: "custom", message: "Rich-text policies must be unique" });
    }
    const disabledLinksDeclarePolicy =
      !constraints.allowLinks &&
      (constraints.allowedTargets.length + constraints.allowedExternalHosts.length > 0 ||
        constraints.externalHostPolicy !== undefined);
    const enabledLinksHaveNoTarget =
      constraints.allowLinks && constraints.allowedTargets.length === 0;
    if (
      disabledLinksDeclarePolicy ||
      enabledLinksHaveNoTarget ||
      hostPolicyConflicts(constraints)
    ) {
      context.addIssue({ code: "custom", message: "Rich-text link policy conflicts" });
    }
    // A cap without the opt-in caps nothing, and reads as though breaks were
    // admitted. Refused, so a policy says one thing.
    if (constraints.maxHardBreaks !== undefined && constraints.allowHardBreaks !== true) {
      context.addIssue({ code: "custom", message: "A hard-break cap needs allowHardBreaks" });
    }
  });

const richTextShape = {
  type: z.literal("rich_text"),
  constraints: richTextConstraintsSchema,
};

const linkConstraintsSchema = z
  .strictObject({
    labelConstraints: linkLabelConstraintsSchema,
    authority: z.enum(["internal_only", "external_only", "internal_or_external"]),
    allowedSchemes: z.array(z.enum(["https", "mailto", "tel"])),
    allowedExternalHosts: uniqueHostsSchema,
    externalHostPolicy: externalHostPolicySchema.optional(),
    fragmentPolicy: z.enum(["forbid", "declared"]),
    allowedFragments: z.array(managedFragmentSchema),
    allowedTargets: z.array(managedLinkTargetSchema),
  })
  .superRefine((constraints, context) => {
    const unique =
      hasUniqueValues(constraints.allowedSchemes) &&
      hasUniqueValues(constraints.allowedFragments) &&
      hasUniqueValues(constraints.allowedTargets);
    if (!unique) {
      context.addIssue({ code: "custom", message: "Link policies must be unique" });
    }
    if (constraints.fragmentPolicy === "forbid" && constraints.allowedFragments.length > 0) {
      context.addIssue({ code: "custom", message: "Forbidden fragments cannot be declared" });
    }
    if (hostPolicyConflicts(constraints)) {
      context.addIssue({ code: "custom", message: "Any-host links cannot declare hosts" });
    }
  });

const linkShape = { type: z.literal("link"), constraints: linkConstraintsSchema };
const imageShape = { type: z.literal("image"), assetSlotId: stableIdSchema("asset") };
const collectionShape = {
  type: z.literal("collection"),
  collectionId: stableIdSchema("collection"),
};

const CAPABILITIES_BY_TYPE = {
  plain_text: ["text.edit"],
  heading_text: ["text.edit"],
  rich_text: [
    "text.edit",
    "rich_text.mark.bold",
    "rich_text.mark.italic",
    "rich_text.link.edit",
  ],
  link: ["link.label.edit", "link.destination.edit", "link.target.edit"],
  image: ["image.upload", "image.crop", "image.focal_point.edit", "image.alt.edit"],
  collection: ["collection.reorder", "collection.add", "collection.remove"],
} as const satisfies Record<string, readonly (typeof MANAGED_FIELD_CAPABILITIES)[number][]>;

type RenderedFieldInput = {
  readonly type: keyof typeof CAPABILITIES_BY_TYPE;
  readonly classification: "customer_editable" | "code_owned_interface";
  readonly capabilities: readonly (typeof MANAGED_FIELD_CAPABILITIES)[number][];
};

interface ScopedFieldInput {
  readonly scope: "site" | "page";
  readonly usages: readonly ManagedFieldUsage[];
}

function hasUniqueValues(values: readonly unknown[]): boolean {
  return new Set(values).size === values.length;
}

export function validateManagedFieldScope(
  field: ScopedFieldInput,
  context: z.RefinementCtx,
): void {
  const pageCount = new Set(field.usages.map((usage) => usage.pageId)).size;
  if (field.scope === "page" && pageCount !== 1) {
    context.addIssue({
      code: "custom",
      message: "Page-scoped field usages must belong to one page",
    });
  }
}

function validateCapabilities(field: RenderedFieldInput, context: z.RefinementCtx): void {
  const allowed = new Set<string>(CAPABILITIES_BY_TYPE[field.type]);
  const compatible = field.capabilities.every((capability) => allowed.has(capability));
  const emptyAsRequired =
    field.classification === "customer_editable"
      ? field.capabilities.length > 0
      : field.capabilities.length === 0;
  if (!compatible || !emptyAsRequired || !hasUniqueValues(field.capabilities)) {
    context.addIssue({ code: "custom", message: "Field capabilities conflict with its type" });
  }
}

type RichTextCapabilityField = RenderedFieldInput & {
  readonly type: "rich_text";
  readonly constraints: {
    readonly allowedMarks: readonly ("bold" | "italic")[];
    readonly allowLinks: boolean;
  };
};

function validateRichTextCapabilities(
  field: RenderedFieldInput,
  context: z.RefinementCtx,
): void {
  if (field.type !== "rich_text") return;
  const richField = field as RichTextCapabilityField;
  const requiredMarks = ["bold", "italic"] as const;
  const missingMark = requiredMarks.some(
    (mark) =>
      richField.capabilities.includes(`rich_text.mark.${mark}`) &&
      !richField.constraints.allowedMarks.includes(mark),
  );
  const editableLinksDisabled =
    richField.capabilities.includes("rich_text.link.edit") &&
    !richField.constraints.allowLinks;
  if (missingMark || editableLinksDisabled) {
    context.addIssue({
      code: "custom",
      message: "Rich-text capabilities conflict with its local policy",
    });
  }
}

const plainTextFieldSchema = z.strictObject({ ...commonFieldShape, ...plainTextShape });
const headingTextFieldSchema = z.strictObject({ ...commonFieldShape, ...headingTextShape });
const richTextFieldSchema = z.strictObject({ ...commonFieldShape, ...richTextShape });
const linkFieldSchema = z.strictObject({ ...commonFieldShape, ...linkShape });
const imageFieldSchema = z.strictObject({ ...commonFieldShape, ...imageShape });
const collectionFieldSchema = z.strictObject({ ...commonFieldShape, ...collectionShape });

export const managedFieldDescriptorSchema = withManagedSiteJsonSchemaSemantic(
  "field-descriptor",
  z.discriminatedUnion("type", [
    plainTextFieldSchema,
    headingTextFieldSchema,
    richTextFieldSchema,
    linkFieldSchema,
    imageFieldSchema,
    collectionFieldSchema,
  ]).superRefine((field, context) => {
    validateCapabilities(field, context);
    validateRichTextCapabilities(field, context);
    validateManagedFieldScope(field, context);
  }),
);

const plainTextItemFieldSchema = z.strictObject({ ...commonItemFieldShape, ...plainTextShape });
const headingTextItemFieldSchema = z.strictObject({ ...commonItemFieldShape, ...headingTextShape });
const richTextItemFieldSchema = z.strictObject({ ...commonItemFieldShape, ...richTextShape });
const linkItemFieldSchema = z.strictObject({ ...commonItemFieldShape, ...linkShape });
const imageItemFieldSchema = z.strictObject({ ...commonItemFieldShape, ...imageShape });

export const managedCollectionItemFieldSchema = z
  .discriminatedUnion("type", [
    plainTextItemFieldSchema,
    headingTextItemFieldSchema,
    richTextItemFieldSchema,
    linkItemFieldSchema,
    imageItemFieldSchema,
    internalProtectedItemFieldSchema,
  ])
  .superRefine((field, context) => {
    if (field.type === "internal_protected") return;
    validateCapabilities(field, context);
    validateRichTextCapabilities(field, context);
  });

const uniquenessRuleSchema = z.strictObject({
  fieldIds: z.array(stableIdSchema("field")).min(1).refine(hasUniqueValues),
  comparison: z.enum(["exact", "case_folded"]),
});

/**
 * How many items a collection may hold. Stated here once, and spread into the
 * descriptor below, so a tool collecting the numbers from an operator checks
 * them against the same bounds the descriptor enforces.
 */
const collectionBoundsShape = {
  minItems: z.number().int().nonnegative().max(500),
  maxItems: z.number().int().positive().max(500),
};

function boundsAreOrdered(bounds: { readonly minItems: number; readonly maxItems: number }): boolean {
  return bounds.minItems <= bounds.maxItems;
}

const managedCollectionBoundsSchema = z
  .strictObject(collectionBoundsShape)
  .refine(boundsAreOrdered);

export type ManagedCollectionBounds = DeepReadonly<
  z.infer<typeof managedCollectionBoundsSchema>
>;

export function parseManagedCollectionBounds(input: unknown): ManagedCollectionBounds {
  return parseSchemaInput(managedCollectionBoundsSchema, input);
}

export const managedCollectionDescriptorSchema = withManagedSiteJsonSchemaSemantic(
  "collection-descriptor",
  z.strictObject({
    id: stableIdSchema("collection"),
    presentation: managedPresentationSchema,
    resolver: jsonPointerSourceResolverSchema,
    itemIdPointer: jsonPointerSchema,
    itemIdPolicy: z.literal("server_minted"),
    ...collectionBoundsShape,
    itemFields: z.array(managedCollectionItemFieldSchema).min(1),
    uniqueness: z.array(uniquenessRuleSchema),
    deletion: z.strictObject({
      whenReferenced: z.enum(["restrict", "cascade"]),
      restorable: z.boolean(),
    }),
  }).refine(boundsAreOrdered),
);

export type ManagedFieldCapability = z.infer<typeof managedFieldCapabilitySchema>;
export type ManagedFieldScope = z.infer<typeof managedFieldScopeSchema>;
export type ManagedContentClassification = z.infer<typeof managedContentClassificationSchema>;
export type ManagedFieldDescriptor = DeepReadonly<z.infer<typeof managedFieldDescriptorSchema>>;
export type ManagedCollectionItemField = DeepReadonly<z.infer<
  typeof managedCollectionItemFieldSchema
>>;
export type ManagedInternalProtectedCollectionItemField = Extract<
  ManagedCollectionItemField,
  { readonly type: "internal_protected" }
>;
export type ManagedCollectionDescriptor = DeepReadonly<z.infer<
  typeof managedCollectionDescriptorSchema
>>;

export function parseManagedFieldDescriptor(input: unknown): ManagedFieldDescriptor {
  return parseSchemaInput(managedFieldDescriptorSchema, input);
}

export function parseManagedCollectionDescriptor(
  input: unknown,
): ManagedCollectionDescriptor {
  return parseSchemaInput(managedCollectionDescriptorSchema, input);
}
