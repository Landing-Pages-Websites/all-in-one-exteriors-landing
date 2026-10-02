import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { parseRouteKind, resolveClientRoute } from "./client-route.ts";
import { readFileSync } from "node:fs";
import {
  STAGING_BYPASS_SITE_KEY,
  routeVerification,
  type ProviderResolution,
} from "./provider.ts";

const REAL_KEY = `6L${"x".repeat(38)}`;

/**
 * The browser learns the route only from what next.config inlined, so
 * anything that is not exactly a route kind is a build this code did not
 * produce and fails closed: no widget, no token, submit disabled.
 */
const PARSE_CASES: ReadonlyArray<readonly [string | undefined, string]> = [
  ["turnstile", "turnstile"],
  ["recaptcha", "recaptcha"],
  ["bypass", "bypass"],
  ["reject", "reject"],
  // Unset is not garbage: see resolveClientRoute below.
  [undefined, "reject"],
  ["", "reject"],
  ["Bypass", "reject"],
  [" bypass", "reject"],
  ["bypass\n", "reject"],
  ["turnstile-v2", "reject"],
  ["recaptch", "reject"],
  ["unconfigured", "reject"],
  // The raw sentinel or a site key is not a route; it would mean something
  // inlined the key where the kind belongs.
  [STAGING_BYPASS_SITE_KEY, "reject"],
  [REAL_KEY, "reject"],
  ["undefined", "reject"],
  ["toString", "reject"],
  ["__proto__", "reject"],
];

for (const [raw, expected] of PARSE_CASES) {
  test(`parseRouteKind(${JSON.stringify(raw)}) -> ${expected}`, () => {
    assert.equal(parseRouteKind(raw), expected);
  });
}

const PROVIDERS: readonly ProviderResolution[] = ["turnstile", "recaptcha", "unconfigured"];
const SITE_KEYS = [undefined, "", "  ", STAGING_BYPASS_SITE_KEY, ` ${STAGING_BYPASS_SITE_KEY} `, REAL_KEY];

test("every route the server can resolve survives the trip to the browser unchanged", () => {
  const seen = new Set<string>();
  for (const provider of PROVIDERS) {
    for (const recaptchaSiteKey of SITE_KEYS) {
      const { kind } = routeVerification({ provider, recaptchaSiteKey });
      seen.add(kind);
      assert.equal(parseRouteKind(kind), kind, `${provider} / ${String(recaptchaSiteKey)}`);
    }
  }
  // The matrix reached every kind, so the round trip above covers them all.
  assert.deepEqual([...seen].sort(), ["bypass", "recaptcha", "reject", "turnstile"]);
});

const ROOT = fileURLToPath(new URL("../../..", import.meta.url));

/** What next.config.ts inlines for this env, evaluated in a fresh process. */
function inlinedRoute(env: Record<string, string>): string {
  const clean = { ...process.env };
  delete clean.NEXT_PUBLIC_CAPTCHA_PROVIDER;
  delete clean.NEXT_PUBLIC_RECAPTCHA_SITE_KEY;
  delete clean.NEXT_PUBLIC_CAPTCHA_ROUTE;
  return execFileSync(
    process.execPath,
    [
      "--import",
      "tsx",
      "--input-type=module",
      "-e",
      // The root package is CJS, so tsx hands the config back wrapped once.
      'const m = await import("./next.config.ts"); const config = m.default.default ?? m.default; process.stdout.write(String(config.env?.NEXT_PUBLIC_CAPTCHA_ROUTE));',
    ],
    { cwd: ROOT, env: { ...clean, ...env }, encoding: "utf8" },
  );
}

