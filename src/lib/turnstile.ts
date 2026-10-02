const SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
const TOKEN_MAX_LENGTH = 2048;
const VERIFY_TIMEOUT_MS = 10_000;

interface SiteverifyResponse {
  success?: unknown;
  hostname?: unknown;
}

function allowedHostnames(): Set<string> {
  const raw = process.env.TURNSTILE_HOSTNAMES ?? "";
  return new Set(
    raw
      .split(",")
      .map((hostname) => hostname.trim().toLowerCase())
      .filter(Boolean),
  );
}

function secretKey(): string | null {
  const secret =
    process.env.TURNSTILE_SECRET_KEY?.trim() ||
    process.env.TURNSTILE_SECRET?.trim() ||
    "";
  return secret.length > 0 ? secret : null;
}

/**
 * Verify a Turnstile token with Cloudflare Siteverify. Fail closed: missing
 * secret, empty token, network error, unsuccessful challenge, or a hostname
 * outside TURNSTILE_HOSTNAMES (when that list is set) all reject.
 */
export async function verifyTurnstileToken(
  token: unknown,
  remoteIp: string | null,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const secret = secretKey();
  if (!secret) {
    return { ok: false, error: "Lead protection is not configured." };
  }
  if (typeof token !== "string" || token.length === 0 || token.length > TOKEN_MAX_LENGTH) {
    return { ok: false, error: "Please complete the security check and try again." };
  }

  const body = new URLSearchParams({ secret, response: token });
  if (remoteIp) body.set("remoteip", remoteIp);

  let result: SiteverifyResponse;
  try {
    const response = await fetch(SITEVERIFY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
      signal: AbortSignal.timeout(VERIFY_TIMEOUT_MS),
    });
    if (!response.ok) {
      return { ok: false, error: "Security check failed. Please try again." };
    }
    result = (await response.json()) as SiteverifyResponse;
  } catch {
    return { ok: false, error: "Security check failed. Please try again." };
  }

  if (result.success !== true) {
    return { ok: false, error: "Please complete the security check and try again." };
  }

  const hosts = allowedHostnames();
  if (hosts.size > 0) {
    const hostname =
      typeof result.hostname === "string" ? result.hostname.toLowerCase() : "";
    if (!hosts.has(hostname)) {
      return { ok: false, error: "Security check failed. Please try again." };
    }
  }

  return { ok: true };
}
