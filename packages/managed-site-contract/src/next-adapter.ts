import {
  createManagedSiteAdapterV1,
  type CreateManagedSiteV1Input,
  type ManagedSiteV1,
} from "./adapter.js";

const NEXT_ADAPTER = Object.freeze({
  kind: "nextjs" as const,
  errors: Object.freeze({
    inputInvalid: "NEXT_ADAPTER_INPUT_INVALID",
    kindMismatch: "NEXT_ADAPTER_KIND",
    selectorInvalid: "NEXT_ADAPTER_SELECTOR_INVALID",
    valueMissing: "NEXT_ADAPTER_VALUE_MISSING",
    valueType: "NEXT_ADAPTER_VALUE_TYPE",
  }),
});

export type CreateManagedSiteNextV1Input = CreateManagedSiteV1Input;
export type ManagedSiteNextV1 = ManagedSiteV1;

export function createManagedSiteNextV1(
  input: CreateManagedSiteNextV1Input,
): ManagedSiteNextV1 {
  return createManagedSiteAdapterV1(input, NEXT_ADAPTER);
}
