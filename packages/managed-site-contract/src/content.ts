import * as z from "zod";

import type { DeepReadonly } from "./deep-readonly.js";
import { ManagedSiteContractError } from "./errors.js";
import {
  isManagedSeoTextSemantic,
  parseManagedCollectionDescriptor,
  parseManagedFieldDescriptor,
  type ManagedCollectionDescriptor,
  type ManagedCollectionItemField,
  type ManagedFieldDescriptor,
} from "./fields.js";
import { managedInternalValueTypeSchema } from "./internal-value-types.js";
import {
  managedRichTextDocumentSchema,
  parseManagedRichTextDocument,
  summarizeManagedRichText,
  type ManagedRichTextDocument,
  type ManagedRichTextMark,
} from "./rich-text.js";
import {
  MANAGED_SITE_ROOT_SEMANTICS,
  withManagedSiteJsonSchemaSemantic,
} from "./schema-semantics.js";
import { parseSchemaInput } from "./schema-input.js";
import {
  absoluteHttpsUrlSchema,
  hasUnsafeTextCharacter,
  isAnyHttpsHost,
  MAX_URL_VALUE_CHARACTERS,
  managedImageMimeTypeSchema,
  managedImageValueSchema,
  managedLinkDestinationSchema,
  managedLinkLabelSchema,
  managedLinkTargetSchema,
  opaqueJsonValueSchema,
  servedAssetPathSchema,
  stableIdSchema,
  type ManagedLinkDestination,
} from "./values.js";

export const managedContentOwnerSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("site") }),
  z.strictObject({ kind: z.literal("page"), pageId: stableIdSchema("page") }),
  z.strictObject({
    kind: z.literal("collection_item"),
    collectionId: stableIdSchema("collection"),
    itemId: stableIdSchema("item"),
  }),
]);

const contentBase = {
  fieldId: stableIdSchema("field"),
  owner: managedContentOwnerSchema,
};

const plainTextContentValueSchema = z.strictObject({
  ...contentBase,
  type: z.literal("plain_text"),
  value: z.string(),
});

const headingTextContentValueSchema = z.strictObject({
  ...contentBase,
  type: z.literal("heading_text"),
  value: z.string(),
});

const richTextContentValueSchema = z
  .strictObject({
    ...contentBase,
    type: z.literal("rich_text"),
    value: managedRichTextDocumentSchema,
  })
  .superRefine((content, context) => {
    try {
      parseManagedRichTextDocument(content.value);
    } catch {
      context.addIssue({ code: "custom", message: "Rich text exceeds its envelope" });
    }
  });

const linkContentValueSchema = z.strictObject({
  ...contentBase,
  type: z.literal("link"),
  value: z.strictObject({
    label: managedLinkLabelSchema,
    destination: managedLinkDestinationSchema,
    target: managedLinkTargetSchema,
  }),
});

const imageContentValueSchema = z.strictObject({
  ...contentBase,
  type: z.literal("image"),
  value: managedImageValueSchema,
});

const collectionContentValueSchema = z.strictObject({
  ...contentBase,
  type: z.literal("collection"),
  value: z.strictObject({ orderedItemIds: z.array(stableIdSchema("item")) }),
});

const internalContentBase = {
  ...contentBase,
  type: z.literal("internal_protected"),
};

const boundedInternalStringSchema = z.string().max(10_000);
const boundedStringListSchema = z.array(z.string().min(1).max(2_048)).max(100);

/**
 * The bounds an internal-protected value is held to, parseable on their own.
 *
 * A migration tool collects business identity from an operator before any
 * content document exists, and those strings are emitted as these values
 * unchanged. Without this it would have to restate the caps to check them at its
 * own boundary, and a restated cap drifts; with it, a value that loads there
 * cannot fail here.
 */
export function parseManagedInternalString(input: unknown): string {
  return parseSchemaInput(boundedInternalStringSchema, input) as string;
}

export function parseManagedInternalStringList(input: unknown): readonly string[] {
  return parseSchemaInput(boundedStringListSchema, input) as readonly string[];
}
const nonemptyNfcString = (maxLength: number): z.ZodString =>
  z.string().min(1).max(maxLength).refine((value) => value.normalize("NFC") === value);

