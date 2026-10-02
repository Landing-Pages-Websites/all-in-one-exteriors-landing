import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
  parseManagedFieldDescriptor,
  validateManagedFieldValue,
} from "../src/index.js";
import { isCompatibilityFieldWidened } from "../src/contract-compatibility-constraints.js";
import { linkField, richTextField, stableId } from "./schema-fixtures.js";

/**
 * Where a link may point, held to the adversarial table megaseo-web's CMS rule
 * (`managed_site_cms_link_destination_violation` and `cms_link_rules.ts`) is
 * held to. A verdict this package reaches differently from the CMS is content
 * the CMS saves and Site Guard then refuses, or the reverse.
 *
 * Only the outcome is compared: this package reports its own error codes, and
 * the table's `reason` is the CMS's wording.
 */
type Outcome = "accepted" | "rejected";
type Constraints = Readonly<Record<string, unknown>>;
type FieldKind = "link" | "rich_text";

interface CaseBase {
  readonly name: string;
  readonly base: string;
  readonly constraints?: Constraints;
  readonly expected: { readonly outcome: Outcome };
}

interface DestinationCase extends CaseBase {
  readonly destination: unknown;
}

interface LabelCase {
  readonly name: string;
  readonly label: string;
  readonly newlines: "forbid" | "allow";
  readonly expected: { readonly outcome: Outcome };
}

interface CompatibilityCase {
  readonly name: string;
  readonly fieldKind: FieldKind;
  readonly production: Constraints;
  readonly candidate: Constraints;
  readonly expected: { readonly widened: boolean };
}

interface LinkRuleTable {
  readonly pageId: string;
  readonly bases: Readonly<Record<string, Constraints>>;
  readonly policyCases: readonly CaseBase[];
  readonly destinationCases: readonly DestinationCase[];
  readonly labelCases: readonly LabelCase[];
  readonly compatibility: { readonly cases: readonly CompatibilityCase[] };
}

const TABLE = JSON.parse(
  readFileSync(new URL("./cms-link-rule-cases.json", import.meta.url), "utf8"),
) as LinkRuleTable;

function baseConstraints(base: string): Constraints {
  const constraints = TABLE.bases[base];
  assert.ok(constraints, `unknown base ${base}`);
  return constraints;
}

function kindOf(base: string): FieldKind {
  return base.startsWith("rich") ? "rich_text" : "link";
}

function fieldFor(kind: FieldKind, constraints: Constraints): Record<string, unknown> {
  if (kind === "link") return { ...linkField(), constraints };
  const base = richTextField();
  // A field whose links are off cannot also claim the capability to edit them.
  const capabilities = (base.capabilities as readonly string[]).filter(
    (capability) => capability !== "rich_text.link.edit" || constraints.allowLinks === true,
  );
  return { ...base, capabilities, constraints };
}

function caseField(entry: CaseBase): Record<string, unknown> {
  const constraints = { ...baseConstraints(entry.base), ...entry.constraints };
  return fieldFor(kindOf(entry.base), constraints);
}

function outcome(check: () => unknown): Outcome {
  try {
    check();
    return "accepted";
  } catch {
    return "rejected";
  }
}

function linkValue(destination: unknown, label = "Read more"): Record<string, unknown> {
  return {
    fieldId: stableId("field"),
    owner: { kind: "site" },
    type: "link",
    value: { label, destination, target: "same_window" },
  };
}

function richTextValue(destination: unknown): Record<string, unknown> {
  return {
    fieldId: stableId("field"),
    owner: { kind: "site" },
    type: "rich_text",
    value: {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            {
              type: "text",
              text: "Read more",
              marks: [{ type: "link", destination, target: "same_window" }],
            },
          ],
        },
      ],
    },
  };
}

function destinationOutcome(entry: DestinationCase): Outcome {
  const field = caseField(entry);
  // The table states only contracts this package accepts, so a field that fails
  // to parse is a broken case rather than a refused destination.
  parseManagedFieldDescriptor(field);
  const value =
    kindOf(entry.base) === "link"
      ? linkValue(entry.destination)
      : richTextValue(entry.destination);
  return outcome(() => validateManagedFieldValue(field, value));
}

function labelOutcome(entry: LabelCase): Outcome {
  const open = baseConstraints("link_open");
  const labelConstraints = {
    ...(open.labelConstraints as Constraints),
    newlines: entry.newlines,
  };
  const field = fieldFor("link", { ...open, labelConstraints });
  parseManagedFieldDescriptor(field);
  const value = linkValue({ kind: "external", url: "https://example.org/" }, entry.label);
  return outcome(() => validateManagedFieldValue(field, value));
}

function compatibilityField(kind: FieldKind, overrides: Constraints) {
  const base = baseConstraints(kind === "link" ? "link_declared" : "rich_declared");
  const constraints: Record<string, unknown> = { ...base, ...overrides };
  if (!("externalHostPolicy" in overrides)) delete constraints.externalHostPolicy;
  return {
    kind: "rendered" as const,
    descriptor: parseManagedFieldDescriptor(fieldFor(kind, constraints)),
  };
}

describe("link rules shared with the CMS", () => {
  it("runs tables that exercise both outcomes", () => {
    for (const cases of [TABLE.policyCases, TABLE.destinationCases, TABLE.labelCases]) {
      const outcomes = new Set(cases.map((entry) => entry.expected.outcome));
      assert.deepEqual([...outcomes].sort(), ["accepted", "rejected"]);
    }
    const widened = new Set(TABLE.compatibility.cases.map((entry) => entry.expected.widened));
    assert.deepEqual([...widened].sort(), [false, true]);
  });

  it("names the page every internal case links to", () => {
    assert.equal(TABLE.pageId, stableId("page"));
  });

  for (const entry of TABLE.policyCases) {
    it(`agrees on the policy: ${entry.name}`, () => {
      const field = caseField(entry);
      assert.equal(outcome(() => parseManagedFieldDescriptor(field)), entry.expected.outcome);
    });
  }

  for (const entry of TABLE.destinationCases) {
    it(`agrees on the destination: ${entry.name}`, () => {
      assert.equal(destinationOutcome(entry), entry.expected.outcome);
    });
  }

  /**
   * Compatibility calls a declared list of DNS names -> any_https a widening, so
   * it must be one on real destinations: whatever a declared base admits, the
   * any_https base of the same field kind admits too.
   */
  it("admits under any_https every destination a declared base admits", () => {
    const admittedUnderDeclared = TABLE.destinationCases.filter(
      (entry) =>
        entry.base.endsWith("_declared") &&
        entry.constraints === undefined &&
        destinationOutcome(entry) === "accepted",
    );
    assert.ok(admittedUnderDeclared.length > 0);
    for (const entry of admittedUnderDeclared) {
      const base = entry.base.replace("_declared", "_open");
      assert.equal(destinationOutcome({ ...entry, base }), "accepted", entry.name);
    }
  });

  for (const entry of TABLE.labelCases) {
    it(`agrees on the label: ${entry.name}`, () => {
      assert.equal(labelOutcome(entry), entry.expected.outcome);
    });
  }

  for (const entry of TABLE.compatibility.cases) {
    it(`agrees on compatibility: ${entry.name}`, () => {
      const production = compatibilityField(entry.fieldKind, entry.production);
      const candidate = compatibilityField(entry.fieldKind, entry.candidate);
      assert.equal(isCompatibilityFieldWidened(production, candidate), entry.expected.widened);
    });
  }
});
