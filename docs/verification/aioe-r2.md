# All In One Exteriors roof-replacement LP: round 2 verification

Task f0c4cda7-1952-4908-98b1-c14d9eee42b3 · customer 1862914c-bd83-4c75-b22b-f25364728c36 · 2026-10-02

Raw evidence (not committed) lives in `/var/lib/megaclaw/workspace/tmp/aioe-r2/`:
`logs/` (build, tsc, eslint, test, lp-lint, asset check, server), `visual-results.json`,
`form-results.json`, `a11y-axe.json`, `a11y-hero-snapshot.yml`, `cta-edge-check.json`,
`image-sources.txt`, `shots/`, `scripts/` (Playwright QA scripts).

## Build and static gates

| Gate | Result |
| --- | --- |
| `npm run build` (no ALLOW_TODO) | exit 1 at prebuild check-config, **only** on `TODO_MEGA_SITE_ID` and `TODO_MEGA_SITE_KEY` (Flow B, not in task input, never invented). The blog seed id and the legal page sentinels are cleared. |
| `ALLOW_TODO=1 npm run build` | exit 0. Same two warnings only. This is the build the browser QA ran against. |
| `tsc --noEmit` | exit 0 |
| eslint (LP files) | exit 0 |
| `npm test` | 139 pass / 8 fail. All 8 are template self-tests. Seven (`managed-site-starter`, `placeholder-assets`) bind to the starter's placeholder icon/logo/OG digests, which the customer's brand assets replaced. The eighth (`blog-contract`: "the starter's own seed post id is a placeholder") asserts the starter seed id is still present, so it fails because that id was re-minted. Not LP behaviour, and the shared scripts were left untouched. `src/lib/roofLead.test.ts` passes 5/5. |
| LP lint `--pre-registration` | exit 1. False positives only (below). |

### LP lint false positives

- `FORM: src/components/lp/RoofEstimateForm.tsx uses type="button"`: required by this task. The click validates with checkValidity/reportValidity, then calls the submission directly. This supersedes the requestSubmit example, because a native submit observer would capture before the API succeeds. The rendered DOM has one `type="button"` per form, and Playwright recorded zero `submit` events.
- `src/components/LeadForm.tsx` (two errors, one warning): this is the unused starter website form. No route renders it (it is only imported by the unused `home/ManagedContact`), and it is absent from the rendered `/` DOM.
- `✓ siteKey: ${siteConfig.megaSiteKey}`: the lint reads the interpolation expression. The rendered value is `window.MEGA_TAG_CONFIG={siteId:"TODO_MEGA_SITE_ID",siteKey:"TODO_MEGA_SITE_KEY",gtmId:"GTM-PCXQBG7X",pixelId:"1620710171744846"}`, a Flow B placeholder guarded by check-config.
- `No site_id/customer_id found` warnings: the hook reads them from `siteConfig` (`CONFIG.SITE_ID: siteConfig.megaSiteId`). The payload proves they are sent (customer_id `1862914c-…`, site_id `TODO_MEGA_SITE_ID`).

## Browser QA (local `next start`, port 4387, current build)

Before each run the server was checked to be serving this build: all 10 CSS/JS assets returned 200 and exist in this worktree's `.next`. Third-party tags (optimizer, CTM, GTM, Meta, PostHog) were blocked in the browser. All rendered images were decoded before each screenshot.

Captures: 360x780 DPR2, 390x844 DPR2, 1512x982, 1728x1117 (fold + full page).

| Check | 360 | 390 | 1512 | 1728 |
| --- | --- | --- | --- | --- |
| H1 font size | 40px | 40px | 75.6px | 84px |
| Hero form card top | 377 | 377 | 113 | 113 |
| First real field top | 466 | 466 | 261 | 261 |
| Logo rendered | 60x48 | 60x48 | 70x56 | 70x56 |
| Horizontal overflow / negative z-index | 0 / 0 | 0 / 0 | 0 / 0 | 0 / 0 |

- Anchors in DOM order: hero, trust-bar, benefits, how-it-works, services, testimonials, offers, service-area, faq, form, footer.
- Rendered text, meta and alt contain no "free", no em dash, no financing and no insurance/claim language. All 8 cities are present.
- Every `tel:` href is `tel:4044458136`. The header uses a sticky bar with no nav, and the floating CTA is form-only (targets `#final-estimate`).
- One executing MEGA_TAG_CONFIG script and one `#optimizer-script`. The CTM `t.js` script appears once. There is no manual GTM, Pixel or noscript, and no Turnstile or honeypot.
- axe (wcag2a + wcag2aa) violations: 0.
- No CTA crosses the 16px gutter at 360 or 390 (`cta-edge-check.json`).

### Image audit

All 10 page photos are unique (distinct md5) customer images, sourced at 1000–2000px. Delivered density comes from the `/_next/image` w-param relative to the rendered CSS width:
mobile (DPR2) 2.1–2.8x, desktop (DPR1) 1.1–1.8x. The final-CTA background `sizes` was reduced from 125vw to 100vw on desktop. The logo is 160x129 at source and renders at 48/56px, so it is never upscaled.

