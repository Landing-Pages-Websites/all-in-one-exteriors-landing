import assert from "node:assert/strict";
import test from "node:test";
import {
  reportCaptchaUnavailable,
  type CaptchaUnavailableReason,
} from "./telemetry.ts";

type Sink = { event?: string; reason?: string; provider?: string };

function withWindow(build: (pushed: Sink[]) => Record<string, unknown>) {
  const pushed: Sink[] = [];
  const original = (globalThis as { window?: unknown }).window;
  (globalThis as { window?: unknown }).window = build(pushed);
  return {
    pushed,
    restore() {
      (globalThis as { window?: unknown }).window = original;
    },
  };
}

const ALL_REASONS: CaptchaUnavailableReason[] = [
  "unconfigured",
  "script_blocked",
  "render_failed",
  "runtime_error",
  "expired",
  "execute_timeout",
  "execute_failed",
];

// The point of the counter is telling the causes apart. A visitor-side block
// and a site that shipped with no key both end the submission, but one is
// expected background and the other means provisioning failed, so a reader
// who cannot separate them learns nothing actionable.
test("every reason reaches the sink as its own distinct value", () => {
  const w = withWindow((pushed) => ({ dataLayer: pushed }));
  try {
    for (const reason of ALL_REASONS) {
      reportCaptchaUnavailable(reason, "recaptcha");
    }
    assert.deepEqual(
      w.pushed.map((e) => e.reason),
      ALL_REASONS,
      "reasons must arrive unmerged and in order",
    );
    assert.equal(
      new Set(w.pushed.map((e) => e.reason)).size,
      ALL_REASONS.length,
      "no two reasons may collapse to the same value",
    );
    for (const entry of w.pushed) {
      assert.equal(entry.event, "captcha_unavailable");
      assert.equal(entry.provider, "recaptcha");
    }
  } finally {
    w.restore();
  }
});

test("the provider rides along, so one counter serves both", () => {
  const w = withWindow((pushed) => ({ dataLayer: pushed }));
  try {
    reportCaptchaUnavailable("script_blocked", "turnstile");
    assert.equal(w.pushed[0]?.provider, "turnstile");
  } finally {
    w.restore();
  }
});

// This runs inside a submit the visitor is waiting on. An analytics fault must
// cost them nothing, so every sink is allowed to be missing or hostile.
test("a hostile or absent analytics surface never throws", () => {
  const cases: Array<[string, Record<string, unknown>]> = [
    ["no analytics at all", {}],
    [
      "dataLayer.push throws",
      {
        dataLayer: {
          push() {
            throw new Error("blocked by extension");
          },
        },
      },
    ],
    [
      "MegaTag.trackEvent throws",
      {
        dataLayer: [],
        MegaTag: {
          trackEvent() {
            throw new Error("tag manager gone");
          },
        },
      },
    ],
    [
      "dataLayer is a hostile getter",
      Object.defineProperty({}, "dataLayer", {
        get() {
          throw new Error("trap");
        },
        configurable: true,
      }),
    ],
  ];
  for (const [label, win] of cases) {
    const w = withWindow(() => win);
    try {
      assert.doesNotThrow(
        () => reportCaptchaUnavailable("script_blocked", "recaptcha"),
        `${label}: reporting must never throw`,
      );
    } finally {
      w.restore();
    }
  }
});

test("server-side rendering is a no-op rather than a crash", () => {
  const original = (globalThis as { window?: unknown }).window;
  (globalThis as { window?: unknown }).window = undefined;
  try {
    assert.doesNotThrow(() =>
      reportCaptchaUnavailable("unconfigured", "recaptcha"),
    );
  } finally {
    (globalThis as { window?: unknown }).window = original;
  }
});
