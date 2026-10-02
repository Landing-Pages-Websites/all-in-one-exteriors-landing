import type { Metadata } from "next";

import "./globals.css";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "Northwind Signs",
  description: "A reference site for proving a conversion changes nothing.",
  robots: { index: true, follow: true },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
