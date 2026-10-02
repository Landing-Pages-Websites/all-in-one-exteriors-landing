import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

/**
 * Guards the ordering rule that makes attachments safe.
 *
 * Uploads must be signed before the form is submitted, because the submission
 * names the keys it uploaded. A challenge token is single-use under BOTH
 * providers (Cloudflare consumes it at siteverify; reCAPTCHA returns
 * invalidReason DUPE on a second assessment), so if signing
 * spent the submission's token then any signing failure would leave a valid
 * enquiry with nothing to present and it would be refused — the visitor sees a
 * security-check error on a form they filled in correctly.
 *
 * The rule: signing uses a SECOND token obtained for it, and the submission's
 * own token is never spent on an upload.
 *
 * That is an ordering property across three files, not something a unit test of
 * any one of them can observe, so it is asserted against the source. A future
 * change that shares one token between both calls fails here.
 */
const HOOK = readFileSync("src/hooks/useMegaLeadForm.ts", "utf8");
const FORM = readFileSync("src/components/LeadForm.tsx", "utf8");
const WIDGET = readFileSync("src/components/CaptchaWidget.tsx", "utf8");
const SUBMIT_ROUTE = readFileSync("src/app/api/lead/route.ts", "utf8");
const SIGN_ROUTE = readFileSync("src/app/api/lead/upload-url/route.ts", "utf8");

test("signing takes a token of its own, not the submission's", () => {
  // The submission's own token is what it depends on. If it were handed to the
  // signing helper, a signing failure would cost the enquiry.
  assert.ok(
    !/uploadAttachments\([^)]*formData\.(turnstileToken|captchaToken)/s.test(
      HOOK,
    ),
    "signing must not be handed the submission's own token",
  );
  assert.match(
    HOOK,
    /uploadAttachments\(files, signingToken, binding\)/,
    "signing should use the separately obtained token",
  );
});

test("attachments are skipped when no signing token could be obtained", () => {
  // Without a second token the files are dropped, never the submission.
  assert.match(HOOK, /signingToken !== null/);
});

test("the form asks for two tokens, naming a different action for each", () => {
  assert.match(FORM, /requestSigningToken/);
  assert.match(
    FORM,
    /getToken\("lead_submit"\)/,
    "the submission mints its own",
  );
  assert.match(FORM, /getToken\("lead_upload"\)/, "signing mints its own");
});

// The mechanism that makes two asks yield two DIFFERENT tokens moved into
// CaptchaWidget when the form became provider-neutral. The property is the same
// one this file has always guarded, so it is asserted at its new home rather
// than dropped with the code that used to implement it.
test("the widget hands out each token once", () => {
  // Turnstile pushes one token on render. Returning it twice would give the
  // submission and the signing call the same challenge, and the second request
  // would be refused as a replay.
  assert.match(
    WIDGET,
    /turnstileTokenRef\.current = null;/,
    "the held token must be consumed when taken",
  );
  assert.match(
    WIDGET,
    /turnstileRef\.current\?\.reset\(\)/,
    "an empty slot must reset the widget for a fresh token",
  );
  // Bounded, so a challenge that never completes cannot hang the submission.
  assert.match(WIDGET, /TURNSTILE_REFRESH_TIMEOUT_MS/);
});

test("a token arriving after a reset goes to the caller waiting for it", () => {
  // A reset fires the same callback. Without routing that to the waiting
  // resolver, the fresh token would be stored as unclaimed and the caller would
  // time out while the token it asked for sat in the slot.
  assert.match(WIDGET, /waitingRef/);
});

