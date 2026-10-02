import type { ManagedSiteContentValue } from "./content.js";
import type {
  ManagedSiteValueReader,
  ManagedSiteValueSelector,
} from "./adapter-values.js";

export type ManagedSiteNextValueSelector<
  Type extends ManagedSiteContentValue["type"] = ManagedSiteContentValue["type"],
> = ManagedSiteValueSelector<Type>;

export type ManagedSiteNextValueReader = ManagedSiteValueReader;
