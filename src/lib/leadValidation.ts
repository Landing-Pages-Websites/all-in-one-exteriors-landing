import { MAX_UPLOAD_FILES, UPLOAD_KEYS_FIELD } from "./leadUploads";
/**
 * Website lead-field contract — same email/phone rules as landing-page-forms
 * Hard Rules #4 and #4b. Shared by the form UI, the submit hook, and `/api/lead`.
 */

export const EMAIL_PATTERN =
  "[A-Za-z0-9._%+\\-]+@[A-Za-z0-9.\\-]+\\.[A-Za-z]{2,}";
export const EMAIL_REGEX = new RegExp(`^${EMAIL_PATTERN}$`);

export const HONEYPOT_FIELD_NAME = "company_website";

export const isValidEmail = (value: unknown): boolean =>
  typeof value === "string" && EMAIL_REGEX.test(value.trim());

export function formatPhone(value: string): string {
  const digits = value.replace(/\D/g, "").slice(0, 10);
  if (digits.length === 0) return "";
  if (digits.length <= 3) return `(${digits}`;
  if (digits.length <= 6) return `(${digits.slice(0, 3)}) ${digits.slice(3)}`;
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
}

export function isValidPhone(value: string): boolean {
  return value.replace(/\D/g, "").length === 10;
}

export function phoneDigits(value: string): string {
  return value.replace(/\D/g, "").slice(0, 10);
}

export interface ValidatedLeadFields {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  extra: Record<string, string>;
  /** Storage keys for files already uploaded, in the order they were chosen. */
  uploadKeys: string[];
}

/**
 * What MEGA stamps a submission with when it declares no usable form key.
 *
 * Also what `<LeadForm />` sends by default, so a site that never declares a
 * second form keeps the registry row and routing rule it already has.
 */
export const DEFAULT_FORM_KEY = "contact-form";

/**
 * Which of the site's forms produced this lead.
 *
 * The browser is the only thing that can send this, so it is checked against
 * what the site itself declared: an unconstrained value would let a visitor
 * choose which of the customer's inboxes receives their submission. Anything
 * unrecognised falls back rather than rejecting, matching MEGA's own stance
 * that the lead is worth more than the precision of its label.
 */
export function resolveFormKey(
  declared: readonly string[],
  payload: Record<string, unknown>,
): string {
  // Both spellings are accepted. `formKey` is what this template's own
  // <LeadForm /> sends; `form_key` is the wire name MEGA uses downstream and
  // what a hand-written client or a provisioning bot naturally reaches for.
  // Accepting one and not the other means the other silently resolves to
  // contact-form, which reads as routing not working rather than as a typo.
  // Selected on PRESENCE, not on truthiness. `??` treats an explicitly sent
  // `"formKey": null` as absent, so `{"formKey": null, "form_key": "x"}`
  // would resolve to `x` — the alias overriding an explicit refusal.
  const value = "formKey" in payload ? payload.formKey : payload.form_key;
  if (typeof value !== "string") return DEFAULT_FORM_KEY;
  return declared.includes(value) ? value : DEFAULT_FORM_KEY;
}

const MAX_NAME = 200;

/**
 * Storage keys the browser reports having uploaded.
 *
 * Only shape is checked. Whether a key really belongs to this site is not
 * knowable here and is not guessed at: MEGA attaches a file to a lead only when
 * the key's own customer segment matches the lead's customer, so a key from
 * anywhere else is discarded there rather than trusted here.
 *
 * Anything unexpected yields no keys, which costs the attachments and never the
 * enquiry.
 */
function parseUploadKeys(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const keys: string[] = [];
  for (const entry of value) {
    if (typeof entry !== "string") continue;
    if (entry.length === 0 || entry.length > 512) continue;
    if (!entry.startsWith("lead-uploads/")) continue;
    if (entry.includes("..")) continue;
    keys.push(entry);
    if (keys.length >= MAX_UPLOAD_FILES) break;
  }
  return keys;
}

export function parseLeadFields(input: Record<string, unknown>):
  | {
      ok: true;
      fields: ValidatedLeadFields;
    }
  | { ok: false; error: string } {
  const firstName =
    typeof input.firstName === "string" ? input.firstName.trim() : "";
  const lastName =
    typeof input.lastName === "string" ? input.lastName.trim() : "";
  const email = typeof input.email === "string" ? input.email.trim() : "";
  const phoneRaw = typeof input.phone === "string" ? input.phone : "";

  if (!firstName || firstName.length > MAX_NAME) {
    return { ok: false, error: "Please enter your first name." };
  }
  if (!lastName || lastName.length > MAX_NAME) {
    return { ok: false, error: "Please enter your last name." };
  }
  if (!isValidEmail(email)) {
    return {
      ok: false,
      error: "Enter a valid email address (e.g. you@company.com).",
    };
  }
  if (!isValidPhone(phoneRaw)) {
    return { ok: false, error: "Please enter a valid 10-digit phone number." };
  }

  const reserved = new Set([
    "firstName",
    "lastName",
    "email",
    "phone",
    // Both spellings are reserved. `captchaToken` is canonical; `turnstileToken`
    // is the legacy wire name, still sent by every deployed site and by the
    // go-live form-registration curl. Reserving only the canonical one would let
    // the legacy field ride into `form_data` and render as a lead field called
    // "Turnstile Token" in the customer's notification email.
    "captchaToken",
    "turnstileToken",
    "context",
    "uploadKeys",
    "uploadCapability",
    "uploadSignedKeys",
    // Reserved so it can never arrive as an ordinary extra field. Upload keys
    // are forwarded under this name, and a client that could set it directly
    // would be naming stored objects rather than describing its own files.
    UPLOAD_KEYS_FIELD,
    HONEYPOT_FIELD_NAME,
    // Form identity is transport, not lead data. Left in `extra` it would ride
    // inside `form_data` and render as a field called "Form Key" in the
    // customer's notification email, on top of travelling correctly top-level.
    "formKey",
    "form_key",
  ]);
  const extra: Record<string, string> = {};
  for (const [key, value] of Object.entries(input)) {
    if (reserved.has(key) || typeof value !== "string") continue;
    extra[key] = value;
  }

  return {
    ok: true,
    fields: {
      firstName,
      lastName,
      email,
      phone: phoneDigits(phoneRaw),
      extra,
      uploadKeys: parseUploadKeys(input.uploadKeys),
    },
  };
}

/**
 * The challenge token this submission presents, under either wire name.
 *
 * `captchaToken` is canonical. `turnstileToken` is accepted because every
 * deployed site, and the go-live form-registration `curl` in the provisioning
 * runbook, still send that name; dropping it would break lead capture on the
 * whole existing fleet the moment this file is synced.
 *
 * Selected on PRESENCE, exactly as `resolveFormKey` above selects its own alias,
 * and for the same reason: `??` would treat an explicitly sent
 * `"captchaToken": null` as absent, so `{"captchaToken": null,
 * "turnstileToken": "x"}` would resolve to `x` — the legacy alias overriding an
 * explicit refusal. Presence also makes an empty `captchaToken` fail closed
 * rather than falling through.
 */
export function readCaptchaToken(payload: Record<string, unknown>): unknown {
  return "captchaToken" in payload
    ? payload.captchaToken
    : payload.turnstileToken;
}
