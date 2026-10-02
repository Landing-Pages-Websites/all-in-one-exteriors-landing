import type { ManagedSiteContentDocument } from "./content.js";
import type { ManagedSiteContractV1 } from "./contract.js";
import { ManagedSiteContractError } from "./errors.js";
import { managedRenderedH1Sources, managedSeoPageIds } from "./rendered-headings.js";

function fail(code: string, message: string): never {
  throw new ManagedSiteContractError(code, message);
}

function isRichText(contract: ManagedSiteContractV1, fieldId: string): boolean {
  return contract.pages.some((page) => page.sections.some((section) =>
    section.fields.some((field) => field.id === fieldId && field.type === "rich_text")));
}

/**
 * A page's rich-text H1 is exactly what its outline declares, on every page,
 * static or generated, read from every field the page renders. A rich-text
 * field's level lives in its content, which the CMS edits, so: a level 1
 * block renders only in a field the outline names at level 1
 * (`CONTENT_RICH_TEXT_H1_UNDECLARED`), and a rich-text field the outline
 * names at level 1 must render exactly one: none is `CONTENT_RICH_TEXT_H1_MISSING`,
 * more is `CONTENT_RICH_TEXT_H1_REPEATED`, so an edit can neither delete or
 * demote the H1 the outline promises nor add a second H1 block to it.
 */
export function validateManagedContentLevelOneHeadings(
  contract: ManagedSiteContractV1,
  content: ManagedSiteContentDocument,
): void {
  for (const pageId of managedSeoPageIds(contract)) {
    const sources = managedRenderedH1Sources(contract, content, pageId);
    const undeclared = sources.richTextFields.find((fieldId) => !sources.outlined.includes(fieldId));
    if (undeclared !== undefined) {
      fail("CONTENT_RICH_TEXT_H1_UNDECLARED", `A level 1 heading in ${undeclared} is not the H1 its page's outline declares: ${pageId}`);
    }
    const [repeated] = sources.repeatedRichTextFields;
    if (repeated !== undefined) {
      fail("CONTENT_RICH_TEXT_H1_REPEATED", `${repeated} renders more than one level 1 heading: ${pageId}`);
    }
    const missing = sources.outlined.find((fieldId) => isRichText(contract, fieldId) && !sources.richTextFields.includes(fieldId));
    if (missing !== undefined) {
      fail("CONTENT_RICH_TEXT_H1_MISSING", `The outline declares ${missing} as the H1, and it renders no level 1 heading: ${pageId}`);
    }
  }
}
