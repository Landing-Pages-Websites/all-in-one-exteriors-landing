/**
 * Reads the pixel dimensions of an image from its header, with no dependency
 * and no full decode.
 *
 * This file is the one image header parser in the repository. It is imported by
 * `src/lib/imageSize.ts`, which sizes blog images for `next/image` at build
 * time, and by `packages/managed-site-conversion/src/image-probe.ts`, which
 * builds the asset manifest for a customer repository being converted. It must
 * stay free of imports other than `node:fs`: it is copied into every customer
 * site along with the rest of `src/lib/`, and those sites are plain Next apps
 * with no workspace packages to resolve.
 *
 * The format list mirrors what the go-live blog migrator will commit into
 * `public/blog/<slug>/` — it sniffs magic bytes and accepts exactly JPEG, PNG,
 * GIF, BMP, WebP and AVIF (SVG is rejected there, since the starter does not
 * set `dangerouslyAllowSVG`). See `blogmig/images.py` in zleague/mega-clawhub.
 *
 * Every failure path returns null. Callers must fall back to their own answer,
 * so an unreadable or unrecognised file is never worse than not looking.
 */
import { closeSync, fstatSync, openSync, readSync } from "node:fs";

export interface ImageSize {
  width: number;
  height: number;
}

/** Reads `length` bytes at `offset`, or null if they are not all in the file. */
export type ReadBytes = (offset: number, length: number) => Buffer | null;

/**
 * How far into a file a header walk may reach before giving up. Bounds the work
 * a corrupt file can cause at build time; real headers sit far below this.
 */
const MAX_HEADER_SCAN_BYTES = 512 * 1024;

/** Bytes of a JPEG read at once while scanning past fill for a marker. */
const MARKER_SCAN_WINDOW = 512;

const EXIF_ORIENTATION_TAG = 0x0112;

/**
 * Swaps the axes. Browsers apply a JPEG's EXIF orientation and an AVIF's `irot`
 * before painting, so a quarter-turned image renders transposed to how its
 * dimensions are stored.
 */
function transpose(size: ImageSize): ImageSize {
  return { width: size.height, height: size.width };
}

function toSize(width: number, height: number): ImageSize | null {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height)) return null;
  if (width <= 0 || height <= 0) return null;
  return { width, height };
}

// --- PNG ---------------------------------------------------------------------

function parsePng(read: ReadBytes): ImageSize | null {
  // IHDR is required to be the first chunk: type(4) width(4) height(4).
  const header = read(12, 12);
  if (!header || header.toString("latin1", 0, 4) !== "IHDR") return null;
  return toSize(header.readUInt32BE(4), header.readUInt32BE(8));
}

// --- GIF ---------------------------------------------------------------------

function parseGif(read: ReadBytes): ImageSize | null {
  // Logical screen descriptor follows the 6-byte signature.
  const screen = read(6, 4);
  if (!screen) return null;
  return toSize(screen.readUInt16LE(0), screen.readUInt16LE(2));
}

// --- BMP ---------------------------------------------------------------------

const BITMAP_CORE_HEADER_SIZE = 12;
const BITMAP_INFO_HEADER_SIZE = 40;

function parseBmp(read: ReadBytes): ImageSize | null {
  const dib = read(14, 12);
  if (!dib) return null;
  const headerSize = dib.readUInt32LE(0);
  if (headerSize === BITMAP_CORE_HEADER_SIZE) {
    return toSize(dib.readUInt16LE(4), dib.readUInt16LE(6));
  }
  if (headerSize < BITMAP_INFO_HEADER_SIZE) return null;
  // BITMAPINFOHEADER onwards is signed; a negative height means top-down rows,
  // which changes storage order but not the rendered size.
  return toSize(dib.readInt32LE(4), Math.abs(dib.readInt32LE(8)));
}

// --- WebP --------------------------------------------------------------------

const WEBP_VP8L_SIGNATURE = 0x2f;
const WEBP_DIMENSION_MASK = 0x3fff;

