import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_FORM_KEY,
  EMAIL_PATTERN,
  isValidEmail,
  isValidPhone,
  parseLeadFields,
  resolveFormKey,
} from "./leadValidation.ts";

test("isValidEmail rejects no-TLD garbage the HTML5 type=email accepts", () => {
  assert.equal(isValidEmail("you@company.com"), true);
  assert.equal(isValidEmail("me@x"), false);
  assert.equal(isValidEmail("foo@bar"), false);
  assert.equal(EMAIL_PATTERN.includes("^"), false);
});

test("phone must be exactly 10 digits, not optional", () => {
  assert.equal(isValidPhone("(555) 123-4567"), true);
  assert.equal(isValidPhone("555123"), false);
  const missingPhone = parseLeadFields({
    firstName: "Weston",
    lastName: "Hayes",
    email: "weston@example.com",
    phone: "",
  });
  assert.equal(missingPhone.ok, false);
  const missingEmail = parseLeadFields({
    firstName: "Weston",
    lastName: "Hayes",
    email: "",
    phone: "(555) 123-4567",
  });
  assert.equal(missingEmail.ok, false);
});

test("parseLeadFields requires firstName lastName email and phone", () => {
  const ok = parseLeadFields({
    firstName: "Charlotte",
    lastName: "Davis",
    email: "charlotte@example.com",
    phone: "4055551212",
    budget: "yes",
  });
  assert.equal(ok.ok, true);
  if (ok.ok) {
    assert.equal(ok.fields.phone, "4055551212");
    assert.equal(ok.fields.extra.budget, "yes");
  }
});

test("resolveFormKey accepts a key the site declared", () => {
  const declared = ["contact-form", "careers-application"];
  for (const key of declared) {
    assert.equal(resolveFormKey(declared, { formKey: key }), key);
  }
});

test("resolveFormKey refuses anything the site did not declare", () => {
  // The browser is the only thing that can send this, so an unconstrained
  // value would let a visitor choose which of the customer's inboxes receives
  // their submission. Unrecognised falls back rather than rejecting: the lead
  // is worth more than the precision of its label.
  const declared = ["contact-form", "careers-application"];
  for (const smuggled of [
    "estimating-only",
    "Contact-Form",
    "contact-form ",
    "",
    42,
    null,
    undefined,
    ["careers-application"],
    { toString: () => "careers-application" },
  ]) {
    assert.equal(
      resolveFormKey(declared, { formKey: smuggled }),
      DEFAULT_FORM_KEY,
      `${JSON.stringify(smuggled)} was accepted as a form key`,
    );
  }
});

test("resolveFormKey defaults a site that declared nothing", () => {
  assert.equal(
    resolveFormKey([], { formKey: "contact-form" }),
    DEFAULT_FORM_KEY,
  );
});

test("parseLeadFields keeps formKey out of the forwarded form_data", () => {
  // Left in `extra` it rides inside form_data and renders as a field called
  // "Form Key" in the customer's notification email, on top of travelling
  // correctly at the top level.
  const parsed = parseLeadFields({
    firstName: "Ada",
    lastName: "Lovelace",
    email: "ada@example.com",
    phone: "2065550134",
    formKey: "careers-application",
  });

  assert.equal(parsed.ok, true);
  assert.equal("formKey" in parsed.fields.extra, false);
});

test("resolveFormKey accepts either spelling of the field", () => {
  // <LeadForm /> sends `formKey`; MEGA's wire name and anything hand-written
  // or bot-written sends `form_key`. Accepting one and not the other turns the
  // other into a silent contact-form.
  const declared = ["contact-form", "careers-application"];
  assert.equal(
    resolveFormKey(declared, { formKey: "careers-application" }),
    "careers-application",
  );
  assert.equal(
    resolveFormKey(declared, { form_key: "careers-application" }),
    "careers-application",
  );
});

test("resolveFormKey prefers formKey when a payload carries both", () => {
  // Arbitrary but fixed, so two spellings never make the result depend on key
  // order. `formKey` wins because it is what the template's own form sends.
  const declared = ["contact-form", "careers-application", "newsletter"];
  assert.equal(
    resolveFormKey(declared, {
      formKey: "careers-application",
      form_key: "newsletter",
    }),
    "careers-application",
  );
});

test("parseLeadFields keeps both spellings out of the forwarded form_data", () => {
  for (const field of ["formKey", "form_key"]) {
    const parsed = parseLeadFields({
      firstName: "Ada",
      lastName: "Lovelace",
      email: "ada@example.com",
      phone: "2065550134",
      [field]: "careers-application",
    });
    assert.equal(parsed.ok, true);
    assert.equal(field in parsed.fields.extra, false, `${field} leaked`);
  }
});

test("resolveFormKey lets an explicit formKey refuse, even beside a valid alias", () => {
  // `formKey` wins whenever both are supplied, and a non-string is refused.
  // Selecting with `??` broke both at once: an explicitly sent null read as
  // absent and the alias took over.
  const declared = ["contact-form", "careers-application"];
  for (const payload of [
    { formKey: null, form_key: "careers-application" },
    { formKey: undefined, form_key: "careers-application" },
    { formKey: "", form_key: "careers-application" },
    { formKey: 0, form_key: "careers-application" },
    { formKey: false, form_key: "careers-application" },
  ]) {
    assert.equal(
      resolveFormKey(declared, payload),
      DEFAULT_FORM_KEY,
      `${JSON.stringify(payload)} let the alias override an explicit formKey`,
    );
  }

  // The alias still applies when formKey is genuinely absent.
  assert.equal(
    resolveFormKey(declared, { form_key: "careers-application" }),
    "careers-application",
  );
});
