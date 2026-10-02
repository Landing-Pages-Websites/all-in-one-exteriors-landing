import assert from "node:assert/strict";
import test from "node:test";
import {
  MAX_UPLOAD_BYTES,
  MAX_UPLOAD_FILES,
  MAX_UPLOAD_TOTAL_BYTES,
  parseSignedUploads,
  declaredContentType,
  selectUploadableFiles,
  UPLOAD_ACCEPT_ATTRIBUTE,
  uploadSignedFiles,
} from "./leadUploads.ts";

function file(name: string, type: string, size: number): File {
  // Constructed rather than built from real bytes so a 10MB case does not
  // allocate 10MB; only `size` is read.
  const handle = new File([""], name, { type });
  Object.defineProperty(handle, "size", { value: size });
  return handle;
}

const pdf = () => file("quote.pdf", "application/pdf", 1024);

test("selectUploadableFiles accepts an ordinary document", () => {
  const { accepted, rejected } = selectUploadableFiles([pdf()]);
  assert.equal(accepted.length, 1);
  assert.equal(rejected.length, 0);
});

test("selectUploadableFiles reports files past the cap instead of dropping them", () => {
  // Refusing beats truncating: a visitor who attaches a file, sees no error and
  // assumes it was sent is worse off than one who is told it was not.
  const files = Array.from({ length: MAX_UPLOAD_FILES + 2 }, () => pdf());
  const { accepted, rejected } = selectUploadableFiles(files);
  assert.equal(accepted.length, MAX_UPLOAD_FILES);
  assert.equal(rejected.length, 2);
  for (const rejection of rejected) {
    assert.match(rejection.reason, /files can be attached/);
  }
});

test("selectUploadableFiles refuses every type outside the allowlist", () => {
  const refused = [
    "image/svg+xml",
    "application/zip",
    "application/x-msdownload",
    "text/html",
    "application/octet-stream",
    "",
  ];
  for (const type of refused) {
    const { accepted, rejected } = selectUploadableFiles([
      file("f", type, 1024),
    ]);
    assert.equal(accepted.length, 0, `accepted ${type}`);
    assert.match(rejected[0].reason, /file type/);
  }
});

test("selectUploadableFiles refuses a file over the per-file ceiling", () => {
  const { accepted, rejected } = selectUploadableFiles([
    file("big.pdf", "application/pdf", MAX_UPLOAD_BYTES + 1),
  ]);
  assert.equal(accepted.length, 0);
  assert.match(rejected[0].reason, /under \d+MB/);
});

test("selectUploadableFiles refuses an empty file", () => {
  const { accepted } = selectUploadableFiles([
    file("empty.pdf", "application/pdf", 0),
  ]);
  assert.equal(accepted.length, 0);
});

test("selectUploadableFiles enforces the total even when each file fits", () => {
  // Derived, never restated: a test that hardcodes a ceiling breaks whenever it
  // moves and, worse, can pass against the wrong one. Each file is exactly half
  // the total, so two fit and the third cannot.
  const half = Math.floor(MAX_UPLOAD_TOTAL_BYTES / 2);
  const { accepted, rejected } = selectUploadableFiles([
    file("a.pdf", "application/pdf", half),
    file("b.pdf", "application/pdf", half),
    file("c.pdf", "application/pdf", half),
  ]);
  const total = accepted.reduce((sum, f) => sum + f.size, 0);
  assert.ok(total <= MAX_UPLOAD_TOTAL_BYTES);
  assert.equal(accepted.length, 2);
  assert.match(rejected[0].reason, /total/);
});

test("selectUploadableFiles keeps a small file that fits after a large refusal", () => {
  // Skipping leaves the running total untouched, so later room stays usable.
  const { accepted } = selectUploadableFiles([
    file("huge.pdf", "application/pdf", MAX_UPLOAD_BYTES + 1),
    pdf(),
  ]);
  assert.deepEqual(
    accepted.map((f) => f.name),
    ["quote.pdf"],
  );
});

test("selectUploadableFiles accepts nothing from an empty selection", () => {
  assert.deepEqual(selectUploadableFiles([]), { accepted: [], rejected: [] });
});

const validUpload = {
  s3Key: "lead-uploads/pending/c/u/quote.pdf",
  uploadUrl: "https://signed.example/put",
  contentType: "application/pdf",
  sizeBytes: 1024,
};

test("parseSignedUploads accepts a well-formed response", () => {
  assert.deepEqual(parseSignedUploads({ uploads: [validUpload] }), [
    validUpload,
  ]);
});

