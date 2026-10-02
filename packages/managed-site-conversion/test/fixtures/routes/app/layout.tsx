import type { Metadata } from "next";

// Declares no title, so a route that declares none of its own resolves nothing.
export const metadata: Metadata = {
  description: "Layout description.",
  robots: { index: true, follow: true },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
