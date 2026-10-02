import type { ReactElement } from "react";

export interface JsonLdProps {
  data: Record<string, unknown>;
}

/**
 * Renders a JSON-LD structured-data script tag. Pair with the builders in
 * "@/components/schema/builders" — e.g. <JsonLd data={buildBusinessSchema()} />.
 */
export function JsonLd({ data }: JsonLdProps): ReactElement {
  return (
    <script
      type="application/ld+json"
      // JSON.stringify output is safe here; "<" is escaped to guard against
      // config values that could otherwise close the script tag.
      dangerouslySetInnerHTML={{
        __html: JSON.stringify(data).replace(/</g, "\\u003c"),
      }}
    />
  );
}
