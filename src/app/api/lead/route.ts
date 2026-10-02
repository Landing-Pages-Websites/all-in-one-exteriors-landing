import { NextRequest, NextResponse } from "next/server";
import {
  HONEYPOT_FIELD_NAME,
  parseLeadFields,
  readCaptchaToken,
  resolveFormKey,
} from "@/lib/leadValidation";
import { siteConfig } from "@/site.config";
import { forwardLeadToKeystone } from "@/lib/forwardLead";
import { verifyCaptchaToken } from "@/lib/captcha/verify";
import { uploadCapabilityAuthorizes } from "@/lib/uploadCapability";
import type { LeadContext } from "@/lib/megaLeadContext";

export const runtime = "nodejs";

const SUBMIT_ERROR =
  "Something went wrong sending your request. Please check your connection and try again.";

function clientIp(request: NextRequest): string | null {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  return (
    request.headers.get("cf-connecting-ip") ?? request.headers.get("x-real-ip")
  );
}

function asLeadContext(value: unknown): LeadContext | null {
  if (typeof value !== "object" || value === null) return null;
  const record = value as Record<string, unknown>;
  if (typeof record.url !== "string") return null;
  if (typeof record.session_id !== "string") return null;
  if (typeof record.visitor_id !== "string") return null;
  return record as unknown as LeadContext;
}

function jsonError(error: string, status: number): NextResponse {
  return NextResponse.json({ ok: false, error }, { status });
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError("Invalid request.", 400);
  }
  if (typeof body !== "object" || body === null) {
    return jsonError("Invalid request.", 400);
  }
  const payload = body as Record<string, unknown>;

  const honeypot =
    typeof payload[HONEYPOT_FIELD_NAME] === "string"
      ? payload[HONEYPOT_FIELD_NAME].trim()
      : "";
  if (honeypot.length > 0) {
    return NextResponse.json({ ok: true, ignored: true });
  }

  const parsed = parseLeadFields(payload);
  if (!parsed.ok) {
    return jsonError(parsed.error, 400);
  }

  // Every submission presents its own solved challenge, exactly as before
  // attachments existed. Uploads are signed with a SECOND token obtained for
  // that purpose, so nothing here had to be relaxed to make them work.
  const captchaToken = readCaptchaToken(payload);
  const challenge = await verifyCaptchaToken(
    captchaToken,
    "lead_submit",
    clientIp(request),
  );
  if (!challenge.ok) {
    return jsonError(challenge.error, 403);
  }

  // Declared keys are honoured only with a capability bound to THIS submission's
  // challenge. Without one the keys are dropped and the enquiry still sends: a
  // failed binding must cost the attachments, never the lead.
  const signedKeys = Array.isArray(payload.uploadSignedKeys)
    ? payload.uploadSignedKeys.filter(
        (key): key is string => typeof key === "string",
      )
    : [];
  const uploadKeys = uploadCapabilityAuthorizes(
    payload.uploadCapability,
    signedKeys,
    parsed.fields.uploadKeys,
    captchaToken,
  )
    ? parsed.fields.uploadKeys
    : [];
  if (parsed.fields.uploadKeys.length > 0 && uploadKeys.length === 0) {
    console.warn("Dropped upload keys this submission cannot claim");
  }

  const context = asLeadContext(payload.context);
  if (!context) {
    return jsonError("Invalid request.", 400);
  }

  try {
    const result = await forwardLeadToKeystone(
      { ...parsed.fields, uploadKeys },
      context,
      resolveFormKey(siteConfig.formKeys, payload),
    );
    return NextResponse.json(result);
  } catch (error) {
    console.error("Keystone lead submit failed", error);
    return jsonError(SUBMIT_ERROR, 502);
  }
}
