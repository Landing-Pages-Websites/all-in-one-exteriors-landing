import assert from "node:assert/strict";
import test from "node:test";
import { RECAPTCHA_PROJECT_ID, assessmentAuthorizes } from "./recaptcha.ts";

const HOSTS = ["allpointsco.com", "www.allpointsco.com"];
const ACTION = "lead_submit";

/** A clean assessment, exactly as the live API returned one on 2026-09-17. */
function clean(over: Record<string, unknown> = {}): unknown {
  return {
    tokenProperties: {
      valid: true,
      invalidReason: "INVALID_REASON_UNSPECIFIED",
      hostname: "allpointsco.com",
      action: ACTION,
      clientSignalsFailed: false,
      createTime: "2026-09-17T18:51:22.598Z",
      ...(over.tokenProperties as object | undefined),
    },
    riskAnalysis: {
      score: 0.9,
      challenge: "NOCAPTCHA",
      lastChallengeType: "CHALLENGE_TYPE_UNSPECIFIED",
      reasons: [],
      ...(over.riskAnalysis as object | undefined),
    },
  };
}

function decide(assessment: unknown): boolean {
  return assessmentAuthorizes(assessment, {
    expectedAction: ACTION,
    allowedHostnames: HOSTS,
  });
}

const TABLE: ReadonlyArray<{
  readonly name: string;
  readonly assessment: unknown;
  readonly expect: boolean;
}> = [
  { name: "clean, NOCAPTCHA", assessment: clean(), expect: true },
  {
    name: "challenge solved, PASSED",
    assessment: clean({ riskAnalysis: { challenge: "PASSED" } }),
    expect: true,
  },
  {
    name: "hostname casing differs",
    assessment: clean({ tokenProperties: { hostname: "AllPointsCo.COM" } }),
    expect: true,
  },

  // --- the enum ---
  {
    name: "challenge FAILED",
    assessment: clean({ riskAnalysis: { challenge: "FAILED" } }),
    expect: false,
  },
  // Pins the constant. An early draft of the design said `PASS`, which would
  // have rejected every challenged visitor in production; this row fails here
  // instead if anyone regresses to it.
  {
    name: "challenge PASS (the wrong constant)",
    assessment: clean({ riskAnalysis: { challenge: "PASS" } }),
    expect: false,
  },
  {
    name: "challenge CHALLENGE_UNSPECIFIED",
    assessment: clean({ riskAnalysis: { challenge: "CHALLENGE_UNSPECIFIED" } }),
    expect: false,
  },
  {
    name: "challenge is a future enum member",
    assessment: clean({ riskAnalysis: { challenge: "CHALLENGE_DEFERRED" } }),
    expect: false,
  },
  {
    name: "challenge missing entirely",
    assessment: { ...(clean() as object), riskAnalysis: { score: 0.9 } },
    expect: false,
  },

  // --- THE replay trap ---
  // A replayed token comes back invalid while `challenge` still reads
  // NOCAPTCHA. Anything that consults `challenge` before `valid` accepts every
  // replay. This row is the reason the order in assessmentAuthorizes is fixed.
  {
    name: "DUPE replay still reporting challenge NOCAPTCHA",
    assessment: {
      tokenProperties: {
        valid: false,
        invalidReason: "DUPE",
        hostname: "",
        action: "",
        createTime: "1970-01-01T00:00:00Z",
      },
      riskAnalysis: { score: 0, challenge: "NOCAPTCHA", reasons: [] },
    },
    expect: false,
  },

  // --- invalid tokens: every documented reason ---
  ...(
    [
      "EXPIRED",
      "MISSING",
      "MALFORMED",
      "BROWSER_ERROR",
      "UNEXPECTED_ACTION",
      "KEY_MISMATCH",
      "DOMAIN_MISMATCH",
      "UNKNOWN_INVALID_REASON",
    ] as const
  ).map((reason) => ({
    name: `invalid: ${reason}`,
    assessment: {
      tokenProperties: {
        valid: false,
        invalidReason: reason,
        hostname: "",
        action: "",
      },
      riskAnalysis: { score: 0, challenge: "NOCAPTCHA" },
    },
    expect: false,
  })),

  // An invalid token reports empty hostname and action. Neither may be read as
  // "matches", which is what an allowlist containing "" would do.
  {
    name: "valid false with empty hostname and action",
    assessment: {
      tokenProperties: { valid: false, hostname: "", action: "" },
      riskAnalysis: { challenge: "PASSED" },
    },
    expect: false,
  },
  {
    name: "valid is the string 'true', not a boolean",
    assessment: clean({ tokenProperties: { valid: "true" } }),
    expect: false,
  },

  // --- action ---
  {
    name: "action mismatch",
    assessment: clean({ tokenProperties: { action: "lead_upload" } }),
    expect: false,
  },
  {
    name: "action empty",
    assessment: clean({ tokenProperties: { action: "" } }),
    expect: false,
  },
  {
    name: "action missing",
    assessment: {
      tokenProperties: { valid: true, hostname: "allpointsco.com" },
      riskAnalysis: { challenge: "NOCAPTCHA" },
    },
    expect: false,
  },

  // --- hostname: substring attacks ---
  {
    name: "hostname evil-allpointsco.com",
    assessment: clean({
      tokenProperties: { hostname: "evil-allpointsco.com" },
    }),
    expect: false,
  },
  {
    name: "hostname allpointsco.com.evil.test",
    assessment: clean({
      tokenProperties: { hostname: "allpointsco.com.evil.test" },
    }),
    expect: false,
  },
  {
    name: "hostname is a subdomain not on the list",
    assessment: clean({ tokenProperties: { hostname: "dev.allpointsco.com" } }),
    expect: false,
  },
  {
    name: "hostname empty",
    assessment: clean({ tokenProperties: { hostname: "" } }),
    expect: false,
  },

  // --- shape ---
  { name: "null assessment", assessment: null, expect: false },
  { name: "string assessment", assessment: "ok", expect: false },
  { name: "empty object", assessment: {}, expect: false },
  {
    name: "tokenProperties missing",
    assessment: { riskAnalysis: { challenge: "NOCAPTCHA" } },
    expect: false,
  },
];

