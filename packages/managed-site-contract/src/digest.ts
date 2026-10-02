import { createHash } from "node:crypto";

import { canonicalizeJson } from "./canonical.js";

export const MANAGED_SITE_CONTRACT_DIGEST_DOMAIN =
  "gomega.managed-site-contract.v1\n";

export function digestCanonicalJson(input: unknown): string {
  const hash = createHash("sha256");
  hash.update(MANAGED_SITE_CONTRACT_DIGEST_DOMAIN, "utf8");
  hash.update(canonicalizeJson(input), "utf8");
  return hash.digest("hex");
}
