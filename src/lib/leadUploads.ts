/**
 * File uploads on the lead form.
 *
 * These limits mirror the ones MEGA enforces when it signs an upload. They are
 * repeated here only so a visitor gets a useful message instead of a rejected
 * request — the server's copy is the one that decides, and a file that slips
 * past this is refused there.
 */
export const MAX_UPLOAD_FILES = 5;
export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
export const MAX_UPLOAD_TOTAL_BYTES = 50 * 1024 * 1024;

/**
 * The field a submission uses to name what it uploaded.
 *
 * Reserved rather than an ordinary extra field: only keys this code obtained
 * from a signing response may appear here, so a hand-rolled POST cannot name
 * somebody else's object and have it forwarded.
 */
export const UPLOAD_KEYS_FIELD = "_mega_uploads";

export const ACCEPTED_UPLOAD_TYPES = [
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "text/csv",
  "text/plain",
  "image/png",
  "image/jpeg",
  "image/heic",
  // CAD drawings, under the spellings browsers actually send. Must match MEGA's
  // allowlist exactly: a type this list accepts but the server does not is
  // refused at signing, and a type the server accepts but this list does not is
  // never offered to the visitor at all.
  "image/vnd.dwg",
  "application/acad",
  "image/x-dwg",
] as const;

/**
 * For the file input's `accept` attribute.
 *
 * Includes the `.dwg` EXTENSION as well as its MIME spellings. Browsers have no
 * registered type for CAD files, so a MIME-only accept list does not offer them
 * in the picker at all.
 */
export const UPLOAD_ACCEPT_ATTRIBUTE = [...ACCEPTED_UPLOAD_TYPES, ".dwg"].join(
  ",",
);

/**
 * The content type to declare for a chosen file.
 *
 * Browsers report an empty `type` for a `.dwg` because there is no registered
 * mapping, so trusting `file.type` alone would refuse every CAD drawing before
 * the server was ever asked. The extension resolves it to a spelling MEGA's
 * allowlist accepts, and the same value is sent as the Content-Type header on
 * the PUT, so what S3 stores is what the claim later reads back and re-checks.
 *
 * Only extensions whose type browsers fail to supply are inferred. Anything else
 * keeps whatever the browser said, including nothing — an unidentified binary
 * must stay refused.
 */
export function declaredContentType(file: File): string {
  if (file.type !== "") return file.type;
  return file.name.toLowerCase().endsWith(".dwg") ? "image/vnd.dwg" : "";
}

export interface UploadRejection {
  fileName: string;
  reason: string;
}

export interface UploadSelection {
  accepted: File[];
  rejected: UploadRejection[];
}

function megabytes(bytes: number): number {
  return Math.floor(bytes / (1024 * 1024));
}

/**
 * Splits a visitor's chosen files into what can be sent and what cannot, with a
 * reason for each refusal.
 *
 * Refuses rather than truncates: silently dropping the sixth file would let
 * someone attach a document, see no error, and assume it was sent.
 */
export function selectUploadableFiles(files: readonly File[]): UploadSelection {
  const accepted: File[] = [];
  const rejected: UploadRejection[] = [];
  let total = 0;

  for (const file of files) {
    if (accepted.length >= MAX_UPLOAD_FILES) {
      rejected.push({
        fileName: file.name,
        reason: `Only ${MAX_UPLOAD_FILES} files can be attached.`,
      });
      continue;
    }
    if (
      !ACCEPTED_UPLOAD_TYPES.includes(
        declaredContentType(file) as (typeof ACCEPTED_UPLOAD_TYPES)[number],
      )
    ) {
      rejected.push({
        fileName: file.name,
        reason: "That file type cannot be attached.",
      });
      continue;
    }
    if (file.size <= 0 || file.size > MAX_UPLOAD_BYTES) {
      rejected.push({
        fileName: file.name,
        reason: `Files must be under ${megabytes(MAX_UPLOAD_BYTES)}MB.`,
      });
      continue;
    }
    if (total + file.size > MAX_UPLOAD_TOTAL_BYTES) {
      rejected.push({
        fileName: file.name,
        reason: `Attachments must total under ${megabytes(MAX_UPLOAD_TOTAL_BYTES)}MB.`,
      });
      continue;
    }
    total += file.size;
    accepted.push(file);
  }

  return { accepted, rejected };
}

export interface SignedUpload {
  s3Key: string;
  uploadUrl: string;
  contentType: string;
  sizeBytes: number;
}

function isSignedUpload(value: unknown): value is SignedUpload {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.s3Key === "string" &&
    record.s3Key.length > 0 &&
    typeof record.uploadUrl === "string" &&
    record.uploadUrl.startsWith("https://") &&
    typeof record.contentType === "string" &&
    typeof record.sizeBytes === "number"
  );
}

/** The signing responses for `files`, in the same order. */
export function parseSignedUploads(value: unknown): SignedUpload[] | null {
  if (typeof value !== "object" || value === null) return null;
  const uploads = (value as { uploads?: unknown }).uploads;
  if (!Array.isArray(uploads)) return null;
  if (!uploads.every(isSignedUpload)) return null;
  return uploads;
}

/**
 * Uploads `files` and returns the keys a submission should declare.
 *
 * A file that fails to upload is left out of the returned keys rather than
 * failing the whole send: losing an attachment is bad, losing the enquiry is
 * worse, and the person filling in the form cannot fix an S3 error.
 *
 * The PUT must send exactly the signed headers: content type, byte count, and
 * `If-None-Match: *`. Any omission fails as SignatureDoesNotMatch, which names
 * nothing useful, so they are set together here and commented at the call site.
 * The browser supplies Content-Length from the body itself.
 */
export async function uploadSignedFiles(
  files: readonly File[],
  uploads: readonly SignedUpload[],
): Promise<string[]> {
  // Mapped and then filtered rather than pushed from parallel callbacks, so the
  // keys come back in the order the visitor chose the files instead of the order
  // S3 happened to finish.
  const settled = await Promise.all(
    files.slice(0, uploads.length).map(async (file, index) => {
      const upload = uploads[index];
      try {
        const response = await fetch(upload.uploadUrl, {
          method: "PUT",
          headers: {
            "Content-Type": upload.contentType,
            // Both of these are SIGNED headers, so omitting either makes S3
            // reject the PUT with SignatureDoesNotMatch rather than with
            // anything that names the real cause.
            //
            // `If-None-Match: *` is what makes the upload write-once: the key
            // cannot be overwritten once written, so a leaked URL cannot
            // replace a file the customer already received. Content-Length is
            // signed too, but the browser sets it from the body and forbids
            // setting it by hand, so it is correct by construction.
            "If-None-Match": "*",
          },
          body: file,
        });
        if (response.ok) return upload.s3Key;
        console.warn("Attachment upload failed", file.name, response.status);
      } catch (error) {
        console.warn("Attachment upload error", file.name, error);
      }
      return null;
    }),
  );

  return settled.filter((key): key is string => key !== null);
}
