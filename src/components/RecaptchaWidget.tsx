"use client";

import { reportCaptchaUnavailable } from "@/lib/captcha/telemetry";
import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  type ReactElement,
} from "react";

const SCRIPT_SRC =
  "https://www.google.com/recaptcha/enterprise.js?render=explicit";
const EXECUTE_TIMEOUT_MS = 30_000;

interface RecaptchaApi {
  ready: (cb: () => void) => void;
  render: (
    container: HTMLElement,
    options: {
      sitekey: string;
      size: "invisible";
      action?: string;
      "error-callback"?: () => void;
      "expired-callback"?: () => void;
    },
  ) => number;
  execute: (widgetId: number, options: { action: string }) => Promise<string>;
  reset: (widgetId: number) => void;
}

declare global {
  interface Window {
    grecaptcha?: { enterprise?: RecaptchaApi };
  }
}

let scriptPromise: Promise<void> | null = null;

function loadRecaptchaScript(): Promise<void> {
  if (window.grecaptcha?.enterprise) return Promise.resolve();
  if (scriptPromise) return scriptPromise;
  scriptPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(
      `script[src="${SCRIPT_SRC}"]`,
    );
    if (existing) {
      existing.addEventListener("load", () => resolve(), { once: true });
      existing.addEventListener("error", () => reject(new Error("recaptcha")), {
        once: true,
      });
      return;
    }
    const script = document.createElement("script");
    script.src = SCRIPT_SRC;
    script.async = true;
    script.defer = true;
    script.addEventListener("load", () => resolve(), { once: true });
    script.addEventListener("error", () => reject(new Error("recaptcha")), {
      once: true,
    });
    document.head.appendChild(script);
  });
  return scriptPromise;
}

export interface RecaptchaHandle {
  /** Mint a token for one submission. Null when the widget is unusable. */
  getToken: (action: string) => Promise<string | null>;
  reset: () => void;
}

interface RecaptchaWidgetProps {
  readonly sitekey: string;
  readonly defaultAction: string;
  readonly onReady: (ready: boolean) => void;
}

/**
 * reCAPTCHA Enterprise, policy-based challenge key.
 *
 * `size: "invisible"` is REQUIRED and is not a style choice. Without it,
 * `render()` returns a widget id and then fires `error-callback` with
 * "Policy-based challenge cannot be rendered as a checkbox", after which
 * `execute()` throws "grecaptcha.execute only works with invisible reCAPTCHA".
 * A returned widget id is therefore NOT evidence of a working widget.
 *
 * Google's policy-based install page documents the declarative
 * `class="g-recaptcha"` form instead. We deliberately do not use it: that
 * pattern is scanned once at script load, so a React form that unmounts and
 * remounts gets an empty container and silently cannot submit. That exact bug
 * shipped on Turnstile and was live for weeks. Please do not "fix" this back.
 *
 * Tokens are minted at SUBMIT time, never at mount: a reCAPTCHA token expires
 * two minutes after it is issued, so one created when the form first rendered
 * would be dead before a visitor finished typing.
 */
const RecaptchaWidget = forwardRef<RecaptchaHandle, RecaptchaWidgetProps>(
  function RecaptchaWidget(
    { sitekey, defaultAction, onReady },
    ref,
  ): ReactElement {
    const containerRef = useRef<HTMLDivElement>(null);
    const widgetIdRef = useRef<number | null>(null);
    const onReadyRef = useRef(onReady);
    onReadyRef.current = onReady;

    useImperativeHandle(ref, () => ({
      getToken: async (action: string) => {
        const id = widgetIdRef.current;
        const api = window.grecaptcha?.enterprise;
        if (id === null || !api) {
          reportCaptchaUnavailable("execute_failed", "recaptcha");
          return null;
        }
        try {
          // A fresh token per call. `reset` first so a retry after a failed
          // submission does not re-present a token the server already consumed:
          // a second assessment of the same token returns invalidReason DUPE.
          api.reset(id);
          return await Promise.race([
            api.execute(id, { action }),
            new Promise<null>((resolve) =>
              setTimeout(() => {
                reportCaptchaUnavailable("execute_timeout", "recaptcha");
                resolve(null);
              }, EXECUTE_TIMEOUT_MS),
            ),
          ]);
        } catch {
          reportCaptchaUnavailable("execute_failed", "recaptcha");
          return null;
        }
      },
      reset: () => {
        const id = widgetIdRef.current;
        if (id !== null && window.grecaptcha?.enterprise) {
          window.grecaptcha.enterprise.reset(id);
        }
      },
    }));

    useEffect(() => {
      const container = containerRef.current;
      if (!sitekey || !container) {
        // No key in the bundle is a provisioning defect, not a visitor one, so
        // it is reported under its own reason and should read as zero.
        if (!sitekey) reportCaptchaUnavailable("unconfigured", "recaptcha");
        onReadyRef.current(false);
        return;
      }

      let cancelled = false;
      void loadRecaptchaScript()
        .then(() => {
          const api = window.grecaptcha?.enterprise;
          if (cancelled || !api || !containerRef.current) return;
          api.ready(() => {
            if (cancelled || !containerRef.current) return;
            try {
              widgetIdRef.current = api.render(containerRef.current, {
                sitekey,
                size: "invisible",
                action: defaultAction,
                "error-callback": () => {
                  reportCaptchaUnavailable("runtime_error", "recaptcha");
                  onReadyRef.current(false);
                },
                "expired-callback": () => {
                  reportCaptchaUnavailable("expired", "recaptcha");
                  onReadyRef.current(false);
                },
              });
              onReadyRef.current(true);
            } catch {
              reportCaptchaUnavailable("render_failed", "recaptcha");
              onReadyRef.current(false);
            }
          });
        })
        .catch(() => {
          // The dominant real-world case: an ad blocker, DNS sinkhole or
          // corporate firewall kept Google's script from loading at all. The
          // visitor sees "could not complete the security check" and their
          // lead never leaves the browser, so this counter is the only place
          // that loss is visible.
          reportCaptchaUnavailable("script_blocked", "recaptcha");
          if (!cancelled) onReadyRef.current(false);
        });

      return () => {
        cancelled = true;
        // reCAPTCHA exposes no remove(); resetting releases the challenge state
        // so a remount starts clean rather than inheriting a consumed widget.
        const id = widgetIdRef.current;
        widgetIdRef.current = null;
        if (id !== null && window.grecaptcha?.enterprise) {
          try {
            window.grecaptcha.enterprise.reset(id);
          } catch {
            // A widget whose container has already gone is not an error here.
          }
        }
      };
    }, [sitekey, defaultAction]);

    return <div ref={containerRef} className="mt-2" />;
  },
);

export default RecaptchaWidget;
