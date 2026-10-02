import type { Metadata } from "next";

import { seoReturnSpread } from "../../lib/seo";

export const metadata: Metadata = seoReturnSpread({
  description: "Spread-overwritten description.",
});

export default function PageReturnspread() {
  return (
    <section id="returnspread">
      <h1>Returnspread</h1>
    </section>
  );
}
