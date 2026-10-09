"use client";

import { useRouter } from "next/navigation";
import {
  useId,
  useRef,
  useState,
  type FormEvent,
  type ReactElement,
} from "react";
import {
  EMAIL_PATTERN,
  formatPhone,
  isValidEmail,
  isValidPhone,
  useMegaLeadForm,
} from "@/hooks/useWebsiteLeadForm";
import { DEFAULT_FORM_KEY, HONEYPOT_FIELD_NAME } from "@/lib/leadValidation";
import { getPostHogClient } from "@/lib/posthog-client";
import { siteConfig } from "@/site.config";
import HoneypotField from "@/components/HoneypotField";
import CaptchaWidget, { type CaptchaHandle } from "@/components/CaptchaWidget";
import {
  selectUploadableFiles,
  UPLOAD_ACCEPT_ATTRIBUTE,
  type UploadRejection,
} from "@/lib/leadUploads";

const inputClasses =
  "w-full rounded-md border-2 border-neutral-300 bg-white px-3 py-2.5 text-sm text-neutral-900 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100";

const SUBMIT_ERROR_MESSAGE =
  "Something went wrong sending your request. Please check your connection and try again.";

const LP_PRIVACY_URL = "https://services.allinoneexteriors.com/privacy-policy";
const LP_TERMS_URL = "https://services.allinoneexteriors.com/terms-and-conditions";

const budgetToggleClasses =
  "rounded-lg border-2 border-neutral-300 py-2.5 text-center text-sm font-semibold transition-all peer-checked:border-neutral-900 peer-checked:bg-neutral-900 peer-checked:text-white dark:border-neutral-700 dark:peer-checked:border-white dark:peer-checked:bg-white dark:peer-checked:text-neutral-900";

declare global {
  interface Window {
    MegaTag?: {
      trackEvent?: (event: string, data: Record<string, string>) => void;
    };
  }
}

/**
 * Fires post-submit analytics. Per the landing-page-tracking skill, the
 * dataLayer event name is `form_submission` (distinct from the optimizer's
 * own `form_submit`) so any dataLayer consumer has its own trigger — and the
 * manual MegaTag.trackEvent("form_submit", …) ships alongside it ("never one
 * without the other"). Lead PII never goes on either event: Keystone already
 * received the fields on `/api/lead`.
 */
function trackFormSubmission(): void {
  if (typeof window === "undefined") {
    return;
  }
  window.dataLayer = window.dataLayer || [];
  window.dataLayer.push({ event: "form_submission" });
  window.MegaTag?.trackEvent?.("form_submit", { form: "lead" });
  getPostHogClient()?.capture("lead_form_submit");
}

/**
 * Lead capture form wired to the Mega submission contract
 * (landing-page-forms skill): validate-first + requestSubmit(), synchronous
 * inFlightRef duplicate guard, separate form_data key per field, and
 * name attributes the Mega optimizer reads. Redirects to
 * siteConfig.thankYouPath after submit.
 */
