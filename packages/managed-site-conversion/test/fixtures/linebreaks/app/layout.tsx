import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Line breaks",
  description: "A fixture whose text blocks are drawn on more than one line.",
  robots: { index: true, follow: true },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