### Forms (both instances: hero `#estimate`, final `#final-estimate`), 40/40 checks pass

The endpoint `**/submission/submit` was intercepted in every scenario, and call counts were asserted.

- Empty form, invalid email and invalid phone: 0 calls, form invalid, 0 events.
- HTTP 500, `{ok:false}`, malformed 2xx and network abort each produced: 1 call, a visible `role="alert"` retryable error, fields preserved, button re-enabled, no redirect, 0 events. A retry then succeeded with a new `submission_id`.
- A 5-click burst produced 1 call. Enter in a text field submitted once through the same validation.
- Payload: `customer_id`, `site_id`, `source_provider`, `submission_id` (`sub_…`, per attempt), `form_key: contact-form`, UTMs/fbclid/fbc, visitor/session ids, url. `form_data` keys are exactly firstName, lastName, email, phone, decisionMaker, roofStatus, qualified, isDisqualified, urgency.
- QA sentinel `+15555550100` rendered as `(555) 555-0100` and was sent as `5555550100`.
- Qualified (decisionMaker Yes) emitted `mt:form_submit` with each field as a separate key, `dl:form_submission`, `dl:qualified_lead` and `fbq Lead`.
- Disqualified (No) was still submitted and reached thank-you. It emitted only `mt:form_submit` and `dl:form_submission`: no qualified_lead and no Meta Lead.
- Thank-you URL kept `?utm_source=qa&utm_campaign=aioe-r2&fbclid=QAFBCLID`.
- No native `submit` event fired in any scenario.

**Mocked success proves client behaviour only. Backend persistence has NOT been tested** (there is no real site_id yet, and no live submission was made).

Form key: both instances send the one declared key `contact-form`. The starter's form-identity gate blocks a declared key that no `<LeadForm>` sends, and it cannot see `RoofEstimateForm`. Tracking tells the two instances apart with `form-hero` / `form-final`.

## Final pre-registration hardening

- 360x780 first-field fix: the form heading "Request a Roof Estimate" wrapped to two lines at 24px in the 286px card at 360. It now uses `text-h4` (20px) below `sm` and `text-h3` from `sm` up, which keeps it on one line. First field moved from 496 to 466 at 360 (and from 469 to 466 at 390). The desktop layout is unchanged. Visual suite: 0 failures. Forms suite: 40/40. axe: 0.
- Legal pages: every `TODO_POLICY_CONTENT` sentinel was replaced with plain-language copy under the existing headings, using the configured business name, legal name, email and phone. No compliance claims.
- The warranty range "5–10" became "5 to 10" in copy and "5-10" in the TrustBar figure, so no en dash is rendered.
- Blog seed id re-minted (`item_n3kjy7579psdkgfm814p323qqr`, valid Crockford pattern), and the post copy was kept with its dash removed.
- Provenance: `task-spec.json` and `content-sources.json` at the repo root (audit only, not rendered).
- Rendered-text sweep of `/`, `/privacy-policy`, `/terms`, `/cookie-policy`, `/thank-you`, `/blog`, `/blog/welcome`, `/llms.txt` and the 404 page (text, meta, alt, title and aria-label, scripts excluded) found 0 hits for "free", em dash, en dash, financ, insurance, claim, competitor and `TODO_` (`logs/content-sweep.txt`).

## Reviews

- design-review: SHIP-READY after fixes (CTA wrapping at 360, asterisk binding, off-white field tokens, static chips). It accepted three items as unchanged: the placeholders as the Flow B state, the requestSubmit exception, and the desktop space under the form.
- code-review: the first pass found no functional bugs. All standards findings were fixed: one component per file, theme tokens, CITY_LIST_TEXT, phone from config, 200ms motion, option validation, and the dead `secondary` style. `gtmId`/`pixelId` stay literal in layout.tsx so the LP lint can read them (accepted).

## Environment notes

- Unlinked `.next` → `/dev/shm/aioe-next` (symlink only). `.next` is now a normal directory in this worktree.
- During the first build, the root filesystem reported 100% used (0 bytes free; `df /`) from usage outside this sandbox's view (`du -x /` saw ~91MB). No ENOSPC error occurred. All writes went to `/var/lib/megaclaw`, and root later recovered (1.6GB free at the end).

## Outstanding (controller)

1. Register the site (`mega site-tracking enable`). Replace `megaSiteId`/`megaSiteKey` in `src/site.config.ts` (that feeds both MEGA_TAG_CONFIG and the submission payload). Then run `npm run build` without ALLOW_TODO (the only remaining blockers are those two sentinels) and the LP lint without `--pre-registration`.
2. Live QA after the real IDs are deployed: one qualified and one disqualified lead with the customer-safe identity (Test / MEGA QA / qatest+<ts>@gomega.ai / +15555550100), confirming Keystone persistence and form_data keys. Also verify that optimizer-injected GTM/Pixel and CTM number swap work on the live domain services.allinoneexteriors.com.
