import {
  parseManagedSiteContentDocument,
  type ManagedSiteContentDocument,
} from "./content.js";
import { validateManagedSiteContractV1ContentSemantics } from "./content-semantics.js";
import type { ManagedSiteContractV1 } from "./contract.js";
import { validateManagedSiteContractV1Semantics } from "./contract-semantics.js";
import {
  ManagedSiteSourceResolver,
  type ManagedSiteSourceDocumentV1,
} from "./source-documents.js";
import {
  projectCollectionValues,
  validateCollectionSourcePointers,
} from "./source-projection-collections.js";
import {
  ProjectedAssetManifest,
  projectNonItemValues,
} from "./source-projection-values.js";

export function projectManagedSiteContentDocumentV1(
  contract: ManagedSiteContractV1,
  sourceDocuments: readonly ManagedSiteSourceDocumentV1[],
): ManagedSiteContentDocument {
  validateManagedSiteContractV1Semantics(contract);
  validateCollectionSourcePointers(contract.collections);
  const sources = new ManagedSiteSourceResolver(sourceDocuments);
  const manifest = new ProjectedAssetManifest();
  const values = [
    ...projectNonItemValues(contract, sources, manifest),
    ...projectCollectionValues(contract.collections, sources, manifest),
  ];
  sources.assertComplete();
  const content = parseManagedSiteContentDocument({
    schemaVersion: "1.0",
    values,
    assetManifest: manifest.ordered(contract.assets),
  });
  validateManagedSiteContractV1ContentSemantics(contract, content);
  return content;
}
