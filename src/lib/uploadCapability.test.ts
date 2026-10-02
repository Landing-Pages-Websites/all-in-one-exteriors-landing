import assert from "node:assert/strict";
import test from "node:test";
import {
  issueUploadCapability,
  submissionBinding,
  uploadCapabilityAuthorizes,
} from "./uploadCapability.ts";

process.env.TURNSTILE_SECRET_KEY = "test-signing-secret";

const KEY_A = "lead-uploads/pending/cust/u1/a.pdf";
const KEY_B = "lead-uploads/pending/cust/u2/b.pdf";
const TOKEN_ONE = "turnstile-token-for-submission-one";
const TOKEN_TWO = "turnstile-token-for-submission-two";

function capabilityFor(keys: string[], token: string): string {
  const value = issueUploadCapability(keys, submissionBinding(token));
  assert.ok(value, "expected a capability");
  return value;
}

test("a capability authorises the submission it was bound to", () => {
  const cap = capabilityFor([KEY_A, KEY_B], TOKEN_ONE);
  assert.equal(
    uploadCapabilityAuthorizes(cap, [KEY_A, KEY_B], [KEY_A, KEY_B], TOKEN_ONE),
    true,
  );
});

// THE finding. Both submissions belong to the same customer and both solve a
// real challenge, so nothing downstream distinguishes them: the binding is the
// only thing that can.
test("a key signed for one submission cannot be claimed by another", () => {
  const cap = capabilityFor([KEY_A], TOKEN_ONE);
  assert.equal(
    uploadCapabilityAuthorizes(cap, [KEY_A], [KEY_A], TOKEN_TWO),
    false,
    "a different submission must not claim this key",
  );
  // And the same key freshly signed for the second submission is fine, so the
  // refusal above is the binding and not a broken fixture.
  const own = capabilityFor([KEY_A], TOKEN_TWO);
  assert.equal(
    uploadCapabilityAuthorizes(own, [KEY_A], [KEY_A], TOKEN_TWO),
    true,
  );
});

test("a capability cannot be replayed onto a later submission", () => {
  // Replay needs the same token, which Cloudflare has already consumed, so the
  // submission is refused before this is consulted. Asserted anyway: the
  // binding must not be the only thing standing between a replay and success.
  const cap = capabilityFor([KEY_A], TOKEN_ONE);
  for (const token of [TOKEN_TWO, `${TOKEN_ONE} `, TOKEN_ONE.toUpperCase()]) {
    assert.equal(
      uploadCapabilityAuthorizes(cap, [KEY_A], [KEY_A], token),
      false,
      token,
    );
  }
});

test("a capability authorises a subset, including none", () => {
  // Uploads happen after signing, so an exact match would refuse a submission
  // whose files failed to upload and lose an otherwise valid enquiry.
  const cap = capabilityFor([KEY_A, KEY_B], TOKEN_ONE);
  for (const declared of [[KEY_A], [KEY_B], []]) {
    assert.equal(
      uploadCapabilityAuthorizes(cap, [KEY_A, KEY_B], declared, TOKEN_ONE),
      true,
      JSON.stringify(declared),
    );
  }
});

test("a capability never authorises a key outside its signed set", () => {
  const cap = capabilityFor([KEY_A], TOKEN_ONE);
  assert.equal(
    uploadCapabilityAuthorizes(cap, [KEY_A], [KEY_A, KEY_B], TOKEN_ONE),
    false,
  );
  assert.equal(
    uploadCapabilityAuthorizes(cap, [KEY_A], [KEY_B], TOKEN_ONE),
    false,
  );
});

test("a capability cannot be re-pointed at a different signed set", () => {
  const cap = capabilityFor([KEY_A], TOKEN_ONE);
  assert.equal(
    uploadCapabilityAuthorizes(cap, [KEY_B], [KEY_B], TOKEN_ONE),
    false,
  );
  assert.equal(
    uploadCapabilityAuthorizes(cap, [KEY_A, KEY_B], [KEY_A], TOKEN_ONE),
    false,
  );
});

test("key order does not change the authorisation", () => {
  const cap = capabilityFor([KEY_A, KEY_B], TOKEN_ONE);
  assert.equal(
    uploadCapabilityAuthorizes(cap, [KEY_B, KEY_A], [KEY_B], TOKEN_ONE),
    true,
  );
});

test("malformed capabilities are refused", () => {
  const malformed: unknown[] = [
    null,
    undefined,
    "",
    123,
    "no-dot",
    "v2.AAAA",
    "v1.AAAA.extra",
    "v1.",
    "x".repeat(600),
  ];
  for (const cap of malformed) {
    assert.equal(
      uploadCapabilityAuthorizes(cap, [KEY_A], [KEY_A], TOKEN_ONE),
      false,
      JSON.stringify(cap),
    );
  }
});

