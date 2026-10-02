import Link from "next/link";
import type { ReactElement } from "react";
import { publishedDate, type BlogPost } from "@/lib/blog";

interface PostCardProps {
  post: BlogPost;
}

export default function PostCard({ post }: PostCardProps): ReactElement {
  // `dateTime` is machine-readable, so it only appears for a date that parses.
  // The text the author wrote is still shown either way: a date we cannot
  // encode is a reason to drop the attribute, not to hide the date.
  const publishedIso = publishedDate(post)?.toISOString() ?? null;
  const dateClassName = "text-sm text-neutral-500";
  return (
    <article className="border-b border-neutral-200 py-8 last:border-b-0">
      {post.date && publishedIso ? (
        <time dateTime={publishedIso} className={dateClassName}>
          {post.date}
        </time>
      ) : null}
      {post.date && !publishedIso ? (
        <span className={dateClassName}>{post.date}</span>
      ) : null}
      <h2 className="mt-2 text-2xl font-semibold">
        <Link href={`/blog/${post.slug}`} className="hover:underline">
          {post.title}
        </Link>
      </h2>
      {post.description ? (
        <p className="mt-2 leading-relaxed text-neutral-700 dark:text-neutral-300">
          {post.description}
        </p>
      ) : null}
      <Link
        href={`/blog/${post.slug}`}
        className="mt-3 inline-block text-sm font-medium underline"
      >
        Read article
      </Link>
    </article>
  );
}
