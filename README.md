# site-starter

Mega's shared Next.js starter for customer websites,
deployed to Vercel. Used as a **GitHub template repo** by both coding bots and
human developers: click "Use this template", fill the operational config and
structured content, build pages, ship.

## The 4 layers

1. **Plumbing (hard-coded, do not edit)** — SEO metadata, JSON-LD schema,
   robots/sitemap/llms.txt/manifest, consent-gated analytics loaders, the
   PostHog reverse proxy, cookie banner, lead form wiring, a11y baseline.
2. **`src/content/` (edit through the contract)** — customer-editable copy,
   images, collections, and internal-protected SEO fields live in structured
   JSON. `managed-site.contract.json` classifies every value and stable ID.
3. **`src/site.config.ts` (edit this)** — operational deployment, lead,
   consent, and legacy compatibility settings. It is not the authored page
   content source.
4. **Env vars (set later, in Vercel)** — tracking IDs (GA4, PostHog,
   GSC) are minted by the provisioning bot after the site exists. The
   site builds and runs fine with none of them set; each loader renders
   nothing until its var exists. The Mega optimizer snippet is NOT an env
   var — it is hard-coded plumbing that loads on every site.

## Building a new site — step by step

For a new customer site, use the current template from the beginning. For a
site already under construction, follow the
[managed-site adoption guide](docs/managed-site-adoption.md); do not copy these
files into a live customer repository as an unreviewed bulk migration.

1. Create a repo from this template and clone it.
2. Fill every field in `src/site.config.ts`, `src/content/site.json`, and
   `src/content/pages/home.json` (no `TODO_` left).
3. Replace the placeholder assets in `public/`: `logo.png`,
   `og-image.png` (1200x630), `icon-192.png`, `icon-512.png`, and
   `src/app/favicon.ico`. The shipped files are solid-gray placeholders.
4. Extend `src/content/managed-site.contract.json` and structured page JSON as
   you build the site's pages. Render only values returned by the managed-site
   adapter and preserve stable page/field annotations.
   - Register every new page in `src/lib/routes.ts` (drives sitemap.xml,
     llms.txt, and the 404 page). The template already registers `/blog`.
     Articles are the exception: they are not registered here. Add them as
     markdown under `content/blog/` and they reach sitemap.xml and llms.txt
     through `listPublishedPosts()`. Every post carries a stable `id` that a
     CMS edit attaches to — see `content/blog/README.md` for the frontmatter
     contract. Do not remove `src/app/blog/page.tsx` or
     `src/app/blog/[slug]/page.tsx`, and do not remove `dynamicParams = false`
     from the post template: without it an unknown `/blog/<slug>` returns a
     404 with an empty body. MEGA writes article images as S3 URLs; keep
     `megaArticleImageRemotePatterns` in `next.config.ts` so `next/image` can
     load them.
   - Use `buildMetadata({ title, description, path })` for every page's
     `export const metadata`.
   - Use the schema builders (`buildBusinessSchema`, `buildFaqSchema`,
     `buildBreadcrumbSchema`, `buildArticleSchema`) with `<JsonLd />` where
     appropriate.
   - Use `<LeadForm />` for lead capture — it validates a real email and a
     10-digit US phone (landing-page Hard Rules 4/4b), protects the POST with
     Cloudflare Turnstile + a honeypot, submits through `/api/lead` to the Mega
     submission API with full attribution, fires analytics events, and
     redirects to `/thank-you`.
     It reads `megaCustomerId` / `megaSiteId` / `sourceProvider` /
     `budgetQualifier` from `src/site.config.ts`. The Mega optimizer needs
     `megaSiteKey` (sk_… from MEGA Admin Conversions tab) — set it in
     `src/site.config.ts` or the optimizer cannot function. NEVER submit leads any
     other way (no direct database access from frontend code).
     Turnstile keys (`NEXT_PUBLIC_TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY`)
     are minted by the provisioning bot; without them `/api/lead` fail-closes.
     - `sourceProvider` uses the `website-<slug>` convention — the
       `website-` prefix distinguishes website leads from ad/LP leads in
       Keystone.
     - Set `budgetQualifier: null` to hide the yes/no budget toggles for
       sites where the qualifying question doesn't fit.
5. Replace the `TODO_POLICY_CONTENT` sections in the legal pages
   (`/privacy-policy`, `/terms`, `/cookie-policy`).
6. Run `npm run check-config` — fix anything it reports.
7. `npm run build` (runs check-config automatically) and deploy to Vercel.

