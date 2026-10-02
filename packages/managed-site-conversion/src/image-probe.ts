import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import type { ManagedImageValue } from "@landing-pages-websites/managed-site-contract";

import { parseImageHeaderFrom, type ImageFormat } from "../../../src/lib/imageHeader.js";

/**
 * Facts about a committed image file. Dimensions, bytes and digest are facts
 * about the file rather than judgements about it, so they are safe to migrate
 * automatically; anything this cannot read is reported rather than assumed.
 *
 * Dimensions come from `src/lib/imageHeader.ts`, the repository's one image
 * header parser, which the starter's blog rendering shares. What is left here
 * is what conversion alone needs: the contract mime type, the byte count, the
 * digest, and the reduced aspect ratio.
 */

/**
 * Taken from the contract rather than restated, so adding a mime type to
 * `managedImageMimeTypeSchema`, or dropping one from it, is a compile error
 * here instead of a manifest the contract will not validate.
 */
export type ImageMimeType = ManagedImageValue["mimeType"];

export interface ProbedImage {
  readonly mimeType: ImageMimeType;
  readonly width: number;
  readonly height: number;
  readonly bytes: number;
  readonly sha256: string;
}

/**
 * The contract's mime type for each format the header parser understands, and
 * null for the formats the contract does not admit. Keyed by `ImageFormat`, so
 * teaching the parser a new format is a compile error here rather than a silent
 * null; valued by the contract's own union, so the mime types cannot drift from
 * it. GIF and BMP are read correctly and then refused, because a manifest entry
 * naming either would fail contract validation downstream.
 */
const CONTRACT_MIME_TYPES: Record<ImageFormat, ImageMimeType | null> = {
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  avif: "image/avif",
  gif: null,
  bmp: null,
};

export function probeImage(absolutePath: string): ProbedImage | null {
  let bytes: Buffer;
  try {
    bytes = readFileSync(absolutePath);
  } catch {
    return null;
  }
  // The digest needs every byte, so the file is already in memory. Parse the
  // header out of it rather than opening the file a second time.
  const header = parseImageHeaderFrom(bytes);
  if (header === null) return null;
  const mimeType = CONTRACT_MIME_TYPES[header.format];
  if (mimeType === null) return null;
  return {
    mimeType,
    width: header.width,
    height: header.height,
    bytes: bytes.byteLength,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
}

function greatestCommonDivisor(left: number, right: number): number {
  return right === 0 ? left : greatestCommonDivisor(right, left % right);
}

export function aspectRatioOf(image: ProbedImage): { readonly width: number; readonly height: number } {
  const divisor = greatestCommonDivisor(image.width, image.height);
  return { width: image.width / divisor, height: image.height / divisor };
}