function parseWebp(read: ReadBytes): ImageSize | null {
  const chunk = read(12, 4);
  if (!chunk) return null;
  switch (chunk.toString("latin1")) {
    case "VP8 ": {
      // Lossy: 3-byte frame tag, then the start code, then 14-bit dimensions.
      const frame = read(23, 7);
      if (!frame) return null;
      if (frame.readUIntBE(0, 3) !== 0x9d012a) return null;
      return toSize(
        frame.readUInt16LE(3) & WEBP_DIMENSION_MASK,
        frame.readUInt16LE(5) & WEBP_DIMENSION_MASK,
      );
    }
    case "VP8L": {
      // Lossless: signature byte, then 14 bits each of width-1 and height-1.
      const frame = read(20, 5);
      if (!frame || frame.readUInt8(0) !== WEBP_VP8L_SIGNATURE) return null;
      const bits = frame.readUInt32LE(1);
      return toSize(
        (bits & WEBP_DIMENSION_MASK) + 1,
        ((bits >>> 14) & WEBP_DIMENSION_MASK) + 1,
      );
    }
    case "VP8X": {
      // Extended: flags(1) reserved(3), then 24-bit canvas width-1/height-1.
      const canvas = read(24, 6);
      if (!canvas) return null;
      return toSize(canvas.readUIntLE(0, 3) + 1, canvas.readUIntLE(3, 3) + 1);
    }
    default:
      return null;
  }
}

// --- JPEG --------------------------------------------------------------------

/** SOFn frame headers carry the dimensions: 0xC0-0xCF, minus DHT, JPG and DAC. */
function isFrameHeader(marker: number): boolean {
  if (marker < 0xc0 || marker > 0xcf) return false;
  return marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
}

/** Markers that stand alone, with no length or payload after them. */
function isStandalone(marker: number): boolean {
  if (marker === 0xd8 || marker === 0x01) return true;
  return marker >= 0xd0 && marker <= 0xd7;
}

function readExifOrientation(
  read: ReadBytes,
  start: number,
  length: number,
): number | null {
  // Confine every read to this APP1 segment, so a bad pointer walks off the
  // end and stops rather than ranging over the file.
  const inSegment: ReadBytes = (offset, size) =>
    offset >= start && offset + size <= start + length
      ? read(offset, size)
      : null;

  if (inSegment(start, 6)?.toString("latin1") !== "Exif\0\0") return null;
  const tiff = start + 6;
  const header = inSegment(tiff, 8);
  if (!header) return null;
  const order = header.toString("latin1", 0, 2);
  if (order !== "II" && order !== "MM") return null;
  const little = order === "II";
  const readUInt16 = (buffer: Buffer, offset: number): number =>
    little ? buffer.readUInt16LE(offset) : buffer.readUInt16BE(offset);

  const directory =
    tiff + (little ? header.readUInt32LE(4) : header.readUInt32BE(4));
  const count = inSegment(directory, 2);
  if (!count) return null;

  const entries = readUInt16(count, 0);
  for (let index = 0; index < entries; index += 1) {
    const entry = inSegment(directory + 2 + index * 12, 12);
    if (!entry) return null;
    if (readUInt16(entry, 0) !== EXIF_ORIENTATION_TAG) continue;
    // A SHORT value sits in the first two bytes of the entry's value field.
    return readUInt16(entry, 8);
  }
  return null;
}

/**
 * Locates the next marker at or after `from`. Any number of 0xFF fill bytes may
 * precede it, so scan a window at a time — advancing one byte per read costs a
 * syscall per padding byte, which a padded file turns into hundreds of
 * thousands of them.
 */
function findMarker(
  read: ReadBytes,
  from: number,
  limit: number,
): { code: number; at: number } | null {
  let offset = from;
  while (offset + 2 <= limit) {
    const window = read(offset, Math.min(MARKER_SCAN_WINDOW, limit - offset));
    if (!window || window.readUInt8(0) !== 0xff) return null;
    for (let index = 1; index < window.length; index += 1) {
      const code = window.readUInt8(index);
      // `at` is the 0xFF that introduces the marker, not the marker itself.
      if (code !== 0xff) return { code, at: offset + index - 1 };
    }
    // All fill. Resume on the last 0xFF so it still introduces what follows.
    offset += window.length - 1;
  }
  return null;
}

