/**
 * A value proven admissible as anchor material.
 *
 * `anchors.ts` says which kinds of thing may name a field, and `extract.ts`
 * says, for one literal, whether this tool will ever offer that value to the
 * customer. Neither could say the two had actually been connected. They had
 * not: `#durableAttributeOf` asked the question for an `id` and an accessible
 * name, while `#collectImage` and `#collectLink` built a discriminator
 * straight from `src` and from an `href` fragment — the very values
 * `image.upload` and `link.destination.edit` hand over — and the type system
 * had nothing to say about it, because every name was a `string`.
 *
 * `AnchorName` is that connection. `region.name` and `discriminator.value` are
 * this type, and only this module mints one, so a collector cannot reach an
 * anchor segment with a value it did not ask about. The two sites above are
 * compile errors now rather than review findings, and so is the third
 * collector nobody has written yet.
 *
 * There are exactly two ways in, and both say which of the two reasons a
 * caller is relying on.
 */

declare const beyondCustomerReach: unique symbol;

export type AnchorName = string & { readonly [beyondCustomerReach]: true };

/**
 * Admissible because this tool will not offer the value for editing.
 *
 * `durable` is the caller's proof, and it has to come from the same reading
 * that decides whether the value is proposed as a field — `#nameVerdictOf` for
 * an attribute, `ownershipOfDestination` for a link destination — so that
 * identity and ownership cannot disagree about one value.
 */
export function nameIfDurable(value: string, durable: boolean): AnchorName | null {
  return durable ? (value as AnchorName) : null;
}

/**
 * Admissible because it is an identifier the developer wrote rather than a
 * value at all: an element tag, a module constant's name. The customer edits
 * what is behind `BOOK_URL`, never the name the markup reads it through, so
 * there is no reading to do — but the caller has to say that is why.
 */
export function nameFromSourceIdentifier(value: string): AnchorName {
  return value as AnchorName;
}
