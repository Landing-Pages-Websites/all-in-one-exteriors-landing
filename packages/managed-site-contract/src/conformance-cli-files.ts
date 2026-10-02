import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  openSync,
  readFileSync,
  type Stats,
} from "node:fs";

import { ManagedSiteContractError } from "./errors.js";
import { HARD_MAX_JSON_TEXT_BYTES } from "./json-text.js";

const INPUT_FAILURE_MESSAGE = "Unable to read managed-site input";

function inputFailure(): ManagedSiteContractError {
  return new ManagedSiteContractError(
    "CONFORMANCE_INPUT_IO",
    INPUT_FAILURE_MESSAGE,
  );
}

function sameFile(
  expected: Stats,
  actual: Stats,
): boolean {
  return expected.dev === actual.dev && expected.ino === actual.ino;
}

function readRegularFile(path: string): Buffer {
  const expected = lstatSync(path);
  if (
    expected.isSymbolicLink() ||
    !expected.isFile() ||
    expected.size > HARD_MAX_JSON_TEXT_BYTES
  ) {
    throw inputFailure();
  }
  const descriptor = openSync(
    path,
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
  );
  try {
    const status = fstatSync(descriptor);
    if (
      !status.isFile() ||
      status.size > HARD_MAX_JSON_TEXT_BYTES ||
      !sameFile(expected, status)
    ) {
      throw inputFailure();
    }
    const value = readFileSync(descriptor);
    if (value.byteLength > HARD_MAX_JSON_TEXT_BYTES) throw inputFailure();
    return value;
  } finally {
    closeSync(descriptor);
  }
}

export function readManagedSiteConformanceFile(path: string): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(
      readRegularFile(path),
    );
  } catch {
    throw inputFailure();
  }
}
