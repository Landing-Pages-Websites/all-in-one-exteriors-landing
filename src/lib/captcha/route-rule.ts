/**
 * Which captcha this deployment uses, stated once.
 *
 * The provisioner writes `NEXT_PUBLIC_CAPTCHA_PROVIDER` alongside the keys, and
 * this is the only thing that reads it. `site.config.ts` deliberately does NOT
 * also declare the provider: two statements of one contract can disagree, and
 * the disagreement would be invisible until a form stopped submitting.
 */
export type CaptchaProvider = "turnstile" | "recaptcha";

/** `unconfigured` rejects every submission. It is never a provider. */
export type ProviderResolution = CaptchaProvider | "unconfigured";

/**
 * Resolve the configured provider, failing closed on anything unrecognised.
 *
 * Absent is `turnstile` — the documented legacy default, because every site
 * built before this variable existed uses Turnstile and must keep working with
 * no change. An unrecognised NON-EMPTY value is `unconfigured` rather than the
 * default: absent means "this site predates the flag", whereas a typo means
 * somebody set it and got it wrong, and quietly serving Turnstile there would
 * hide the mistake behind a working form.
 */
export function resolveCaptchaProvider(
  raw: string | undefined,
): ProviderResolution {
  const value = raw?.trim().toLowerCase() ?? "";
  if (value.length === 0) return "turnstile";
  if (value === "turnstile") return "turnstile";
  if (value === "recaptcha") return "recaptcha";
  return "unconfigured";
}

/** The provider this deployment is configured for. */
export function configuredCaptchaProvider(): ProviderResolution {
  return resolveCaptchaProvider(process.env.NEXT_PUBLIC_CAPTCHA_PROVIDER);
}

export const NOT_CONFIGURED_ERROR = "Lead protection is not configured.";

export type VerificationRoute =
  | { readonly kind: "reject"; readonly error: string }
  | { readonly kind: "bypass" }
  | { readonly kind: "turnstile" }
  | { readonly kind: "recaptcha" };

/**
 * Which captcha this deployment uses — the ONE rule, read by both sides.
 *
 * It lives here rather than beside the verifiers because the browser needs the
 * same answer the server will give. When the widget decided independently, a
 * Turnstile deployment that still carried the reCAPTCHA sentinel rendered no
 * widget, reported itself ready, and sent the bypass placeholder, while the
 * server correctly routed it to Turnstile and rejected every submission and
 * every upload. The rule was right in both places and they still disagreed,
 * because there were two of them.
 *
 * The sentinel test is a PARAMETER so this file never states the sentinel.
 * provider.ts supplies the real one; the browser, which must not carry the
 * literal (the production go-live sweep fails any bundle containing it, even
 * on a real key), gets its route inlined by next.config.ts and only falls back
 * to this rule, with the bypass switched off, on a build that never derived it.
 */
export function routeWith(
  input: {
    readonly provider: ProviderResolution;
    readonly recaptchaSiteKey: string | undefined;
  },
  isBypassKey: (siteKey: string) => boolean,
): VerificationRoute {
  if (input.provider === "unconfigured") {
    return { kind: "reject", error: NOT_CONFIGURED_ERROR };
  }
  // The sentinel is only meaningful to the reCAPTCHA path. Honouring it under
  // Turnstile would make a reCAPTCHA-only variable a second, undocumented way
  // to switch Turnstile off.
  if (input.provider === "turnstile") return { kind: "turnstile" };

  const siteKey = input.recaptchaSiteKey?.trim() ?? "";
  if (siteKey.length === 0) {
    return { kind: "reject", error: NOT_CONFIGURED_ERROR };
  }
  if (isBypassKey(siteKey)) return { kind: "bypass" };
  return { kind: "recaptcha" };
}
