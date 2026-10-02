import Image from "next/image";
import type { ReactElement } from "react";
import { canOptimizeBlogImage } from "@/lib/blog-images";
import { readLocalImageSize } from "@/lib/imageSize";

/**
 * `body` declares the source's own dimensions, so the box reserved before the
 * image loads is the box it ends up occupying. A portrait infographic or a
 * tall before/after photo must not be reshaped into a banner.
 *
 * `banner` keeps the fixed 16:9 declaration the article header has always
 * used. That reserves a 16:9 box rather than enforcing one: with `height:auto`
 * the natural ratio wins once the image decodes, so a non-16:9 hero still
 * settles at its own shape and still shifts on load. Making the header a true
 * 16:9 crop would change the hero on every existing site, so it is left alone
 * here deliberately.
 */
type BlogImageVariant = "banner" | "body";

interface BlogImageProps {
  src: string;
  alt: string;
  variant: BlogImageVariant;
  priority?: boolean;
}

const BANNER_SIZE = { width: 1600, height: 900 } as const;

export default function BlogImage({
  src,
  alt,
  variant,
  priority = false,
}: BlogImageProps): ReactElement {
  // Only local files have knowable dimensions at build time. A remote src
  // keeps the fixed box, which is what it has always had.
  const intrinsic = variant === "body" ? readLocalImageSize(src) : null;
  const { width, height } = intrinsic ?? BANNER_SIZE;

  return (
    <Image
      src={src}
      alt={alt}
      width={width}
      height={height}
      sizes="(min-width: 768px) 42rem, 100vw"
      // `object-cover` fills the fixed box; with real dimensions the box
      // already matches the image, so cropping it would only ever lose pixels.
      className={
        intrinsic
          ? "h-auto w-full rounded-lg"
          : "h-auto w-full rounded-lg object-cover"
      }
      priority={priority}
      unoptimized={!canOptimizeBlogImage(src)}
    />
  );
}
