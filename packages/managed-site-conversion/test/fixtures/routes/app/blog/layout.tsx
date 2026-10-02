import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Blog title",
};

export default function BlogLayout({ children }: { children: React.ReactNode }) {
  return <div id="blog">{children}</div>;
}
