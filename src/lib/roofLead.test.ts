import assert from "node:assert/strict";
import test from "node:test";
import {
  formatPhone,
  isValidPhone,
  phoneDigits,
  qualifyRoofLead,
  EMPTY_ROOF_LEAD,
} from "./roofLead";

const QA_SENTINEL = "+15555550100";

test("QA sentinel +1 phone renders formatted and persists 10 digits", () => {
  assert.equal(formatPhone(QA_SENTINEL), "(555) 555-0100");
  assert.equal(phoneDigits(QA_SENTINEL), "5555550100");
  assert.equal(isValidPhone(formatPhone(QA_SENTINEL)), true);
  assert.equal(isValidPhone(QA_SENTINEL), true);
});

test("phone formats progressively and caps at 10 digits", () => {
  assert.equal(formatPhone("555"), "(555");
  assert.equal(formatPhone("55555"), "(555) 55");
  assert.equal(formatPhone("+1 (555) 555-01009999"), "(555) 555-0100");
  assert.equal(formatPhone(""), "");
});

test("phone validation rejects short and malformed numbers", () => {
  assert.equal(isValidPhone("(555) 555-010"), false);
  assert.equal(isValidPhone("0555550100"), false);
  assert.equal(isValidPhone("25555501001"), false);
});

const lead = (decisionMaker: string, roofStatus: string) => ({
  ...EMPTY_ROOF_LEAD,
  decisionMaker,
  roofStatus,
});

test("decision maker Yes qualifies for both roof statuses", () => {
  assert.deepEqual(qualifyRoofLead(lead("Yes", "Yes, leaking or damaged")), {
    qualified: true,
    isDisqualified: false,
    urgency: "urgent",
  });
  assert.deepEqual(qualifyRoofLead(lead("Yes", "No, standard replacement")), {
    qualified: true,
    isDisqualified: false,
    urgency: "standard",
  });
});

test("decision maker No is disqualified but keeps its urgency flag", () => {
  assert.deepEqual(qualifyRoofLead(lead("No", "Yes, leaking or damaged")), {
    qualified: false,
    isDisqualified: true,
    urgency: "urgent",
  });
  assert.equal(qualifyRoofLead(lead("No", "No, standard replacement")).qualified, false);
});
