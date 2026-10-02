import { createHash } from "node:crypto";

import { canonicalizeJson } from "./canonical.js";
import type { ManagedSiteContentDocument } from "./content.js";
import { validateManagedSiteContractV1ContentSemantics } from "./content-semantics.js";
import type { ManagedSiteContractV1 } from "./contract.js";

export interface ManagedSiteContractArtifactV1 {
  readonly schemaVersion: ManagedSiteContractV1["schemaVersion"];
  readonly adapterKind: ManagedSiteContractV1["adapter"]["kind"];
  readonly adapterVersion: ManagedSiteContractV1["adapter"]["adapterVersion"];
  readonly canonicalContractJson: string;
  readonly contractSha256: string;
}

export interface ManagedSiteContentArtifactV1 {
  readonly schemaVersion: ManagedSiteContentDocument["schemaVersion"];
  readonly canonicalContentJson: string;
  readonly contentSha256: string;
  readonly canonicalAssetManifestJson: string;
  readonly assetManifestSha256: string;
}

export interface ManagedSiteNormalizedArtifactsV1 {
  readonly contract: ManagedSiteContractArtifactV1;
  readonly content: ManagedSiteContentArtifactV1;
}

function sha256Text(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function contractArtifact(
  contract: ManagedSiteContractV1,
  canonicalContractJson: string,
): ManagedSiteContractArtifactV1 {
  return Object.freeze({
    schemaVersion: contract.schemaVersion,
    adapterKind: contract.adapter.kind,
    adapterVersion: contract.adapter.adapterVersion,
    canonicalContractJson,
    contractSha256: sha256Text(canonicalContractJson),
  });
}

function contentArtifact(
  content: ManagedSiteContentDocument,
  canonicalContentJson: string,
  canonicalAssetManifestJson: string,
): ManagedSiteContentArtifactV1 {
  return Object.freeze({
    schemaVersion: content.schemaVersion,
    canonicalContentJson,
    contentSha256: sha256Text(canonicalContentJson),
    canonicalAssetManifestJson,
    assetManifestSha256: sha256Text(canonicalAssetManifestJson),
  });
}

export function normalizeManagedSiteArtifactsV1(
  contract: ManagedSiteContractV1,
  content: ManagedSiteContentDocument,
): ManagedSiteNormalizedArtifactsV1 {
  validateManagedSiteContractV1ContentSemantics(contract, content);
  const canonicalContractJson = canonicalizeJson(contract);
  const canonicalContentJson = canonicalizeJson(content);
  const canonicalAssetManifestJson = canonicalizeJson(content.assetManifest);
  return Object.freeze({
    contract: contractArtifact(contract, canonicalContractJson),
    content: contentArtifact(
      content,
      canonicalContentJson,
      canonicalAssetManifestJson,
    ),
  });
}
