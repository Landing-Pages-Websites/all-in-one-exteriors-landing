import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Hidden route fixture",
  description: "A fixture with public pages and routes that answer 404.",
  robots: { index: true, follow: true },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
