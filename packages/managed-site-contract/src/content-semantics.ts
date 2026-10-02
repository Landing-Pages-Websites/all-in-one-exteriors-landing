import type { ManagedSiteContentDocument } from "./content.js";
import { validateManagedContentCollections } from "./content-semantics-collections.js";
import { collectManagedContentSemanticFacts } from "./content-semantics-facts.js";
import { validateManagedContentLevelOneHeadings } from "./content-semantics-headings.js";
import {
  validateManagedContentAssets,
  validateManagedContentValues,
} from "./content-semantics-values.js";
import type { ManagedSiteContractV1 } from "./contract.js";
import { validateManagedSiteContractV1Semantics } from "./contract-semantics.js";

export function validateManagedSiteContractV1ContentSemantics(
  contract: ManagedSiteContractV1,
  content: ManagedSiteContentDocument,
): void {
  validateManagedSiteContractV1Semantics(contract);
  const facts = collectManagedContentSemanticFacts(contract, content);
  validateManagedContentValues(facts);
  validateManagedContentCollections(facts);
  validateManagedContentAssets(facts);
  validateManagedContentLevelOneHeadings(contract, content);
}
