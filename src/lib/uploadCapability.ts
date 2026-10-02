import { createHash, createHmac, timingSafeEqual } from "node:crypto";

/**
 * Binds a set of signed upload keys to one specific submission.
 *
 * Signing happens before the submission, so without a binding the submission
 * can present any key it has ever had signed. The keys are unguessable and the
 * customer is checked downstream, so the practical exposure is a visitor
 * attaching their own file to their own lead — but "the file this submission
 * uploaded" is the property worth enforcing, not "a file this customer owns".
 *
 * The binding uses the submission's own challenge token as the nonce. That token
 * is single-use under both providers, so a capability cannot be presented twice:
 * a replay must re-present a consumed token and the submission is refused before
 * the capability is even considered. (Cloudflare consumes it at siteverify;
 * reCAPTCHA returns `invalidReason: "DUPE"` on a second assessment — verified
 * against the live API, so this is a property of both, not an assumption
 * inherited from Turnstile.) No durable store is needed, which matters because
 * this code ships to every customer site and none of them have one.
 *
 * Only the token's HASH is ever transported or stored, so the signing step never
 * sees the token the submission depends on.
 */
const CAPABILITY_VERSION = "v1";

/**
 * Server-only signing secret.
 *
 * `LEAD_UPLOAD_SIGNING_SECRET` is the provider-neutral value the provisioner
 * mints per site. The Turnstile secret remains a fallback so existing sites,
 * which have no such value, keep behaving exactly as before.
 *
 * This fallback is not cosmetic. reCAPTCHA Enterprise authenticates assessments
 * at the PROJECT level, so a reCAPTCHA site has no `TURNSTILE_SECRET_KEY` at
 * all. Without a dedicated secret, `signingKey()` would return null there,
 * `issueUploadCapability` would return null, and every lead attachment would be
 * dropped silently while the lead itself still sent — a failure designed to be
 * quiet, on a path nothing else checks.
 */
function signingKey(): string | null {
  const secret =
    process.env.LEAD_UPLOAD_SIGNING_SECRET?.trim() ||
    process.env.TURNSTILE_SECRET_KEY?.trim() ||
    process.env.TURNSTILE_SECRET?.trim() ||
    "";
  return secret.length > 0 ? secret : null;
}

/** The value that binds a capability to one submission's challenge. */
export function submissionBinding(captchaToken: string): string {
  return createHash("sha256").update(captchaToken).digest("hex");
}

function payload(keys: readonly string[], binding: string): string {
  // Sorted so reordering cannot change the authorised set, and joined with a
  // character an S3 key cannot contain so two different key lists can never
  // produce the same payload.
  return [CAPABILITY_VERSION, binding, [...keys].sort().join("\n")].join(" ");
}

function sign(value: string, key: string): string {
  return createHmac("sha256", key).update(value).digest("base64url");
}

/**
 * A capability for `keys`, usable only by the submission whose challenge token
 * hashes to `binding`.
 *
 * Returns null without a signing key, so a misconfigured site cannot mint an
 * authorisation nothing can verify.
 */
export function issueUploadCapability(
  keys: readonly string[],
  binding: string,
): string | null {
  const key = signingKey();
  if (key === null || !/^[0-9a-f]{64}$/.test(binding)) return null;
  return `${CAPABILITY_VERSION}.${sign(payload(keys, binding), key)}`;
}

/**
 * Whether `capability` was issued for `signedKeys` bound to this submission, and
 * permits it to declare `declaredKeys`.
 *
 * `declaredKeys` may be any subset of `signedKeys`, including none: uploads
 * happen after signing, so requiring an exact match would refuse a submission
 * whose files failed to upload and lose an enquiry that is otherwise valid. A
 * subset can never name a key that was not signed.
 *
 * Fails closed on everything else — no signing key, wrong shape, unknown
 * version, a declared key outside the signed set, or a signature over different
 * keys or a different submission.
 */
export function uploadCapabilityAuthorizes(
  capability: unknown,
  signedKeys: readonly string[],
  declaredKeys: readonly string[],
  captchaToken: unknown,
): boolean {
  const key = signingKey();
  if (key === null) return false;
  if (typeof captchaToken !== "string" || captchaToken.length === 0) {
    return false;
  }
  if (
    typeof capability !== "string" ||
    capability.length === 0 ||
    capability.length > 512
  ) {
    return false;
  }

  const parts = capability.split(".");
  if (parts.length !== 2) return false;
  const [version, provided] = parts;
  if (version !== CAPABILITY_VERSION) return false;

  // Every declared key must have been signed, or a valid capability would
  // authorise its own key list rather than the submission's.
  const authorized = new Set(signedKeys);
  if (!declaredKeys.every((declared) => authorized.has(declared))) return false;

  const expected = sign(
    payload(signedKeys, submissionBinding(captchaToken)),
    key,
  );
  const expectedBytes = Buffer.from(expected);
  const providedBytes = Buffer.from(provided);
  if (expectedBytes.length !== providedBytes.length) return false;
  return timingSafeEqual(expectedBytes, providedBytes);
}
