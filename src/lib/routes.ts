/**
 * Route registry — the single list of public pages on this site.
 *
 * Site builders APPEND an entry here for every page they add. The registry
 * drives sitemap.xml, llms.txt, and the 404 page's "key pages" links, so a
 * missing entry means the page is invisible to search engines and LLMs.
 *
 * Blog posts are the one exception: they are not registered here. They come
 * from `listPublishedPosts()` in `src/lib/blog.ts`, which sitemap.xml and
 * llms.txt both read, so a published post reaches both without an entry.
 */

export interface RouteEntry {
  /** Path starting with "/", e.g. "/services/roof-repair". */
  path: string;
  /** Human-readable page title, used in llms.txt and the 404 page. */
  title: string;
  /** Sitemap priority 0.0–1.0. Defaults to 0.5 when omitted. */
  priority?: number;
  /** Set true to keep the route out of the 404 page's quick links. */
  hideFromKeyPages?: boolean;
}

export const siteRoutes: RouteEntry[] = [
  { path: "/", title: "Home", priority: 1 },
  { path: "/privacy-policy", title: "Privacy Policy", priority: 0.2, hideFromKeyPages: true },
  { path: "/terms", title: "Terms of Service", priority: 0.2, hideFromKeyPages: true },
  { path: "/cookie-policy", title: "Cookie Policy", priority: 0.2, hideFromKeyPages: true },
  { path: "/thank-you", title: "Thank You", priority: 0.1, hideFromKeyPages: true },
  { path: "/blog", title: "Blog", priority: 0.7 },
  // Builders: append new pages below this line.
];
