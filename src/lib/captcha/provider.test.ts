import assert from "node:assert/strict";
import test from "node:test";
import {
  STAGING_BYPASS_SITE_KEY,
  isStagingBypassSiteKey,
  resolveCaptchaProvider,
} from "./provider.ts";

/**
 * Provider resolution is the fork every submission passes through, so an
 * unrecognised value must never resolve to "pick one". The table below is the
 * whole contract.
 */
const CASES: ReadonlyArray<{
  readonly name: string;
  readonly value: string | undefined;
  readonly expect: "turnstile" | "recaptcha" | "unconfigured";
}> = [
  // Absent is the documented legacy default: every existing site predates the
  // variable and must keep working untouched.
  { name: "absent", value: undefined, expect: "turnstile" },
  { name: "empty string", value: "", expect: "turnstile" },
  { name: "whitespace only", value: "   ", expect: "turnstile" },
  { name: "turnstile", value: "turnstile", expect: "turnstile" },
  { name: "recaptcha", value: "recaptcha", expect: "recaptcha" },
  // Casing and padding are operator slips, not different providers.
  { name: "RECAPTCHA upper", value: "RECAPTCHA", expect: "recaptcha" },
  { name: "padded", value: "  recaptcha  ", expect: "recaptcha" },
  { name: "Turnstile mixed", value: "TurnStile", expect: "turnstile" },
  // Everything else fails closed. A typo must not silently select a provider,
  // and must not fall back to the legacy default either: absent means "this
  // site predates the flag", a typo means "someone tried to set it".
  { name: "typo recaptcah", value: "recaptcah", expect: "unconfigured" },
  { name: "typo turnstle", value: "turnstle", expect: "unconfigured" },
  { name: "unknown provider", value: "hcaptcha", expect: "unconfigured" },
  { name: "substring of valid", value: "recap", expect: "unconfigured" },
  { name: "valid plus junk", value: "recaptcha-v3", expect: "unconfigured" },
];

for (const item of CASES) {
  test(`provider resolution: ${item.name}`, () => {
    assert.equal(resolveCaptchaProvider(item.value), item.expect);
  });
}

test("the staging bypass key is recognised exactly", () => {
  assert.equal(isStagingBypassSiteKey(STAGING_BYPASS_SITE_KEY), true);
  assert.equal(isStagingBypassSiteKey(` ${STAGING_BYPASS_SITE_KEY} `), true);
});

// A real key that merely CONTAINS the sentinel must not be treated as bypass,
// or the one property the bypass rests on (production can never hold it) stops
// being checkable by inspection.
test("a key containing the sentinel is not the sentinel", () => {
  for (const near of [
    `${STAGING_BYPASS_SITE_KEY}-live`,
    `prefix-${STAGING_BYPASS_SITE_KEY}`,
    STAGING_BYPASS_SITE_KEY.slice(0, -1),
    STAGING_BYPASS_SITE_KEY.toUpperCase(),
    "6LctvMAtAAAAAH1iItpNhBJlndxMsyENl8dQioKo",
    "",
  ]) {
    assert.equal(
      isStagingBypassSiteKey(near),
      false,
      `${near} must not read as the bypass sentinel`,
    );
  }
});
