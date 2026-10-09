"use client";

import { useEffect, useId, useState, type ReactElement } from "react";
import {
  useRoofEstimateForm,
  type SubmitStatus,
} from "@/hooks/useRoofEstimateForm";
import { EMAIL_PATTERN } from "@/lib/leadValidation";
import {
  DECISION_MAKER_OPTIONS,
  PHONE_PATTERN,
  ROOF_STATUS_OPTIONS,
} from "@/lib/roofLead";
import { buttonStyles } from "./buttonStyles";
import { ChoiceGroup } from "./form/ChoiceGroup";
import { TextField } from "./form/TextField";
import { Icon } from "./Icon";
import { CITY_LIST_TEXT, PRIMARY_CTA } from "./content";

const BUTTON_LABELS: Record<SubmitStatus, string> = {
  idle: PRIMARY_CTA,
  submitting: "Requesting your estimate…",
  success: "Request received",
};

const LP_PRIVACY_URL = "https://services.allinoneexteriors.com/privacy-policy";
const LP_TERMS_URL = "https://services.allinoneexteriors.com/terms";
const SUBMISSION_ENDPOINT = "https://analytics.gomega.ai/submission/submit";

type SmsWindow = Window & {
  __allInOneSmsPatch?: boolean;
  __allInOneSmsConsent?: boolean;
};

function publishSmsConsent(value: boolean): void {
  if (typeof window === "undefined") return;
  (window as SmsWindow).__allInOneSmsConsent = value;
}

/**
 * useMegaLeadForm rebuilds form_data from the six named roof fields, so a
 * checkbox on this form would otherwise be dropped. Merge the boolean after
 * that object is built, only for the MEGA submission request.
 */
function installSmsConsentPatch(): void {
  if (typeof window === "undefined") return;
  const host = window as SmsWindow;
  if (host.__allInOneSmsPatch) return;
  host.__allInOneSmsPatch = true;
  const original = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const nextInit = init ? { ...init } : undefined;
    try {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : input.url;
      if (url === SUBMISSION_ENDPOINT && nextInit && typeof nextInit.body === "string") {
        const payload = JSON.parse(nextInit.body) as {
          form_data?: Record<string, unknown>;
        };
        if (payload.form_data && typeof payload.form_data === "object") {
          payload.form_data.smsConsent = host.__allInOneSmsConsent === true;
          nextInit.body = JSON.stringify(payload);
        }
      }
    } catch {
      // Leave the request unchanged when the body is not the lead payload.
    }
    return original(input, nextInit);
  };
}

/**
 * Roof-estimate lead form on the MEGA contract. The button is type="button":
 * its click validates (checkValidity/reportValidity) and then calls the
 * submission directly, so no native submit ever fires before the API confirms.
 * One form_data key per field, each matching its input `name`.
 */
