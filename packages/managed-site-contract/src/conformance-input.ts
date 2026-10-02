import * as z from "zod";

import { parseManagedSiteContentDocument } from "./content.js";
import { parseManagedSiteContractV1 } from "./contract.js";
import { ManagedSiteContractError } from "./errors.js";
import { parseJsonText } from "./json-text.js";
import {
  normalizeManagedSiteArtifactsV1,
  type ManagedSiteNormalizedArtifactsV1,
} from "./normalized-artifacts.js";

function schemaValidationFailure(): ManagedSiteContractError {
  return new ManagedSiteContractError(
    "SCHEMA_VALIDATION",
    "Managed-site schema validation failed",
  );
}

function parseContractText(contractText: string) {
  return parseManagedSiteContractV1(parseJsonText(contractText));
}

function parseContentText(contentText: string) {
  return parseManagedSiteContentDocument(parseJsonText(contentText));
}

export function conformManagedSiteJsonText(
  contractText: string,
  contentText: string,
): ManagedSiteNormalizedArtifactsV1 {
  try {
    return normalizeManagedSiteArtifactsV1(
      parseContractText(contractText),
      parseContentText(contentText),
    );
  } catch (error) {
    if (error instanceof z.ZodError) throw schemaValidationFailure();
    throw error;
  }
}
