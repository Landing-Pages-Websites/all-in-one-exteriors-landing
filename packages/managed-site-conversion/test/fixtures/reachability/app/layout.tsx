import type { Metadata } from "next";

import { SiteFooter } from "@/components/SiteFooter";

export const metadata: Metadata = {
  title: "Reachability fixture",
  description: "A fixture for render-tree reachability.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  // Declared inside the layout and rendered by nothing.
  function UnusedNotice() {
    return (
      <aside id="notice">
        <p>Never shown from the layout</p>
      </aside>
    );
  }
  return (
    <html lang="en">
      <body>
        {children}
        <SiteFooter />
      </body>
    </html>
  );
}
