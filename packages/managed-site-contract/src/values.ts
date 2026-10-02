import * as z from "zod";

import { ManagedSiteContractError } from "./errors.js";
import type { DeepReadonly } from "./deep-readonly.js";
import { parseStableId, type StableId, type StableIdKind } from "./ids.js";
import { HARD_MAX_JSON_DEPTH, type JsonValue } from "./json.js";
import { withManagedSiteJsonSchemaSemantic } from "./schema-semantics.js";
import { parseSchemaInput } from "./schema-input.js";
import {
  parseJsonPointer,
  parseRepositoryPath,
  type JsonPointer,
  type RepositoryPath,
} from "./source.js";

const STABLE_ID_SUFFIX = "[0-9a-hjkmnp-tv-z]{25}[048cgmrw]";
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/u;
const SHA256 = /^[a-f0-9]{64}$/;
const MAX_JSON_SCHEMA_DEPTH = 8;
export const MAX_LINK_LABEL_CHARACTERS = 2_000;
export const MAX_URL_VALUE_CHARACTERS = 2_048;

function accepts(check: () => unknown): boolean {
  try {
    check();
    return true;
  } catch {
    return false;
  }
}

export function stableIdSchema<Kind extends StableIdKind>(
  kind: Kind,
): z.ZodType<StableId<Kind>> {
  const pattern = new RegExp(`^${kind}_${STABLE_ID_SUFFIX}$`);
  return z
    .string()
    .regex(pattern)
    .refine((value) =>
      accepts(() => parseStableId(value, kind)),
    ) as unknown as z.ZodType<StableId<Kind>>;
}

export const repositoryPathSchema = z.stringFormat(
  "gomega-repository-path-v1",
  (value) => accepts(() => parseRepositoryPath(value)),
) as unknown as z.ZodType<RepositoryPath>;

/**
 * Where every image a contract names must live: the directory a site serves
 * from its root. Next.js serves `public/` and nothing else, the CMS writes each
 * upload to `public/managed-site-cms/`, and the converter refuses at config load
 * any asset root but this one, so an image at any other path is one no site
 * can show and nothing in this toolchain writes. Refusing
 * it here keeps "the contract accepts it" and "a site can render it" the same
 * statement. The prefix is compared exactly: `Public/`, `publicx/` and a bare
 * `public` are other paths.
 */
export const MANAGED_SERVED_ASSET_ROOT = "public/";

export function isManagedServedAssetPath(value: string): boolean {
  return (
    accepts(() => parseRepositoryPath(value)) &&
    value.startsWith(MANAGED_SERVED_ASSET_ROOT) &&
    value.length > MANAGED_SERVED_ASSET_ROOT.length
  );
}

export const servedAssetPathSchema = z.stringFormat(
  "gomega-served-asset-path-v1",
  isManagedServedAssetPath,
) as unknown as z.ZodType<RepositoryPath>;

export const jsonPointerSchema = z.stringFormat(
  "gomega-json-pointer-v1",
  (value) => accepts(() => parseJsonPointer(value)),
) as unknown as z.ZodType<JsonPointer>;

function isJsonPrimitive(value: unknown): boolean {
  return (
    value === null ||
    typeof value === "boolean" ||
    typeof value === "string" ||
    (typeof value === "number" && Number.isFinite(value))
  );
}

function isJsonValueWithinDepth(value: unknown, remainingDepth: number): boolean {
  if (isJsonPrimitive(value)) return true;
  if (value === null || remainingDepth === 0 || typeof value !== "object") {
    return false;
  }
  if (Array.isArray(value)) {
    return value.every((child) =>
      isJsonValueWithinDepth(child, remainingDepth - 1),
    );
  }
  return Object.keys(value).every((key) => {
    const child = Object.getOwnPropertyDescriptor(value, key)?.value;
    return isJsonValueWithinDepth(child, remainingDepth - 1);
  });
}

function jsonValueSchemaAtDepth(maxDepth: number): z.ZodType<JsonValue> {
  return z.custom<JsonValue>((value) => isJsonValueWithinDepth(value, maxDepth));
}

export const opaqueJsonValueSchema = withManagedSiteJsonSchemaSemantic(
  "opaque-json",
  jsonValueSchemaAtDepth(HARD_MAX_JSON_DEPTH),
);
export const boundedJsonValueSchema = withManagedSiteJsonSchemaSemantic(
  "bounded-json-depth-8",
  jsonValueSchemaAtDepth(MAX_JSON_SCHEMA_DEPTH),
);

