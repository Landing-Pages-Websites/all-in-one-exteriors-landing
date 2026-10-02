import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Client chain",
  description: "A fixture shaped like a site whose values live in client components.",
  robots: { index: true, follow: true },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
