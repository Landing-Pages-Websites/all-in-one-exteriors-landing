"use client";

import { useId, type ReactElement } from "react";
import { useRoofEstimateForm, type SubmitStatus } from "@/hooks/useRoofEstimateForm";
import { EMAIL_PATTERN } from "@/lib/leadValidation";
import { DECISION_MAKER_OPTIONS, PHONE_PATTERN, ROOF_STATUS_OPTIONS } from "@/lib/roofLead";
import { buttonStyles } from "./Cta";
import { ChoiceGroup } from "./form/ChoiceGroup";
import { TextField } from "./form/TextField";
import { Icon } from "./Icon";
import { PRIMARY_CTA } from "./content";

const BUTTON_LABELS: Record<SubmitStatus, string> = {
  idle: PRIMARY_CTA,
  submitting: "Requesting your estimate…",
  success: "Request received",
};

/**
 * Roof-estimate lead form on the MEGA contract. The button is type="button":
 * its click validates (checkValidity/reportValidity) and then calls the
 * submission directly, so no native submit ever fires before the API confirms.
 * One form_data key per field, each matching its input `name`.
 */
export function RoofEstimateForm({
  formKey,
  heading,
  headingLevel = "h2",
}: {
  /** Must be one of siteConfig.formKeys. */
  formKey: string;
  heading: string;
  headingLevel?: "h2" | "h3";
}): ReactElement {
  const id = useId();
  const form = useRoofEstimateForm(formKey);
  const { fields, setField, status } = form;
  const locked = status !== "idle";
  const Heading = headingLevel;

  return (
    <div className="relative rounded-[2px] border border-line border-t-4 border-t-brand bg-surface p-5 shadow-[0_30px_60px_-30px_rgba(0,0,0,0.9)] sm:p-7">
      <Heading id={`${id}-heading`} className="text-h3 font-extrabold tracking-tight text-white">
        {heading}
      </Heading>
      <p className="mt-2 text-small font-medium text-muted">
        For homeowners in Alpharetta, Milton, Johns Creek, Marietta, Woodstock, Rome, Roswell, and Dunwoody.
      </p>
      <form
        ref={form.formRef}
        onSubmit={form.handleSubmit}
        onKeyDown={form.handleKeyDown}
        aria-labelledby={`${id}-heading`}
        className="mt-5 flex flex-col gap-4"
      >
        <div className="grid grid-cols-1 gap-4 min-[420px]:grid-cols-2">
          <TextField id={`${id}-first`} name="firstName" label="First name" type="text" autoComplete="given-name" disabled={locked} value={fields.firstName} onValueChange={(v) => setField("firstName", v)} />
          <TextField id={`${id}-last`} name="lastName" label="Last name" type="text" autoComplete="family-name" disabled={locked} value={fields.lastName} onValueChange={(v) => setField("lastName", v)} />
        </div>
        <TextField id={`${id}-email`} name="email" label="Email" type="email" autoComplete="email" disabled={locked} value={fields.email} pattern={EMAIL_PATTERN} title="Enter a valid email address (e.g. you@example.com)" onValueChange={(v) => setField("email", v)} />
        <TextField id={`${id}-phone`} name="phone" label="Phone" type="tel" inputMode="numeric" autoComplete="tel" disabled={locked} value={fields.phone} placeholder="(555) 123-4567" pattern={PHONE_PATTERN} title="Enter a 10-digit phone number" onValueChange={(v) => setField("phone", v)} />
        <ChoiceGroup name="decisionMaker" legend="Are you the homeowner or authorized decision maker for this property?" options={DECISION_MAKER_OPTIONS} value={fields.decisionMaker} onChange={(v) => setField("decisionMaker", v)} disabled={locked} />
        <ChoiceGroup name="roofStatus" legend="Is your roof currently leaking or damaged?" options={ROOF_STATUS_OPTIONS} value={fields.roofStatus} onChange={(v) => setField("roofStatus", v)} disabled={locked} />
        {form.submitError ? (
          <p role="alert" className="rounded-[2px] border-2 border-error bg-[#2a0d0e] px-3 py-2.5 text-sm font-medium text-white">
            {form.submitError}
          </p>
        ) : null}
        <button type="button" onClick={form.attemptSubmit} disabled={locked} aria-busy={status === "submitting"} className={`${buttonStyles.primary} w-full`}>
          {BUTTON_LABELS[status]}
          {locked ? null : <Icon name="arrowRight" size={18} />}
        </button>
        <p className="flex items-start gap-2 text-small font-medium text-muted">
          <Icon name="shield" size={16} className="mt-0.5 shrink-0 text-gold" />
          Roof inspections are a paid service. Leaking roofs and planned replacements are both welcome.
        </p>
      </form>
    </div>
  );
}
