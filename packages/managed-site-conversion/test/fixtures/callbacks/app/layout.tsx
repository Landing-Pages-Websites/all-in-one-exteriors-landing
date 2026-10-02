import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Callback fixture",
  description: "A fixture for components rendered from inside callbacks.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
