import {
  resolveCaptchaProvider,
  routeWith,
  type VerificationRoute,
} from "./route-rule";

/**
 * The browser's half of the captcha route, and the ONLY captcha routing the
 * browser runs.
 *
 * next.config.ts resolves `configuredVerificationRoute()` at build time, the
 * same rule `/api/lead` applies, and inlines just the resulting kind as
 * `NEXT_PUBLIC_CAPTCHA_ROUTE`. Nothing here may import from provider.ts: doing so ships the staging-sentinel comparison literal to every
 * visitor, and the go-live sweep fails a production bundle that contains it
 * even when the configured key is real (ln-associates-website, five routes).
 * `scripts/client-bundle-sentinel.mjs` checks the built output for exactly that.
 */
export type RouteKind = VerificationRoute["kind"];

// A Record so adding a kind to VerificationRoute fails to compile here rather
// than being quietly parsed as "reject".
const ROUTE_KINDS: Readonly<Record<RouteKind, true>> = {
  reject: true,
  bypass: true,
  turnstile: true,
  recaptcha: true,
};

/**
 * Exact match, failing closed: a value that is set but is not a kind is a
 * build this code did not produce.
 */
export function parseRouteKind(raw: string | undefined): RouteKind {
  return raw !== undefined && Object.hasOwn(ROUTE_KINDS, raw)
    ? (raw as RouteKind)
    : "reject";
}

/**
 * The inlined route, or, when next.config never set one, the server's own rule
 * with the bypass switched off.
 *
 * Unset is not garbage. It is a customer site whose src/ was synced but whose
 * own next.config.ts predates this, and rejecting there would take every lead
 * form on a live site down. Production holds a real key, so it routes exactly
 * as the server does. An unmigrated preview holding the sentinel renders a
 * widget that cannot load, which QA sees, instead of the browser carrying the
 * sentinel comparison.
 */
export function resolveClientRoute(
  inlined: string | undefined,
  legacy: { readonly provider: string | undefined; readonly recaptchaSiteKey: string | undefined },
): RouteKind {
  if (inlined !== undefined) return parseRouteKind(inlined);
  return routeWith(
    { provider: resolveCaptchaProvider(legacy.provider), recaptchaSiteKey: legacy.recaptchaSiteKey },
    () => false,
  ).kind;
}

/**
 * The route this build was compiled for. Each variable is read by its full
 * name so Next can inline it; `next dev` must restart after the captcha env
 * changes, because next.config is not re-evaluated on an env-file edit.
 */
export function clientVerificationRoute(): RouteKind {
  return resolveClientRoute(process.env.NEXT_PUBLIC_CAPTCHA_ROUTE, {
    provider: process.env.NEXT_PUBLIC_CAPTCHA_PROVIDER,
    recaptchaSiteKey: process.env.NEXT_PUBLIC_RECAPTCHA_SITE_KEY,
  });
}
