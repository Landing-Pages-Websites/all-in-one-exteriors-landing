import { NextRequest, NextResponse } from "next/server";
import { siteConfig } from "@/site.config";
import { verifyCaptchaToken } from "@/lib/captcha/verify";
import { readCaptchaToken } from "@/lib/leadValidation";
import { issueUploadCapability } from "@/lib/uploadCapability";
import {
  MAX_UPLOAD_FILES,
  MAX_UPLOAD_BYTES,
  MAX_UPLOAD_TOTAL_BYTES,
  ACCEPTED_UPLOAD_TYPES,
} from "@/lib/leadUploads";

export const runtime = "nodejs";

const UPLOAD_URL_ENDPOINT = "https://analytics.gomega.ai/submission/upload-url";

interface RequestedFile {
  fileName: string;
  contentType: string;
  sizeBytes: number;
}

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

function jsonError(error: string, status: number): NextResponse {
  return NextResponse.json({ ok: false, error }, { status });
}

/**
 * Reads the files a visitor wants to upload, or null if the request is not a
 * shape this route will forward.
 *
 * Checked here as well as by MEGA because forwarding an obviously bad request
 * spends a round trip to learn what is already knowable. MEGA's copy is still
 * the one that decides: it binds size and type into the signature, so a file
 * that lies here cannot be uploaded anyway.
 */
function parseRequestedFiles(value: unknown): RequestedFile[] | null {
  if (typeof value !== "object" || value === null) return null;
  const files = (value as { files?: unknown }).files;
  if (!Array.isArray(files) || files.length === 0) return null;
  if (files.length > MAX_UPLOAD_FILES) return null;

  const parsed: RequestedFile[] = [];
  let total = 0;
  for (const entry of files) {
    if (typeof entry !== "object" || entry === null) return null;
    const record = entry as Record<string, unknown>;
    const { fileName, contentType, sizeBytes } = record;
    if (typeof fileName !== "string" || fileName.length === 0) return null;
    if (typeof contentType !== "string") return null;
    if (
      !ACCEPTED_UPLOAD_TYPES.includes(
        contentType as (typeof ACCEPTED_UPLOAD_TYPES)[number],
      )
    ) {
      return null;
    }
    if (typeof sizeBytes !== "number" || !Number.isInteger(sizeBytes))
      return null;
    if (sizeBytes <= 0 || sizeBytes > MAX_UPLOAD_BYTES) return null;
    total += sizeBytes;
    if (total > MAX_UPLOAD_TOTAL_BYTES) return null;
    parsed.push({ fileName, contentType, sizeBytes });
  }
  return parsed;
}

/**
 * Asks MEGA to sign uploads for this site's lead form.
 *
 * The site's identity is taken from `siteConfig` on the server and is never read
 * from the request body. The signed key carries the customer id, and MEGA only
 * attaches a file to a lead when the key's customer matches the lead's — so a
 * body-supplied identity here would either be ignored or, worse, sign into a
 * prefix this site's own submissions can never claim.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  if (!siteConfig.uploadsEnabled) {
    // Off by default. A site opts in only once its customer is ready for
    // visitors to attach files, so an unconfigured site cannot mint upload
    // permission for anyone.
    return jsonError("Attachments are not enabled for this site.", 404);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError("Invalid request.", 400);
  }

  const files = parseRequestedFiles(body);
  if (!files) {
    return jsonError("Those files cannot be attached.", 400);
  }

  // Only the HASH of the submission's token, never the token itself: this route
  // must not be able to spend the challenge the submission depends on.
  const binding = (body as { submissionBinding?: unknown }).submissionBinding;
  if (typeof binding !== "string" || !/^[0-9a-f]{64}$/.test(binding)) {
    return jsonError("Those files cannot be attached.", 400);
  }

  // Proof of a human BEFORE anything is signed. A signed URL is upload
  // permission, so handing them out to unverified callers lets anyone spend this
  // site's storage without ever creating a lead.
  //
  // This consumes a token of its own, obtained for signing. The submission keeps
  // its original token untouched, so a failure anywhere in here costs the
  // attachments and never the enquiry.
  // A DISTINCT action from the submission's, so a token minted to sign uploads
  // cannot be replayed as the submission's own challenge, or vice versa.
  //
  // Enforced on the reCAPTCHA path only: the assessment reports the action a
  // token was minted for and the verifier compares it. Turnstile's siteverify
  // call takes no action and never has, so on a Turnstile site the two tokens
  // remain interchangeable — unchanged from before this route was made
  // provider-neutral, but do not read the distinct actions here as a guarantee
  // that holds everywhere.
  const challenge = await verifyCaptchaToken(
    readCaptchaToken(body as Record<string, unknown>),
    "lead_upload",
    clientIp(request),
  );
  if (!challenge.ok) {
    return jsonError(challenge.error, 403);
  }

  try {
    const response = await fetch(UPLOAD_URL_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        customer_id: siteConfig.megaCustomerId,
        site_id: siteConfig.megaSiteId,
        files,
      }),
    });

    if (!response.ok) {
      console.error("Upload signing refused", response.status);
      // Deliberately not passing MEGA's message to the browser: it is written
      // for an operator, and a visitor filling in a contact form can act on
      // "try a smaller file" but not on a routing explanation.
      return jsonError("Those files cannot be attached right now.", 400);
    }

    const json: unknown = await response.json();
    const uploads = (json as { uploads?: unknown } | null)?.uploads;
    if (!Array.isArray(uploads) || uploads.length !== files.length) {
      // A short response would silently drop an attachment the visitor believes
      // they sent, so it is treated as a failure rather than partially used.
      console.error("Upload signing returned an unexpected shape");
      return jsonError("Those files cannot be attached right now.", 502);
    }
    // Bound to the submission that will declare these keys, so a key signed
    // here cannot be presented by a different submission.
    const signedKeys = uploads
      .map((upload) => (upload as { s3Key?: unknown }).s3Key)
      .filter((key): key is string => typeof key === "string");
    const capability = issueUploadCapability(signedKeys, binding);
    if (capability === null) {
      console.error("Cannot bind uploads to this submission");
      return jsonError("Those files cannot be attached right now.", 500);
    }
    return NextResponse.json({ ok: true, uploads, capability, signedKeys });
  } catch (error) {
    console.error("Upload signing failed", error);
    return jsonError("Those files cannot be attached right now.", 502);
  }
}
