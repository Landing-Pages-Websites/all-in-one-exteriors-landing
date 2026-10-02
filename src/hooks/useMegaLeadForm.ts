"use client";

import { useCallback, useEffect, useRef } from "react";
import { captureLeadContext, initAttribution } from "@/lib/megaLeadContext";
import { isValidEmail } from "@/lib/leadValidation";
import {
  isValidPhone,
  phoneDigits,
  qualifyRoofLead,
  type RoofLeadFields,
  type RoofLeadQualification,
} from "@/lib/roofLead";
import { siteConfig } from "@/site.config";

/**
 * Standalone ads LP: leads go straight to the canonical MEGA submission API.
 * site_id is a Flow B placeholder in site.config.ts until registration.
 */
const CONFIG = {
  CUSTOMER_ID: siteConfig.megaCustomerId,
  SITE_ID: siteConfig.megaSiteId,
  SOURCE_PROVIDER: siteConfig.sourceProvider,
  ENDPOINT: "https://analytics.gomega.ai/submission/submit",
} as const;

const REQUEST_TIMEOUT_MS = 15_000;

/** The endpoint answered, but not with a confirmed submission. */
class SubmissionRejectedError extends Error {}

export interface SubmissionResult {
  id?: string;
  /** The exact values MEGA stored, for the post-success form-capture event. */
  fields: RoofLeadFields;
  qualification: RoofLeadQualification;
}

interface UseMegaLeadFormReturn {
  submit: (fields: RoofLeadFields, formKey: string) => Promise<SubmissionResult>;
}

function normalizeFields(fields: RoofLeadFields): RoofLeadFields {
  const normalized: RoofLeadFields = {
    firstName: fields.firstName.trim(),
    lastName: fields.lastName.trim(),
    email: fields.email.trim(),
    phone: phoneDigits(fields.phone),
    decisionMaker: fields.decisionMaker,
    roofStatus: fields.roofStatus,
  };
  if (!normalized.firstName || !normalized.lastName) {
    throw new Error("First and last name are required");
  }
  if (!isValidEmail(normalized.email)) throw new Error("Enter a valid email address");
  if (!isValidPhone(fields.phone)) throw new Error("Phone must be exactly 10 digits");
  if (!normalized.decisionMaker || !normalized.roofStatus) {
    throw new Error("Both qualifying questions are required");
  }
  return normalized;
}

function generateSubmissionId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `sub_${crypto.randomUUID()}`;
  }
  return `sub_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`;
}

/** Only `{ ok: true }` counts; any other 2xx body is a failed submission. */
function confirmedId(json: unknown): string | undefined {
  if (typeof json !== "object" || json === null || !("ok" in json) || json.ok !== true) {
    throw new SubmissionRejectedError("Submission was not confirmed by the server");
  }
  return "id" in json && typeof json.id === "string" ? json.id : undefined;
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    throw new SubmissionRejectedError("Submission endpoint returned a malformed response");
  }
}

async function postSubmission(payload: Record<string, unknown>): Promise<string | undefined> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(CONFIG.ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    if (!response.ok) throw new SubmissionRejectedError(`Submission endpoint returned HTTP ${response.status}`);
    return confirmedId(await readJson(response));
  } catch (error) {
    if (error instanceof SubmissionRejectedError) throw error;
    throw new Error("Submission request failed before the server confirmed it", { cause: error });
  } finally {
    window.clearTimeout(timer);
  }
}

/**
 * MEGA lead submission. Validates, then POSTs one attempt with its own
 * submission_id. Throws on every unconfirmed outcome so callers fail closed.
 * NEVER submit leads any other way — no direct database access.
 */
export const useMegaLeadForm = (): UseMegaLeadFormReturn => {
  const inFlightRef = useRef(false);

  useEffect(() => {
    initAttribution();
  }, []);

  const submit = useCallback(
    async (fields: RoofLeadFields, formKey: string): Promise<SubmissionResult> => {
      if (inFlightRef.current) throw new Error("A submission is already in progress");
      inFlightRef.current = true;
      try {
        const normalized = normalizeFields(fields);
        const qualification = qualifyRoofLead(normalized);
        const id = await postSubmission({
          ...captureLeadContext(),
          customer_id: CONFIG.CUSTOMER_ID,
          site_id: CONFIG.SITE_ID,
          source_provider: CONFIG.SOURCE_PROVIDER,
          submission_id: generateSubmissionId(),
          // Top level, never in form_data: MEGA routes on it as transport.
          form_key: formKey,
          form_data: { ...normalized, ...qualification },
        });
        return { id, fields: normalized, qualification };
      } finally {
        inFlightRef.current = false;
      }
    },
    [],
  );

  return { submit };
};

export default useMegaLeadForm;
