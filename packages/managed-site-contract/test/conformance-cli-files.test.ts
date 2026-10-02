import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  rmSync,
  symlinkSync,
  truncateSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

import { readManagedSiteConformanceFile } from "../src/conformance-cli-files.js";
import {
  HARD_MAX_JSON_TEXT_BYTES,
  ManagedSiteContractError,
} from "../src/index.js";

function withTempDirectory(action: (directory: string) => void): void {
  const directory = mkdtempSync(join(tmpdir(), "managed-site-cli-"));
  try {
    action(directory);
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
}

function assertInputFailure(action: () => unknown): void {
  assert.throws(
    action,
    (error: unknown) =>
      error instanceof ManagedSiteContractError &&
      error.code === "CONFORMANCE_INPUT_IO" &&
      error.message === "Unable to read managed-site input",
  );
}

describe("managed-site conformance file reader", () => {
  it("reads an exact regular UTF-8 file", () => {
    withTempDirectory((directory) => {
      const path = join(directory, "contract.json");
      writeFileSync(path, '{"name":"café"}', "utf8");

      assert.equal(readManagedSiteConformanceFile(path), '{"name":"café"}');
    });
  });

  it("accepts the exact byte hard cap", () => {
    withTempDirectory((directory) => {
      const path = join(directory, "exact.json");
      writeFileSync(path, "", "utf8");
      truncateSync(path, HARD_MAX_JSON_TEXT_BYTES);

      assert.equal(
        readManagedSiteConformanceFile(path).length,
        HARD_MAX_JSON_TEXT_BYTES,
      );
    });
  });

  it("rejects a file one byte over the hard cap before decoding", () => {
    withTempDirectory((directory) => {
      const path = join(directory, "oversized.json");
      writeFileSync(path, "", "utf8");
      truncateSync(path, HARD_MAX_JSON_TEXT_BYTES + 1);

      assertInputFailure(() => readManagedSiteConformanceFile(path));
    });
  });

  it("rejects invalid UTF-8 without replacement characters", () => {
    withTempDirectory((directory) => {
      const path = join(directory, "invalid.json");
      writeFileSync(path, Buffer.from([0xc3, 0x28]));

      assertInputFailure(() => readManagedSiteConformanceFile(path));
    });
  });

  it("rejects directories, symlinks, and missing paths identically", () => {
    withTempDirectory((directory) => {
      const file = join(directory, "target.json");
      const childDirectory = join(directory, "child");
      const symlink = join(directory, "link.json");
      const missing = join(directory, "missing.json");
      writeFileSync(file, "{}", "utf8");
      mkdirSync(childDirectory);
      symlinkSync(file, symlink);

      for (const path of [childDirectory, symlink, missing]) {
        assertInputFailure(() => readManagedSiteConformanceFile(path));
      }
    });
  });
});
