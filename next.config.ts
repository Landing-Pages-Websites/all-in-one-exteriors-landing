import type { NextConfig } from "next";
import { megaArticleImageRemotePatterns } from "./src/lib/blog-images";
import { configuredVerificationRoute } from "./src/lib/captcha/provider";
import { redirectMap } from "./src/lib/redirects";

const POSTHOG_HOST =
  process.env.NEXT_PUBLIC_POSTHOG_HOST ?? "https://us.i.posthog.com";
// e.g. https://us.i.posthog.com -> https://us-assets.i.posthog.com
const POSTHOG_ASSETS_HOST = POSTHOG_HOST.replace(
  ".i.posthog.com",
  "-assets.i.posthog.com",
);

const nextConfig: NextConfig = {
  env: {
    // The captcha route, resolved once by the rule /api/lead applies, from the
    // same env. The browser receives only the kind (src/lib/captcha/
    // client-route.ts), so the staging-sentinel comparison never ships to it:
    // the go-live sweep fails any production bundle that contains the literal.
    NEXT_PUBLIC_CAPTCHA_ROUTE: configuredVerificationRoute().kind,
  },
  // Pin the workspace root: stray lockfiles in parent directories otherwise
  // make Next.js guess wrong.
  turbopack: {
    root: __dirname,
  },
  images: {
    remotePatterns: megaArticleImageRemotePatterns,
  },
  async redirects() {
    // 301-equivalent redirects for migrations. Builders fill the map in
    // src/lib/redirects.ts; Next serves permanent redirects as 308
    // (SEO-equivalent to 301 — go-live QA accepts either).
    return redirectMap.map(({ source, destination }) => ({
      source,
      destination,
      permanent: true,
    }));
  },
  async rewrites() {
    // Same-origin reverse proxy for PostHog (PostHog's documented Next.js
    // pattern) so analytics requests are not blocked by ad blockers.
    return [
      {
        source: "/ingest/static/:path*",
        destination: `${POSTHOG_ASSETS_HOST}/static/:path*`,
      },
      {
        source: "/ingest/:path*",
        destination: `${POSTHOG_HOST}/:path*`,
      },
    ];
  },
  // Required for the PostHog proxy: its API calls can use trailing slashes,
  // which Next would otherwise redirect (dropping the POST body).
  skipTrailingSlashRedirect: true,
};

export default nextConfig;