export const managedPresentationSchema = withManagedSiteJsonSchemaSemantic(
  "presentation",
  z.strictObject({
    name: z.string().min(1).max(160),
    description: z.string().min(1).max(1_000).nullable(),
    group: z.string().min(1).max(160),
    order: z.number().int(),
    example: boundedJsonValueSchema.nullable(),
  }),
);

export const jsonPointerSourceResolverSchema = z.strictObject({
  kind: z.literal("json_pointer"),
  path: repositoryPathSchema,
  pointer: jsonPointerSchema,
});

export const managedFieldUsageSchema = z.strictObject({
  pageId: stableIdSchema("page"),
  itemId: stableIdSchema("item").nullable(),
});

export const managedLinkTargetSchema = z.enum(["same_window", "new_window"]);

/**
 * What every URL this contract carries must satisfy, whatever it names.
 *
 * A control character, a non-HTTPS scheme, or embedded credentials are wrong in
 * a canonical and in a link alike.
 */
function isSafeHttpsUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      !CONTROL_CHARACTERS.test(value) &&
      url.protocol === "https:" &&
      url.username === "" &&
      url.password === ""
    );
  } catch {
    return false;
  }
}

/**
 * A canonical names a PAGE, so it must not carry a fragment: two canonicals
 * differing only after the `#` are the same page claiming to be two.
 */
function validateCanonicalUrl(value: string): boolean {
  if (!isSafeHttpsUrl(value)) return false;
  return !value.includes("#") && new URL(value).hash === "";
}

/**
 * A destination names a PLACE, which a fragment is part of.
 *
 * The browser reads it and the server never sees it, so `.../kit.html#page/1`
 * is an ordinary link that a real site writes. This used to share the
 * canonical's rule and answer with the canonical's answer, which made such a
 * link impossible to represent at all rather than merely unusual.
 */
function validateDestinationUrl(value: string): boolean {
  return isSafeHttpsUrl(value);
}

export const absoluteHttpsUrlSchema = withManagedSiteJsonSchemaSemantic(
  "absolute-https-url",
  z
    .url()
    .refine(validateCanonicalUrl, "URL must be absolute HTTPS without credentials or hash"),
);

/**
 * The bound a LINK destination is held to. Separate from the canonical bound
 * above because the two ask different questions of the same string.
 */
export const externalDestinationUrlSchema = withManagedSiteJsonSchemaSemantic(
  "external-destination-url",
  z
    .url()
    .refine(validateDestinationUrl, "URL must be absolute HTTPS without credentials"),
);

/**
 * The bound an internal-SEO `url` value is held to, parseable on its own, so a
 * tool that collects a canonical URL from an operator can refuse "not-a-url"
 * where the operator wrote it rather than three stages later.
 */
const managedAbsoluteHttpsUrlValueSchema = absoluteHttpsUrlSchema.max(MAX_URL_VALUE_CHARACTERS);

export function parseManagedAbsoluteHttpsUrl(input: unknown): string {
  return parseSchemaInput(managedAbsoluteHttpsUrlValueSchema, input) as string;
}

const STATIC_ROUTE_PATTERN = /^\/(?:[A-Za-z0-9._~-]+(?:\/[A-Za-z0-9._~-]+)*)?$/;
const GENERATED_SEGMENT_PATTERN = /^\[[A-Za-z][A-Za-z0-9_]*\]$/;
const STATIC_SEGMENT_PATTERN = /^[A-Za-z0-9._~-]+$/;

export function isManagedGeneratedRouteSegment(value: string): boolean {
  return GENERATED_SEGMENT_PATTERN.test(value);
}

function hasCanonicalRouteSegments(value: string, allowGenerated: boolean): boolean {
  if (value === "/") return !allowGenerated;
  const segments = value.slice(1).split("/");
  const validSegments = segments.every((segment) =>
    segment !== "." &&
    segment !== ".." &&
    (STATIC_SEGMENT_PATTERN.test(segment) ||
      (allowGenerated && isManagedGeneratedRouteSegment(segment))),
  );
  return (
    validSegments &&
    (!allowGenerated || segments.some(isManagedGeneratedRouteSegment))
  );
}

export const managedStaticRoutePathSchema = withManagedSiteJsonSchemaSemantic(
  "static-route",
  z
    .string()
    .max(2_048)
    .regex(STATIC_ROUTE_PATTERN)
    .refine((value) => hasCanonicalRouteSegments(value, false)),
);