test("parseSignedUploads returns null for anything malformed", () => {
  // A malformed response must not be partially used: uploading whatever
  // survived would leave the visitor believing every file was sent.
  const malformed: unknown[] = [
    null,
    {},
    { uploads: null },
    { uploads: {} },
    { uploads: [{ ...validUpload, s3Key: "" }] },
    { uploads: [{ ...validUpload, sizeBytes: "1024" }] },
    { uploads: [validUpload, { ...validUpload, uploadUrl: undefined }] },
  ];
  for (const value of malformed) {
    assert.equal(parseSignedUploads(value), null, JSON.stringify(value));
  }
});

test("parseSignedUploads refuses a URL that is not https", () => {
  // The URL is followed with the visitor's file in the request body.
  for (const uploadUrl of [
    "http://insecure.example/put",
    "ftp://elsewhere/put",
    "javascript:alert(1)",
  ]) {
    assert.equal(
      parseSignedUploads({ uploads: [{ ...validUpload, uploadUrl }] }),
      null,
      uploadUrl,
    );
  }
});

test("uploadSignedFiles sends every signed header on the PUT", async () => {
  // The presign signs content-type, content-length and if-none-match. Omitting
  // any of them fails as SignatureDoesNotMatch, which names nothing useful, so
  // this is pinned rather than left to be discovered on a real upload.
  const seen: Array<Record<string, string>> = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (_url: string, init: RequestInit) => {
    seen.push(init.headers as Record<string, string>);
    return { ok: true } as Response;
  }) as typeof fetch;
  try {
    const keys = await uploadSignedFiles(
      [pdf()],
      [
        {
          s3Key: "lead-uploads/pending/c/u/quote.pdf",
          uploadUrl: "https://signed.example/put",
          contentType: "application/pdf",
          sizeBytes: 1024,
        },
      ],
    );
    assert.deepEqual(keys, ["lead-uploads/pending/c/u/quote.pdf"]);
    assert.equal(seen[0]["Content-Type"], "application/pdf");
    assert.equal(
      seen[0]["If-None-Match"],
      "*",
      "write-once is a signed header; without it the PUT is refused",
    );
  } finally {
    globalThis.fetch = original;
  }
});

test("uploadSignedFiles omits a key whose PUT was refused", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = (async () =>
    ({ ok: false, status: 403 }) as Response) as typeof fetch;
  try {
    const keys = await uploadSignedFiles(
      [pdf()],
      [
        {
          s3Key: "lead-uploads/pending/c/u/quote.pdf",
          uploadUrl: "https://signed.example/put",
          contentType: "application/pdf",
          sizeBytes: 1024,
        },
      ],
    );
    // A refused upload must not be declared: the submission would name a file
    // that does not exist.
    assert.deepEqual(keys, []);
  } finally {
    globalThis.fetch = original;
  }
});

test("declaredContentType resolves a .dwg the browser could not type", () => {
  // Browsers report an empty type for CAD files. Without this a contractor's
  // plan drawing is refused before the server is ever asked.
  assert.equal(
    declaredContentType(file("plan.dwg", "", 1024)),
    "image/vnd.dwg",
  );
  assert.equal(
    declaredContentType(file("PLAN.DWG", "", 1024)),
    "image/vnd.dwg",
  );
});

test("declaredContentType never overrides a type the browser supplied", () => {
  assert.equal(
    declaredContentType(file("plan.dwg", "application/acad", 1024)),
    "application/acad",
  );
  assert.equal(declaredContentType(pdf()), "application/pdf");
});

test("declaredContentType leaves an unidentified binary unidentified", () => {
  // Inferring only .dwg is the point: an unnamed binary must stay refused.
  assert.equal(declaredContentType(file("mystery.bin", "", 1024)), "");
  assert.equal(declaredContentType(file("archive.zip", "", 1024)), "");
});

test("selectUploadableFiles accepts an untyped .dwg and still refuses other untyped files", () => {
  const dwg = selectUploadableFiles([file("plan.dwg", "", 2048)]);
  assert.equal(dwg.accepted.length, 1, "an untyped .dwg must be accepted");

  const binary = selectUploadableFiles([file("mystery.bin", "", 2048)]);
  assert.equal(binary.accepted.length, 0);
  assert.match(binary.rejected[0].reason, /file type/);
});

test("the accept attribute offers .dwg by extension", () => {
  // A MIME-only accept list does not offer CAD files in the picker at all.
  assert.ok(UPLOAD_ACCEPT_ATTRIBUTE.includes(".dwg"));
  assert.ok(UPLOAD_ACCEPT_ATTRIBUTE.includes("application/pdf"));
});
