/**
 * Resolves a blog image's `src` to a file under `public/` and reports the pixel
 * dimensions the browser will paint.
 *
 * Blog pages are server components rendered at build time, so a local image's
 * real dimensions are knowable then. `next/image` needs `width` and `height` to
 * reserve the box before the bytes arrive; guessing 16:9 makes every non-16:9
 * body image shift the page when it loads.
 *
 * Header parsing lives in `imageHeader.ts`, which the managed-site conversion
 * proposer shares. This file is the part that is specific to how this site
 * serves its own files, and is the only part that may touch a path.
 */
import { resolve, sep } from "node:path";
import { isLocalBlogImage } from "@/lib/blog-images";
import { readImageHeader, type ImageSize } from "@/lib/imageHeader";

/** Files live under `public/`, which Next serves from the site root. */
const PUBLIC_DIR = "public";

/**
 * Absolute path of the file `src` resolves to inside `public/`, or null when
 * `src` is remote or escapes the directory.
 */
function publicFilePath(src: string): string | null {
  if (!isLocalBlogImage(src)) return null;
  let pathname: string;
  try {
    // Drop any query or hash, and undo percent-encoding, so the lookup matches
    // the file on disk rather than the URL spelling of it.
    pathname = decodeURIComponent(new URL(src, "http://site.invalid").pathname);
  } catch {
    return null;
  }
  if (pathname.includes("\0")) return null;
  const root = resolve(process.cwd(), PUBLIC_DIR);
  const file = resolve(root, `.${pathname}`);
  return file.startsWith(root + sep) ? file : null;
}

/**
 * Pixel dimensions of a local image as the browser will render it, or null for
 * a remote src, a missing file, or a header this does not understand.
 */
export function readLocalImageSize(src: string): ImageSize | null {
  const file = publicFilePath(src);
  if (!file) return null;
  const header = readImageHeader(file);
  // Only the axes: callers compare this against a plain size, and the format is
  // the conversion proposer's business rather than this site's.
  return header === null ? null : { width: header.width, height: header.height };
}