for (const row of TABLE) {
  test(`assessment: ${row.name}`, () => {
    assert.equal(decide(row.assessment), row.expect);
  });
}

// The allowlist itself must fail closed when unset. turnstile.ts historically
// applied its hostname check only when the list was non-empty, which meant an
// unset variable silently disabled the check.
test("an empty hostname allowlist rejects even a clean assessment", () => {
  assert.equal(
    assessmentAuthorizes(clean(), {
      expectedAction: ACTION,
      allowedHostnames: [],
    }),
    false,
  );
});

test("an allowlist containing only blanks rejects", () => {
  assert.equal(
    assessmentAuthorizes(clean(), {
      expectedAction: ACTION,
      allowedHostnames: ["", "   "],
    }),
    false,
  );
});

// Guards the "" comparison directly: a blank entry must never authorise the
// empty hostname an invalid token reports.
test("a blank allowlist entry does not authorise an empty hostname", () => {
  assert.equal(
    assessmentAuthorizes(
      {
        tokenProperties: { valid: true, hostname: "", action: ACTION },
        riskAnalysis: { challenge: "NOCAPTCHA" },
      },
      { expectedAction: ACTION, allowedHostnames: ["", "allpointsco.com"] },
    ),
    false,
  );
});

// CROSS-REPO CONTRACT. megaseo-web's `google_recaptcha_client.ts` mints keys in
// this project; this file assesses tokens against it. The two repos share no
// package, so the literal is pinned on both sides. If they ever diverge every
// assessment 404s or, worse, resolves against a project holding no such key,
// and the form rejects every visitor with no clue why.
test("the GCP project is the one the provisioner mints keys in", () => {
  assert.equal(RECAPTCHA_PROJECT_ID, "mega-seo-432712");
});
