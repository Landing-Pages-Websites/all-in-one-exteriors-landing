import { listPublishedPosts } from "@/lib/blog";
import { siteRoutes } from "@/lib/routes";
import { absoluteUrl } from "@/lib/seo";
import { managedHome } from "@/content/managed-site";

/**
 * Prerendered at build time, like sitemap.xml.
 *
 * Every input is known at build: the managed content, the route registry and
 * the content directory. Left dynamic, a route handler is uncached by default
 * and each request would re-scan `content/blog` and synchronously read every
 * post off disk on the event loop — for a file crawlers fetch in bursts.
 */
export const dynamic = "force-static";

/** Serves /llms.txt — a machine-readable site summary for LLM crawlers. */
export function GET(): Response {
  const { identity, metadata } = managedHome.seo;
  const pageLines = siteRoutes.map(
    (route) => `- [${route.title}](${absoluteUrl(route.path)})`,
  );
  // Posts are not in the route registry — they come from the content
  // directory. Everything that lists posts reads this one loader, so llms.txt
  // and sitemap.xml cannot disagree about which posts exist.
  const articleLines = listPublishedPosts().map(
    (post) => `- [${post.title}](${absoluteUrl(`/blog/${post.slug}`)})`,
  );

  const body = [
    `# ${identity.displayName}`,
    "",
    `> ${metadata.description}`,
    "",
    "## Pages",
    "",
    ...pageLines,
    "",
    ...(articleLines.length > 0 ? ["## Articles", "", ...articleLines, ""] : []),
    "## Contact",
    "",
    `- Email: ${identity.email}`,
    `- Phone: ${identity.telephone}`,
    "",
  ].join("\n");

  return new Response(body, {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}