function parseJpeg(read: ReadBytes, fileSize: number): ImageSize | null {
  const limit = Math.min(fileSize, MAX_HEADER_SCAN_BYTES);
  let offset = 2;
  let orientation = 1;
  while (offset < limit) {
    const marker = findMarker(read, offset, limit);
    if (!marker) return null;
    if (isStandalone(marker.code)) {
      offset = marker.at + 2;
      continue;
    }
    // Start-of-scan and end-of-image mean no frame header will follow.
    if (marker.code === 0xda || marker.code === 0xd9) return null;

    const segment = read(marker.at + 2, 2);
    if (!segment) return null;
    const length = segment.readUInt16BE(0);
    if (length < 2) return null;

    if (isFrameHeader(marker.code)) {
      // Skip marker(2), length(2) and the sample precision byte.
      const frame = read(marker.at + 5, 4);
      if (!frame) return null;
      const stored = toSize(frame.readUInt16BE(2), frame.readUInt16BE(0));
      if (!stored) return null;
      // Orientations 5-8 turn the image a quarter, swapping the painted axes.
      return orientation >= 5 && orientation <= 8 ? transpose(stored) : stored;
    }
    if (marker.code === 0xe1) {
      orientation =
        readExifOrientation(read, marker.at + 4, length - 2) ?? orientation;
    }
    offset = marker.at + 2 + length;
  }
  return null;
}

// --- AVIF --------------------------------------------------------------------

interface Box {
  type: string;
  /** First byte of the box's content, past its header. */
  start: number;
  /** One past the box's last byte. */
  end: number;
}

const LARGE_SIZE_MARKER = 1;
const SIZE_TO_END_MARKER = 0;

/** Bytes of version and flags at the head of an ISOBMFF FullBox. */
const FULL_BOX_PREFIX = 4;

function readBoxes(read: ReadBytes, start: number, end: number): Box[] {
  const boxes: Box[] = [];
  let offset = start;
  while (offset + 8 <= end) {
    const header = read(offset, 8);
    if (!header) break;
    const declared = header.readUInt32BE(0);
    const type = header.toString("latin1", 4, 8);
    let contentStart = offset + 8;
    let boxEnd: number;
    if (declared === LARGE_SIZE_MARKER) {
      const large = read(offset + 8, 8);
      if (!large) break;
      boxEnd = offset + Number(large.readBigUInt64BE(0));
      contentStart = offset + 16;
    } else if (declared === SIZE_TO_END_MARKER) {
      boxEnd = end;
    } else {
      boxEnd = offset + declared;
    }
    if (boxEnd <= contentStart || boxEnd > end) break;
    boxes.push({ type, start: contentStart, end: boxEnd });
    offset = boxEnd;
  }
  return boxes;
}

/** Confines reads to one box, so a bad offset stops rather than ranging on. */
function within(read: ReadBytes, box: Box): ReadBytes {
  return (offset, length) =>
    offset >= box.start && offset + length <= box.end
      ? read(offset, length)
      : null;
}

/** The `pitm` box names which item is the image, as opposed to a thumbnail. */
function readPrimaryItem(read: ReadBytes, pitm: Box | undefined): number | null {
  if (!pitm) return null;
  const inBox = within(read, pitm);
  const header = inBox(pitm.start, FULL_BOX_PREFIX);
  if (!header) return null;
  const wideItemIds = header.readUInt8(0) >= 1;
  const item = inBox(pitm.start + FULL_BOX_PREFIX, wideItemIds ? 4 : 2);
  if (!item) return null;
  return wideItemIds ? item.readUInt32BE(0) : item.readUInt16BE(0);
}

interface AssociationEntry {
  item: number;
  /** 1-based positions in `ipco` that this item claims. */
  indices: number[];
  /** Offset just past this entry. */
  next: number;
}

function readAssociationEntry(
  read: ReadBytes,
  offset: number,
  wideItemIds: boolean,
  wideIndices: boolean,
): AssociationEntry | null {
  const itemIdBytes = wideItemIds ? 4 : 2;
  const indexBytes = wideIndices ? 2 : 1;
  const id = read(offset, itemIdBytes);
  const count = read(offset + itemIdBytes, 1);
  if (!id || !count) return null;

  const associations = count.readUInt8(0);
  const listAt = offset + itemIdBytes + 1;
  const listBytes = associations * indexBytes;
  const list = listBytes > 0 ? read(listAt, listBytes) : Buffer.alloc(0);
  if (!list) return null;

  return {
    item: wideItemIds ? id.readUInt32BE(0) : id.readUInt16BE(0),
    // The top bit marks a property essential; the rest is the position.
    indices: Array.from({ length: associations }, (_unused, index) =>
      wideIndices
        ? list.readUInt16BE(index * 2) & 0x7fff
        : list.readUInt8(index) & 0x7f,
    ),
    next: listAt + listBytes,
  };
}

/**
 * The `ipma` box maps each item to the 1-based positions in `ipco` of the
 * properties that describe it. Returns those positions for one item.
 */
