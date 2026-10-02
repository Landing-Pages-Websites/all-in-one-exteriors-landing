/**
 * reCAPTCHA Enterprise verification for policy-based challenge keys.
 *
 * Fails closed on everything: missing credentials, empty token, network error,
 * non-2xx, unparseable body, an invalid token, a mismatched action, a hostname
 * outside the allowlist, and any challenge value that is not explicitly known
 * to be good.
 */

const ASSESSMENT_HOST = "https://recaptchaenterprise.googleapis.com";
const TOKEN_MAX_LENGTH = 8192;
const VERIFY_TIMEOUT_MS = 10_000;

/**
 * The only two affirmative outcomes.
 *
 * `NOCAPTCHA` means the score cleared the key's threshold and no challenge was
 * shown; `PASSED` means one was shown and solved. Verified against the live API
 * on 2026-09-17 — note these are `PASSED`/`FAILED`, NOT `PASS`/`FAIL`. An
 * allowlist written against `PASS` matches nothing on a solved challenge and
 * silently rejects every challenged visitor, which is the exact lead loss this
 * integration exists to avoid.
 */
const ALLOWED_CHALLENGES = new Set(["NOCAPTCHA", "PASSED"]);

export interface AssessmentExpectation {
  readonly expectedAction: string;
  readonly allowedHostnames: readonly string[];
}

function normalizeHostname(value: string): string {
  return value.trim().toLowerCase().replace(/\.$/, "");
}

/**
 * Hostnames this deployment serves. Blank entries are dropped rather than kept,
 * because an invalid token reports `hostname: ""` and a blank entry in the list
 * would authorise it.
 */
function hostnameSet(hostnames: readonly string[]): Set<string> {
  return new Set(hostnames.map(normalizeHostname).filter(Boolean));
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : null;
}

/**
 * Whether an assessment authorises this submission.
 *
 * ORDER IS LOAD-BEARING. `valid` is checked first because a replayed token
 * comes back `valid: false, invalidReason: "DUPE"` while `riskAnalysis.challenge`
 * still reads `NOCAPTCHA`. `challenge` describes which challenge flow occurred;
 * it is not a verdict, and it keeps a permissive-looking value on tokens the API
 * has already rejected. Anything that consults it before `valid` accepts every
 * replay. For the same reason `hostname` and `action` are never compared before
 * `valid`: both are `""` on an invalid token.
 */
export function assessmentAuthorizes(
  assessment: unknown,
  expectation: AssessmentExpectation,
): boolean {
  const body = record(assessment);
  if (!body) return false;

  const properties = record(body.tokenProperties);
  if (!properties) return false;

  // 1. Validity, before anything derived from the token is read.
  if (properties.valid !== true) return false;

  // 2. Action, so a token minted for another flow cannot be replayed into this
  //    one. Turnstile's verifier never checked this; reCAPTCHA's does.
  if (
    typeof properties.action !== "string" ||
    properties.action !== expectation.expectedAction
  ) {
    return false;
  }

  // 3. Hostname, exact and case-insensitive. Never substring: both
  //    `evil-allpointsco.com` and `allpointsco.com.evil.test` contain an
  //    allowed domain.
  const allowed = hostnameSet(expectation.allowedHostnames);
  if (allowed.size === 0) return false;
  if (typeof properties.hostname !== "string") return false;
  const hostname = normalizeHostname(properties.hostname);
  if (hostname.length === 0 || !allowed.has(hostname)) return false;

  // 4. The challenge outcome, allow-listed rather than deny-listed so a future
  //    enum member rejects instead of being read as permissive.
  const risk = record(body.riskAnalysis);
  if (!risk) return false;
  const challenge = risk.challenge;
  if (typeof challenge !== "string") return false;
  if (!ALLOWED_CHALLENGES.has(challenge)) {
    // Loud on purpose. Failing closed silently on an enum we do not recognise
    // would drop real leads with no signal that anything changed.
    console.error(
      `reCAPTCHA returned an unrecognised challenge value: ${challenge}`,
    );
    return false;
  }

  return true;
}

/**
 * The Google Cloud project holding every customer reCAPTCHA key.
 *
 * Hardcoded, and deliberately the same literal the provisioner uses
 * (`megaseo-web` `google_recaptcha_client.ts`). It is infrastructure identity
 * rather than a secret — it appears in the assessment URL this file requests —
 * and one project holds the whole fleet, so an env var for it was a value
 * nobody would ever set differently.
 *
 * The credential that IS secret, `RECAPTCHA_API_KEY`, stays env-backed and is
 * written per site by the provisioner.
 */
export const RECAPTCHA_PROJECT_ID = "mega-seo-432712";

function apiKey(): string | null {
  return process.env.RECAPTCHA_API_KEY?.trim() || null;
}

function siteKey(): string | null {
  return process.env.NEXT_PUBLIC_RECAPTCHA_SITE_KEY?.trim() || null;
}

function allowedHostnames(): string[] {
  return (process.env.RECAPTCHA_HOSTNAMES ?? "")
    .split(",")
    .map((hostname) => hostname.trim())
    .filter(Boolean);
}

/**
 * Verify a reCAPTCHA token by creating an assessment.
 *
 * The hostname allowlist is REQUIRED. Turnstile's verifier applied its
 * equivalent check only when the list was non-empty, so an unset variable
 * silently disabled it; this one rejects instead.
 */
export async function verifyRecaptchaToken(
  token: unknown,
  expectedAction: string,
  remoteIp: string | null,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const key = apiKey();
  const site = siteKey();
  const hostnames = allowedHostnames();
  if (!key || !site || hostnames.length === 0) {
    return { ok: false, error: "Lead protection is not configured." };
  }
  if (
    typeof token !== "string" ||
    token.length === 0 ||
    token.length > TOKEN_MAX_LENGTH
  ) {
    return {
      ok: false,
      error: "Please complete the security check and try again.",
    };
  }

  const url = `${ASSESSMENT_HOST}/v1/projects/${encodeURIComponent(RECAPTCHA_PROJECT_ID)}/assessments?key=${encodeURIComponent(key)}`;
  let body: unknown;
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        event: {
          token,
          siteKey: site,
          expectedAction,
          ...(remoteIp ? { userIpAddress: remoteIp } : {}),
        },
      }),
      signal: AbortSignal.timeout(VERIFY_TIMEOUT_MS),
    });
    if (!response.ok) {
      return { ok: false, error: "Security check failed. Please try again." };
    }
    body = await response.json();
  } catch {
    return { ok: false, error: "Security check failed. Please try again." };
  }

  if (
    !assessmentAuthorizes(body, { expectedAction, allowedHostnames: hostnames })
  ) {
    return {
      ok: false,
      error: "Please complete the security check and try again.",
    };
  }
  return { ok: true };
}
