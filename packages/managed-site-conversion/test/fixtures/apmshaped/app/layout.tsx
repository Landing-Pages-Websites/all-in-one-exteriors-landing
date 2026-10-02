import type { Metadata } from "next";

import { Chrome } from "@/components/Chrome";
import { Footer } from "@/components/Footer";

export const metadata: Metadata = {
  title: "All Points",
  description: "A fixture shaped like a converted marketing site.",
  robots: { index: true, follow: true },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Chrome />
        {children}
        <Footer />
      </body>
    </html>
  );
}
