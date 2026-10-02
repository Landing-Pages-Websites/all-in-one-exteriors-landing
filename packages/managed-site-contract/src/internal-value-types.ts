import * as z from "zod";

export const managedInternalValueTypeSchema = z.enum([
  "string",
  "url",
  "boolean",
  "number",
  "string_list",
  "postal_address",
  "geo_coordinates",
  "opening_hours",
  "indexing_directives",
  "json",
]);

export type ManagedInternalValueType = z.infer<
  typeof managedInternalValueTypeSchema
>;
