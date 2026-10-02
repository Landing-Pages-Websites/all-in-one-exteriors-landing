import type { ManagedSiteContentDocument } from "./content.js";
import type { ManagedSiteContractV1 } from "./contract.js";
import {
  MANAGED_METADATA_SLOT_POLICY,
  metadataFieldReferences,
} from "./contract-semantics-seo-metadata.js";
import type { ManagedFieldDescriptor } from "./fields.js";

type StaticPageSeo = ManagedSiteContractV1["internalSeo"]["pages"][number];
type Metadata = StaticPageSeo["metadata"];

interface RepointSides {
  readonly productionContract: ManagedSiteContractV1;
  readonly productionContent: ManagedSiteContentDocument;
  readonly candidateContract: ManagedSiteContractV1;
  readonly candidateContent: ManagedSiteContentDocument;
}

interface RepointContext extends RepointSides {
  readonly productionFields: ReadonlyMap<string, ManagedFieldDescriptor>;
  readonly candidateFields: ReadonlyMap<string, ManagedFieldDescriptor>;
  readonly candidateProtected: ReadonlySet<string>;
}

interface Repoint {
  readonly pageId: string;
  readonly slot: EditableSlot;
  readonly from: string;
  readonly to: string;
  /** The candidate's social echo of this slot, or null when it has none. */
  readonly echo: string | null;
  readonly productionEcho: string | null;
}

type EditableSlot = "title" | "description";

function isEditableSlot(slot: string): slot is EditableSlot {
  return slot in MANAGED_METADATA_SLOT_POLICY &&
    MANAGED_METADATA_SLOT_POLICY[slot as keyof typeof MANAGED_METADATA_SLOT_POLICY].editableSemantic !== null;
}

function renderedFields(contract: ManagedSiteContractV1): ReadonlyMap<string, ManagedFieldDescriptor> {
  return new Map(
    contract.pages.flatMap((page) =>
      page.sections.flatMap((section) => section.fields.map((field) => [field.id, field] as const)),
    ),
  );
}

/**
 * The one string a field publishes for this page alone, or null. A site-owned
 * value is not evidence: the page serves its own literal for a protected slot,
 * so a value shared by every page need not be what this page shows.
 */
function servedText(content: ManagedSiteContentDocument, fieldId: string, pageId: string): string | null {
  const values = content.values.filter(
    (value) => value.fieldId === fieldId && value.owner.kind === "page" && value.owner.pageId === pageId,
  );
  const [only] = values;
  return values.length === 1 && typeof only?.value === "string" ? only.value : null;
}

function echoOf(metadata: Metadata, slot: EditableSlot): string | null {
  const echo = metadataFieldReferences(metadata).find((reference) => !reference.primary && reference.slot === slot);
  return echo?.fieldId ?? null;
}

/**
 * The slots a customer may own (a primary reference whose slot policy names an
 * editable semantic), derived from the slot table semantics already enforces,
 * so a social echo or a protected-only slot is never a candidate.
 */
function editableSlotRepoints(production: StaticPageSeo, candidate: StaticPageSeo): readonly Repoint[] {
  const next = new Map(metadataFieldReferences(candidate.metadata).map((reference) => [reference.path, reference]));
  return metadataFieldReferences(production.metadata).flatMap((reference) => {
    const moved = next.get(reference.path);
    const slot = reference.slot;
    if (!reference.primary || !isEditableSlot(slot) || moved === undefined || moved.fieldId === reference.fieldId) return [];
    return [{
      pageId: production.pageId,
      slot,
      from: reference.fieldId,
      to: moved.fieldId,
      echo: echoOf(candidate.metadata, slot),
      productionEcho: echoOf(production.metadata, slot),
    }];
  });
}

function isNewEditableSeoField(context: RepointContext, repoint: Repoint): boolean {
  const field = context.candidateFields.get(repoint.to);
  return (
    field !== undefined &&
    field.type === "plain_text" &&
    field.classification === "customer_editable" &&
    field.semantic === MANAGED_METADATA_SLOT_POLICY[repoint.slot].editableSemantic &&
    !context.productionFields.has(repoint.to)
  );
}

/**
 * The share card keeps what it published. The site fills an og or twitter
 * card from an editable title whose echo is null or names that field, so the
 * candidate's echo must name a protected field: production's own echo, or,
 * where production had none (converted sites emit null), the re-point's old
 * source, whose text is the text the page serves. Any other protected field
 * would put new words on the card.
 */
function keepsShareCard(context: RepointContext, repoint: Repoint): boolean {
  const echo = repoint.echo;
  if (echo === null || !context.candidateProtected.has(echo)) return false;
  return repoint.productionEcho === null ? echo === repoint.from : echo === repoint.productionEcho;
}

/**
 * A re-point publishes exactly what production serves: the new field's one
 * candidate value is the same string, compared exactly, as the old source's one
 * production value. A blank value is refused, since the site falls back from a
 * blank editable title to something else.
 */
function publishesSameText(context: RepointContext, repoint: Repoint): boolean {
  const before = servedText(context.productionContent, repoint.from, repoint.pageId);
  const after = servedText(context.candidateContent, repoint.to, repoint.pageId);
  return before !== null && after !== null && after.trim() !== "" && after === before;
}

function isAdmitted(context: RepointContext, repoint: Repoint): boolean {
  return isNewEditableSeoField(context, repoint) && keepsShareCard(context, repoint) && publishesSameText(context, repoint);
}

/** The metadata as production had it for each admitted slot: its source and its echo. */
function restore(metadata: Metadata, repoints: readonly Repoint[]): Metadata {
  return repoints.reduce<Metadata>((restored, repoint) => ({
    ...restored,
    [repoint.slot]: repoint.from,
    social: { ...restored.social, [repoint.slot]: repoint.productionEcho },
  }), metadata);
}

function admitPage(context: RepointContext, production: StaticPageSeo | undefined, candidate: StaticPageSeo): StaticPageSeo {
  if (production === undefined) return candidate;
  const admitted = editableSlotRepoints(production, candidate).filter((repoint) => isAdmitted(context, repoint));
  return admitted.length === 0 ? candidate : { ...candidate, metadata: restore(candidate.metadata, admitted) };
}

/**
 * The candidate as the SEO identity rule should judge it: a static page's
 * title or description moved from its production source to a new
 * customer-editable `seo_*` field that publishes the same text, for this page
 * alone, while its share-card echo names a protected field, is read as
 * unchanged. Every other re-point is left in place, so the rule refuses it.
 */
export function withAdmittedEditableSeoRepoints(sides: RepointSides): ManagedSiteContractV1 {
  const context: RepointContext = {
    ...sides,
    productionFields: renderedFields(sides.productionContract),
    candidateFields: renderedFields(sides.candidateContract),
    candidateProtected: new Set(sides.candidateContract.internalSeo.protectedFields.map((field) => field.id)),
  };
  const production = new Map(sides.productionContract.internalSeo.pages.map((entry) => [entry.pageId, entry]));
  const pages = sides.candidateContract.internalSeo.pages.map((entry) =>
    admitPage(context, production.get(entry.pageId), entry),
  );
  return { ...sides.candidateContract, internalSeo: { ...sides.candidateContract.internalSeo, pages } };
}