export const managedGeneratedRoutePatternSchema = withManagedSiteJsonSchemaSemantic(
  "generated-route",
  z
    .string()
    .min(1)
    .max(2_048)
    .regex(/^\/(?!\/)[^/]+(?:\/[^/]+)*$/)
    .refine((value) => hasCanonicalRouteSegments(value, true)),
);

export const managedFragmentSchema = z
  .string()
  .min(1)
  .max(256)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);

/**
 * Text that can make a link read as somewhere it does not go: every Cc, the bidi
 * embeddings, overrides and isolates, and the line and paragraph separators.
 * The class megaseo-web's CMS states as `unsafe_character`, by code point, so
 * no link this contract accepts carries a character the CMS refuses. This is
 * one direction only: elsewhere this contract is stricter than the CMS (an email
 * address is held to `z.email()`, the CMS only asks for one `@` and a dot).
 */
const UNSAFE_LINK_CHARACTER =
  /[\u0000-\u001f\u007f-\u009f\u2028\u2029\u202a-\u202e\u2066-\u2069]/u;
/**
 * Whether text carries the unsafe class, CR and LF included. A search title or
 * description is one line the customer never sees rendered as a link, so it is
 * held to the whole class, as a link destination is.
 */
export function hasUnsafeTextCharacter(value: string): boolean {
  return UNSAFE_LINK_CHARACTER.test(value);
}

/** The same class less CR and LF, which a label's `newlines` policy decides. */
const UNSAFE_LINK_LABEL_CHARACTER =
  /[\u0000-\u0009\u000b\u000c\u000e-\u001f\u007f-\u009f\u2028\u2029\u202a-\u202e\u2066-\u2069]/u;
/** No legitimate unescaped use in a URL, and each breaks out of an attribute. */
const UNESCAPED_IN_LINK_URL = /["<>`]/;
/**
 * The CMS's `SPACE_OR_CONTROL`: an ASCII space or any Cc, anywhere in a link URL.
 * Checked on the string as written, because `z.url()` trims leading and
 * trailing whitespace before any later check sees it.
 */
const LINK_URL_AS_WRITTEN = /^[^ \p{Cc}]*$/u;

function countCodePoints(value: string): number {
  return [...value].length;
}

/**
 * A string of at most `max` code points: what megaseo-web's CMS counts with
 * `char_length` and what JSON Schema's `maxLength` means, so an emoji is one.
 * Zod's own `max` counts UTF-16 units and would refuse what the CMS saved.
 */
function maxCodePointsString(max: number) {
  return z
    .string()
    .refine((value) => countCodePoints(value) <= max, `At most ${max} characters`)
    .meta({ maxLength: max });
}

/**
 * What a link destination must satisfy beyond its shape, judged over the whole
 * destination so no string member escapes it: none carries an unsafe character,
 * and an external URL is at most {@link MAX_URL_VALUE_CHARACTERS} code points
 * with no unescaped quote, angle bracket or backtick. Only link destinations are
 * held to this; a redirect or canonical URL keeps its own rule.
 */
function isSafeLinkDestination(destination: Readonly<Record<string, unknown>>): boolean {
  const unsafe = Object.values(destination).some(
    (member) => typeof member === "string" && UNSAFE_LINK_CHARACTER.test(member),
  );
  if (unsafe) return false;
  const url = destination.kind === "external" ? destination.url : null;
  return (
    typeof url !== "string" ||
    (countCodePoints(url) <= MAX_URL_VALUE_CHARACTERS && !UNESCAPED_IN_LINK_URL.test(url))
  );
}

export const managedLinkDestinationSchema = z
  .discriminatedUnion("kind", [
    z.strictObject({
      kind: z.literal("internal"),
      pageId: stableIdSchema("page"),
      fragment: managedFragmentSchema.nullable(),
    }),
    z.strictObject({
      kind: z.literal("external"),
      url: z.string().regex(LINK_URL_AS_WRITTEN).pipe(externalDestinationUrlSchema),
    }),
    z.strictObject({ kind: z.literal("email"), address: z.email() }),
    z.strictObject({ kind: z.literal("phone"), number: z.string().regex(/^\+[1-9]\d{7,14}$/) }),
  ])
  .refine(isSafeLinkDestination, "Link destination carries a disallowed character or URL");

/**
 * A DNS name with an alphabetic top-level label, in labels of at most 63
 * characters: the CMS's `any_https` host rule. Every IPv4 spelling a browser
 * resolves (dotted, decimal, hex, octal, short) ends in a numeric label, so none
 * passes, and a single label such as `localhost` has no top-level label at all.
 */
const DNS_NAME =
  /^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]([a-z0-9-]{0,61}[a-z0-9])?$/;
