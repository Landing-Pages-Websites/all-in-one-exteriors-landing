import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Formatted blocks",
  description: "A fixture whose text blocks carry inline formatting.",
  robots: { index: true, follow: true },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
