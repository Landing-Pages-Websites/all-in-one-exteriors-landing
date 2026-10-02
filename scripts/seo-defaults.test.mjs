import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const sitemapPath = new URL("../src/app/sitemap.ts", import.meta.url);
const robotsPath = new URL("../src/app/robots.ts", import.meta.url);

async function loadMetadataRoute(path, replacements) {
  const source = await readFile(path, "utf8");
  const transformed = Object.entries(replacements).reduce(
    (result, [search, replacement]) => result.replace(search, replacement),
    source,
  );
  const output = ts.transpileModule(transformed, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText;

  return import(`data:text/javascript,${encodeURIComponent(output)}`);
}

test("sitemap gives every registered prelaunch route a weekly crawl default", async () => {
  const siteRoutes = [{ path: "/", priority: 1 }, { path: "/services" }];
  const { default: sitemap } = await loadMetadataRoute(sitemapPath, {
    'import type { MetadataRoute } from "next";': "",
    'import { listPublishedPosts, publishedDate } from "@/lib/blog";':
      "const listPublishedPosts = () => []; const publishedDate = () => null;",
    'import { siteRoutes } from "@/lib/routes";': `const siteRoutes = ${JSON.stringify(siteRoutes)};`,
    'import { absoluteUrl } from "@/lib/seo";': 'const absoluteUrl = (path) => `https://preview.example${path}`;',
  });

  const entries = sitemap();

  assert.deepEqual(
    entries.map(({ url, changeFrequency, priority }) => ({ url, changeFrequency, priority })),
    [
      {
        url: "https://preview.example/",
        changeFrequency: "weekly",
        priority: 1,
      },
      {
        url: "https://preview.example/services",
        changeFrequency: "weekly",
        priority: 0.5,
      },
    ],
  );
  assert.ok(entries.every(({ lastModified }) => lastModified instanceof Date));
});

test("a post's lastModified comes from publishedDate, and is omitted when it has none", async () => {
  // `new Date()` here made every post claim to have changed on every deploy,
  // which teaches crawlers to ignore <lastmod> entirely.
  //
  // This asserts the WIRING only: that the sitemap asks `publishedDate` and
  // omits the entry's lastModified when it declines. Which date strings are
  // usable is `publishedDate`'s own rule, tested against the real function in
  // src/lib/blog.test.ts — re-implementing that rule in this stub would make
  // the test agree with itself rather than with the loader.
  const posts = [{ slug: "dated" }, { slug: "no-usable-date" }];
  const { default: sitemap } = await loadMetadataRoute(sitemapPath, {
    'import type { MetadataRoute } from "next";': "",
    'import { listPublishedPosts, publishedDate } from "@/lib/blog";': `const listPublishedPosts = () => ${JSON.stringify(posts)};
       const publishedDate = (post) =>
         post.slug === "dated" ? new Date("2026-01-15T00:00:00.000Z") : null;`,
    'import { siteRoutes } from "@/lib/routes";': "const siteRoutes = [];",
    'import { absoluteUrl } from "@/lib/seo";': 'const absoluteUrl = (path) => `https://preview.example${path}`;',
  });

  assert.deepEqual(
    sitemap().map(({ url, lastModified }) => [
      url,
      lastModified instanceof Date ? lastModified.toISOString() : lastModified,
    ]),
    [
      ["https://preview.example/blog/dated", "2026-01-15T00:00:00.000Z"],
      ["https://preview.example/blog/no-usable-date", undefined],
    ],
  );
});

test("llms.txt lists exactly the posts the loader publishes", async () => {
  // sitemap.xml and llms.txt must never disagree about which posts exist, and
  // grepping both files for `listPublishedPosts` would not catch one of them
  // filtering the result differently. Run the real route instead.
  const posts = [
    { slug: "first", title: "First post" },
    { slug: "second", title: "Second post" },
  ];
  const { GET } = await loadMetadataRoute(
    new URL("../src/app/llms.txt/route.ts", import.meta.url),
    {
      'import { listPublishedPosts } from "@/lib/blog";': `const listPublishedPosts = () => ${JSON.stringify(posts)};`,
      'import { siteRoutes } from "@/lib/routes";': 'const siteRoutes = [{ path: "/", title: "Home" }];',
      'import { absoluteUrl } from "@/lib/seo";': 'const absoluteUrl = (path) => `https://preview.example${path}`;',
      'import { managedHome } from "@/content/managed-site";':
        'const managedHome = { seo: { identity: { displayName: "Acme", email: "a@example.com", telephone: "555" }, metadata: { description: "Desc" } } };',
    },
  );

  const body = await new Response(GET().body).text();
  assert.match(body, /## Articles/);
  assert.deepEqual(
    body.split("\n").filter((line) => line.startsWith("- [") && line.includes("/blog/")),
    [
      "- [First post](https://preview.example/blog/first)",
      "- [Second post](https://preview.example/blog/second)",
    ],
  );
});

test("robots permits review crawlers and advertises the sitemap", async () => {
  const { default: robots } = await loadMetadataRoute(robotsPath, {
    'import type { MetadataRoute } from "next";': "",
    'import { absoluteUrl } from "@/lib/seo";': 'const absoluteUrl = (path) => `https://preview.example${path}`;',
  });

  assert.deepEqual(robots(), {
    rules: [{ userAgent: "*", allow: "/" }],
    sitemap: "https://preview.example/sitemap.xml",
  });
});
