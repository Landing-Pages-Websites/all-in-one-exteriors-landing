"use client";

import type { ManagedFields } from "@/src/content/managed-site";

export function Panel({ managedFields }: { managedFields?: ManagedFields }) {
  return <p>{managedFields?.["field_unknown"]?.value ?? "Built by one crew."}</p>;
}
