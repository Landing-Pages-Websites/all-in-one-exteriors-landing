import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { deflateSync } from "node:zlib";

import { aspectRatioOf, probeImage } from "../src/image-probe.js";

// Dimension parsing is covered by `src/lib/imageSize.test.ts`, which exercises
// the shared header parser across every format and its adversarial variants.
// This suite covers what conversion adds on top: the contract mime type, the
// byte count, the digest, the reduced ratio, and refusing what the contract
// will not accept.

function be32(value: number): Buffer {
  const buffer = Buffer.alloc(4);
  buffer.writeUInt32BE(value);
  return buffer;
}

function crc32(buffer: Buffer): number {
  let value = ~0;
  for (const byte of buffer) {
    value ^= byte;
    for (let bit = 0; bit < 8; bit += 1) value = (value >>> 1) ^ (0xedb88320 & -(value & 1));
  }
  return (~value) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  return Buffer.concat([be32(data.length), body, be32(crc32(body))]);
}

function png(width: number, height: number): Buffer {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 2;
  const pixels = deflateSync(Buffer.alloc(height * (1 + width * 3)));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", header),
    pngChunk("IDAT", pixels),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

function jpegSegment(marker: number, payload: Buffer): Buffer {
  const head = Buffer.alloc(4);
  head.writeUInt8(0xff, 0);
  head.writeUInt8(marker, 1);
  head.writeUInt16BE(payload.length + 2, 2);
  return Buffer.concat([head, payload]);
}

function jpegFrame(width: number, height: number): Buffer {
  const payload = Buffer.alloc(6);
  payload.writeUInt8(8, 0);
  payload.writeUInt16BE(height, 1);
  payload.writeUInt16BE(width, 3);
  payload.writeUInt8(3, 5);
  return jpegSegment(0xc0, payload);
}

/** An APP1 Exif segment carrying nothing but an orientation tag. */
function exifOrientation(orientation: number): Buffer {
  const directory = Buffer.alloc(14);
  directory.writeUInt16BE(1, 0); // one entry
  directory.writeUInt16BE(0x0112, 2); // Orientation
  directory.writeUInt16BE(3, 4); // SHORT
  directory.writeUInt32BE(1, 6); // one value
  directory.writeUInt16BE(orientation, 10);
  return jpegSegment(
    0xe1,
    Buffer.concat([
      Buffer.from("Exif\0\0", "latin1"),
      Buffer.from("MM\0*", "latin1"),
      be32(8), // the directory sits right after the 8-byte TIFF header
      directory,
    ]),
  );
}

function jpeg(width: number, height: number, orientation?: number): Buffer {
  return Buffer.concat([
    Buffer.from([0xff, 0xd8]),
    ...(orientation === undefined ? [] : [exifOrientation(orientation)]),
    jpegFrame(width, height),
    Buffer.from([0xff, 0xd9]),
  ]);
}

function riff(fourcc: string, payload: Buffer): Buffer {
  const size = Buffer.alloc(4);
  size.writeUInt32LE(payload.length);
  const body = Buffer.concat([
    Buffer.from("WEBP"),
    Buffer.from(fourcc),
    size,
    payload,
  ]);
  const riffSize = Buffer.alloc(4);
  riffSize.writeUInt32LE(body.length);
  return Buffer.concat([Buffer.from("RIFF"), riffSize, body]);
}

/** A lossy WebP, including the VP8 start code the frame header is found by. */
function webpLossy(width: number, height: number): Buffer {
  const payload = Buffer.alloc(10);
  Buffer.from([0x9d, 0x01, 0x2a]).copy(payload, 3);
  payload.writeUInt16LE(width, 6);
  payload.writeUInt16LE(height, 8);
  return riff("VP8 ", payload);
}

function webpLossless(width: number, height: number): Buffer {
  const payload = Buffer.alloc(5);
  payload.writeUInt8(0x2f, 0);
  payload.writeUInt32LE(((height - 1) << 14) | (width - 1), 1);
  return riff("VP8L", payload);
}

function webpExtended(width: number, height: number): Buffer {
  const payload = Buffer.alloc(10);
  payload.writeUIntLE(width - 1, 4, 3);
  payload.writeUIntLE(height - 1, 7, 3);
  return riff("VP8X", payload);
}

function box(type: string, content: Buffer): Buffer {
  return Buffer.concat([be32(content.length + 8), Buffer.from(type), content]);
}

/**
 * The simplest conforming AVIF: one item, one `ispe`, no rotation. `brands` is
 * the `ftyp` major brand followed by the compatible brands, because a `ftyp`
 * box alone identifies an ISO-BMFF container rather than an AVIF image.
 */
function isoBmff(
  width: number,
  height: number,
  brands: readonly string[] = ["avif"],
): Buffer {
  const ispe = box("ispe", Buffer.concat([be32(0), be32(width), be32(height)]));
  const pitm = box("pitm", Buffer.from([0, 0, 0, 0, 0, 1]));
  const ipma = box(
    "ipma",
    Buffer.concat([Buffer.from([0, 0, 0, 0]), be32(1), Buffer.from([0, 1, 1, 1])]),
  );
  const iprp = box("iprp", Buffer.concat([box("ipco", ispe), ipma]));
  const [major = "avif", ...compatible] = brands;
  const ftyp = box(
    "ftyp",
    Buffer.concat([
      Buffer.from(major, "latin1"),
      be32(0), // minor version
      ...compatible.map((brand) => Buffer.from(brand, "latin1")),
    ]),
  );
  return Buffer.concat([
    ftyp,
    box("meta", Buffer.concat([be32(0), pitm, iprp])),
  ]);
}

function gif(width: number, height: number): Buffer {
  const screen = Buffer.alloc(7);
  screen.writeUInt16LE(width, 0);
  screen.writeUInt16LE(height, 2);
  return Buffer.concat([Buffer.from("GIF89a"), screen]);
}

function bmp(width: number, height: number): Buffer {
  const dib = Buffer.alloc(40);
  dib.writeUInt32LE(40, 0);
  dib.writeInt32LE(width, 4);
  dib.writeInt32LE(height, 8);
  return Buffer.concat([Buffer.from("BM"), Buffer.alloc(12), dib]);
}

function write(name: string, bytes: Buffer): string {
  const path = join(mkdtempSync(join(tmpdir(), "managed-site-image-")), name);
  writeFileSync(path, bytes);
  return path;
}

interface ProbeCase {
  readonly name: string;
  readonly file: string;
  readonly bytes: Buffer;
  readonly mimeType: string;
  readonly width: number;
  readonly height: number;
}

const PROBED: readonly ProbeCase[] = [
  { name: "png", file: "a.png", bytes: png(120, 60), mimeType: "image/png", width: 120, height: 60 },
  {
    name: "jpeg",
    file: "b.jpg",
    bytes: jpeg(800, 400),
    mimeType: "image/jpeg",
    width: 800,
    height: 400,
  },
  {
    name: "lossy webp",
    file: "c.webp",
    bytes: webpLossy(2048, 1024),
    mimeType: "image/webp",
    width: 2048,
    height: 1024,
  },
  {
    name: "lossless webp",
    file: "d.webp",
    bytes: webpLossless(300, 200),
    mimeType: "image/webp",
    width: 300,
    height: 200,
  },
  {
    name: "extended webp",
    file: "e.webp",
    bytes: webpExtended(1600, 900),
    mimeType: "image/webp",
    width: 1600,
    height: 900,
  },
  // Avif was named in `ImageMimeType` before this suite could reach it: the old
  // probe had no avif reader, so the mime type was unreachable in practice.
  {
    name: "avif",
    file: "f.avif",
    bytes: isoBmff(1024, 768),
    mimeType: "image/avif",
    width: 1024,
    height: 768,
  },
  // What Pillow, sharp and Apple actually emit: the avif brand sits in the
  // compatible list next to the generic HEIF brands, not as the major brand.
  {
    name: "avif branded through its compatible list",
    file: "g.avif",
    bytes: isoBmff(800, 600, ["mif1", "avif", "miaf"]),
    mimeType: "image/avif",
    width: 800,
    height: 600,
  },
];

test("dimensions and digests are read from the committed file", () => {
  for (const probe of PROBED) {
    const probed = probeImage(write(probe.file, probe.bytes));
    assert.ok(probed !== null, `failed to probe ${probe.name}`);
    assert.equal(probed.mimeType, probe.mimeType, probe.name);
    assert.equal(probed.width, probe.width, probe.name);
    assert.equal(probed.height, probe.height, probe.name);
    assert.equal(probed.bytes, probe.bytes.byteLength, probe.name);
    assert.equal(
      probed.sha256,
      createHash("sha256").update(probe.bytes).digest("hex"),
      probe.name,
    );
  }
});

test("a quarter-turned jpeg records the axes a browser will paint", () => {
  // Orientations 5-8 turn the image a quarter, so the painted axes are the
  // stored ones swapped. The manifest describes what renders, not what is
  // stored, or a portrait photo enters the contract as a landscape one.
  for (const orientation of [5, 6, 7, 8]) {
    const probed = probeImage(write("turned.jpg", jpeg(800, 400, orientation)));
    assert.ok(probed !== null, `orientation ${orientation}`);
    assert.equal(probed.width, 400, `orientation ${orientation}`);
    assert.equal(probed.height, 800, `orientation ${orientation}`);
  }
  for (const orientation of [1, 2, 3, 4]) {
    const probed = probeImage(write("upright.jpg", jpeg(800, 400, orientation)));
    assert.ok(probed !== null, `orientation ${orientation}`);
    assert.equal(probed.width, 800, `orientation ${orientation}`);
    assert.equal(probed.height, 400, `orientation ${orientation}`);
  }
});

test("a format the contract does not admit is refused, not relabelled", () => {
  // The header parser reads gif and bmp correctly for the starter's blog
  // rendering. `managedImageMimeTypeSchema` admits neither, so conversion must
  // report them unreadable rather than invent a mime type the contract rejects.
  for (const [name, bytes] of [
    ["readable.gif", gif(640, 480)],
    ["readable.bmp", bmp(640, 480)],
  ] as const) {
    assert.equal(probeImage(write(name, bytes)), null, name);
  }
});

test("a HEIF sibling is never labelled image/avif", () => {
  // HEIC and HEIF carry a `ftyp` box and the same `meta`/`iprp`/`ispe` boxes the
  // avif parser reads, so a container-only check would put `image/avif` in the
  // manifest for bytes no managed site can serve. `mif1` and `miaf` are generic
  // HEIF brands that real AVIF files list too, so neither is evidence on its own.
  const siblings: ReadonlyArray<readonly [string, readonly string[]]> = [
    ["heic.heic", ["heic", "mif1", "MiPr", "miaf", "MiHB", "heic"]],
    ["heix.heic", ["heix", "mif1"]],
    ["generic-heif.heif", ["mif1", "miaf"]],
    ["bare-mif1.heif", ["mif1"]],
    ["video.mp4", ["isom", "isom", "mp42", "avc1"]],
    ["prefix-only.avif", ["avi "]],
  ];
  for (const [name, brands] of siblings) {
    assert.equal(probeImage(write(name, isoBmff(640, 480, brands))), null, name);
  }
});

test("an unreadable file is reported as unknown, never assumed", () => {
  const unreadable: ReadonlyArray<readonly [string, Buffer]> = [
    ["truncated.gif", Buffer.from("GIF89a not really")],
    // `GIF` is three bytes of a six-byte magic; the prefix is not evidence.
    ["prefix.gif", Buffer.concat([Buffer.from("GIFT n"), Buffer.alloc(8)])],
    ["empty.png", Buffer.alloc(0)],
    ["prose.txt", Buffer.from("not an image at all")],
    ["vector.svg", Buffer.from('<svg width="640" height="480"></svg>')],
    ["zero.png", png(0, 0)],
    // A lossy webp with no VP8 start code: the frame header is not where the
    // chunk claims, so its dimensions are whatever bytes happen to sit there.
    ["startless.webp", riff("VP8 ", Buffer.alloc(10))],
    ["unknown-riff.webp", riff("XXXX", Buffer.alloc(16))],
  ];
  for (const [name, bytes] of unreadable) {
    assert.equal(probeImage(write(name, bytes)), null, name);
  }
  assert.equal(probeImage(join(tmpdir(), "managed-site-does-not-exist.png")), null);
});

test("aspect ratios are reduced, not rounded", () => {
  const ratios: ReadonlyArray<readonly [number, number, number, number]> = [
    [1920, 1080, 16, 9],
    [800, 600, 4, 3],
    [1000, 1000, 1, 1],
    [1080, 1920, 9, 16],
    [1001, 999, 1001, 999],
  ];
  for (const [width, height, expectedWidth, expectedHeight] of ratios) {
    const probed = probeImage(write("ratio.png", png(width, height)));
    assert.ok(probed !== null, `${width}x${height}`);
    assert.deepEqual(
      aspectRatioOf(probed),
      { width: expectedWidth, height: expectedHeight },
      `${width}x${height}`,
    );
  }
});
