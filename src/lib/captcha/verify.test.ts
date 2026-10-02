import assert from "node:assert/strict";
import test, { describe } from "node:test";
import {
  STAGING_BYPASS_SITE_KEY,
  configuredVerificationRoute,
} from "./provider.ts";
import { bypassAuthorizes, routeVerification } from "./verify.ts";

const REAL_KEY = "6LctvMAtAAAAAH1iItpNhBJlndxMsyENl8dQioKo";

test("turnstile provider routes to turnstile", () => {
  assert.deepEqual(
    routeVerification({ provider: "turnstile", recaptchaSiteKey: undefined }),
    { kind: "turnstile" },
  );
});

test("recaptcha with a real key routes to recaptcha", () => {
  assert.deepEqual(
    routeVerification({ provider: "recaptcha", recaptchaSiteKey: REAL_KEY }),
    { kind: "recaptcha" },
  );
});

test("recaptcha with the sentinel routes to bypass", () => {
  assert.deepEqual(
    routeVerification({
      provider: "recaptcha",
      recaptchaSiteKey: STAGING_BYPASS_SITE_KEY,
    }),
    { kind: "bypass" },
  );
});

// An unconfigured provider must never fall back to a working path.
test("unconfigured provider rejects", () => {
  const route = routeVerification({
    provider: "unconfigured",
    recaptchaSiteKey: REAL_KEY,
  });
  assert.equal(route.kind, "reject");
});

// The sentinel is meaningless under Turnstile, and must not open a bypass there
// — otherwise the one env var that is supposed to be reCAPTCHA-only becomes a
// second, undocumented way to disable Turnstile.
test("the sentinel does not open a bypass on the turnstile path", () => {
  assert.deepEqual(
    routeVerification({
      provider: "turnstile",
      recaptchaSiteKey: STAGING_BYPASS_SITE_KEY,
    }),
    { kind: "turnstile" },
  );
});

test("recaptcha with no site key rejects rather than bypassing", () => {
  for (const key of [undefined, "", "   "]) {
    const route = routeVerification({
      provider: "recaptcha",
      recaptchaSiteKey: key,
    });
    assert.equal(
      route.kind,
      "reject",
      `a missing site key must reject, got ${route.kind}`,
    );
  }
});

// Near-miss keys must reach the real verifier, not the bypass.
test("a key that merely contains the sentinel is not a bypass", () => {
  for (const near of [
    `${STAGING_BYPASS_SITE_KEY}-live`,
    `x${STAGING_BYPASS_SITE_KEY}`,
    STAGING_BYPASS_SITE_KEY.toUpperCase(),
  ]) {
    assert.deepEqual(
      routeVerification({ provider: "recaptcha", recaptchaSiteKey: near }),
      { kind: "recaptcha" },
      `${near} must not bypass`,
    );
  }
});

test("bypass accepts any non-empty token", () => {
  assert.equal(bypassAuthorizes("provisioning"), true);
  assert.equal(bypassAuthorizes("anything at all"), true);
});

// Even the bypass requires SOMETHING, so a client that forgets the field
// entirely still fails on staging rather than passing silently and hiding a
// wiring bug that production would then discover.
test("bypass still requires a non-empty string token", () => {
  for (const bad of ["", "   ", undefined, null, 42, {}, []]) {
    assert.equal(
      bypassAuthorizes(bad),
      false,
      `${JSON.stringify(bad)} must not authorise`,
    );
  }
});

// THE finding. A Turnstile deployment that still carries the reCAPTCHA staging
// sentinel must route to Turnstile on BOTH sides. When the widget decided
// independently it rendered no widget, reported itself ready, and sent the
// bypass placeholder, while the server routed to Turnstile and rejected every
// submission and every upload — a deployment that looks configured and accepts
// nothing.
describe("configuredVerificationRoute reads the same rule as the widget", () => {
  const saved = {
    provider: process.env.NEXT_PUBLIC_CAPTCHA_PROVIDER,
    siteKey: process.env.NEXT_PUBLIC_RECAPTCHA_SITE_KEY,
  };
  function restore(): void {
    if (saved.provider === undefined)
      delete process.env.NEXT_PUBLIC_CAPTCHA_PROVIDER;
    else process.env.NEXT_PUBLIC_CAPTCHA_PROVIDER = saved.provider;
    if (saved.siteKey === undefined)
      delete process.env.NEXT_PUBLIC_RECAPTCHA_SITE_KEY;
    else process.env.NEXT_PUBLIC_RECAPTCHA_SITE_KEY = saved.siteKey;
  }

  const CASES: ReadonlyArray<{
    readonly name: string;
    readonly provider: string | undefined;
    readonly siteKey: string | undefined;
    readonly expect: string;
  }> = [
    {
      name: "turnstile provider WITH the reCAPTCHA sentinel still routes to turnstile",
      provider: "turnstile",
      siteKey: STAGING_BYPASS_SITE_KEY,
      expect: "turnstile",
    },
    {
      name: "absent provider WITH the sentinel still routes to turnstile",
      provider: undefined,
      siteKey: STAGING_BYPASS_SITE_KEY,
      expect: "turnstile",
    },
    {
      name: "recaptcha provider with the sentinel bypasses",
      provider: "recaptcha",
      siteKey: STAGING_BYPASS_SITE_KEY,
      expect: "bypass",
    },
    {
      name: "recaptcha provider with a real key verifies",
      provider: "recaptcha",
      siteKey: REAL_KEY,
      expect: "recaptcha",
    },
    {
      name: "unconfigured provider rejects whatever the site key is",
      provider: "recaptcah",
      siteKey: STAGING_BYPASS_SITE_KEY,
      expect: "reject",
    },
  ];

  for (const item of CASES) {
    test(item.name, () => {
      if (item.provider === undefined)
        delete process.env.NEXT_PUBLIC_CAPTCHA_PROVIDER;
      else process.env.NEXT_PUBLIC_CAPTCHA_PROVIDER = item.provider;
      if (item.siteKey === undefined)
        delete process.env.NEXT_PUBLIC_RECAPTCHA_SITE_KEY;
      else process.env.NEXT_PUBLIC_RECAPTCHA_SITE_KEY = item.siteKey;
      try {
        assert.equal(configuredVerificationRoute().kind, item.expect);
      } finally {
        restore();
      }
    });
  }
});
