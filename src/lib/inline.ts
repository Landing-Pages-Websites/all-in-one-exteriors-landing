/**
 * The inline model, and the two URL policies that decide what may reach an
 * `href` or a `src`.
 *
 * A leaf module on purpose. Both the HTML walker (`html-blocks.ts`) and the
 * markdown grammar (`markdown-text.ts`) build `InlineNode`s, and both have to
 * make the same call about a URL, so neither can own these without the other
 * importing it back.
 */

export type InlineNode =
  | { kind: "text"; value: string }
  | { kind: "strong"; value: string }
  | { kind: "em"; value: string }
  | { kind: "code"; value: string }
  | { kind: "link"; text: string; href: string }
  | { kind: "image"; src: string; alt: string };

/** The readable text of a run of inline nodes, with every mark resolved. */
export function plainText(nodes: InlineNode[]): string {
  return nodes
    .map((node) => {
      if (node.kind === "link") return node.text;
      if (node.kind === "image") return node.alt;
      return node.value;
    })
    .join("");
}

/**
 * `strong` and `em` carry a plain string, so a mark wrapping a link or an image
 * cannot be expressed. Keep the children: losing bold is cosmetic, printing
 * `[text](href)` or an `<a>` at the reader is a leak.
 */
export function collapseMark(kind: "strong" | "em", children: InlineNode[]): InlineNode[] {
  if (children.length === 1 && children[0].kind === "text") {
    return [{ kind, value: children[0].value }];
  }
  return children;
}

const NON_SPACE = /\S/;

function isWhitespaceOnly(node: InlineNode): boolean {
  return node.kind === "text" && !NON_SPACE.test(node.value);
}

/** Drop empty edges and trim the outermost text, so a paragraph does not open
 * or close with the whitespace that separated its tags in the source. */
export function trimInline(nodes: InlineNode[]): InlineNode[] {
  let start = 0;
  let end = nodes.length;
  while (start < end && isWhitespaceOnly(nodes[start])) start += 1;
  while (end > start && isWhitespaceOnly(nodes[end - 1])) end -= 1;
  if (start === end) return [];
  const trimmed = nodes.slice(start, end);
  const first = trimmed[0];
  if (first.kind === "text") trimmed[0] = { kind: "text", value: first.value.trimStart() };
  const last = trimmed[trimmed.length - 1];
  if (last.kind === "text") {
    trimmed[trimmed.length - 1] = { kind: "text", value: last.value.trimEnd() };
  }
  return trimmed;
}

/**
 * A `src` `next/image` can render, or null.
 *
 * A relative path (`images/a.png`, routine in WordPress-migrated bodies) makes
 * `next/image` throw "Failed to parse src", which takes the whole post page
 * down, so it is rooted rather than passed through. Any other scheme is refused
 * outright: an unrenderable image is a gap, an unparseable one is an outage.
 *
 * A protocol-relative `//host/a.png` passes as written, the same as it does in
 * `linkHref`: it names no scheme, so there is no scheme to refuse, and `next/image`
 * resolves it against the page.
 */
export function imageSrc(raw: string): string | null {
  const value = raw.trim();
  if (value === "") return null;
  if (value.startsWith("/")) return value;
  if (/^https?:\/\//i.test(value)) return value;
  if (/^data:image\//i.test(value)) return value;
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(value)) return null;
  return `/${value}`;
}

const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f-\u009f\s]+/g;

/**
 * An `href` safe to put in the page, or null.
 *
 * Turning an `<a href="javascript:…">` that used to render as escaped text into
 * a real anchor is new reach, so the scheme is allow-listed rather than
 * blocked: relative paths, fragments and protocol-relative URLs pass,
 * `http`/`https`/`mailto`/`tel` pass, and anything else is refused. Whitespace
 * and control characters are stripped first, because `" JaVaScript:x"` and
 * `"java\tscript:x"` are the same URL to a browser and a different string to a
 * naive test.
 *
 * Every caller reads a URL out of ONE contiguous run of source text — an
 * attribute value the scanner delimited, or a markdown destination with no
 * markup inside it. Nothing assembles a URL out of parts, so there is no
 * transformation left for this check to run on the wrong side of.
 */
export function linkHref(raw: string): string | null {
  const value = raw.trim();
  if (value === "") return null;
  const scheme = value.replace(CONTROL_CHARACTERS, "").match(/^([a-zA-Z][a-zA-Z0-9+.-]*):/);
  if (scheme === null) return value;
  return ["http", "https", "mailto", "tel"].includes(scheme[1].toLowerCase()) ? value : null;
}
