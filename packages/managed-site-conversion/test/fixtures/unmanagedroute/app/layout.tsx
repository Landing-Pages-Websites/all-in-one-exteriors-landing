import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Unmanaged route fixture",
  description: "A fixture with one public page and one internal screen.",
  robots: { index: false, follow: true },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
