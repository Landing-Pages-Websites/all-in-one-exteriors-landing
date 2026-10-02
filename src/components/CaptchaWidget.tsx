"use client";

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  type ReactElement,
} from "react";
import RecaptchaWidget, {
  type RecaptchaHandle,
} from "@/components/RecaptchaWidget";
import TurnstileWidget, {
  type TurnstileHandle,
} from "@/components/TurnstileWidget";
import { clientVerificationRoute } from "@/lib/captcha/client-route";
import type { CaptchaAction } from "@/lib/captcha/verify";

/** Placeholder presented on preview builds carrying the staging sentinel. */
const BYPASS_TOKEN = "staging-bypass";

/**
 * How long to wait for Turnstile to issue a replacement token after a reset.
 * Bounded so a challenge that never completes costs the attachments rather than
 * hanging the submission.
 */
const TURNSTILE_REFRESH_TIMEOUT_MS = 6000;

export interface CaptchaHandle {
  /**
   * Mint a token for ONE request.
   *
   * Every call returns a token that has not been used before, because a
   * submission and its upload-signing call must present separate challenges —
   * a token is single-use under both providers, so sharing one would make the
   * second request fail and cost the visitor a correctly filled-in enquiry.
   *
   * Called at submit time rather than read from state: a reCAPTCHA token
   * expires two minutes after it is issued, so anything minted at mount is
   * already dead by the time a visitor finishes filling the form.
   */
  getToken: (action: CaptchaAction) => Promise<string | null>;
  reset: () => void;
}

interface CaptchaWidgetProps {
  /**
   * Whether a token can be obtained at all. Turnstile reports true once its
   * first token arrives; reCAPTCHA once the invisible widget has rendered,
   * because under reCAPTCHA no token exists until submit.
   */
  readonly onReady: (ready: boolean) => void;
  readonly action?: CaptchaAction;
}

/**
 * The captcha for this deployment, whichever provider it is configured for.
 *
 * `TurnstileWidget` is reused untouched. Its copy already ships in every
 * existing customer site, so changing it would put a diff on ~276 repos to
 * serve sites that are not moving providers.
 */
const CaptchaWidget = forwardRef<CaptchaHandle, CaptchaWidgetProps>(
  function CaptchaWidget(
    { onReady, action = "lead_submit" },
    ref,
  ): ReactElement | null {
    // The SAME decision the server makes, taken at build time by next.config
    // and inlined as a kind. Deciding here independently is how a Turnstile
    // deployment carrying the reCAPTCHA sentinel came to render no widget and
    // send the bypass placeholder while the server verified against Turnstile
    // and rejected everything; running the rule here instead would ship the
    // sentinel literal, which fails the production go-live sweep.
    const route = clientVerificationRoute();
    const recaptchaSiteKey =
      process.env.NEXT_PUBLIC_RECAPTCHA_SITE_KEY?.trim() ?? "";

    const recaptchaRef = useRef<RecaptchaHandle>(null);
    const turnstileRef = useRef<TurnstileHandle>(null);
    /** The unconsumed Turnstile token, or null when one must be minted. */
    const turnstileTokenRef = useRef<string | null>(null);
    /** Resolver for a caller waiting on a post-reset Turnstile token. */
    const waitingRef = useRef<((token: string | null) => void) | null>(null);

    // Turnstile pushes tokens rather than returning them, so a caller that
    // asked for one before it arrived is handed it here. Anything else is a
    // token nobody has claimed yet, held for the next getToken.
    const handleTurnstileToken = useCallback(
      (token: string | null) => {
        const waiting = waitingRef.current;
        if (waiting !== null && token !== null) {
          waitingRef.current = null;
          waiting(token);
          return;
        }
        turnstileTokenRef.current = token;
        onReady(token !== null);
      },
      [onReady],
    );

    /**
     * A Turnstile token nobody has used yet.
     *
     * The FIRST call takes the token the widget minted on render. Any later
     * call finds the slot empty, resets the widget and waits for a replacement
     * — which is how the submission and the upload-signing call end up with
     * separate challenges. Returning the held token twice would hand both the
     * same one, the second request would fail siteverify as a replay, and the
     * two-token design would be decorative.
     */
    const takeTurnstileToken = useCallback((): Promise<string | null> => {
      const held = turnstileTokenRef.current;
      if (held !== null) {
        turnstileTokenRef.current = null;
        return Promise.resolve(held);
      }
      return new Promise((resolve) => {
        waitingRef.current = resolve;
        turnstileRef.current?.reset();
        window.setTimeout(() => {
          if (waitingRef.current === resolve) {
            waitingRef.current = null;
            resolve(null);
          }
        }, TURNSTILE_REFRESH_TIMEOUT_MS);
      });
    }, []);

    useImperativeHandle(ref, () => ({
      getToken: async (requested: CaptchaAction) => {
        if (route === "bypass") return BYPASS_TOKEN;
        if (route === "recaptcha") {
          // execute() mints a fresh token per call, so no slot to manage.
          return (await recaptchaRef.current?.getToken(requested)) ?? null;
        }
        if (route === "reject") return null;
        return takeTurnstileToken();
      },
      reset: () => {
        if (route === "recaptcha") {
          recaptchaRef.current?.reset();
          return;
        }
        turnstileTokenRef.current = null;
        turnstileRef.current?.reset();
      },
    }));

    // Straight from the route, so there is no second place to get it wrong.
    // Computed before any early return so the hooks below always run in the
    // same order.
    const mode: "bypass" | "none" | "recaptcha" | "turnstile" =
      route === "reject" ? "none" : route;

    // Readiness for the two shapes that render no widget is reported from an
    // effect, never from the render body. Calling onReady during render sets
    // state on the parent mid-render, which React rejects with "Cannot update a
    // component while rendering a different component" and which can loop as
    // the parent re-renders and the child repeats the call.
    useEffect(() => {
      if (mode === "bypass") onReady(true);
      if (mode === "none") onReady(false);
    }, [mode, onReady]);

    // A preview build holding the sentinel renders no widget at all. There is
    // nothing to render it with — the sentinel is not a real site key — and
    // `/api/lead` accepts any non-empty token on exactly this configuration.
    if (mode === "bypass" || mode === "none") return null;

    if (mode === "recaptcha") {
      return (
        <RecaptchaWidget
          ref={recaptchaRef}
          sitekey={recaptchaSiteKey}
          defaultAction={action}
          onReady={onReady}
        />
      );
    }

    return (
      <TurnstileWidget ref={turnstileRef} onToken={handleTurnstileToken} />
    );
  },
);

export default CaptchaWidget;