export function RoofEstimateForm({
  placement,
  heading,
  headingLevel = "h2",
}: {
  /** Which instance on the page; tracking only, never lead data. */
  placement: "hero" | "final";
  heading: string;
  headingLevel?: "h2" | "h3";
}): ReactElement {
  const id = useId();
  const {
    formRef,
    fields,
    status,
    submitError,
    setField,
    attemptSubmit,
    handleKeyDown,
    handleSubmit,
  } = useRoofEstimateForm(placement);
  const [smsConsent, setSmsConsent] = useState(false);
  const locked = status !== "idle";
  const Heading = headingLevel;

  useEffect(() => {
    installSmsConsentPatch();
  }, []);

  return (
    <div className="relative rounded-[2px] border border-line border-t-4 border-t-brand bg-surface p-5 shadow-[0_30px_60px_-30px_rgba(0,0,0,0.9)] sm:p-7">
      <Heading
        id={`${id}-heading`}
        className="text-h4 font-extrabold tracking-tight text-white sm:text-h3"
      >
        {heading}
      </Heading>
      <p className="mt-2 hidden text-small font-medium text-muted sm:block">
        For homeowners in {CITY_LIST_TEXT}.
      </p>
      <form
        ref={formRef}
        onSubmit={handleSubmit}
        onKeyDown={(event) => {
          if (event.key === "Enter") publishSmsConsent(smsConsent);
          handleKeyDown(event);
        }}
        aria-labelledby={`${id}-heading`}
        className="mt-4 flex flex-col gap-4 sm:mt-5"
      >
        <div className="grid grid-cols-1 gap-4 min-[420px]:grid-cols-2">
          <TextField
            id={`${id}-first`}
            name="firstName"
            label="First name"
            type="text"
            autoComplete="given-name"
            disabled={locked}
            value={fields.firstName}
            onValueChange={(v) => setField("firstName", v)}
          />
          <TextField
            id={`${id}-last`}
            name="lastName"
            label="Last name"
            type="text"
            autoComplete="family-name"
            disabled={locked}
            value={fields.lastName}
            onValueChange={(v) => setField("lastName", v)}
          />
        </div>
        <TextField
          id={`${id}-email`}
          name="email"
          label="Email"
          type="email"
          autoComplete="email"
          disabled={locked}
          value={fields.email}
          pattern={EMAIL_PATTERN}
          title="Enter a valid email address (e.g. you@example.com)"
          onValueChange={(v) => setField("email", v)}
        />
        <TextField
          id={`${id}-phone`}
          name="phone"
          label="Phone"
          type="tel"
          inputMode="numeric"
          autoComplete="tel"
          disabled={locked}
          value={fields.phone}
          placeholder="(555) 123-4567"
          pattern={PHONE_PATTERN}
          title="Enter a 10-digit phone number"
          onValueChange={(v) => setField("phone", v)}
        />
        <ChoiceGroup
          name="decisionMaker"
          legend="Are you the homeowner or authorized decision maker for this property?"
          options={DECISION_MAKER_OPTIONS}
          value={fields.decisionMaker}
          onChange={(v) => setField("decisionMaker", v)}
          disabled={locked}
        />
        <ChoiceGroup
          name="roofStatus"
          legend="Is your roof currently leaking or damaged?"
          options={ROOF_STATUS_OPTIONS}
          value={fields.roofStatus}
          onChange={(v) => setField("roofStatus", v)}
          disabled={locked}
        />
        {submitError ? (
          <p
            role="alert"
            className="rounded-[2px] border-2 border-error bg-error-surface px-3 py-2.5 text-sm font-medium text-white"
          >
            {submitError}
          </p>
        ) : null}
        <label className="flex items-start gap-3 text-small font-medium text-muted">
          <input
            type="checkbox"
            name="smsConsent"
            checked={smsConsent}
            disabled={locked}
            onChange={(event) => {
              const next = event.target.checked;
              setSmsConsent(next);
              publishSmsConsent(next);
            }}
            className="mt-1 h-4 w-4 shrink-0 accent-gold"
          />
          <span>
            By checking this box, you agree to receive SMS customer-care
            messages from All In One Exteriors, including inspection scheduling
            and confirmations, reminders, project updates, and service-related
            communications. Message frequency may vary. Message and data rates
            may apply. Reply STOP to opt out. Reply HELP for help. Consent is
            not a condition of purchase. Your mobile information will not be
            sold or shared with third parties for promotional or marketing
            purposes. Optional. You can submit this form without opting in to
            text messages.{" "}
            <a
              href={LP_PRIVACY_URL}
              className="font-semibold text-gold underline"
              target="_blank"
              rel="noopener noreferrer"
            >
              Privacy Policy
            </a>
            {" | "}
            <a
              href={LP_TERMS_URL}
              className="font-semibold text-gold underline"
              target="_blank"
              rel="noopener noreferrer"
            >
              Terms and Conditions
            </a>
            .
          </span>
        </label>
        <button
          type="button"
          onClick={() => {
            publishSmsConsent(smsConsent);
            attemptSubmit();
          }}
          disabled={locked}
          aria-busy={status === "submitting"}
          className={`${buttonStyles.primary} w-full`}
        >
          {BUTTON_LABELS[status]}
          {locked ? null : <Icon name="arrowRight" size={18} />}
        </button>
        <p className="flex items-start gap-2 text-small font-medium text-muted">
          <Icon name="shield" size={16} className="mt-0.5 shrink-0 text-gold" />
          Roof inspections are a paid service. Leaking roofs and planned
          replacements are both welcome.
        </p>
      </form>
    </div>
  );
}