export function LeadForm({
  formKey = DEFAULT_FORM_KEY,
}: {
  /**
   * Which of the site's forms this is. Must be one of `siteConfig.formKeys`;
   * the route falls back to `contact-form` for anything else, so a typo shows
   * up as leads landing in the default bucket rather than as an error.
   *
   * Defaults to `contact-form`, so a site with one form keeps the registry row
   * and routing rule it already has. Pass a distinct key when a site renders a
   * SECOND form, or both register as the same one.
   */
  formKey?: string;
} = {}): ReactElement {
  const router = useRouter();
  const idPrefix = useId();
  const { submit } = useMegaLeadForm();

  const formRef = useRef<HTMLFormElement>(null);
  const captchaRef = useRef<CaptchaHandle>(null);
  // Synchronous duplicate-submit gate: React state is batched, so a
  // double-click in one tick would see submitting=false twice. A ref flips
  // immediately. Cleared in finally so a failed submit can be retried; a
  // confirmed success sets submitted=true, which permanently gates re-submit.
  const inFlightRef = useRef(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  // Readiness, not a token. Under reCAPTCHA no token exists until submit, so
  // gating the button on holding one would disable it permanently.
  const [captchaReady, setCaptchaReady] = useState(false);

  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [budget, setBudget] = useState("");
  const [attachments, setAttachments] = useState<File[]>([]);
  const [attachmentErrors, setAttachmentErrors] = useState<UploadRejection[]>(
    [],
  );
  const [smsConsent, setSmsConsent] = useState(false);

  const { budgetQualifier } = siteConfig;
  const budgetAnswered = budgetQualifier === null || budget !== "";
  const canSubmit =
    firstName.trim() !== "" &&
    lastName.trim() !== "" &&
    isValidEmail(email) &&
    isValidPhone(phone) &&
    budgetAnswered &&
    captchaReady;

  function handleClick(): void {
    if (
      firstName.trim() === "" ||
      lastName.trim() === "" ||
      !isValidEmail(email) ||
      !isValidPhone(phone) ||
      !budgetAnswered
    ) {
      formRef.current?.reportValidity();
      return;
    }
    if (!captchaReady) {
      setSubmitError(
        "Please wait a moment for the security check, then try again.",
      );
      return;
    }
    formRef.current?.requestSubmit();
  }

  // The submission's own token is never spent on an upload: signing asks for a
  // SECOND one. CaptchaWidget owns how that is obtained per provider — reset
  // and wait under Turnstile, a fresh execute() under reCAPTCHA — so this form
  // just asks twice with different actions. If the second does not arrive,
  // attachments are skipped and the enquiry goes exactly as it would have
  // without them.
  function requestSigningToken(): Promise<string | null> {
    return captchaRef.current?.getToken("lead_upload") ?? Promise.resolve(null);
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    void performSubmit();
  }

  async function performSubmit(): Promise<void> {
    if (inFlightRef.current || submitted) return; // synchronous gate
    if (!canSubmit) return;
    inFlightRef.current = true; // flips IMMEDIATELY, not next render
    setSubmitting(true);
    setSubmitError(null);
    const honeypotInput =
      formRef.current?.elements.namedItem(HONEYPOT_FIELD_NAME);
    const honeypotValue =
      honeypotInput instanceof HTMLInputElement ? honeypotInput.value : "";
    // Minted here, not held in state. A reCAPTCHA token expires two minutes
    // after it is issued, so one created when the form rendered would be dead
    // by the time a visitor finished typing.
    //
    // Taken BEFORE the signing token, so under Turnstile the submission gets
    // the token the widget already minted and signing gets the fresh one after
    // a reset — the order this form has always had.
    const captchaToken = await captchaRef.current?.getToken("lead_submit");
    if (typeof captchaToken !== "string" || captchaToken.length === 0) {
      // No token means no submission would be accepted anyway; say so here
      // rather than posting a request the server will reject.
      console.error("Could not obtain a captcha token");
      setSubmitError(SUBMIT_ERROR_MESSAGE);
      captchaRef.current?.reset();
      inFlightRef.current = false;
      setSubmitting(false);
      return;
    }
    const formData = {
      firstName: firstName.trim(),
      lastName: lastName.trim(),
      email: email.trim(),
      phone: phone.trim(),
      [HONEYPOT_FIELD_NAME]: honeypotValue,
      formKey,
      captchaToken,
      ...(budgetQualifier === null ? {} : { budget }),
      smsConsent: smsConsent === true,
    };
    try {
      const signingToken =
        attachments.length > 0 ? await requestSigningToken() : null;
      const res = await submit(formData, attachments, signingToken);
      // A 2xx with a body that isn't {ok:true} is still a dropped lead. Only a
      // confirmed success fires analytics and advances to the thank-you page.
      if (res?.ok !== true) {
        throw new Error("Submission not confirmed by server.");
      }
      if (res.ignored === true) {
        setSubmitted(true);
        return;
      }
      trackFormSubmission();
      setSubmitted(true);
      router.push(siteConfig.thankYouPath);
    } catch (error) {
      // The visitor is fine; the LEAD would be dropped. Surface a retryable error,
      // fire no analytics, and do not advance to the thank-you page.
      console.error("Form submission error:", error);
      setSubmitError(SUBMIT_ERROR_MESSAGE);
      captchaRef.current?.reset();
    } finally {
      inFlightRef.current = false;
      setSubmitting(false);
    }
  }

  return (
    <form
      ref={formRef}
      method="post"
      action="/api/lead"
      onSubmit={handleSubmit}
      data-lead-protection="turnstile"
      className="flex w-full max-w-md flex-col gap-4"
    >
      <div className="flex flex-col gap-1">
        <label
          htmlFor={`${idPrefix}-first-name`}
          className="text-sm font-medium"
        >
          First Name
        </label>
        <input
          id={`${idPrefix}-first-name`}
          name="firstName"
          type="text"
          required
          autoComplete="given-name"
          value={firstName}
          onChange={(e) => setFirstName(e.target.value)}
          className={inputClasses}
        />
      </div>
      <div className="flex flex-col gap-1">
        <label
          htmlFor={`${idPrefix}-last-name`}
          className="text-sm font-medium"
        >
          Last Name
        </label>
        <input
          id={`${idPrefix}-last-name`}
          name="lastName"
          type="text"
          required
          autoComplete="family-name"
          value={lastName}
          onChange={(e) => setLastName(e.target.value)}
          className={inputClasses}
        />
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor={`${idPrefix}-email`} className="text-sm font-medium">
          Email
        </label>
        <input
          id={`${idPrefix}-email`}
          name="email"
          type="email"
          required
          autoComplete="email"
          value={email}
          pattern={EMAIL_PATTERN}
          title="Enter a valid email address (e.g. you@company.com)"
          onChange={(e) => setEmail(e.target.value)}
          className={inputClasses}
        />
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor={`${idPrefix}-phone`} className="text-sm font-medium">
          Phone
        </label>
        <input
          id={`${idPrefix}-phone`}
          name="phone"
          type="tel"
          inputMode="numeric"
          required
          autoComplete="tel"
          value={phone}
          onChange={(e) => setPhone(formatPhone(e.target.value))}
          placeholder="(555) 123-4567"
          pattern="\(\d{3}\) \d{3}-\d{4}"
          title="Please enter a valid 10-digit phone number"
          className={inputClasses}
        />
      </div>
      {budgetQualifier === null ? null : (
        <fieldset>
          <legend className="mb-2 text-sm font-medium">
            {budgetQualifier.priceAnchor} {budgetQualifier.question}
          </legend>
          <div className="flex gap-3">
            {(["yes", "no"] as const).map((option) => (
              <label key={option} className="flex-1 cursor-pointer">
                <input
                  type="radio"
                  name="budget"
                  value={option}
                  required
                  checked={budget === option}
                  onChange={() => setBudget(option)}
                  className="sr-only peer"
                />
                <div className={budgetToggleClasses}>
                  {option === "yes" ? "Yes" : "No"}
                </div>
              </label>
            ))}
          </div>
        </fieldset>
      )}
      <div className="flex items-start gap-3">
        <input
          id={`${idPrefix}-smsConsent`}
          name="smsConsent"
          type="checkbox"
          value="true"
          checked={smsConsent}
          onChange={(event) => setSmsConsent(event.target.checked)}
          className="mt-1 size-4 shrink-0 accent-brand"
        />
        <div>
          <label
            htmlFor={`${idPrefix}-smsConsent`}
            className="cursor-pointer text-sm leading-relaxed"
          >
            By checking this box, you agree to receive SMS customer-care messages
            from All In One Exteriors, including inspection scheduling and
            confirmations, reminders, project updates, and service-related
            communications. Message frequency may vary. Message and data rates
            may apply. Reply STOP to opt out. Reply HELP for help. Consent is
            not a condition of purchase. Your mobile information will not be
            sold or shared with third parties for promotional or marketing
            purposes.{" "}
            <a
              href={LP_PRIVACY_URL}
              className="font-semibold text-gold underline"
            >
              Privacy Policy
            </a>
            {" | "}
            <a href={LP_TERMS_URL} className="font-semibold text-gold underline">
              Terms &amp; Conditions
            </a>
          </label>
          <p className="mt-1.5 text-sm leading-relaxed text-muted">
            Optional. You can submit this form without opting in to text
            messages.
          </p>
        </div>
      </div>
      <HoneypotField />
      {siteConfig.uploadsEnabled === true && (
        <div className="flex flex-col gap-1">
          <label
            htmlFor={`${idPrefix}-attachments`}
            className="text-sm font-medium"
          >
            Attachments <span className="font-normal">(optional)</span>
          </label>
          <input
            id={`${idPrefix}-attachments`}
            name="attachments"
            type="file"
            multiple
            accept={UPLOAD_ACCEPT_ATTRIBUTE}
            disabled={submitting || submitted}
            onChange={(event) => {
              const chosen = Array.from(event.target.files ?? []);
              const { accepted, rejected } = selectUploadableFiles(chosen);
              setAttachments(accepted);
              setAttachmentErrors(rejected);
            }}
            className={inputClasses}
          />
          {attachments.length > 0 && (
            <ul className="text-xs">
              {attachments.map((file) => (
                <li key={`${file.name}-${file.size}`}>{file.name}</li>
              ))}
            </ul>
          )}
          {attachmentErrors.map((rejection) => (
            <p
              key={`${rejection.fileName}-${rejection.reason}`}
              className="text-xs text-red-600"
              role="alert"
            >
              {rejection.fileName}: {rejection.reason}
            </p>
          ))}
        </div>
      )}

      <CaptchaWidget ref={captchaRef} onReady={setCaptchaReady} />
      {submitError ? (
        <p
          role="alert"
          aria-live="polite"
          className="rounded-md border-2 border-red-300 bg-red-50 px-3 py-2.5 text-sm text-red-800 dark:border-red-800 dark:bg-red-950 dark:text-red-200"
        >
          {submitError}
        </p>
      ) : null}
      <button
        type="button"
        onClick={handleClick}
        disabled={submitting || submitted}
        className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-700 disabled:opacity-60 dark:bg-white dark:text-neutral-900 dark:hover:bg-neutral-200"
      >
        {submitting ? "Sending…" : "Get My Free Quote"}
      </button>
    </form>
  );
}
