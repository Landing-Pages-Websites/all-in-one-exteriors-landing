import { siteConfig } from "@/site.config";
import { UPLOAD_KEYS_FIELD } from "@/lib/leadUploads";
import type { LeadContext } from "@/lib/megaLeadContext";
import type { ValidatedLeadFields } from "@/lib/leadValidation";

const SUBMIT_ENDPOINT = "https://analytics.gomega.ai/submission/submit";

export interface KeystoneSubmitResult {
  ok: boolean;
  id?: string;
}

export async function forwardLeadToKeystone(
  fields: ValidatedLeadFields,
  context: LeadContext,
  formKey: string,
): Promise<KeystoneSubmitResult> {
  const payload = {
    ...context,
    customer_id: siteConfig.megaCustomerId,
    site_id: siteConfig.megaSiteId,
    source_provider: siteConfig.sourceProvider,
    // Top level, never inside form_data: MEGA strips a `form_key` found there
    // so a visitor cannot type into a field of that name and pick which of the
    // customer's inboxes receives their submission.
    form_key: formKey,
    form_data: {
      firstName: fields.firstName,
      lastName: fields.lastName,
      email: fields.email,
      phone: fields.phone,
      ...fields.extra,
      // Spread last and only when present, so the reserved field cannot be
      // shadowed by an extra and an ordinary submission carries no empty array
      // for MEGA's notification email to render as a field.
      ...(fields.uploadKeys.length > 0
        ? { [UPLOAD_KEYS_FIELD]: fields.uploadKeys }
        : {}),
    },
  };

  const response = await fetch(SUBMIT_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error(`Keystone HTTP ${response.status}`);
  }

  const json: unknown = await response.json();
  if (
    typeof json !== "object" ||
    json === null ||
    !("ok" in json) ||
    (json as { ok: unknown }).ok !== true
  ) {
    throw new Error("Keystone rejected the submission");
  }
  const id =
    "id" in json && typeof (json as { id: unknown }).id === "string"
      ? (json as { id: string }).id
      : undefined;
  return { ok: true, id };
}