const postalAddressSchema = z.strictObject({
  streetAddress: nonemptyNfcString(300),
  addressLocality: nonemptyNfcString(160),
  addressRegion: nonemptyNfcString(160),
  postalCode: nonemptyNfcString(32),
  addressCountry: z.string().regex(/^[A-Z]{2}$/),
});

const geoCoordinatesSchema = z.strictObject({
  latitude: z.number().finite().min(-90).max(90),
  longitude: z.number().finite().min(-180).max(180),
});

const weekdaySchema = z.enum([
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
]);
const uniqueDaysSchema = z.array(weekdaySchema).min(1).max(7).refine(hasUniqueValues);
const canonicalTimeSchema = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/);
const allDayPeriodSchema = z.strictObject({
  days: uniqueDaysSchema,
  allDay: z.literal(true),
  opens: z.null(),
  closes: z.null(),
});
const timedPeriodSchema = z.strictObject({
  days: uniqueDaysSchema,
  allDay: z.literal(false),
  opens: canonicalTimeSchema,
  closes: canonicalTimeSchema,
});
const openingPeriodSchema = z.discriminatedUnion("allDay", [
  allDayPeriodSchema,
  timedPeriodSchema,
]);

function isIanaTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value }).format();
    return true;
  } catch {
    return false;
  }
}

function hasUniqueValues(values: readonly unknown[]): boolean {
  return new Set(values).size === values.length;
}

const openingHoursSchema = z
  .strictObject({
    timeZone: z.string().min(1).max(100).refine(isIanaTimeZone),
    periods: z.array(openingPeriodSchema).max(21),
  })
  .refine((hours) =>
    hasUniqueValues(hours.periods.flatMap((period) => period.days)),
  );

const indexingDirectivesSchema = z.strictObject({
  index: z.boolean(),
  follow: z.boolean(),
  archive: z.boolean(),
  imageIndex: z.boolean(),
  maxSnippet: z.number().int().min(-1).max(10_000),
  maxImagePreview: z.enum(["none", "standard", "large"]),
  maxVideoPreview: z.number().int().min(-1).max(86_400),
});

const internalProtectedContentValueSchema = z.discriminatedUnion("valueType", [
  z.strictObject({ ...internalContentBase, valueType: z.literal("string"), value: boundedInternalStringSchema }),
  z.strictObject({ ...internalContentBase, valueType: z.literal("url"), value: absoluteHttpsUrlSchema.max(MAX_URL_VALUE_CHARACTERS) }),
  z.strictObject({ ...internalContentBase, valueType: z.literal("boolean"), value: z.boolean() }),
  z.strictObject({ ...internalContentBase, valueType: z.literal("number"), value: z.number().finite() }),
  z.strictObject({ ...internalContentBase, valueType: z.literal("string_list"), value: boundedStringListSchema }),
  z.strictObject({ ...internalContentBase, valueType: z.literal("postal_address"), value: postalAddressSchema }),
  z.strictObject({ ...internalContentBase, valueType: z.literal("geo_coordinates"), value: geoCoordinatesSchema }),
  z.strictObject({ ...internalContentBase, valueType: z.literal("opening_hours"), value: openingHoursSchema }),
  z.strictObject({ ...internalContentBase, valueType: z.literal("indexing_directives"), value: indexingDirectivesSchema }),
  z.strictObject({
    ...internalContentBase,
    valueType: z.literal("json"),
    value: opaqueJsonValueSchema,
  }),
]);

const renderedContentValueSchema = z.discriminatedUnion("type", [
  plainTextContentValueSchema,
  headingTextContentValueSchema,
  richTextContentValueSchema,
  linkContentValueSchema,
  imageContentValueSchema,
  collectionContentValueSchema,
]);

export const managedSiteContentValueSchema = withManagedSiteJsonSchemaSemantic(
  "content-value",
  z.union([renderedContentValueSchema, internalProtectedContentValueSchema]),
);