// [name, env, the kind /api/lead resolves for the same env]
const CONFIG_ROWS: ReadonlyArray<readonly [string, Record<string, string>, string]> = [
  ["legacy site, nothing set", {}, "turnstile"],
  ["turnstile", { NEXT_PUBLIC_CAPTCHA_PROVIDER: "turnstile" }, "turnstile"],
  ["production reCAPTCHA", { NEXT_PUBLIC_CAPTCHA_PROVIDER: "recaptcha", NEXT_PUBLIC_RECAPTCHA_SITE_KEY: REAL_KEY }, "recaptcha"],
  ["preview sentinel", { NEXT_PUBLIC_CAPTCHA_PROVIDER: "recaptcha", NEXT_PUBLIC_RECAPTCHA_SITE_KEY: STAGING_BYPASS_SITE_KEY }, "bypass"],
  ["reCAPTCHA with no key", { NEXT_PUBLIC_CAPTCHA_PROVIDER: "recaptcha" }, "reject"],
  ["provider typo", { NEXT_PUBLIC_CAPTCHA_PROVIDER: "recaptcah", NEXT_PUBLIC_RECAPTCHA_SITE_KEY: REAL_KEY }, "reject"],
  ["sentinel under turnstile is still turnstile", { NEXT_PUBLIC_CAPTCHA_PROVIDER: "turnstile", NEXT_PUBLIC_RECAPTCHA_SITE_KEY: STAGING_BYPASS_SITE_KEY }, "turnstile"],
  // A value already in the environment must not override the derivation, or
  // an operator could hand the browser a route the server does not apply.
  ["stale route in env is overridden", { NEXT_PUBLIC_CAPTCHA_PROVIDER: "recaptcha", NEXT_PUBLIC_RECAPTCHA_SITE_KEY: REAL_KEY, NEXT_PUBLIC_CAPTCHA_ROUTE: "bypass" }, "recaptcha"],
];

for (const [name, env, expected] of CONFIG_ROWS) {
  test(`next.config inlines the server's route: ${name} -> ${expected}`, () => {
    assert.equal(inlinedRoute(env), expected);
  });
}

/**
 * Unset means next.config never derived a route: a customer site whose src/
 * was synced but whose own next.config.ts predates this. Rejecting there would
 * take down every lead form on a live site, so the browser falls back to the
 * server's own rule with the bypass switched off. Production holds a real key,
 * so it routes exactly as the server does; an unmigrated preview holding the
 * sentinel renders a widget that cannot load, which QA sees, rather than
 * shipping the comparison.
 */
// [name, inlined route, NEXT_PUBLIC_CAPTCHA_PROVIDER, NEXT_PUBLIC_RECAPTCHA_SITE_KEY, expected]
const CLIENT_ROWS: ReadonlyArray<
  readonly [string, string | undefined, string | undefined, string | undefined, string]
> = [
  ["unset, legacy Turnstile site", undefined, undefined, undefined, "turnstile"],
  ["unset, explicit Turnstile", undefined, "turnstile", undefined, "turnstile"],
  ["unset, production reCAPTCHA", undefined, "recaptcha", REAL_KEY, "recaptcha"],
  ["unset, padded provider", undefined, " ReCaptcha ", REAL_KEY, "recaptcha"],
  ["unset, sentinel is never a bypass", undefined, "recaptcha", STAGING_BYPASS_SITE_KEY, "recaptcha"],
  ["unset, padded sentinel is never a bypass", undefined, "recaptcha", ` ${STAGING_BYPASS_SITE_KEY} `, "recaptcha"],
  ["unset, reCAPTCHA without a key", undefined, "recaptcha", "  ", "reject"],
  ["unset, provider typo", undefined, "recaptcah", REAL_KEY, "reject"],
  // Inlined always wins: the legacy variables are only consulted when
  // next.config never ran.
  ["inlined bypass wins over a real key", "bypass", "recaptcha", REAL_KEY, "bypass"],
  ["inlined turnstile wins over reCAPTCHA env", "turnstile", "recaptcha", REAL_KEY, "turnstile"],
  // Set but not a kind is a build this code did not produce: fail closed.
  ["inlined garbage rejects", "Bypass", "recaptcha", REAL_KEY, "reject"],
  ["inlined empty rejects", "", undefined, undefined, "reject"],
];

for (const [name, inlined, provider, siteKey, expected] of CLIENT_ROWS) {
  test(`resolveClientRoute: ${name} -> ${expected}`, () => {
    assert.equal(resolveClientRoute(inlined, { provider, recaptchaSiteKey: siteKey }), expected);
  });
}

test("the browser-side modules never state the sentinel", () => {
  for (const file of ["client-route.ts", "route-rule.ts"]) {
    const source = readFileSync(new URL(`./${file}`, import.meta.url), "utf8");
    assert.ok(!source.includes(STAGING_BYPASS_SITE_KEY), `${file} carries the sentinel`);
    assert.ok(
      !/from\s+["'](?:\.\/|@\/lib\/captcha\/)provider["']/u.test(source.replace(/import type[^;]*;/gu, "")),
      `${file} imports a value from provider.ts`,
    );
  }
});