function readPropertyIndices(
  read: ReadBytes,
  ipma: Box,
  item: number,
): number[] | null {
  const inBox = within(read, ipma);
  const header = inBox(ipma.start, FULL_BOX_PREFIX + 4);
  if (!header) return null;
  const wideItemIds = header.readUInt8(0) >= 1;
  // The low flag bit widens each association from one byte to two.
  const wideIndices = (header.readUIntBE(1, 3) & 1) === 1;
  const entries = header.readUInt32BE(FULL_BOX_PREFIX);

  let offset = ipma.start + FULL_BOX_PREFIX + 4;
  for (let entry = 0; entry < entries; entry += 1) {
    const association = readAssociationEntry(
      inBox,
      offset,
      wideItemIds,
      wideIndices,
    );
    if (!association) return null;
    if (association.item === item) return association.indices;
    offset = association.next;
  }
  return null;
}

function readSpatialExtents(read: ReadBytes, ispe: Box): ImageSize | null {
  const extent = within(read, ispe)(ispe.start + FULL_BOX_PREFIX, 8);
  if (!extent) return null;
  return toSize(extent.readUInt32BE(0), extent.readUInt32BE(4));
}

/** `irot` holds quarter turns in its low two bits; browsers apply them. */
function readQuarterTurns(read: ReadBytes, irot: Box | undefined): number {
  if (!irot) return 0;
  const angle = within(read, irot)(irot.start, 1);
  return angle ? angle.readUInt8(0) & 0x03 : 0;
}

function parseAvif(read: ReadBytes, fileSize: number): ImageSize | null {
  const end = Math.min(fileSize, MAX_HEADER_SCAN_BYTES);
  const meta = readBoxes(read, 0, end).find((box) => box.type === "meta");
  if (!meta) return null;

  // `meta` is a FullBox, so its children start past the version and flags.
  const children = readBoxes(read, meta.start + FULL_BOX_PREFIX, meta.end);
  const primary = readPrimaryItem(
    read,
    children.find((box) => box.type === "pitm"),
  );
  const iprp = children.find((box) => box.type === "iprp");
  if (primary === null || !iprp) return null;

  const properties = readBoxes(read, iprp.start, iprp.end);
  const ipco = properties.find((box) => box.type === "ipco");
  const ipma = properties.find((box) => box.type === "ipma");
  if (!ipco || !ipma) return null;

  const indices = readPropertyIndices(read, ipma, primary);
  if (!indices) return null;

  // `ipco` children are addressed by their 1-based position in the box.
  const declared = readBoxes(read, ipco.start, ipco.end);
  const owned = indices
    .map((index) => declared[index - 1])
    .filter((box): box is Box => box !== undefined);

  const extents = owned.find((box) => box.type === "ispe");
  if (!extents) return null;
  const stored = readSpatialExtents(read, extents);
  if (!stored) return null;

  const turns = readQuarterTurns(read, owned.find((box) => box.type === "irot"));
  return turns % 2 === 1 ? transpose(stored) : stored;
}

// --- Dispatch ----------------------------------------------------------------

/** Formats this reads. Anything else is reported as unknown, never guessed. */
export type ImageFormat = "png" | "gif" | "bmp" | "jpeg" | "webp" | "avif";

export interface ImageHeader extends ImageSize {
  readonly format: ImageFormat;
}

/** Enough to tell the formats apart: WebP's `WEBP` tag ends at byte 12. */
const MAGIC_BYTES = 12;

/** Both GIF signatures in full. `GIF` alone is three bytes of a six-byte magic. */
const GIF_SIGNATURES = new Set(["GIF87a", "GIF89a"]);

/**
 * The `ftyp` brands that mean the primary item is AVIF. `mif1` and `miaf` are
 * deliberately absent: they are generic HEIF brands that real AVIF files list
 * too, so they distinguish nothing. HEIC declares `heic`, `heix` or `mif1`.
 */
const AVIF_BRANDS = new Set(["avif", "avis"]);

/**
 * A `ftyp` box carries a handful of four-byte brands. This bounds the walk when
 * a corrupt box declares a huge size.
 */
const MAX_FTYP_BYTES = 1024;

/**
 * True when the `ftyp` box declares an AVIF brand, as either its major brand or
 * one of its compatible brands.
 *
 * A `ftyp` box on its own means no more than "some ISO-BMFF file". HEIC, HEIF
 * and MP4 all carry one, and HEIF shares the very `meta`/`iprp`/`ispe` boxes
 * `parseAvif` reads, so treating the container as proof would report HEIC bytes
 * as AVIF and let a conversion manifest claim `image/avif` for a file no
 * managed site can serve. Brands are the only positive evidence available.
 */
