import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Legal layout title",
};

export default function LegalLayout({ children }: { children: React.ReactNode }) {
  return <div id="legal">{children}</div>;
}
