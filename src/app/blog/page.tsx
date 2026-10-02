import type { Metadata } from "next";
import type { ReactElement } from "react";
import PostCard from "@/components/blog/PostCard";
import { listPublishedPosts } from "@/lib/blog";
import { buildMetadata } from "@/lib/seo";
import { siteConfig } from "@/site.config";

export const metadata: Metadata = buildMetadata({
  title: "Blog",
  description: `Articles and updates from ${siteConfig.businessName}.`,
  path: "/blog",
});

export default function BlogIndexPage(): ReactElement {
  const posts = listPublishedPosts();
  return (
    <article className="mx-auto w-full max-w-2xl px-6 py-16">
      <h1 className="text-3xl font-bold">Blog</h1>
      <p className="mt-2 text-neutral-600 dark:text-neutral-400">
        Tips, updates, and practical advice from {siteConfig.businessName}.
      </p>
      <section aria-label="Articles" className="mt-10">
        {posts.map((post) => (
          <PostCard key={post.slug} post={post} />
        ))}
      </section>
    </article>
  );
}
