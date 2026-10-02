import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Fixture site",
  description: "A fixture used by the managed-site conversion tests.",
  robots: { index: false, follow: true },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
