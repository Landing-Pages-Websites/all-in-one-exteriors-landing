import type { ManagedRichTextDocument } from "@landing-pages-websites/managed-site-contract";

import type { AnchorPath } from "./anchors.js";
import type { RichTextTemplates } from "./inline-block.js";
import type { SourceLocation } from "./report.js";

/** What the walker observed, before any contract shape is built. */

export type Ownership = "customer_editable" | "code_owned_interface";

/**
 * What decided a candidate's identity, which decides what a *collision* means.
 *
 * `position` — the anchor names a place inside one component's markup. Two
 * candidates sharing it are two places nothing can tell apart, so the gate
 * refuses both rather than attributing the value to whichever was walked first.
 *
 * `declaration` — the anchor names a binding the developer wrote, so every
 * render site of that binding shows the same string and they are ONE value. The
 * gate merges them when they name the same declaration. When two modules
 * declare the same name the anchor would name two different values, so the gate
 * refuses those instead of picking one.
 */
export type CandidateIdentity =
  | { readonly kind: "position" }
  | { readonly kind: "declaration"; readonly module: string };

export const POSITION_IDENTITY: CandidateIdentity = Object.freeze({ kind: "position" });

export interface CandidateBase {
  readonly anchor: AnchorPath;
  /**
   * Every component that renders this value. More than one only for candidates
   * whose identity is a declaration: the same binding read from two components
   * is one value, so the gate merges them rather than calling them ambiguous.
   */
  readonly componentNames: readonly string[];
  /**
   * The same components, as `declarationKey` identities rather than names.
   *
   * A name is not an identity. Two modules may each declare `AdminCard`, and
   * page attribution asked which routes render "a component called AdminCard",
   * so one route's component was answered for by another's. That decides the
   * field's scope, its content document and, since routes may now decline
   * content, whether an internal screen is rewritten at all. `componentNames`
   * stays for what it is good for: naming a section and slugging an anchor.
   */
  readonly componentKeys: readonly string[];
  readonly location: SourceLocation;
  readonly evidence: string;
  readonly ownership: Ownership;
  readonly identity: CandidateIdentity;
}

/**
 * The component a value is handed to, when it is passed as a prop.
 *
 * Recorded where the reading resolved it. A rewriter that wants to annotate
 * the element the RECEIVER renders the value in needs to find that
 * declaration, and re-resolving the tag would be a second answer to a question
 * extraction already answered.
 */
export interface CandidateReceiver {
  readonly component: string;
  readonly file: string;
  readonly prop: string;
}

export interface PlainTextCandidate extends CandidateBase {
  readonly kind: "plain_text";
  readonly semantic: "body" | "label";
  readonly value: string;
  readonly receiver?: CandidateReceiver;
}

export interface HeadingCandidate extends CandidateBase {
  readonly kind: "heading_text";
  readonly level: number;
  readonly value: string;
}

export interface RichTextCandidate extends CandidateBase {
  readonly kind: "rich_text";
  readonly document: ManagedRichTextDocument;
  /** Set when the formatted text is itself a heading element. */
  readonly headingLevel: number | null;
  /**
   * The site's own element for each mark, for a value rendered in place as ONE
   * block of its element. Null for a document that is not one inline block (a
   * list), which nothing renders in place.
   */
  readonly templates: RichTextTemplates | null;
}

export type RawDestination =
  | { readonly kind: "fragment"; readonly fragment: string }
  | { readonly kind: "self" }
  | { readonly kind: "external"; readonly url: string }
  | { readonly kind: "email"; readonly address: string }
  | { readonly kind: "phone"; readonly number: string };

export interface LinkCandidate extends CandidateBase {
  readonly kind: "link";
  readonly label: string;
  /**
   * Whether the link field is the label's one editor. Only a label that is
   * bare text is: a formatted label is its own rich-text field, and a label
   * beside other elements has its text read as a field of its own, so offering
   * it on the link too would give one label two editors.
   */
  readonly labelEditable: boolean;
  readonly destination: RawDestination;
  readonly newWindow: boolean;
}

export interface ImageCandidate extends CandidateBase {
  readonly kind: "image";
  readonly source: string;
  readonly altText: string | null;
}

export type ItemFieldKind = "plain_text" | "heading_text" | "link" | "image";

export interface ItemFieldSpec {
  readonly property: string;
  readonly kind: ItemFieldKind;
  readonly semantic: "body" | "label";
  readonly headingLevel: number | null;
  readonly ownership: Ownership;
}

export interface CollectionItemValue {
  readonly property: string;
  readonly value: string;
  /** Only populated for image item fields. */
  readonly altText: string | null;
}

export interface CollectionCandidate extends CandidateBase {
  readonly kind: "collection";
  readonly bindingName: string;
  readonly itemFields: readonly ItemFieldSpec[];
  readonly items: readonly (readonly CollectionItemValue[])[];
}

export type Candidate =
  | PlainTextCandidate
  | HeadingCandidate
  | RichTextCandidate
  | LinkCandidate
  | ImageCandidate
  | CollectionCandidate;
