import {
  createManagedSiteAdapterV1,
  type CreateManagedSiteV1Input,
  type ManagedSiteV1,
} from "./adapter.js";

const ASTRO_ADAPTER = Object.freeze({
  kind: "astro" as const,
  errors: Object.freeze({
    inputInvalid: "ASTRO_ADAPTER_INPUT_INVALID",
    kindMismatch: "ASTRO_ADAPTER_KIND",
    selectorInvalid: "ASTRO_ADAPTER_SELECTOR_INVALID",
    valueMissing: "ASTRO_ADAPTER_VALUE_MISSING",
    valueType: "ASTRO_ADAPTER_VALUE_TYPE",
  }),
});

export type CreateManagedSiteAstroV1Input = CreateManagedSiteV1Input;
export type ManagedSiteAstroV1 = ManagedSiteV1;

export function createManagedSiteAstroV1(
  input: CreateManagedSiteAstroV1Input,
): ManagedSiteAstroV1 {
  return createManagedSiteAdapterV1(input, ASTRO_ADAPTER);
}