test("both routes verify a challenge and act on the result", () => {
  // Presence of the call proves nothing: a route could verify and ignore the
  // answer. Each must also refuse on failure, so the assertion is on the
  // refusal, not on the call.
  for (const [name, source] of [
    ["submit route", SUBMIT_ROUTE],
    ["signing route", SIGN_ROUTE],
  ] as const) {
    assert.match(source, /verifyCaptchaToken/, name);
    assert.match(
      source,
      /const challenge = await verifyCaptchaToken\(/,
      `${name} must keep the challenge result`,
    );
    assert.match(
      source,
      /if \(!challenge\.ok\) \{\s*return jsonError\(challenge\.error, 403\);/,
      `${name} must refuse when the challenge fails`,
    );
  }

  // Each route names a DISTINCT action, so a token minted to sign uploads can
  // never be presented as the submission's own challenge. reCAPTCHA reports the
  // action a token was minted for and the verifier compares it; without
  // different actions here that check would pass for either token and the
  // second-token design would be decorative.
  assert.match(
    SUBMIT_ROUTE,
    /"lead_submit"/,
    "submit route must name its action",
  );
  assert.match(
    SIGN_ROUTE,
    /"lead_upload"/,
    "signing route must name its action",
  );
  assert.ok(
    !/"lead_upload"/.test(SUBMIT_ROUTE) && !/"lead_submit"/.test(SIGN_ROUTE),
    "the two routes must not share an action",
  );

  // The capability is bound to the submission's own challenge, which both
  // providers make single-use, so there is no free-standing authorization to
  // replay.
  for (const [name, source] of [
    ["submit route", SUBMIT_ROUTE],
    ["signing route", SIGN_ROUTE],
    ["hook", HOOK],
  ] as const) {
    assert.ok(
      !/ticket/i.test(source),
      `${name} must not reintroduce an unbound authorization token`,
    );
  }
});

test("declared upload keys are honoured only with a bound capability", () => {
  // Forwarding `parsed.fields.uploadKeys` directly would accept any
  // syntactically valid key the caller supplied, which is the whole defect.
  assert.match(SUBMIT_ROUTE, /uploadCapabilityAuthorizes\(/);
  assert.match(
    SUBMIT_ROUTE,
    /\{ \.\.\.parsed\.fields, uploadKeys \}/,
    "the forwarded keys must be the capability-checked set",
  );
  assert.ok(
    !/forwardLeadToKeystone\(parsed\.fields,/.test(SUBMIT_ROUTE),
    "unchecked fields must not be forwarded",
  );
});

test("the capability is bound by hash, never by the submission's token", () => {
  // The signing route must never receive the token the submission depends on.
  assert.match(SIGN_ROUTE, /submissionBinding/);
  assert.match(SIGN_ROUTE, /\[0-9a-f\]\{64\}/);
  assert.match(HOOK, /submissionBinding\(submitToken\)/);
  // And the hook must find the token under either wire name, or the binding is
  // null and every attachment is dropped while the lead still sends.
  assert.match(HOOK, /formData\.captchaToken \?\? formData\.turnstileToken/);
});

test("the signing route verifies before it signs", () => {
  // Verification after the signing call would hand out upload permission to an
  // unverified caller and only then check.
  const verifyAt = SIGN_ROUTE.indexOf("verifyCaptchaToken");
  const signAt = SIGN_ROUTE.indexOf("UPLOAD_URL_ENDPOINT, {");
  assert.ok(verifyAt > -1 && signAt > -1);
  assert.ok(verifyAt < signAt, "challenge must be verified before signing");
});

// The widget must not decide which provider a deployment uses. It did, from the
// reCAPTCHA site key alone, so a Turnstile deployment still carrying the
// reCAPTCHA staging sentinel rendered no widget, reported itself ready and sent
// the bypass placeholder — while the server routed it to Turnstile and rejected
// every submission and every upload. Both sides were individually right; there
// were simply two rules.
//
// It takes the route next.config computed with the server's rule (proven in
// client-route.test.ts) and imports nothing from provider.ts: running the rule
// in the browser shipped the sentinel literal, which fails production go-live.
test("the widget reads the shared route rather than deciding for itself", () => {
  assert.match(
    WIDGET,
    /clientVerificationRoute\(\)/,
    "the widget must take the route the server would take",
  );
  // Any spelling that reaches provider.ts (alias, relative, or verify.ts's
  // re-export) counts; only type imports are erased from the bundle.
  const captchaValueImports = [
    ...WIDGET.matchAll(/\b(import|export)\b([^;]*?)\bfrom\s*["']([^"']+)["']|\bimport\s*\(\s*["']([^"']+)["']/gu),
  ].filter((match) => {
    const specifier = match[3] ?? match[4];
    const typeOnly = match[2] !== undefined && /^\s*type\b/u.test(match[2]);
    return /captcha\/(?!client-route$)/u.test(specifier) && !typeOnly;
  });
  assert.deepEqual(
    captchaValueImports.map((match) => match[0]),
    [],
    "the widget must take captcha values only from client-route.ts; provider.ts carries the sentinel literal",
  );
  assert.ok(
    !/isStagingBypassSiteKey/.test(WIDGET),
    "the widget must not evaluate the bypass condition itself",
  );
  assert.ok(
    !/configuredCaptchaProvider/.test(WIDGET),
    "provider and site key must not be combined into a second routing rule here",
  );
});
