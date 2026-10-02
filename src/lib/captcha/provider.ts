/**
 * The staging bypass, and the server's entry points to the routing rule.
 *
 * The rule itself lives in route-rule.ts, which never states the sentinel, so
 * the browser can share it. Everything it exports is re-exported here, so
 * existing importers are unchanged.
 */
import {
  configuredCaptchaProvider,
  routeWith,
  type ProviderResolution,
  type VerificationRoute,
} from "./route-rule";

export {
  NOT_CONFIGURED_ERROR,
  configuredCaptchaProvider,
  resolveCaptchaProvider,
  type CaptchaProvider,
  type ProviderResolution,
  type VerificationRoute,
} from "./route-rule";

/**
 * The preview-only sentinel. `/api/lead` accepts any non-empty token when the
 * configured site key is EXACTLY this, which is what lets go-live QA and the
 * form-registration `curl` submit without solving a challenge.
 *
 * Production carries a real key, so the bypass branch is unreachable there by
 * construction rather than by configuration. Three separate guards keep it that
 * way: the provisioner refuses to write this to a production target, the go-live
 * sweep fails production when the served bundle contains it, and provisioning
 * row 8.6 compares the served key against the effective production key.
 */
export const STAGING_BYPASS_SITE_KEY = "recaptcha-staging-bypass-key";

/**
 * Exact match only, after trimming. A key that merely CONTAINS the sentinel is
 * not the sentinel: the bypass is safe only because "production never holds
 * this value" is checkable by inspection, and substring matching would make a
 * real key starting with these bytes silently bypass the challenge.
 */
export function isStagingBypassSiteKey(siteKey: string | undefined): boolean {
  return siteKey?.trim() === STAGING_BYPASS_SITE_KEY;
}

/**
 * Which captcha this deployment uses — the ONE rule (route-rule.ts), with the
 * real staging sentinel. Server-side only: importing this module ships
 * `STAGING_BYPASS_SITE_KEY` to every visitor.
 */
export function routeVerification(input: {
  readonly provider: ProviderResolution;
  readonly recaptchaSiteKey: string | undefined;
}): VerificationRoute {
  return routeWith(input, isStagingBypassSiteKey);
}

/** The route this deployment resolves to, from its own configuration. */
export function configuredVerificationRoute(): VerificationRoute {
  return routeVerification({
    provider: configuredCaptchaProvider(),
    recaptchaSiteKey: process.env.NEXT_PUBLIC_RECAPTCHA_SITE_KEY,
  });
}