const MAX_DNS_NAME_CHARACTERS = 253;
const BARE_HOST = /^[A-Za-z0-9.-]+$/;

/**
 * Whether an `externalHostPolicy: "any_https"` field admits a host written
 * exactly so: bare ASCII letters, digits, dots and hyphens, and a DNS name.
 */
export function isAnyHttpsHost(host: string): boolean {
  return (
    BARE_HOST.test(host) &&
    host.length <= MAX_DNS_NAME_CHARACTERS &&
    DNS_NAME.test(host.toLowerCase())
  );
}

/**
 * A link's visible label. Bounded here and free of the unsafe class; whether it
 * may break a line is its field's `newlines` policy, so CR and LF are left to it.
 */
export const managedLinkLabelSchema = maxCodePointsString(MAX_LINK_LABEL_CHARACTERS)
  .refine(
    (label) => !UNSAFE_LINK_LABEL_CHARACTER.test(label),
    "Link label carries a disallowed character",
  );

export const managedImageMimeTypeSchema = z.enum([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/avif",
]);

const normalizedRectSchema = z
  .strictObject({
    x: z.number().min(0).max(1),
    y: z.number().min(0).max(1),
    width: z.number().positive().max(1),
    height: z.number().positive().max(1),
  })
  .refine((rect) => rect.x + rect.width <= 1 && rect.y + rect.height <= 1);

/**
 * A crop is a region of the image's own pixel grid, so its smallest meaningful
 * size is one pixel on each axis: a region narrower than that selects no whole
 * pixel of the image, has nothing to show, and scales the image by an unbounded
 * factor when rendered (1e-307 of a 1200px image asks for a 10^309-fold zoom).
 * The bound is the image's own resolution, not a chosen constant.
 *
 * Compared as `crop.width >= 1 / width` in IEEE doubles, because `1 / width` is
 * exactly how a one-pixel crop is written. The product form,
 * `crop.width * width >= 1`, refuses that very value for 540 widths up to 5000
 * (the first is 49: (1/49)*49 < 1 in doubles), since the multiply rounds. With
 * the division form a renderer's zoom, 100 / crop.width, is at most
 * 100 * width: always finite. Coordinates are already finite (JSON carries no
 * NaN or Infinity and the number schema refuses them) and x + width, y + height
 * stay within 1.
 */
function cropCoversAPixel(
  crop: { readonly width: number; readonly height: number },
  image: { readonly width: number; readonly height: number },
): boolean {
  return crop.width >= 1 / image.width && crop.height >= 1 / image.height;
}

/** An image value's alt text, which the CMS bounds with `char_length`. */
const MAX_ALT_TEXT_CHARACTERS = 2_000;

export const managedImageValueSchema = z.strictObject({
  path: servedAssetPathSchema,
  sha256: z.string().regex(SHA256),
  mimeType: managedImageMimeTypeSchema,
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  bytes: z.number().int().positive(),
  altText: maxCodePointsString(MAX_ALT_TEXT_CHARACTERS).nullable(),
  crop: normalizedRectSchema.nullable(),
  focalPoint: z
    .strictObject({ x: z.number().min(0).max(1), y: z.number().min(0).max(1) })
    .nullable(),
}).refine(
  (image) => image.crop === null || cropCoversAPixel(image.crop, image),
  "A crop must cover at least one pixel of the image on each axis",
);

const managedAssetSemanticsSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("decorative") }),
  z.strictObject({ kind: z.literal("informative") }),
  z.strictObject({ kind: z.literal("fixed_alt"), altText: z.string().min(1).max(2_000) }),
]);

const assetPolicySchema = z.enum(["forbidden", "optional", "required"]);
const aspectRatioSchema = z.strictObject({
  width: z.number().int().positive(),
  height: z.number().int().positive(),
});

function hasUniqueStrings(values: readonly string[]): boolean {
  return new Set(values).size === values.length;
}

