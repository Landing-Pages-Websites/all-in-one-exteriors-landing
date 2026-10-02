import type { MetadataRoute } from "next";
import { listPublishedPosts, publishedDate } from "@/lib/blog";
import { siteRoutes } from "@/lib/routes";
import { absoluteUrl } from "@/lib/seo";

const DEFAULT_PRIORITY = 0.5;
const DEFAULT_CHANGE_FREQUENCY = "weekly" as const;


export default function sitemap(): MetadataRoute.Sitemap {
  const pages = siteRoutes.map((route) => ({
    url: absoluteUrl(route.path),
    lastModified: new Date(),
    changeFrequency: DEFAULT_CHANGE_FREQUENCY,
    priority: route.priority ?? DEFAULT_PRIORITY,
  }));
  // A post's <lastmod> is when it was published, not when the site was built.
  // `new Date()` here made every post claim to have changed on every deploy,
  // which teaches crawlers to ignore the signal.
  const posts = listPublishedPosts().map((post) => ({
    url: absoluteUrl(`/blog/${post.slug}`),
    lastModified: publishedDate(post) ?? undefined,
    changeFrequency: "monthly" as const,
    priority: 0.6,
  }));
  return [...pages, ...posts];
}
