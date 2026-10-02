/**
 * MEGA git-as-CMS (`imageStrategy: "remote-url"`, the default) writes public
 * article image URLs into frontmatter. Those hosts must be in
 * `images.remotePatterns` or `next/image` will refuse them at runtime.
 */
export const MEGA_ARTICLE_IMAGE_HOST =
  "zleague-public-prod.s3.us-east-2.amazonaws.com";

const MEGA_ARTICLE_PATH_STYLE_HOST = "s3.us-east-2.amazonaws.com";
const MEGA_ARTICLE_PATH_PREFIX = "/zleague-public-prod/";

export const megaArticleImageRemotePatterns = [
  {
    protocol: "https" as const,
    hostname: MEGA_ARTICLE_IMAGE_HOST,
  },
  {
    protocol: "https" as const,
    hostname: MEGA_ARTICLE_PATH_STYLE_HOST,
    pathname: "/zleague-public-prod/**",
  },
];

/**
 * True when `src` is a path this site serves itself, so the bytes are on disk
 * under `public/` at build time.
 */
export function isLocalBlogImage(src: string): boolean {
  // `//host/x` starts with `/` but is a remote URL, not a site path.
  return src.startsWith("/") && !src.startsWith("//");
}

/** True when next/image can optimize this src (local path or allowlisted S3). */
export function canOptimizeBlogImage(src: string): boolean {
  if (isLocalBlogImage(src)) return true;
  try {
    const url = new URL(src);
    if (url.protocol !== "https:") return false;
    if (url.hostname === MEGA_ARTICLE_IMAGE_HOST) return true;
    return (
      url.hostname === MEGA_ARTICLE_PATH_STYLE_HOST &&
      url.pathname.startsWith(MEGA_ARTICLE_PATH_PREFIX)
    );
  } catch {
    return false;
  }
}
