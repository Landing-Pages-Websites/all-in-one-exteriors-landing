import ts from "typescript";

import type { RichTextCandidate } from "./candidates.js";
import type { MarkTemplate, RichTextTemplates } from "./inline-block.js";

/**
 * The rewrite of one formatted block rendered in place.
 *
 * The block's children are replaced by ONE read of the value, and each mark in
 * it renders through the element the source used for that mark, carrying
 * `data-gomega-mark`, as each line break does through the source's `<br>`,
 * carrying `data-gomega-break`. The element itself keeps its tag and
 * attributes and gains the field annotation, exactly as a text field's element
 * does. What renders is the source's own markup plus annotations, which is
 * what the parity gate compares.
 */

export interface RichTextRewrite {
  /** The element's own start, which is how the rewrite keys one annotation per element. */
  readonly elementStart: number;
  readonly start: number;
  readonly end: number;
  readonly text: string;
  /** Where the annotation spread goes: after the element's own attributes. */
  readonly annotationAt: number;
  readonly annotation: string;
}

const TEMPLATE_ORDER = ["bold", "italic", "link", "hard_break"] as const;

/** A mark wraps its children; a break is one self-closing element and takes none. */
function templateEntry(kind: (typeof TEMPLATE_ORDER)[number], template: MarkTemplate): string {
  if (kind === "hard_break") return `${kind}: () => ${template.open}`;
  const parameters = kind === "link" ? "(children, link)" : "(children)";
  return `${kind}: ${parameters} => ${template.open}{children}${template.close}`;
}

function templatesText(templates: RichTextTemplates): string {
  const entries = TEMPLATE_ORDER.flatMap((kind) => {
    const template = templates[kind];
    return template === undefined ? [] : [templateEntry(kind, template)];
  });
  return `{ ${entries.join(", ")} }`;
}

/** The JSX element that starts exactly at `offset`, as a candidate recorded it. */
export function jsxElementAt(source: ts.SourceFile, offset: number): ts.JsxElement | null {
  let hit: ts.JsxElement | null = null;
  const visit = (node: ts.Node): void => {
    if (hit !== null) return;
    if (ts.isJsxElement(node) && node.getStart(source) === offset) {
      hit = node;
      return;
    }
    if (node.getStart(source) <= offset && node.getEnd() > offset) ts.forEachChild(node, visit);
  };
  ts.forEachChild(source, visit);
  return hit;
}

/**
 * The edits for one block, or why there are none.
 *
 * Refused rather than attempted: a document that is not one inline block (a
 * list, which nothing renders in place), an element that is not where the
 * reading recorded it, and a component rather than a host element, whose
 * annotation would mark the call site instead of what renders.
 */
export function richTextRewrite(
  source: ts.SourceFile,
  candidate: RichTextCandidate,
  fieldId: string,
  isHostTag: (tag: string) => boolean,
): RichTextRewrite | string {
  if (candidate.templates === null) return "rich text that is not one inline block is not rewired";
  const element = jsxElementAt(source, candidate.location.offset);
  if (element === null) return "no formatted element at the recorded offset";
  const opening = element.openingElement;
  if (!isHostTag(opening.tagName.getText(source))) {
    return "formatted block is rendered by a component";
  }
  const id = JSON.stringify(fieldId);
  return {
    elementStart: opening.getStart(source),
    start: opening.getEnd(),
    end: element.closingElement.getStart(source),
    text: `{managedRichText(${id}, ${templatesText(candidate.templates)}).content}`,
    annotationAt: opening.attributes.getEnd(),
    annotation: ` {...managedRichTextAttributes(${id})}`,
  };
}
