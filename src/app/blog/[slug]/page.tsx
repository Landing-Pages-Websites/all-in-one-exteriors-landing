import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactElement } from "react";
import MarkdownBody from "@/components/blog/MarkdownBody";
import BlogImage from "@/components/blog/BlogImage";
import { JsonLd } from "@/components/schema/JsonLd";
import { buildArticleSchema } from "@/components/schema/builders";
import { getPublishedPost, listPublishedPosts, publishedDate } from "@/lib/blog";
import { buildMetadata } from "@/lib/seo";

interface ArticleParams {
  params: Promise<{ slug: string }>;
}

export function generateStaticParams(): Array<{ slug: string }> {
  return listPublishedPosts().map((post) => ({ slug: post.slug }));
}

/**
 * Only the params `generateStaticParams` returned are valid routes.
 *
 * Without this, `dynamicParams` defaults to true: Next renders ANY slug on
 * demand, the page calls `notFound()` mid-stream, and the 404 comes back with
 * an EMPTY <body> because the shell had already flushed. A crawler or a stale
 * inbound link gets a blank page with no header and no way back into the site.
 */
export const dynamicParams = false;

export async function generateMetadata({
  params,
}: ArticleParams): Promise<Metadata> {
  const { slug } = await params;
  const post = getPublishedPost(slug);
  if (!post) return {};
  return buildMetadata({
    title: post.title,
    description: post.description || post.title,
    path: `/blog/${post.slug}`,
    ogImagePath: post.image ?? undefined,
  });
}

export default async function BlogArticlePage({
  params,
}: ArticleParams): Promise<ReactElement> {
  const { slug } = await params;
  const post = getPublishedPost(slug);
  if (!post) notFound();
  const path = `/blog/${post.slug}`;
  // The Article schema and the <time> element are both machine-readable, so
  // both need a date that actually parses rather than whatever text the
  // frontmatter carried: Google rejects a rich result with a bad
  // datePublished, and an invalid dateTime attribute is worse than no <time>.
  // The date the author wrote is still shown either way.
  const publishedIso = publishedDate(post)?.toISOString() ?? null;
  return (
    <article className="mx-auto w-full max-w-2xl px-6 py-16">
      {publishedIso ? (
        <JsonLd
          data={buildArticleSchema({
            headline: post.title,
            description: post.description || post.title,
            path,
            datePublished: publishedIso,
            imagePath: post.image ?? undefined,
          })}
        />
      ) : null}
      <p className="text-sm text-neutral-500">
        <Link href="/blog" className="underline">
          ← All articles
        </Link>
        {post.date ? (
          <>
            {" · "}
            {publishedIso ? (
              <time dateTime={publishedIso}>{post.date}</time>
            ) : (
              post.date
            )}
          </>
        ) : null}
      </p>
      <h1 className="mt-6 text-3xl font-bold">{post.title}</h1>
      {post.author ? (
        <p className="mt-2 text-sm text-neutral-500">By {post.author}</p>
      ) : null}
      {post.image ? (
        <div className="mt-8">
          <BlogImage
            src={post.image}
            alt={post.imageAlt ?? post.title}
            variant="banner"
            priority
          />
        </div>
      ) : null}
      <div className="mt-10">
        <MarkdownBody source={post.body} />
      </div>
    </article>
  );
}
