import { IDS, type JsonObject } from "./runtime-site.js";

/**
 * Hand-written adversarial inputs for the readers, shared by the behavioural
 * suite and the differential one. They were once "values the reader must
 * refuse"; the differential suite now asks the contract which of them it
 * accepts, and holds the reader to rendering every one it does.
 */

export const internalTo = (pageId: unknown, fragment: unknown = null): JsonObject => ({ kind: "internal", pageId, fragment });
export const external = (url: unknown): JsonObject => ({ kind: "external", url });
export const linkValue = (destination: unknown, target: unknown = "same_window", label: unknown = "x"): JsonObject => ({
  destination,
  label,
  target,
});
export const text = (value: string, marks?: readonly JsonObject[]): JsonObject =>
  marks === undefined ? { type: "text", text: value } : { type: "text", text: value, marks };
export const paragraph = (...content: JsonObject[]): JsonObject => ({ type: "paragraph", content });

/** 2028 astral code points: 2048 with the origin, as the contract counts, and 4076 UTF-16 units. */
const ASTRAL_PATH = String.fromCodePoint(0x1f600).repeat(2028);

export type Outcome = "accepted" | "rejected";

/**
 * Link values, each with the contract's verdict when it sits in an open link
 * field (any https host, every scheme and target, fragments "team", "method" and
 * "pricing"). Stated, not observed: the differential suite asserts the contract
 * reaches it, so a harness that refused everything would fail.
 */
export const ADVERSARIAL_LINKS: readonly [string, unknown, Outcome][] = [
  ["javascript: as an external url", linkValue(external("javascript:alert(1)")), "rejected"],
  ["javascript: with https-looking tail", linkValue(external("javascript://https://example.com")), "rejected"],
  ["http", linkValue(external("http://example.com/")), "rejected"],
  ["uppercase scheme", linkValue(external("HTTPS://example.com/")), "rejected"],
  ["protocol-relative", linkValue(external("//example.com/")), "rejected"],
  ["credentials", linkValue(external("https://user:pw@example.com/")), "rejected"],
  ["port", linkValue(external("https://example.com:8443/")), "rejected"],
  ["IPv4 host", linkValue(external("https://127.0.0.1/")), "rejected"],
  ["hex IPv4 host", linkValue(external("https://0x7f.1/")), "rejected"],
  ["single-label host", linkValue(external("https://localhost/")), "rejected"],
  ["markup in the url", linkValue(external('https://example.com/"><script>alert(1)</script>')), "rejected"],
  ["backtick in the url", linkValue(external("https://example.com/\u0060x")), "rejected"],
  ["space in the url", linkValue(external("https://example.com/a b")), "rejected"],
  ["backslash in the url", linkValue(external("https://example.com\\@evil.example/")), "rejected"],
  ["bidi override in the url", linkValue(external("https://example.com/\u202e")), "rejected"],
  ["mailto smuggled as external", linkValue(external("mailto:a@example.com")), "rejected"],
  ["unknown page id", linkValue(internalTo("page_0000000000000000000000zzz0")), "rejected"],
  ["page id of another kind", linkValue(internalTo(IDS.faq)), "rejected"],
  ["fragment with markup", linkValue(internalTo(IDS.aboutPage, "<script>")), "rejected"],
  ["fragment with a hash", linkValue(internalTo(IDS.aboutPage, "#team")), "rejected"],
  ["missing fragment key", linkValue({ kind: "internal", pageId: IDS.aboutPage }), "rejected"],
  ["email with a query", linkValue({ kind: "email", address: "a@example.com?cc=b@example.com" }), "rejected"],
  ["email with a scheme", linkValue({ kind: "email", address: "mailto:a@example.com" }), "rejected"],
  ["phone not E.164", linkValue({ kind: "phone", number: "555-0100" }), "rejected"],
  ["phone with a scheme", linkValue({ kind: "phone", number: "tel:+15555550100" }), "rejected"],
  ["unknown kind", linkValue({ kind: "javascript", url: "alert(1)" }), "rejected"],
  ["no destination", { label: "x", target: "same_window" }, "rejected"],
  ["target as an HTML value", linkValue(internalTo(IDS.aboutPage), "_blank"), "rejected"],
  ["label not a string", linkValue(internalTo(IDS.aboutPage), "same_window", 3), "rejected"],
  ["not an object", "https://example.com/", "rejected"],
  ["backslash in the path", linkValue(external("https://example.com/a\\b")), "accepted"],
  ["2048 code points of url, more UTF-16 units than that", linkValue(external("https://example.com/" + ASTRAL_PATH)), "accepted"],
  ["2049 code points of url", linkValue(external("https://example.com/" + "a".repeat(2029))), "rejected"],
  ["uppercase host", linkValue(external("https://Example.COM/x")), "accepted"],
  ["punycode host", linkValue(external("https://xn--bcher-kva.example/")), "accepted"],
  ["query braces and pipes", linkValue(external("https://example.com/a?q={x}|y^z&w=1#frag")), "accepted"],
  ["a new-window link", linkValue(external("https://example.com/"), "new_window"), "accepted"],
  // Since contract 0.13.0 no internal destination may name a generated page.
  ["a generated page", linkValue(internalTo(IDS.servicePage)), "rejected"],
  ["a generated page with a fragment", linkValue(internalTo(IDS.servicePage, "team")), "rejected"],
  ["a static page with a fragment", linkValue(internalTo(IDS.aboutPage, "team")), "accepted"],
  ["label with markup", linkValue(internalTo(IDS.aboutPage), "same_window", "<script>alert(1)</script>"), "accepted"],
  ["empty label", linkValue(internalTo(IDS.aboutPage), "same_window", ""), "rejected"],
];

