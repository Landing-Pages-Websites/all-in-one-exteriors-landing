"use client";

import { useEffect, useCallback, useRef } from "react";
import {
  captureLeadContext,
  initAttribution,
  type Attribution,
} from "@/lib/megaLeadContext";
import {
  HONEYPOT_FIELD_NAME,
  isValidEmail,
  isValidPhone,
  phoneDigits,
} from "@/lib/leadValidation";
import {
  declaredContentType,
  parseSignedUploads,
  uploadSignedFiles,
} from "@/lib/leadUploads";

export {
  EMAIL_PATTERN,
  EMAIL_REGEX,
  formatPhone,
  isValidEmail,
  isValidPhone,
} from "@/lib/leadValidation";

export type { Attribution };

export interface SubmissionResponse {
  ok: boolean;
  id?: string;
  ignored?: boolean;
}

interface UseMegaLeadFormReturn {
  submit: (
    formData: Record<string, unknown>,
    files?: readonly File[],
    signingToken?: string | null,
  ) => Promise<SubmissionResponse>;
  isReady: boolean;
}

/**
 * Mega lead submission hook. Validates email/phone, then POSTs to this
 * site's `/api/lead` (Turnstile + honeypot + Keystone). NEVER submit leads
 * any other way — no direct database access from frontend code.
 */
/**
 * Hashes the submission's token so the signing step can bind to it without ever
 * seeing it. Returns null where WebCrypto is unavailable, which skips
 * attachments rather than sending an unbindable request.
 */
async function submissionBinding(token: string): Promise<string | null> {
  try {
    const digest = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(token),
    );
    return [...new Uint8Array(digest)]
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");
  } catch (error) {
    console.warn("Cannot bind attachments to this submission", error);
    return null;
  }
}

export interface AttachmentClaim {
  keys: string[];
  signedKeys: string[];
  capability: string | null;
}

const NO_ATTACHMENTS: AttachmentClaim = {
  keys: [],
  signedKeys: [],
  capability: null,
};

/**
 * Signs and uploads the visitor's files, returning what the submission may claim.
 *
 * Uses a challenge token of its OWN so the submission's token is never spent
 * here, and binds the result to the submission's token by hash so the keys
 * cannot be presented by any other submission.
 *
 * Returns nothing claimable on any failure rather than throwing. The caller
 * submits either way.
 */
async function uploadAttachments(
  files: readonly File[],
  signingToken: string,
  binding: string,
): Promise<AttachmentClaim> {
  try {
    const response = await fetch("/api/lead/upload-url", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        turnstileToken: signingToken,
        submissionBinding: binding,
        files: files.map((file) => ({
          fileName: file.name,
          contentType: declaredContentType(file),
          sizeBytes: file.size,
        })),
      }),
    });
    if (!response.ok) {
      console.warn("Could not sign attachments", response.status);
      return NO_ATTACHMENTS;
    }
    const json: unknown = await response.json();
    const uploads = parseSignedUploads(json);
    if (uploads === null) {
      console.warn("Attachment signing returned an unexpected shape");
      return NO_ATTACHMENTS;
    }
    const capability = (json as { capability?: unknown }).capability;
    if (typeof capability !== "string") return NO_ATTACHMENTS;
    return {
      keys: await uploadSignedFiles(files, uploads),
      signedKeys: uploads.map((upload) => upload.s3Key),
      capability,
    };
  } catch (error) {
    console.warn("Attachment upload step failed", error);
    return NO_ATTACHMENTS;
  }
}

export const useMegaLeadForm = (): UseMegaLeadFormReturn => {
  const isInitialized = useRef(false);

  useEffect(() => {
    if (!isInitialized.current) {
      initAttribution();
      isInitialized.current = true;
    }
  }, []);

  const submit = useCallback(
    async (
      formData: Record<string, unknown>,
      files: readonly File[] = [],
      signingToken: string | null = null,
    ): Promise<SubmissionResponse> => {
      if (!isValidPhone(String(formData.phone ?? ""))) {
        throw new Error("Phone must be exactly 10 digits");
      }
      if (!formData.firstName || !formData.lastName || !formData.email) {
        throw new Error("firstName, lastName and email are required");
      }
      if (!isValidEmail(formData.email)) {
        throw new Error("Enter a valid email address");
      }
      formData.phone = phoneDigits(String(formData.phone));

      // Uploads happen before the submission so the keys can be declared on it.
      // Every failure below costs the attachments and never the enquiry.
      // Attachments need a challenge of their own, supplied only when the form
      // could obtain a second token, and a binding to this submission's token.
      // Without either the files are skipped rather than the submission risked.
      // Both wire names, because this hook ships to sites whose forms still
      // send the legacy one. Reading only the canonical name would compute no
      // binding there, and every attachment would be dropped silently while the
      // lead itself still sent.
      const rawToken = formData.captchaToken ?? formData.turnstileToken;
      const submitToken = typeof rawToken === "string" ? rawToken : null;
      const binding =
        files.length > 0 && signingToken !== null && submitToken !== null
          ? await submissionBinding(submitToken)
          : null;
      const claim =
        binding !== null && signingToken !== null
          ? await uploadAttachments(files, signingToken, binding)
          : NO_ATTACHMENTS;

      const response = await fetch("/api/lead", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...formData,
          ...(claim.capability !== null
            ? {
                uploadKeys: claim.keys,
                uploadSignedKeys: claim.signedKeys,
                uploadCapability: claim.capability,
              }
            : {}),
          context: captureLeadContext(),
        }),
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const json: unknown = await response.json();
      if (
        typeof json !== "object" ||
        json === null ||
        !("ok" in json) ||
        (json as { ok: unknown }).ok !== true
      ) {
        throw new Error(
          `Submission rejected: ${JSON.stringify(json)?.slice(0, 200)}`,
        );
      }
      const ignored =
        "ignored" in json && (json as { ignored: unknown }).ignored === true;
      return {
        ok: true,
        ...("id" in json && typeof (json as { id: unknown }).id === "string"
          ? { id: (json as { id: string }).id }
          : {}),
        ...(ignored ? { ignored: true } : {}),
      };
    },
    [],
  );

  return { submit, isReady: typeof window !== "undefined" };
};

export { HONEYPOT_FIELD_NAME };
export default useMegaLeadForm;
