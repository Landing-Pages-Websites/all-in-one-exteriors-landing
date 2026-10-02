/**
 * One entry point for challenge verification, whichever provider a site uses.
 *
 * Every caller gets the same result shape, so `/api/lead` and
 * `/api/lead/upload-url` do not branch on provider themselves.
 */

import { configuredCaptchaProvider, routeVerification } from "./provider";
import { verifyRecaptchaToken } from "./recaptcha";
import { verifyTurnstileToken } from "../turnstile";

/** Named so a token minted for one flow cannot be replayed into the other. */
export type CaptchaAction = "lead_submit" | "lead_upload";

export type CaptchaResult = { ok: true } | { ok: false; error: string };

const INCOMPLETE = "Please complete the security check and try again.";

// Re-exported, not reimplemented. The widget receives this function's answer,
// inlined at build time by next.config.ts, so the browser and the server
// cannot route a deployment differently.
export { routeVerification, type VerificationRoute } from "./provider";

/**
 * The preview-only bypass.
 *
 * Reachable ONLY when the configured site key is exactly the staging sentinel,
 * which the provisioner refuses to write to a production target. It still
 * demands a non-empty token so a client that omits the field entirely fails on
 * staging rather than passing there and breaking in production.
 */
export function bypassAuthorizes(token: unknown): boolean {
  return typeof token === "string" && token.trim().length > 0;
}

export async function verifyCaptchaToken(
  token: unknown,
  action: CaptchaAction,
  remoteIp: string | null,
): Promise<CaptchaResult> {
  const route = routeVerification({
    provider: configuredCaptchaProvider(),
    recaptchaSiteKey: process.env.NEXT_PUBLIC_RECAPTCHA_SITE_KEY,
  });

  switch (route.kind) {
    case "reject":
      return { ok: false, error: route.error };
    case "bypass":
      return bypassAuthorizes(token)
        ? { ok: true }
        : { ok: false, error: INCOMPLETE };
    case "recaptcha":
      return verifyRecaptchaToken(token, action, remoteIp);
    case "turnstile":
      return verifyTurnstileToken(token, remoteIp);
  }
}