const LABEL_ONLY_REFUSALS = new Set(["label not a string", "empty label"]);

export function documentWith(block: unknown): JsonObject {
  return { type: "doc", content: [block] };
}

export function paragraphWithMarks(marks: unknown): JsonObject {
  return documentWith({ type: "paragraph", content: [{ type: "text", text: "x", marks }] });
}

/** Rich-text documents: grammar edges, and link marks carrying the link variants above. */
export const ADVERSARIAL_DOCUMENTS: readonly [string, unknown, Outcome][] = [
  ["root not doc", { type: "paragraph", content: [] }, "rejected"],
  ["empty document", { type: "doc", content: [] }, "rejected"],
  ["unknown block", documentWith({ type: "image", attrs: { src: "/x.png" } }), "rejected"],
  ["html block", documentWith({ type: "html", content: [{ type: "text", text: "<script>" }] }), "rejected"],
  ["heading level 0", documentWith({ type: "heading", attrs: { level: 0 }, content: [{ type: "text", text: "x" }] }), "rejected"],
  ["heading level 1", documentWith({ type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "x" }] }), "accepted"],
  ["heading level 1.5", documentWith({ type: "heading", attrs: { level: 1.5 }, content: [{ type: "text", text: "x" }] }), "rejected"],
  ["heading level 4", documentWith({ type: "heading", attrs: { level: 4 }, content: [{ type: "text", text: "x" }] }), "rejected"],
  ["heading without attrs", documentWith({ type: "heading", content: [{ type: "text", text: "x" }] }), "rejected"],
  ["list holding a paragraph", documentWith({ type: "bullet_list", content: [{ type: "paragraph", content: [{ type: "text", text: "x" }] }] }), "rejected"],
  ["blockquote holding a list", documentWith({ type: "blockquote", content: [{ type: "bullet_list", content: [] }] }), "rejected"],
  ["unknown inline", documentWith({ type: "paragraph", content: [{ type: "hard_break" }] }), "rejected"],
  ["text without text", documentWith({ type: "paragraph", content: [{ type: "text" }] }), "rejected"],
  ["unknown mark", paragraphWithMarks([{ type: "underline" }]), "rejected"],
  ["duplicate mark", paragraphWithMarks([{ type: "bold" }, { type: "bold" }]), "rejected"],
  ["marks not a list", paragraphWithMarks({ type: "bold" }), "rejected"],
  ["javascript: link mark", paragraphWithMarks([{ type: "link", destination: external("javascript:alert(1)"), target: "same_window" }]), "rejected"],
  ["markup in a link mark href", paragraphWithMarks([{ type: "link", destination: external("https://example.com/<script>"), target: "same_window" }]), "rejected"],
  ["link mark to an unknown page", paragraphWithMarks([{ type: "link", destination: internalTo("page_0000000000000000000000zzz0"), target: "same_window" }]), "rejected"],
  ["link mark with an HTML target", paragraphWithMarks([{ type: "link", destination: internalTo(IDS.aboutPage), target: "_top" }]), "rejected"],
  ["a marks key holding undefined", paragraphWithMarks(undefined), "rejected"],
  ["link mark to a generated page", paragraphWithMarks([{ type: "link", destination: internalTo(IDS.servicePage), target: "same_window" }]), "rejected"],
  ["bold italic link", paragraphWithMarks([{ type: "italic" }, { type: "link", destination: internalTo(IDS.aboutPage, "team"), target: "new_window" }, { type: "bold" }]), "accepted"],
  // Every link variant again as a prose link mark. A mark carries no label, so
  // a label-only refusal does not carry over; everything else does, a
  // generated page included (one predicate decides both since 0.13.0).
  ...ADVERSARIAL_LINKS.flatMap(([name, value, outcome]): [string, unknown, Outcome][] => {
    const link = value as JsonObject;
    if (typeof link !== "object" || link === null || !("destination" in link)) return [];
    const markOutcome = LABEL_ONLY_REFUSALS.has(name) ? "accepted" : outcome;
    return [["link mark: " + name, paragraphWithMarks([{ type: "link", destination: link.destination, target: link.target }]), markOutcome]];
  }),
];
