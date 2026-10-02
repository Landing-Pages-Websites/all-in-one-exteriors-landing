/**
 * Field contract and qualification rules for the roof-replacement LP form.
 *
 * Six visible fields, each sent once in `form_data` under its DOM `name`.
 * Qualification is derived metadata and never renames or repeats a field.
 */

export const DECISION_MAKER_OPTIONS = ["Yes", "No"] as const;
export const ROOF_STATUS_OPTIONS = [
  "Yes, leaking or damaged",
  "No, standard replacement",
] as const;

export type DecisionMaker = (typeof DECISION_MAKER_OPTIONS)[number];
export type RoofStatus = (typeof ROOF_STATUS_OPTIONS)[number];

export interface RoofLeadFields {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  decisionMaker: string;
  roofStatus: string;
}

export type RoofLeadFieldName = keyof RoofLeadFields;

export const EMPTY_ROOF_LEAD: RoofLeadFields = {
  firstName: "",
  lastName: "",
  email: "",
  phone: "",
  decisionMaker: "",
  roofStatus: "",
};

export interface RoofLeadQualification {
  qualified: boolean;
  isDisqualified: boolean;
  urgency: "urgent" | "standard";
}

const QUALIFYING_DECISION_MAKER: DecisionMaker = "Yes";
const URGENT_ROOF_STATUS: RoofStatus = "Yes, leaking or damaged";

/**
 * Homeowner or authorized decision maker qualifies; anyone else is stored but
 * disqualified. Roof status never disqualifies: it only flags urgency.
 */
export function qualifyRoofLead(fields: RoofLeadFields): RoofLeadQualification {
  const qualified = fields.decisionMaker === QUALIFYING_DECISION_MAKER;
  return {
    qualified,
    isDisqualified: !qualified,
    urgency: fields.roofStatus === URGENT_ROOF_STATUS ? "urgent" : "standard",
  };
}

const PHONE_DIGIT_COUNT = 10;
/** NANP area codes never start with 1, so a leading 1 is always the country code. */
const LEADING_COUNTRY_CODE = /^1/;
const NATIONAL_NUMBER = /^[2-9]\d{9}$/;

/** HTML `pattern` for the formatted value; the browser anchors it itself. */
export const PHONE_PATTERN = "\\(\\d{3}\\) \\d{3}-\\d{4}";

/** Ten national digits, accepting an optional leading +1 / 1 country code. */
export function phoneDigits(value: string): string {
  return value
    .replace(/\D/g, "")
    .replace(LEADING_COUNTRY_CODE, "")
    .slice(0, PHONE_DIGIT_COUNT);
}

/** Formats as the visitor types, ending at exactly (XXX) XXX-XXXX. */
export function formatPhone(value: string): string {
  const digits = phoneDigits(value);
  if (digits.length === 0) return "";
  if (digits.length <= 3) return `(${digits}`;
  if (digits.length <= 6) return `(${digits.slice(0, 3)}) ${digits.slice(3)}`;
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
}

/** Exactly 10 national digits once an optional +1 is removed. */
export function isValidPhone(value: string): boolean {
  const raw = value.replace(/\D/g, "");
  const national =
    raw.length === PHONE_DIGIT_COUNT + 1 ? raw.replace(LEADING_COUNTRY_CODE, "") : raw;
  return national.length === PHONE_DIGIT_COUNT && NATIONAL_NUMBER.test(national);
}
