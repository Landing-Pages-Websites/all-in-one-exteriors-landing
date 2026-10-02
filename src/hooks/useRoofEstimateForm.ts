"use client";

import { useRouter } from "next/navigation";
import {
  useCallback,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
  type RefObject,
} from "react";
import { useMegaLeadForm } from "@/hooks/useMegaLeadForm";
import { trackLeadCaptured } from "@/hooks/useTracking";
import { DEFAULT_FORM_KEY } from "@/lib/leadValidation";
import {
  EMPTY_ROOF_LEAD,
  formatPhone,
  type RoofLeadFieldName,
  type RoofLeadFields,
} from "@/lib/roofLead";
import { siteConfig } from "@/site.config";

export const SUBMIT_ERROR_MESSAGE = `We couldn't send your request. Please try again, or call ${siteConfig.contact.phone}.`;

export type SubmitStatus = "idle" | "submitting" | "success";

export interface UseRoofEstimateFormReturn {
  formRef: RefObject<HTMLFormElement | null>;
  fields: RoofLeadFields;
  status: SubmitStatus;
  submitError: string | null;
  setField: (name: RoofLeadFieldName, value: string) => void;
  /** The submit button's click: validate first, then perform the submission. */
  attemptSubmit: () => void;
  /** Enter-to-submit, routed through the same validation as the button. */
  handleKeyDown: (event: KeyboardEvent<HTMLFormElement>) => void;
  /** Blocks native submission only; it never performs one. */
  handleSubmit: (event: FormEvent<HTMLFormElement>) => void;
}

/**
 * State and submit flow for one roof-estimate form instance.
 *
 * Fails closed: only a confirmed `{ ok: true }` shows success, tracks, and
 * redirects. Anything else keeps the fields, shows a retryable error, and
 * clears the latch. No native submit is ever dispatched, so nothing can
 * observe a conversion before the API confirms it.
 */
export function useRoofEstimateForm(
  placement: string,
): UseRoofEstimateFormReturn {
  const router = useRouter();
  const { submit } = useMegaLeadForm();
  const formRef = useRef<HTMLFormElement>(null);
  // React state is batched, so a burst of clicks in one tick would all read
  // status "idle". The ref flips synchronously.
  const inFlightRef = useRef(false);
  const [fields, setFields] = useState<RoofLeadFields>(EMPTY_ROOF_LEAD);
  const [status, setStatus] = useState<SubmitStatus>("idle");
  const [submitError, setSubmitError] = useState<string | null>(null);

  const setField = useCallback(
    (name: RoofLeadFieldName, value: string): void => {
      setFields((prev) => ({
        ...prev,
        [name]: name === "phone" ? formatPhone(value) : value,
      }));
    },
    [],
  );

  const performSubmit = useCallback(async (): Promise<void> => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    setStatus("submitting");
    setSubmitError(null);
    try {
      // Both instances are the same estimate request: one declared form key
      // for routing; placement only distinguishes them in analytics.
      const result = await submit(fields, DEFAULT_FORM_KEY);
      setStatus("success");
      trackLeadCaptured(placement, result.fields, result.qualification);
      // Carry the ad click's query string so thank-you conversions attribute.
      router.push(`${siteConfig.thankYouPath}${window.location.search}`);
    } catch {
      // Success stays latched for the redirect; only a failure reopens the form.
      inFlightRef.current = false;
      setStatus("idle");
      setSubmitError(SUBMIT_ERROR_MESSAGE);
    }
  }, [fields, placement, router, submit]);

  const attemptSubmit = useCallback((): void => {
    const form = formRef.current;
    if (!form || inFlightRef.current) return;
    if (!form.checkValidity()) {
      form.reportValidity();
      return;
    }
    void performSubmit();
  }, [performSubmit]);

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLFormElement>): void => {
      if (event.key !== "Enter" || event.nativeEvent.isComposing) return;
      // A focused button already activates itself on Enter.
      if (event.target instanceof HTMLButtonElement) return;
      event.preventDefault();
      attemptSubmit();
    },
    [attemptSubmit],
  );

  const handleSubmit = useCallback(
    (event: FormEvent<HTMLFormElement>): void => {
      event.preventDefault();
    },
    [],
  );

  return {
    formRef,
    fields,
    status,
    submitError,
    setField,
    attemptSubmit,
    handleKeyDown,
    handleSubmit,
  };
}