## Do not edit (plumbing)

Bots and humans: leave these alone unless you are changing the template
itself.

- `src/lib/` — seo, routes types, consent store, tracking, posthog client
- `src/hooks/useMegaLeadForm.ts` — Mega lead submission + attribution hook
- `src/components/analytics/` — GA4 / Mega / PostHog loaders
- `src/components/consent/` — cookie banner + `useConsent()`
- `src/components/schema/` — JSON-LD renderer + builders
- `src/app/robots.ts`, `src/app/sitemap.ts`, `src/app/manifest.ts`,
  `src/app/llms.txt/route.ts`
- `next.config.ts` (PostHog `/ingest` reverse proxy)
- `scripts/check-config.mjs`

### Prelaunch reviews

The starter's `robots.txt` permits crawlers and advertises the generated
`sitemap.xml`; every registered route receives a weekly crawl-frequency hint.
Keep `src/lib/routes.ts` current so a prelaunch Website Review can discover
the complete public site. The Gomega review bridge is immutable v10 plumbing:
`https://app.gomega.ai/review-bridge/v10/review-bridge.js` with its pinned SRI
value and anonymous cross-origin mode. Do not replace any of those values. A
site certified on an older bridge keeps its version until it is re-enrolled
(see `packages/managed-site-contract/README.md`).

What you DO edit: `src/site.config.ts`, `src/content/`,
`content/blog/*.md` (articles; the `/blog` page and `[slug]` template stay),
`src/lib/routes.ts` (append pages),
`src/lib/redirects.ts` (migrations only: map every old-site URL to its new
slug — inventory the old site while it's still live, BEFORE DNS flips;
go-live QA verifies each entry and treats a broken one as a launch blocker),
everything under `src/app/*/page.tsx`, and `public/` assets.

## Env vars

All optional except Turnstile, which go-live QA requires before launch. Set in
**Vercel project env** (Production + Preview), never committed.

| Var | Who sets it | Where | Required when |
| --- | --- | --- | --- |
| `NEXT_PUBLIC_GA4_ID` | provisioning bot | Vercel env | GA4 tracking is provisioned |
| `NEXT_PUBLIC_POSTHOG_KEY` | provisioning bot | Vercel env | PostHog project is provisioned |
| `NEXT_PUBLIC_POSTHOG_HOST` | provisioning bot | Vercel env | Only for non-US PostHog (defaults to US cloud) |
| `NEXT_PUBLIC_GSC_VERIFICATION` | provisioning bot | Vercel env | Search Console verification is requested |
| `NEXT_PUBLIC_TURNSTILE_SITE_KEY` | provisioning bot | Vercel env | Lead forms (go-live blocker) |
| `TURNSTILE_SECRET_KEY` | provisioning bot | Vercel env | Lead forms (go-live blocker) |
| `TURNSTILE_HOSTNAMES` | provisioning bot | Vercel env | Lead forms — production hostnames only |
| `ALLOW_TODO` | builder | build command / CI only | Preview builds while config is unfinished |

GA4 and PostHog loaders are **consent-aware**, controlled by
`consentMode` in `src/site.config.ts`:

- **`"us-default"`** (the default): analytics load immediately on page view;
  the banner is informational ("Got it" / "Decline") and Decline is an
  opt-out that stops capture. The norm for US clients (CCPA is
  opt-out-based) — no analytics loss from visitors who ignore the banner.
- **`"strict"`**: nothing loads until the visitor clicks Accept (GDPR-style
  opt-in). Use for customers with meaningful EU traffic.

PostHog additionally lazy-initializes (first interaction or 3s idle) through
the same-origin `/ingest` proxy, with session recording off by default.

The **Mega optimizer snippet** (`cdn.gomega.ai/scripts/optimizer.min.js`) is
the exception: it is hard-coded in
`src/components/analytics/MegaSnippet.tsx` and **intentionally not
consent-gated** — it is the business-critical lead-capture/optimizer script
(decision made by Peter's assistant; flagged for review).

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Dev server |
| `npm run check-config` | Fails if `TODO_` sentinels / empty fields remain in operational config or structured content |
| `npm run build` | check-config, then production build (`ALLOW_TODO=1` downgrades to a warning) |
| `npm run lint` | ESLint |

## Conventions

- TypeScript strict, no `any`, explicit return types on exported functions.
- One component per file; files under 500 lines.
- Database/API calls never live in components.
- Comments explain non-obvious "why", not "what".