export const managedSiteAssetManifestEntrySchema = z.strictObject({
  assetSlotId: stableIdSchema("asset"),
  path: servedAssetPathSchema,
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  mimeType: managedImageMimeTypeSchema,
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  bytes: z.number().int().positive(),
});

export const managedSiteContentDocumentSchema = withManagedSiteJsonSchemaSemantic(
  MANAGED_SITE_ROOT_SEMANTICS.ManagedSiteContentDocument,
  z.strictObject({
    schemaVersion: z.literal("1.0"),
    values: z.array(managedSiteContentValueSchema),
    assetManifest: z.array(managedSiteAssetManifestEntrySchema),
  }),
);

export type ManagedContentOwner = DeepReadonly<z.infer<typeof managedContentOwnerSchema>>;
export type ManagedSiteContentValue = DeepReadonly<z.infer<typeof managedSiteContentValueSchema>>;
export type ManagedSiteAssetManifestEntry = DeepReadonly<z.infer<
  typeof managedSiteAssetManifestEntrySchema
>>;
export type ManagedSiteContentDocument = DeepReadonly<z.infer<
  typeof managedSiteContentDocumentSchema
>>;
export type { ManagedInternalValueType } from "./internal-value-types.js";

function fail(code: string, message: string): never {
  throw new ManagedSiteContractError(code, message);
}

export function parseManagedSiteContentValue(input: unknown): ManagedSiteContentValue {
  return parseSchemaInput(managedSiteContentValueSchema, input);
}

export function parseManagedSiteContentDocument(
  input: unknown,
): ManagedSiteContentDocument {
  return parseSchemaInput(managedSiteContentDocumentSchema, input);
}

function destinationScheme(destination: ManagedLinkDestination): "internal" | "https" | "mailto" | "tel" {
  if (destination.kind === "internal") return "internal";
  if (destination.kind === "external") return "https";
  return destination.kind === "email" ? "mailto" : "tel";
}

