import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  parseManagedAbsoluteHttpsUrl,
  parseManagedFieldDescriptor,
  parseManagedRichTextDocument,
  validateManagedFieldValue,
  resolveManagedImageAltText,
  validateManagedImageValue,
} from "../src/index.js";
import {
  assetSlot,
  headingTextField,
  imageField,
  imageValue,
  invalidLinkValues,
  invalidRichTextContent,
  linkedListDocument,
  linkContentValue,
  linkField,
  plainTextField,
  richTextContentValue,
  richTextDocument,
  richTextField,
  richTextParagraph,
  stableId,
} from "./schema-fixtures.js";

describe("managed field schemas", () => {
  /**
   * A fragment is part of a URL, and an external link is where it belongs: the
   * browser reads it and the server never sees it. A CANONICAL must not carry
   * one, because it names the page rather than a place inside it. One schema was
   * answering both questions with the canonical's answer, so a real site's
   * `https://host/kit.html#page/1` could not be represented at all.
   */
  it("accepts a fragment on an external destination and still refuses one on a canonical", () => {
    assert.doesNotThrow(() =>
      validateManagedFieldValue(
        linkField(),
        linkContentValue({
          label: "Media kit",
          destination: { kind: "external", url: "https://example.com/kit.html#page/1" },
          target: "new_window",
        }),
      ),
    );
    // The canonical bound is unchanged: a fragment there is still refused.
    assert.throws(() => parseManagedAbsoluteHttpsUrl("https://example.com/page#section"));
    assert.doesNotThrow(() => parseManagedAbsoluteHttpsUrl("https://example.com/page"));
  });

  it("rejects unknown keys, coercion, invalid classifications, and capabilities", () => {
    for (const invalid of [
      { ...plainTextField(), ignored: true },
      { ...plainTextField(), classification: "ignore" },
      { ...plainTextField(), capabilities: [] },
      { ...plainTextField(), capabilities: ["image.upload"] },
      { ...plainTextField(), capabilities: ["text.edit", "text.edit"] },
      { ...plainTextField(), constraints: { minLength: "1", maxLength: 10, newlines: "forbid" } },
    ]) {
      assert.throws(() => parseManagedFieldDescriptor(invalid));
    }

    assert.doesNotThrow(() =>
      parseManagedFieldDescriptor({
        ...plainTextField(),
        classification: "code_owned_interface",
        capabilities: [],
      }),
    );
  });

  it("uses the C1 hostile-input boundary before schema validation", () => {
    let getterCalls = 0;
    const hostile = { ...plainTextField() };
    Object.defineProperty(hostile, "type", {
      enumerable: true,
      get() {
        getterCalls += 1;
        return "plain_text";
      },
    });

    assert.throws(
      () => parseManagedFieldDescriptor(hostile),
      (error: unknown) =>
        error instanceof Error && error.message.includes("accessors"),
    );
    assert.equal(getterCalls, 0);
  });

  it("keeps heading semantics fixed outside the editable string", () => {
    const parsed = parseManagedFieldDescriptor(headingTextField());
    assert.equal(parsed.type, "heading_text");
    if (parsed.type === "heading_text") assert.equal(parsed.semanticLevel, 2);
    assert.throws(() =>
      parseManagedFieldDescriptor({ ...headingTextField(), semanticLevel: 0 }),
    );
  });

  it("accepts only the bounded rich-text grammar", () => {
    assert.doesNotThrow(() =>
      parseManagedRichTextDocument(richTextDocument([richTextParagraph])),
    );
    assert.doesNotThrow(() => parseManagedRichTextDocument(linkedListDocument()));
    assert.doesNotThrow(() =>
      parseManagedRichTextDocument(
        richTextDocument(Array.from({ length: 300 }, () => richTextParagraph)),
      ),
    );
    assert.throws(() =>
      parseManagedRichTextDocument(
        richTextDocument(Array.from({ length: 1_000 }, () => richTextParagraph)),
      ),
    );

    for (const child of invalidRichTextContent) {
      assert.throws(() =>
        parseManagedRichTextDocument(richTextDocument([child])),
      );
    }

    assert.throws(() =>
      parseManagedRichTextDocument({
        type: "doc",
        content: [{ type: "paragraph", content: [{ type: "text", text: "x".repeat(131_073) }] }],
      }),
    );
  });

  it("enforces text, rich-text, and link constraints against content values", () => {
    assert.throws(() =>
      validateManagedFieldValue(plainTextField(), {
        fieldId: stableId("field"),
        owner: { kind: "site" },
        type: "plain_text",
        value: "line one\nline two",
      }),
    );

    const richValue = richTextContentValue("https://untrusted.example/path");
    assert.throws(() => validateManagedFieldValue(richTextField(), richValue));

    const markedLinkValue = structuredClone(richValue);
    const richDocument = markedLinkValue.value as Record<string, unknown>;
    const richParagraph = (richDocument.content as Record<string, unknown>[])[0];
    const richText = (richParagraph.content as Record<string, unknown>[])[0];
    const richMarks = richText.marks as Record<string, unknown>[];
    // Point the link at a permitted host so the refusal below can only come from
    // the formatting mark, which this field does not allow.
    const linkMark = richMarks.find((mark) => mark.type === "link");
    assert.ok(linkMark);
    linkMark.destination = { kind: "external", url: "https://example.com" };
    richText.marks = [...richMarks, { type: "italic" }];
    const boldOnlyField = structuredClone(richTextField());
    (boldOnlyField.constraints as Record<string, unknown>).allowedMarks = ["bold"];
    assert.throws(() => validateManagedFieldValue(boldOnlyField, markedLinkValue));

    assert.throws(() =>
      validateManagedFieldValue(
        linkField(),
        linkContentValue({
          label: "Unsafe",
          destination: { kind: "external", url: "https://evil.example" },
          target: "same_window",
        }),
      ),
    );

    for (const value of invalidLinkValues) {
      assert.throws(() =>
        validateManagedFieldValue(linkField(), linkContentValue(value)),
      );
    }

    for (const label of ["", "x".repeat(81), "line one\nline two"]) {
      assert.throws(() =>
        validateManagedFieldValue(
          linkField(),
          linkContentValue({
            label,
            destination: { kind: "external", url: "https://example.com" },
            target: "same_window",
          }),
        ),
      );
    }
  });

  it("keeps every descriptor-valid link-label length representable", () => {
    for (const length of [1_999, 2_000]) {
      const field = linkField();
      const constraints = field.constraints as Record<string, unknown>;
      constraints.labelConstraints = {
        minLength: 1,
        maxLength: length,
        newlines: "forbid",
      };
      assert.doesNotThrow(() => parseManagedFieldDescriptor(field));
      assert.doesNotThrow(() =>
        validateManagedFieldValue(
          field,
          linkContentValue({
            label: "x".repeat(length),
            destination: { kind: "external", url: "https://example.com" },
            target: "same_window",
          }),
        ),
      );
    }

    const oversizedField = linkField();
    const constraints = oversizedField.constraints as Record<string, unknown>;
    constraints.labelConstraints = {
      minLength: 1,
      maxLength: 2_001,
      newlines: "forbid",
    };
    assert.throws(() => parseManagedFieldDescriptor(oversizedField));
    assert.throws(() =>
      validateManagedFieldValue(
        linkField(),
        linkContentValue({
          label: "x".repeat(2_001),
          destination: { kind: "external", url: "https://example.com" },
          target: "same_window",
        }),
      ),
    );
  });

  it("keeps declared rich-text capabilities aligned with local policy", () => {
    for (const invalid of [
      {
        capabilities: ["text.edit", "rich_text.mark.bold"],
        allowedMarks: [],
        allowLinks: false,
      },
      {
        capabilities: ["text.edit", "rich_text.mark.italic"],
        allowedMarks: ["bold"],
        allowLinks: false,
      },
      {
        capabilities: ["text.edit", "rich_text.link.edit"],
        allowedMarks: [],
        allowLinks: false,
      },
    ]) {
      const field = structuredClone(richTextField());
      field.capabilities = invalid.capabilities;
      const constraints = field.constraints as Record<string, unknown>;
      constraints.allowedMarks = invalid.allowedMarks;
      constraints.allowLinks = invalid.allowLinks;
      constraints.allowedExternalHosts = [];
      constraints.allowedTargets = [];
      assert.throws(() => parseManagedFieldDescriptor(field));
    }
  });

  it("uses one semantic rich-text node count at every validation layer", () => {
    const direct = richTextDocument([
      { type: "paragraph", content: [{ type: "text", text: "x" }] },
    ]);
    const linked = richTextDocument([
      {
        type: "paragraph",
        content: [{
          type: "text",
          text: "x",
          marks: [{
            type: "link",
            destination: { kind: "external", url: "https://example.com" },
            target: "same_window",
          }],
        }],
      },
    ]);
    const listed = richTextDocument([
      {
        type: "bullet_list",
        content: [{
          type: "list_item",
          content: [{
            type: "paragraph",
            content: [{ type: "text", text: "x" }],
          }],
        }],
      },
    ]);
    for (const [document, exactNodes] of [[direct, 3], [linked, 3], [listed, 5]] as const) {
      const field = structuredClone(richTextField());
      (field.constraints as Record<string, unknown>).maxNodes = exactNodes;
      assert.doesNotThrow(() =>
        validateManagedFieldValue(field, {
          fieldId: stableId("field"), owner: { kind: "site" }, type: "rich_text", value: document,
        }),
      );
      (field.constraints as Record<string, unknown>).maxNodes = exactNodes - 1;
      assert.throws(() =>
        validateManagedFieldValue(field, {
          fieldId: stableId("field"), owner: { kind: "site" }, type: "rich_text", value: document,
        }),
      );
    }
  });

  for (const testCase of [
    { semantics: { kind: "informative" }, altText: "Gutter", expected: "Gutter" },
    { semantics: { kind: "decorative" }, altText: "", expected: "" },
    { semantics: { kind: "fixed_alt", altText: "Company logo" }, altText: null, expected: "Company logo" },
  ]) {
    it(`resolves rendered alt text for a ${testCase.semantics.kind} slot`, () => {
      assert.equal(
        resolveManagedImageAltText(
          { ...assetSlot(), semantics: testCase.semantics },
          { ...imageValue(), altText: testCase.altText },
        ),
        testCase.expected,
      );
    });
  }

  for (const testCase of [
    { semantics: { kind: "informative" }, altText: null },
    { semantics: { kind: "informative" }, altText: "  " },
    { semantics: { kind: "decorative" }, altText: "Not empty" },
    { semantics: { kind: "fixed_alt", altText: "Company logo" }, altText: "Override" },
  ]) {
    it(`refuses rendered alt text for a ${testCase.semantics.kind} slot given ${JSON.stringify(testCase.altText)}`, () => {
      assert.throws(() =>
        resolveManagedImageAltText(
          { ...assetSlot(), semantics: testCase.semantics },
          { ...imageValue(), altText: testCase.altText },
        ),
      );
    });
  }

  it("enforces image dimensions, ratios, policies, bytes, and alt semantics", () => {
    assert.doesNotThrow(() => validateManagedImageValue(assetSlot(), imageValue()));

    for (const invalid of [
      { ...imageValue(), width: 700 },
      { ...imageValue(), height: 900 },
      { ...imageValue(), bytes: 3_000_000 },
      { ...imageValue(), mimeType: "image/gif" },
      { ...imageValue(), altText: "" },
      { ...imageValue(), crop: { x: -0.1, y: 0, width: 1, height: 1 } },
    ]) {
      assert.throws(() => validateManagedImageValue(assetSlot(), invalid));
    }

    assert.doesNotThrow(() => parseManagedFieldDescriptor(imageField()));

    assert.doesNotThrow(() =>
      validateManagedImageValue(
        { ...assetSlot(), semantics: { kind: "decorative" } },
        { ...imageValue(), altText: "" },
      ),
    );
    assert.doesNotThrow(() =>
      validateManagedImageValue(
        { ...assetSlot(), semantics: { kind: "fixed_alt", altText: "Fixed" } },
        { ...imageValue(), altText: null },
      ),
    );

    assert.throws(() =>
      validateManagedImageValue(
        assetSlot(),
        { ...imageValue(), mimeType: "image/jpeg" },
      ),
    );
    assert.doesNotThrow(() =>
      validateManagedImageValue(
        { ...assetSlot(), acceptedMimeTypes: ["image/jpeg"] },
        imageValue(),
      ),
    );
  });
});