function hasAvifBrand(read: ReadBytes): boolean {
  // size(4) type(4) major_brand(4) minor_version(4), then compatible brands.
  const header = read(0, 16);
  if (!header) return false;
  if (AVIF_BRANDS.has(header.toString("latin1", 8, 12))) return true;
  const limit = Math.min(header.readUInt32BE(0), MAX_FTYP_BYTES);
  if (limit <= 16) return false;
  const compatible = read(16, limit - 16);
  if (!compatible) return false;
  for (let offset = 0; offset + 4 <= compatible.length; offset += 4) {
    if (AVIF_BRANDS.has(compatible.toString("latin1", offset, offset + 4))) {
      return true;
    }
  }
  return false;
}

/**
 * The format a file's magic bytes claim, sniffed rather than taken from its
 * name. Every branch requires the format's full signature: a partial match is
 * not evidence, so anything unrecognised falls through to null.
 */
function detectFormat(magic: Buffer, read: ReadBytes): ImageFormat | null {
  if (magic.toString("latin1", 0, 8) === "\x89PNG\r\n\x1a\n") return "png";
  if (GIF_SIGNATURES.has(magic.toString("latin1", 0, 6))) return "gif";
  if (magic.toString("latin1", 0, 2) === "BM") return "bmp";
  if (magic.readUInt8(0) === 0xff && magic.readUInt8(1) === 0xd8) return "jpeg";
  if (
    magic.toString("latin1", 0, 4) === "RIFF" &&
    magic.toString("latin1", 8, 12) === "WEBP"
  ) {
    return "webp";
  }
  if (magic.toString("latin1", 4, 8) === "ftyp") {
    return hasAvifBrand(read) ? "avif" : null;
  }
  return null;
}

/**
 * One parser per format. Keyed by `ImageFormat` so adding a format is a type
 * error here rather than a silent fall-through to null.
 */
const PARSERS: Record<
  ImageFormat,
  (read: ReadBytes, fileSize: number) => ImageSize | null
> = {
  png: parsePng,
  gif: parseGif,
  bmp: parseBmp,
  jpeg: parseJpeg,
  webp: parseWebp,
  avif: parseAvif,
};

/**
 * Wraps a byte source in the one bounds check every parser relies on, so a bad
 * offset or a read past the end stops here rather than in each of them.
 */
function bounded(
  fileSize: number,
  fetch: (offset: number, length: number) => Buffer | null,
): ReadBytes {
  return (offset, length) => {
    if (offset < 0 || length <= 0) return null;
    if (offset + length > fileSize) return null;
    return fetch(offset, length);
  };
}

/**
 * Header read through `read`, whose every call is bounded by `fileSize`, so a
 * truncated or corrupt file stops rather than reading past its end.
 */
export function parseImageHeader(
  read: ReadBytes,
  fileSize: number,
): ImageHeader | null {
  const magic = read(0, MAGIC_BYTES);
  if (!magic) return null;
  const format = detectFormat(magic, read);
  if (format === null) return null;
  const size = PARSERS[format](read, fileSize);
  return size === null ? null : { format, width: size.width, height: size.height };
}

/**
 * Header of an image held in `bytes`, for a caller that has already read the
 * file and would otherwise read it twice.
 */
export function parseImageHeaderFrom(bytes: Buffer): ImageHeader | null {
  const read = bounded(bytes.byteLength, (offset, length) =>
    bytes.subarray(offset, offset + length),
  );
  return parseImageHeader(read, bytes.byteLength);
}

/**
 * Header of the file at `absolutePath`, read as a few bounded ranges rather
 * than by slurping the file, or null for a file that cannot be read or a
 * header this does not understand.
 */
export function readImageHeader(absolutePath: string): ImageHeader | null {
  let descriptor: number;
  try {
    descriptor = openSync(absolutePath, "r");
  } catch {
    return null;
  }
  try {
    const fileSize = fstatSync(descriptor).size;
    const read = bounded(fileSize, (offset, length) => {
      const buffer = Buffer.alloc(length);
      const bytes = readSync(descriptor, buffer, 0, length, offset);
      return bytes === length ? buffer : null;
    });
    return parseImageHeader(read, fileSize);
  } catch {
    return null;
  } finally {
    closeSync(descriptor);
  }
}