/** The CMS's test that a link is an absolute https URL, scheme in lowercase. */
const ABSOLUTE_HTTPS = /^https:\/\/[^/ \t\n\v\f\r]+/;
const AUTHORITY_HOST = /^https:\/\/([^/?#]*)/;
const BARE_HOST = /^[A-Za-z0-9.-]+$/;

type ExternalHostConstraints = {
  readonly externalHostPolicy?: "declared" | "any_https";
  readonly allowedExternalHosts: readonly string[];
};

/**
 * Whether a destination is one its field's host policy admits: always, unless it
 * is external. Link fields and prose links share it so the two cannot drift.
 *
 * Both policies judge the host as it is written, exactly as the CMS does,
 * because `new URL()` rewrites a host before anyone can judge it: it turns
 * `0x7f.1` into `127.0.0.1`, `ex%61mple.org` into `example.org`, drops a port,
 * lowercases `HTTPS:` and reads a backslash as a slash. So the scheme must be
 * `https://` as written, the authority must hold no `@`, and the host must be
 * bare ASCII letters, digits, dots and hyphens. `declared` then needs it on the
 * list, compared in lowercase; `any_https` needs it to be a DNS name. Every host
 * `declared` admits is therefore one `any_https` judges on the same string.
 */
function isAdmittedExternalHost(
  destination: ManagedLinkDestination,
  constraints: ExternalHostConstraints,
): boolean {
  if (destination.kind !== "external") return true;
  const host = writtenHost(destination.url);
  if (host === null) return false;
  if (constraints.externalHostPolicy === "any_https") return isAnyHttpsHost(host);
  return constraints.allowedExternalHosts.includes(host.toLowerCase());
}

/** The bare host an https link names as written, or `null` when it names none. */
function writtenHost(url: string): string | null {
  if (!ABSOLUTE_HTTPS.test(url)) return null;
  // Split exactly as the CMS does: anything after an `@` in it is the authority.
  if ((url.split("/")[2] ?? "").includes("@")) return null;
  const host = AUTHORITY_HOST.exec(url)?.[1] ?? "";
  return BARE_HOST.test(host) ? host : null;
}

type ManagedValueField = ManagedFieldDescriptor | ManagedCollectionItemField;
type ManagedTextField = Extract<
  ManagedValueField,
  { type: "plain_text" | "heading_text" }
>;

function isAllowedDestination(
  destination: ManagedLinkDestination,
  constraints: Extract<ManagedValueField, { type: "link" }>['constraints'],
): boolean {
  const internal = destination.kind === "internal";
  if (constraints.authority === "internal_only" && !internal) return false;
  if (constraints.authority === "external_only" && internal) return false;
  const scheme = destinationScheme(destination);
  if (scheme !== "internal" && !constraints.allowedSchemes.includes(scheme)) return false;
  if (!isAdmittedExternalHost(destination, constraints)) return false;
  if (destination.kind !== "internal") return true;
  if (constraints.fragmentPolicy === "forbid") return destination.fragment === null;
  return destination.fragment === null || constraints.allowedFragments.includes(destination.fragment);
}

function validateRichText(
  field: Extract<ManagedValueField, { type: "rich_text" }>,
  document: ManagedRichTextDocument,
): boolean {
  const stats = summarizeManagedRichText(document);
  const withinEnvelope =
    stats.characters <= field.constraints.maxCharacters &&
    stats.nodes <= field.constraints.maxNodes;
  const maxBlocks = field.constraints.maxBlocks;
  const blocksAllowed =
    (maxBlocks === undefined || stats.blocks.length <= maxBlocks) &&
    stats.blocks.every((block) => field.constraints.allowedBlocks.includes(block.type));
  // A mark is an object now, so what a constraint names is its kind. Link marks
  // are excluded here on purpose: they are governed by `allowLinks` and its
  // companions below, which is where they were governed when a link was a node,
  // so nothing has to be added to `allowedMarks` for links to keep working.
  const marksAllowed = stats.textNodes.every((node) =>
    (node.marks ?? []).every(
      (mark) =>
        mark.type === "link" ||
        field.constraints.allowedMarks.includes(mark.type),
    ),
  );
  const linksAllowed = stats.textNodes.every((node) =>
    (node.marks ?? []).every(
      (mark) => mark.type !== "link" || richTextLinkAllowed(field, mark),
    ),
  );
  return withinEnvelope && blocksAllowed && marksAllowed && linksAllowed && hardBreaksAllowed(field, stats.hardBreaks);
}

/**
 * Breaks are admitted only by the field's opt-in, and then up to its cap. An
 * opt-in with no cap is bounded only by the node limit, as an absent
 * `maxBlocks` is. Where a break may sit is the document's own rule, already
 * held by the parser.
 */
function hardBreaksAllowed(
  field: Extract<ManagedValueField, { type: "rich_text" }>,
  hardBreaks: number,
): boolean {
  if (hardBreaks === 0) return true;
  const { allowHardBreaks, maxHardBreaks } = field.constraints;
  return allowHardBreaks === true && (maxHardBreaks === undefined || hardBreaks <= maxHardBreaks);
}

function richTextLinkAllowed(
  field: Extract<ManagedValueField, { type: "rich_text" }>,
  mark: Extract<ManagedRichTextMark, { type: "link" }>,
): boolean {
  if (!field.constraints.allowLinks) return false;
  if (!field.constraints.allowedTargets.includes(mark.target)) return false;
  return isAdmittedExternalHost(mark.destination, field.constraints);
}

interface TextConstraints {
  readonly minLength: number;
  readonly maxLength: number;
  readonly newlines: "forbid" | "allow";
}

/**
 * Text is measured in code points, as megaseo-web's CMS measures it
 * (`char_length`, `[...text].length`), so an emoji counts once toward
 * `maxLength`. `minLength` still admits a value whose UTF-16 length meets it:
 * code points never exceed UTF-16 units, so measuring the minimum in code
 * points alone could refuse a value this contract admitted before, and a
 * minimum the CMS holds more strictly is refused there, on write. Plain text,
 * heading text and link labels all come through here.
 */
function validatesText(value: string, constraints: TextConstraints): boolean {
  const { minLength, maxLength, newlines } = constraints;
  return (
    value.length >= minLength &&
    [...value].length <= maxLength &&
    (newlines === "allow" || !/[\r\n]/u.test(value))
  );
}

function isSeoTextField(field: ManagedTextField): boolean {
  return field.type === "plain_text" && isManagedSeoTextSemantic(field.semantic);
}

function validateTextFieldContent(
  field: ManagedTextField,
  content: ManagedSiteContentValue,
): void {
  if (
    (content.type !== "plain_text" && content.type !== "heading_text") ||
    !validatesText(content.value, field.constraints) ||
    (isSeoTextField(field) && hasUnsafeTextCharacter(content.value))
  ) {
    fail("FIELD_VALUE_TEXT", "Text violates its field constraints");
  }
}

function validateRichTextFieldContent(
  field: Extract<ManagedValueField, { type: "rich_text" }>,
  content: ManagedSiteContentValue,
): void {
  if (content.type !== "rich_text") {
    fail("FIELD_VALUE_IDENTITY", "Content value does not match its field descriptor");
  }
  const document = parseManagedRichTextDocument(content.value);
  if (!validateRichText(field, document)) {
    fail("FIELD_VALUE_RICH_TEXT", "Rich text violates its field constraints");
  }
}

function validateLinkFieldContent(
  field: Extract<ManagedValueField, { type: "link" }>,
  content: ManagedSiteContentValue,
): void {
  if (content.type !== "link") {
    fail("FIELD_VALUE_IDENTITY", "Content value does not match its field descriptor");
  }
  const labelValid = validatesText(content.value.label, field.constraints.labelConstraints);
  const targetValid = field.constraints.allowedTargets.includes(content.value.target);
  if (!labelValid || !targetValid || !isAllowedDestination(content.value.destination, field.constraints)) {
    fail("FIELD_VALUE_LINK", "Link violates its field constraints");
  }
}

export function validateParsedManagedFieldValue(
  field: ManagedValueField,
  content: ManagedSiteContentValue,
): void {
  if (field.id !== content.fieldId || field.type !== content.type) {
    fail("FIELD_VALUE_IDENTITY", "Content value does not match its field descriptor");
  }
  switch (field.type) {
    case "internal_protected":
      if (
        content.type !== "internal_protected" ||
        content.valueType !== field.valueType
      ) {
        fail(
          "FIELD_VALUE_IDENTITY",
          "Protected content does not match its item descriptor",
        );
      }
      return;
    case "plain_text":
    case "heading_text":
      return validateTextFieldContent(field, content);
    case "rich_text":
      return validateRichTextFieldContent(field, content);
    case "link":
      return validateLinkFieldContent(field, content);
    case "image":
    case "collection":
      return;
  }
}

export function validateParsedManagedCollectionValue(
  descriptor: ManagedCollectionDescriptor,
  content: ManagedSiteContentValue,
): void {
  if (content.type !== "collection") {
    fail("COLLECTION_VALUE_TYPE", "Expected a collection content value");
  }
  const ids = content.value.orderedItemIds;
  const withinBounds = ids.length >= descriptor.minItems && ids.length <= descriptor.maxItems;
  if (!withinBounds || new Set(ids).size !== ids.length) {
    fail("COLLECTION_VALUE_POLICY", "Collection item IDs violate collection policy");
  }
}

export function validateManagedFieldValue(
  fieldInput: unknown,
  valueInput: unknown,
): ManagedSiteContentValue {
  const field = parseManagedFieldDescriptor(fieldInput);
  const content = parseManagedSiteContentValue(valueInput);
  validateParsedManagedFieldValue(field, content);
  return content;
}

export function validateManagedCollectionValue(
  descriptorInput: unknown,
  valueInput: unknown,
): ManagedSiteContentValue {
  const descriptor: ManagedCollectionDescriptor = parseManagedCollectionDescriptor(descriptorInput);
  const content = parseManagedSiteContentValue(valueInput);
  validateParsedManagedCollectionValue(descriptor, content);
  return content;
}