export const managedAssetSlotDescriptorSchema = withManagedSiteJsonSchemaSemantic(
  "asset-slot",
  z.strictObject({
    id: stableIdSchema("asset"),
    presentation: managedPresentationSchema,
    semantics: managedAssetSemanticsSchema,
    acceptedMimeTypes: z.array(managedImageMimeTypeSchema).min(1),
    outputMimeTypes: z.array(managedImageMimeTypeSchema).min(1),
    minWidth: z.number().int().positive(),
    maxWidth: z.number().int().positive(),
    minHeight: z.number().int().positive(),
    maxHeight: z.number().int().positive(),
    aspectRatios: z.array(aspectRatioSchema).min(1),
    cropPolicy: assetPolicySchema,
    focalPointPolicy: assetPolicySchema,
    maxBytes: z.number().int().positive(),
  }).superRefine((slot, context) => {
    const dimensionsValid =
      slot.minWidth <= slot.maxWidth && slot.minHeight <= slot.maxHeight;
    const mimeTypesUnique =
      hasUniqueStrings(slot.acceptedMimeTypes) && hasUniqueStrings(slot.outputMimeTypes);
    const ratiosUnique =
      new Set(slot.aspectRatios.map(({ width, height }) => width / height)).size ===
      slot.aspectRatios.length;
    if (!dimensionsValid || !mimeTypesUnique || !ratiosUnique) {
      context.addIssue({ code: "custom", message: "Asset slot constraints conflict" });
    }
  }),
);

export type ManagedPresentation = DeepReadonly<z.infer<typeof managedPresentationSchema>>;
export type JsonPointerSourceResolver = DeepReadonly<z.infer<
  typeof jsonPointerSourceResolverSchema
>>;
export type ManagedFieldUsage = DeepReadonly<z.infer<typeof managedFieldUsageSchema>>;
export type ManagedLinkDestination = DeepReadonly<z.infer<typeof managedLinkDestinationSchema>>;
export type ManagedLinkTarget = z.infer<typeof managedLinkTargetSchema>;
export type ManagedImageValue = DeepReadonly<z.infer<typeof managedImageValueSchema>>;
export type ManagedAssetSlotDescriptor = DeepReadonly<z.infer<
  typeof managedAssetSlotDescriptorSchema
>>;

function fail(code: string, message: string): never {
  throw new ManagedSiteContractError(code, message);
}

function parseAssetSlot(input: unknown): ManagedAssetSlotDescriptor {
  return parseSchemaInput(managedAssetSlotDescriptorSchema, input);
}

export function parseManagedImageValueInput(input: unknown): ManagedImageValue {
  return parseSchemaInput(managedImageValueSchema, input);
}

function policyAllows(
  policy: "forbidden" | "optional" | "required",
  value: unknown,
): boolean {
  if (policy === "required") return value !== null;
  if (policy === "forbidden") return value === null;
  return true;
}

function matchesAspectRatio(slot: ManagedAssetSlotDescriptor, image: ManagedImageValue): boolean {
  return slot.aspectRatios.some(
    (ratio) => image.width * ratio.height === image.height * ratio.width,
  );
}

function hasValidAlt(slot: ManagedAssetSlotDescriptor, image: ManagedImageValue): boolean {
  if (slot.semantics.kind === "decorative") return image.altText === "";
  if (slot.semantics.kind === "fixed_alt") return image.altText === null;
  return image.altText !== null && image.altText.trim().length > 0;
}

function assertImagePolicy(
  slot: ManagedAssetSlotDescriptor,
  image: ManagedImageValue,
): void {
  const dimensionsValid =
    image.width >= slot.minWidth &&
    image.width <= slot.maxWidth &&
    image.height >= slot.minHeight &&
    image.height <= slot.maxHeight;
  const mimeValid = slot.outputMimeTypes.includes(image.mimeType);
  const policiesValid =
    policyAllows(slot.cropPolicy, image.crop) &&
    policyAllows(slot.focalPointPolicy, image.focalPoint);
  if (
    !dimensionsValid ||
    !mimeValid ||
    !matchesAspectRatio(slot, image) ||
    !policiesValid ||
    image.bytes > slot.maxBytes ||
    !hasValidAlt(slot, image)
  ) {
    fail("IMAGE_VALUE_POLICY", "Image value violates its asset-slot policy");
  }
}

export function validateManagedImageValue(
  slotInput: unknown,
  imageInput: unknown,
): ManagedImageValue {
  const image = parseManagedImageValueInput(imageInput);
  assertImagePolicy(parseAssetSlot(slotInput), image);
  return image;
}

/**
 * The alt text a renderer must emit for a policy-valid image. A fixed_alt slot
 * owns its alt text, so its values carry `altText: null` and the slot supplies it.
 */
export function resolveManagedImageAltText(
  slotInput: unknown,
  imageInput: unknown,
): string {
  const slot = parseAssetSlot(slotInput);
  const image = parseManagedImageValueInput(imageInput);
  assertImagePolicy(slot, image);
  if (slot.semantics.kind === "fixed_alt") return slot.semantics.altText;
  // assertImagePolicy refused a null alt for every other semantics.
  return image.altText as string;
}
