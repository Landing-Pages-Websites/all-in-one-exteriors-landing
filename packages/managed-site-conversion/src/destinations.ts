import ts from "typescript";

import { nameFromSourceIdentifier, nameIfDurable, type AnchorName } from "./anchor-name.js";
import type { Ownership, RawDestination } from "./candidates.js";
import { resolvedStringValueOf, type ModuleConstants } from "./literals.js";

const FRAGMENT_PATTERN = /^#([A-Za-z0-9][A-Za-z0-9._:-]*)$/u;
const ROUTE_PATTERN = /^\/[A-Za-z0-9._~\-/]*$/u;

/**
 * The contract's destination for one that names no page of this site: an
 * https URL, an email address or a phone number. Null for `self` and
 * `fragment`, which need the page id only the caller knows.
 */
export function offSiteDestination(
  raw: RawDestination,
):
  | { readonly kind: "external"; readonly url: string }
  | { readonly kind: "email"; readonly address: string }
  | { readonly kind: "phone"; readonly number: string }
  | null {
  switch (raw.kind) {
    case "external":
      return { kind: "external", url: raw.url };
    case "email":
      return { kind: "email", address: raw.address };
    case "phone":
      return { kind: "phone", number: raw.number };
    case "self":
    case "fragment":
      return null;
  }
}

export function readDestination(
  expression: ts.Expression,
  constants: ModuleConstants,
): RawDestination | null {
  const href = resolvedStringValueOf(expression, constants);
  if (href === null) return null;
  if (href === "#" || href === "") return { kind: "self" };
  const fragment = FRAGMENT_PATTERN.exec(href);
  if (fragment !== null) return { kind: "fragment", fragment: fragment[1]! };
  if (href.startsWith("mailto:")) return { kind: "email", address: href.slice("mailto:".length) };
  if (href.startsWith("tel:")) return { kind: "phone", number: href.slice("tel:".length) };
  if (href.startsWith("https://")) return { kind: "external", url: href };
  if (ROUTE_PATTERN.test(href)) return { kind: "self" };
  return null;
}

/**
 * Whether a link's destination is the customer's to change.
 *
 * A link to this same site is navigation the developer wired, so the customer
 * is granted nothing over it. Everything else is a destination they own. This
 * is the single reading: `emit-contract.ts` grants `link.destination.edit`
 * from `candidate.ownership`, which is this, and `destinationDiscriminator`
 * refuses to name a link from this, so the two cannot disagree about one href.
 * `extract.ts::isContentDestination` used to be a second statement of it.
 */
export function ownershipOfDestination(destination: RawDestination): Ownership {
  return destination.kind === "self" ? "code_owned_interface" : "customer_editable";
}

/**
 * The durable half of a destination, used to tell sibling links apart.
 *
 * This function used to decide it per kind, refusing an external URL because
 * "a customer editing the destination would silently re-identify the field"
 * and then keeping the fragment, which `link.destination.edit` lets them edit
 * in exactly the same way. Two readings of one question, in one function,
 * reaching opposite answers.
 *
 * The per-kind list is gone. Ownership decides, and it is the same
 * `ownershipOfDestination` the field side reads, so a destination kind that
 * becomes code-owned later gets its name back without anyone remembering to
 * add a case for it.
 */
export function destinationDiscriminator(
  destination: RawDestination,
  expression: ts.Expression,
): AnchorName | null {
  // A module constant's NAME is a name a developer wrote, and it is not part of
  // the value the customer edits: `href={BOOK_URL}` still reads BOOK_URL
  // whatever URL now sits behind it. It is the one durable name an editable
  // destination has.
  if (ts.isIdentifier(expression)) {
    return nameFromSourceIdentifier(`const:${expression.text}`);
  }
  // Anything else a destination offers as a name IS the destination value, so
  // it may name the link only when the customer is granted nothing over it.
  // `readDestination` folds every same-site destination — `#`, `""` and every
  // route — into `self`, and `self` is the only kind ownership calls
  // code-owned, so the one admissible name is what that fold leaves.
  return nameIfDurable("#", ownershipOfDestination(destination) === "code_owned_interface");
}