test("a missing or non-string submission token refuses", () => {
  const cap = capabilityFor([KEY_A], TOKEN_ONE);
  for (const token of [null, undefined, "", 42, {}]) {
    assert.equal(
      uploadCapabilityAuthorizes(cap, [KEY_A], [KEY_A], token),
      false,
      JSON.stringify(token),
    );
  }
});

test("a capability signed with a different secret is refused", () => {
  const cap = capabilityFor([KEY_A], TOKEN_ONE);
  process.env.TURNSTILE_SECRET_KEY = "another-secret";
  try {
    assert.equal(
      uploadCapabilityAuthorizes(cap, [KEY_A], [KEY_A], TOKEN_ONE),
      false,
    );
  } finally {
    process.env.TURNSTILE_SECRET_KEY = "test-signing-secret";
  }
});

test("nothing is issued or authorised without a signing key", () => {
  const cap = capabilityFor([KEY_A], TOKEN_ONE);
  const saved = process.env.TURNSTILE_SECRET_KEY;
  delete process.env.TURNSTILE_SECRET_KEY;
  try {
    assert.equal(
      issueUploadCapability([KEY_A], submissionBinding(TOKEN_ONE)),
      null,
    );
    assert.equal(
      uploadCapabilityAuthorizes(cap, [KEY_A], [KEY_A], TOKEN_ONE),
      false,
    );
  } finally {
    process.env.TURNSTILE_SECRET_KEY = saved;
  }
});

test("a binding that is not a sha256 digest mints nothing", () => {
  // The signing route validates this too; refusing here as well means a caller
  // cannot supply a short or attacker-chosen binding to weaken the coupling.
  for (const binding of ["", "nothex", "ABCDEF".repeat(10), "a".repeat(63)]) {
    assert.equal(issueUploadCapability([KEY_A], binding), null, binding);
  }
});

// --- provider neutrality -------------------------------------------------
//
// A reCAPTCHA site has NO `TURNSTILE_SECRET_KEY`: Enterprise authenticates
// assessments at the project level, so no per-site captcha secret is deployed.
// Before `LEAD_UPLOAD_SIGNING_SECRET` existed, `signingKey()` returned null on
// exactly that configuration, no capability was minted, and every attachment
// was dropped while the lead itself still sent. These tests fail if that
// regresses, because nothing downstream would notice.

test("a capability is minted on a site with no turnstile secret", () => {
  const savedTurnstile = process.env.TURNSTILE_SECRET_KEY;
  const savedLegacy = process.env.TURNSTILE_SECRET;
  delete process.env.TURNSTILE_SECRET_KEY;
  delete process.env.TURNSTILE_SECRET;
  process.env.LEAD_UPLOAD_SIGNING_SECRET = "recaptcha-site-signing-secret";
  try {
    const cap = issueUploadCapability([KEY_A], submissionBinding(TOKEN_ONE));
    assert.ok(cap, "a reCAPTCHA site must still mint upload capabilities");
    assert.equal(
      uploadCapabilityAuthorizes(cap, [KEY_A], [KEY_A], TOKEN_ONE),
      true,
    );
    // The binding still holds on this path — the new secret must not weaken it.
    assert.equal(
      uploadCapabilityAuthorizes(cap, [KEY_A], [KEY_A], TOKEN_TWO),
      false,
      "the submission binding must survive the provider-neutral secret",
    );
  } finally {
    delete process.env.LEAD_UPLOAD_SIGNING_SECRET;
    if (savedTurnstile !== undefined) {
      process.env.TURNSTILE_SECRET_KEY = savedTurnstile;
    }
    if (savedLegacy !== undefined) process.env.TURNSTILE_SECRET = savedLegacy;
  }
});

test("no signing secret of any kind mints nothing", () => {
  const savedTurnstile = process.env.TURNSTILE_SECRET_KEY;
  delete process.env.TURNSTILE_SECRET_KEY;
  try {
    assert.equal(
      issueUploadCapability([KEY_A], submissionBinding(TOKEN_ONE)),
      null,
      "a site with no secret must not mint an authorisation nothing can verify",
    );
  } finally {
    if (savedTurnstile !== undefined) {
      process.env.TURNSTILE_SECRET_KEY = savedTurnstile;
    }
  }
});

// The dedicated secret wins, so rotating a captcha key cannot silently change
// which secret is signing capabilities.
test("the dedicated secret takes precedence over the turnstile secret", () => {
  process.env.LEAD_UPLOAD_SIGNING_SECRET = "dedicated-secret";
  try {
    const cap = issueUploadCapability([KEY_A], submissionBinding(TOKEN_ONE));
    assert.ok(cap);
    delete process.env.LEAD_UPLOAD_SIGNING_SECRET;
    assert.equal(
      uploadCapabilityAuthorizes(cap, [KEY_A], [KEY_A], TOKEN_ONE),
      false,
      "a capability signed with the dedicated secret must not verify under the turnstile one",
    );
  } finally {
    delete process.env.LEAD_UPLOAD_SIGNING_SECRET;
  }
});
