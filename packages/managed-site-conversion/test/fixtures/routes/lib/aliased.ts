import type { Metadata } from "next";

// A PRIVATE function with the exported name. An importer's `seo(...)` never
// runs this one, so reading its body would read code that does not execute.
function seo({ description }: { readonly description: string }): Metadata {
  void description;
  return { description: "From the private declaration." };
}
void seo;

function actual({ description }: { readonly description: string }): Metadata {
  return { description };
}

export { actual as seo };
