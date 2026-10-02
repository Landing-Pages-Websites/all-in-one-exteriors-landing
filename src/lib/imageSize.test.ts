import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test, { after, before } from "node:test";
import { readLocalImageSize } from "./imageSize.ts";

// `readLocalImageSize` resolves against `process.cwd()/public`, so the suite
// runs from a throwaway site root and writes fixtures into it.
const originalCwd = process.cwd();
let siteRoot = "";

before(() => {
  siteRoot = mkdtempSync(join(tmpdir(), "site-starter-image-size-"));
  process.chdir(siteRoot);
});

after(() => {
  process.chdir(originalCwd);
  rmSync(siteRoot, { recursive: true, force: true });
});

/** Writes bytes to `public/<path>` and returns the src the markdown would use. */
function publish(path: string, bytes: Buffer): string {
  const file = join(siteRoot, "public", path);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, bytes);
  return `/${path}`;
}

function be32(value: number): Buffer {
  const buffer = Buffer.alloc(4);
  buffer.writeUInt32BE(value);
  return buffer;
}

// --- Fixture builders --------------------------------------------------------

function png(width: number, height: number): Buffer {
  return Buffer.concat([
    Buffer.from("89504e470d0a1a0a", "hex"),
    be32(13),
    Buffer.from("IHDR"),
    be32(width),
    be32(height),
    Buffer.from([8, 6, 0, 0, 0]),
  ]);
}

function gif(width: number, height: number, signature = "GIF89a"): Buffer {
  const screen = Buffer.alloc(7);
  screen.writeUInt16LE(width, 0);
  screen.writeUInt16LE(height, 2);
  return Buffer.concat([Buffer.from(signature, "latin1"), screen]);
}

function bmp(width: number, height: number, headerSize = 40): Buffer {
  const dib = Buffer.alloc(headerSize);
  dib.writeUInt32LE(headerSize, 0);
  if (headerSize === 12) {
    dib.writeUInt16LE(width, 4);
    dib.writeUInt16LE(height, 6);
  } else {
    dib.writeInt32LE(width, 4);
    dib.writeInt32LE(height, 8);
  }
  return Buffer.concat([Buffer.from("BM"), Buffer.alloc(12), dib]);
}

function riff(fourcc: string, payload: Buffer): Buffer {
  const chunkSize = Buffer.alloc(4);
  chunkSize.writeUInt32LE(payload.length);
  const body = Buffer.concat([
    Buffer.from("WEBP"),
    Buffer.from(fourcc),
    chunkSize,
    payload,
  ]);
  const riffSize = Buffer.alloc(4);
  riffSize.writeUInt32LE(body.length);
  return Buffer.concat([Buffer.from("RIFF"), riffSize, body]);
}

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

function jpegSegment(marker: number, payload: Buffer): Buffer {
  const head = Buffer.alloc(4);
  head.writeUInt8(0xff, 0);
  head.writeUInt8(marker, 1);
  head.writeUInt16BE(payload.length + 2, 2);
  return Buffer.concat([head, payload]);
}

function frameHeader(width: number, height: number): Buffer {
  const payload = Buffer.alloc(6);
  payload.writeUInt8(8, 0);
  payload.writeUInt16BE(height, 1);
  payload.writeUInt16BE(width, 3);
  payload.writeUInt8(3, 5);
  return payload;
}

/** An Exif APP1 payload whose IFD0 holds a single tag. */
function exif(tag: number, value: number): Buffer {
  const tiff = Buffer.alloc(8 + 2 + 12 + 4);
  tiff.write("II", 0, "latin1");
  tiff.writeUInt16LE(42, 2);
  tiff.writeUInt32LE(8, 4);
  tiff.writeUInt16LE(1, 8); // one directory entry
  tiff.writeUInt16LE(tag, 10);
  tiff.writeUInt16LE(3, 12); // SHORT
  tiff.writeUInt32LE(1, 14);
  tiff.writeUInt16LE(value, 18);
  return Buffer.concat([Buffer.from("Exif\0\0"), tiff]);
}

interface JpegOptions {
  /** SOFn marker: 0xC0 baseline, 0xC2 progressive. */
  frameMarker?: number;
  orientation?: number;
  /** Segments emitted before the frame header, as `[marker, payload]`. */
  leading?: Array<[number, Buffer]>;
  /** 0xFF fill bytes padding the gap before the frame header. */
  fillBytes?: number;
}

function jpeg(
  width: number,
  height: number,
  { frameMarker = 0xc0, orientation, leading = [], fillBytes = 0 }: JpegOptions = {},
): Buffer {
  const parts: Buffer[] = [Buffer.from([0xff, 0xd8])];
  if (orientation !== undefined) {
    parts.push(jpegSegment(0xe1, exif(0x0112, orientation)));
  }
  for (const [marker, payload] of leading) {
    parts.push(jpegSegment(marker, payload));
  }
  if (fillBytes > 0) parts.push(Buffer.alloc(fillBytes, 0xff));
  parts.push(jpegSegment(frameMarker, frameHeader(width, height)));
  parts.push(Buffer.from([0xff, 0xda]));
  return Buffer.concat(parts);
}

function box(type: string, content: Buffer): Buffer {
  return Buffer.concat([be32(content.length + 8), Buffer.from(type), content]);
}

function spatialExtents(width: number, height: number): Buffer {
  return box("ispe", Buffer.concat([be32(0), be32(width), be32(height)]));
}

/** An `irot` property: quarter turns counter-clockwise, in the low two bits. */
function rotation(quarterTurns: number): Buffer {
  return box("irot", Buffer.from([quarterTurns & 0x03]));
}

interface AvifOptions {
  /** `ipco` properties, in the order the file declares them. */
  properties: Buffer[];
  /** 1-based `ipco` positions each item claims, keyed by item id. */
  items: Record<number, number[]>;
  primary: number;
  /** Version 1 widens item ids to four bytes. */
  wideItemIds?: boolean;
  /** Flag bit 0 widens each association to two bytes. */
  wideIndices?: boolean;
  /** `ftyp` major brand, and the compatible brands after the minor version. */
  brands?: { major: string; compatible?: string[] };
}

function avif({
  properties,
  items,
  primary,
  wideItemIds = false,
  wideIndices = false,
  brands = { major: "avif" },
}: AvifOptions): Buffer {
  const writeId = (target: Buffer, value: number, at: number): void => {
    if (wideItemIds) target.writeUInt32BE(value, at);
    else target.writeUInt16BE(value, at);
  };
  const idBytes = wideItemIds ? 4 : 2;

  const pitmValue = Buffer.alloc(idBytes);
  writeId(pitmValue, primary, 0);
  const pitm = box(
    "pitm",
    Buffer.concat([Buffer.from([wideItemIds ? 1 : 0, 0, 0, 0]), pitmValue]),
  );

  const entries = Object.entries(items).map(([id, indices]) => {
    const head = Buffer.alloc(idBytes + 1);
    writeId(head, Number(id), 0);
    head.writeUInt8(indices.length, idBytes);
    const list = Buffer.alloc(indices.length * (wideIndices ? 2 : 1));
    indices.forEach((index, position) => {
      if (wideIndices) list.writeUInt16BE(index, position * 2);
      else list.writeUInt8(index, position);
    });
    return Buffer.concat([head, list]);
  });
  const ipma = box(
    "ipma",
    Buffer.concat([
      Buffer.from([wideItemIds ? 1 : 0, 0, 0, wideIndices ? 1 : 0]),
      be32(entries.length),
      ...entries,
    ]),
  );

  const meta = box(
    "meta",
    Buffer.concat([
      be32(0), // FullBox version and flags
      pitm,
      box(
        "iprp",
        Buffer.concat([box("ipco", Buffer.concat(properties)), ipma]),
      ),
    ]),
  );
  const ftyp = box(
    "ftyp",
    Buffer.concat([
      Buffer.from(brands.major, "latin1"),
      be32(0), // minor version
      ...(brands.compatible ?? []).map((brand) => Buffer.from(brand, "latin1")),
    ]),
  );
  return Buffer.concat([ftyp, meta]);
}

/** The simplest conforming AVIF: one item, one `ispe`. */
function plainAvif(width: number, height: number): Buffer {
  return avif({
    properties: [spatialExtents(width, height)],
    items: { 1: [1] },
    primary: 1,
  });
}

// --- Every format the go-live migrator can commit ----------------------------

const FORMATS: Array<{ name: string; file: string; bytes: Buffer }> = [
  { name: "png", file: "blog/a/png.png", bytes: png(640, 1024) },
  { name: "gif", file: "blog/a/gif.gif", bytes: gif(640, 1024) },
  { name: "bmp", file: "blog/a/bmp.bmp", bytes: bmp(640, 1024) },
  {
    name: "bmp with a core header",
    file: "blog/a/core.bmp",
    bytes: bmp(640, 1024, 12),
  },
  {
    name: "bmp stored top-down",
    file: "blog/a/topdown.bmp",
    bytes: bmp(640, -1024),
  },
  { name: "webp lossy", file: "blog/a/lossy.webp", bytes: webpLossy(640, 1024) },
  {
    name: "webp lossless",
    file: "blog/a/lossless.webp",
    bytes: webpLossless(640, 1024),
  },
  {
    name: "webp extended",
    file: "blog/a/extended.webp",
    bytes: webpExtended(640, 1024),
  },
  { name: "jpeg baseline", file: "blog/a/base.jpg", bytes: jpeg(640, 1024) },
  {
    name: "jpeg progressive",
    file: "blog/a/prog.jpg",
    bytes: jpeg(640, 1024, { frameMarker: 0xc2 }),
  },
  {
    name: "jpeg behind JFIF and a Huffman table",
    file: "blog/a/tables.jpg",
    bytes: jpeg(640, 1024, {
      leading: [
        [0xe0, Buffer.from("JFIF\0\0\0\0\0\0")],
        [0xc4, Buffer.alloc(64)],
      ],
    }),
  },
  {
    name: "jpeg padded with fill bytes",
    file: "blog/a/filled.jpg",
    bytes: jpeg(640, 1024, { fillBytes: 300_000 }),
  },
  {
    name: "jpeg with an unrelated Exif tag",
    file: "blog/a/exif-other.jpg",
    bytes: Buffer.concat([
      Buffer.from([0xff, 0xd8]),
      jpegSegment(0xe1, exif(0x011a, 72)),
      jpegSegment(0xc0, frameHeader(640, 1024)),
    ]),
  },
  {
    name: "avif",
    file: "blog/a/still.avif",
    bytes: plainAvif(640, 1024),
  },
];

test("every migrated format reports its real portrait dimensions", () => {
  for (const { name, file, bytes } of FORMATS) {
    assert.deepEqual(
      readLocalImageSize(publish(file, bytes)),
      { width: 640, height: 1024 },
      name,
    );
  }
});

// --- EXIF orientation --------------------------------------------------------

test("a photo reports the axes its Exif orientation will render", () => {
  // The frame header always stores 1024x640; orientations 5-8 turn it a
  // quarter, so the browser paints those transposed.
  const upright = { width: 1024, height: 640 };
  const turned = { width: 640, height: 1024 };
  const expected: Array<[number, typeof upright]> = [
    [1, upright],
    [2, upright],
    [3, upright],
    [4, upright],
    [5, turned],
    [6, turned],
    [7, turned],
    [8, turned],
  ];
  for (const [orientation, size] of expected) {
    const src = publish(
      `blog/turn/${orientation}.jpg`,
      jpeg(1024, 640, { orientation }),
    );
    assert.deepEqual(readLocalImageSize(src), size, `orientation ${orientation}`);
  }
});

// --- AVIF primary item resolution --------------------------------------------

test("an avif reports its primary item, not a thumbnail", () => {
  // Apple's encoder emits tile items with their own smaller `ispe`, and only
  // `pitm` plus `ipma` say which extents belong to the image itself.
  const src = publish(
    "blog/avif/thumbed.avif",
    avif({
      properties: [
        spatialExtents(512, 512),
        spatialExtents(640, 1024),
        rotation(0),
      ],
      items: { 1: [1], 2: [1], 5: [2, 3] },
      primary: 5,
    }),
  );
  assert.deepEqual(readLocalImageSize(src), { width: 640, height: 1024 });
});

test("an avif reports the axes `irot` will render", () => {
  const turned: Array<[number, { width: number; height: number }]> = [
    [0, { width: 1024, height: 640 }],
    [1, { width: 640, height: 1024 }],
    [2, { width: 1024, height: 640 }],
    [3, { width: 640, height: 1024 }],
  ];
  for (const [quarterTurns, expected] of turned) {
    const src = publish(
      `blog/avif/rot-${quarterTurns}.avif`,
      avif({
        properties: [spatialExtents(1024, 640), rotation(quarterTurns)],
        items: { 1: [1, 2] },
        primary: 1,
      }),
    );
    assert.deepEqual(readLocalImageSize(src), expected, `irot ${quarterTurns}`);
  }
});

test("an avif reports the same size however wide its tables are", () => {
  const expected = { width: 640, height: 1024 };
  for (const wideItemIds of [false, true]) {
    for (const wideIndices of [false, true]) {
      const name = `wide-${wideItemIds}-${wideIndices}.avif`;
      const src = publish(
        `blog/avif/${name}`,
        avif({
          properties: [spatialExtents(160, 256), spatialExtents(640, 1024)],
          items: { 1: [1], 4000: [2] },
          primary: 4000,
          wideItemIds,
          wideIndices,
        }),
      );
      assert.deepEqual(readLocalImageSize(src), expected, name);
    }
  }
});

// --- Identifying a format, not a container -----------------------------------

test("an ISO-BMFF file is read only when a ftyp brand says AVIF", () => {
  // A `ftyp` box means "some ISO-BMFF file". HEIC and HEIF carry one, and HEIF
  // shares the `meta`/`iprp`/`ispe` boxes read here, so the container cannot be
  // the evidence: a HEIC would be reported as AVIF and the conversion manifest
  // would claim `image/avif` for bytes no managed site can serve.
  const accepted: Array<[string, { major: string; compatible?: string[] }]> = [
    ["a plain avif major brand", { major: "avif" }],
    ["an avif image sequence", { major: "avis" }],
    // What Pillow, sharp and Apple actually emit: the brand is in the
    // compatible list, alongside the generic HEIF brands.
    ["avif among the compatible brands", { major: "mif1", compatible: ["avif", "miaf"] }],
    ["Apple's ordering", { major: "MiPr", compatible: ["avif", "miaf", "mif1"] }],
    ["avis among the compatible brands", { major: "mif1", compatible: ["miaf", "avis"] }],
  ];
  for (const [name, brands] of accepted) {
    const src = publish(
      `blog/brand/ok-${brands.major}-${(brands.compatible ?? []).join("")}.avif`,
      avif({ properties: [spatialExtents(640, 1024)], items: { 1: [1] }, primary: 1, brands }),
    );
    assert.deepEqual(readLocalImageSize(src), { width: 640, height: 1024 }, name);
  }

  const rejected: Array<[string, { major: string; compatible?: string[] }]> = [
    // A real `sips -s format heic` file: heic major, mif1 among compatible.
    ["heic", { major: "heic", compatible: ["mif1", "MiPr", "miaf", "MiHB", "heic"] }],
    ["heix", { major: "heix", compatible: ["mif1"] }],
    // `mif1` and `miaf` are generic HEIF brands that AVIF files list too, so on
    // their own they are not evidence either way.
    ["mif1 alone", { major: "mif1", compatible: ["miaf"] }],
    ["mif1 with no compatible brands", { major: "mif1" }],
    // Brands the reviewer did not name: video containers carry ftyp as well.
    ["mp4", { major: "isom", compatible: ["isom", "mp42", "avc1"] }],
    ["quicktime", { major: "qt  " }],
    // A brand that merely starts with the same bytes must not slip through.
    ["avi (not avif)", { major: "avi " }],
  ];
  for (const [name, brands] of rejected) {
    const src = publish(
      `blog/brand/no-${brands.major.trim()}-${(brands.compatible ?? []).join("")}.avif`,
      avif({ properties: [spatialExtents(640, 1024)], items: { 1: [1] }, primary: 1, brands }),
    );
    assert.equal(readLocalImageSize(src), null, name);
  }
});

test("the brand walk stops at a sane cap rather than trusting a huge ftyp", () => {
  // A real ftyp lists a handful of brands. Padding it with hundreds and hiding
  // the avif brand past the cap must fail closed: the box structure here is
  // valid, so only the brand walk can reject it.
  const padding = Array.from({ length: 400 }, () => "xxxx");
  const src = publish(
    "blog/brand/capped.avif",
    avif({
      properties: [spatialExtents(640, 1024)],
      items: { 1: [1] },
      primary: 1,
      brands: { major: "mif1", compatible: [...padding, "avif"] },
    }),
  );
  assert.equal(readLocalImageSize(src), null);

  // The same file with the brand inside the cap is read, so the case above is
  // rejected by the cap and not by something else in the header.
  const near = publish(
    "blog/brand/near.avif",
    avif({
      properties: [spatialExtents(640, 1024)],
      items: { 1: [1] },
      primary: 1,
      brands: { major: "mif1", compatible: ["xxxx", "avif", ...padding] },
    }),
  );
  assert.deepEqual(readLocalImageSize(near), { width: 640, height: 1024 });
});

test("a gif needs its whole six-byte signature", () => {
  for (const signature of ["GIF87a", "GIF89a"]) {
    const src = publish(`blog/sig/${signature}.gif`, gif(640, 1024, signature));
    assert.deepEqual(readLocalImageSize(src), { width: 640, height: 1024 }, signature);
  }
  // `GIF` is three bytes of a six-byte magic. Accepting the prefix reads the
  // next four bytes of an unrelated file as its dimensions.
  for (const signature of ["GIFT n", "GIF88a", "GIF89b", "GIF97a", "GIF\0\0\0", "gif89a"]) {
    const src = publish(`blog/sig/bad-${signature.replace(/\W/gu, "_")}.gif`, gif(640, 1024, signature));
    assert.equal(readLocalImageSize(src), null, JSON.stringify(signature));
  }
});

// --- Failing closed ----------------------------------------------------------

test("an unreadable file falls back rather than guessing", () => {
  const unreadable: Array<[string, Buffer]> = [
    ["empty.png", Buffer.alloc(0)],
    ["truncated.png", png(640, 1024).subarray(0, 18)],
    ["zero.png", png(0, 0)],
    ["prose.txt", Buffer.from("not an image at all")],
    ["diagram.svg", Buffer.from('<svg width="640" height="1024"></svg>')],
    // A JPEG whose scan starts before any frame header.
    ["headless.jpg", Buffer.from([0xff, 0xd8, 0xff, 0xda, 0x00, 0x02])],
    // An unknown RIFF payload must not be read as one of the WebP shapes.
    ["audio.webp", riff("XXXX", Buffer.alloc(16))],
    // An AVIF whose `ipma` never mentions the item `pitm` calls primary.
    [
      "orphan.avif",
      avif({
        properties: [spatialExtents(640, 1024)],
        items: { 1: [1] },
        primary: 9,
      }),
    ],
    // An association pointing past the end of `ipco`.
    [
      "dangling.avif",
      avif({
        properties: [spatialExtents(640, 1024)],
        items: { 1: [7] },
        primary: 1,
      }),
    ],
  ];
  for (const [name, bytes] of unreadable) {
    assert.equal(readLocalImageSize(publish(`blog/bad/${name}`, bytes)), null, name);
  }
});

test("a missing file falls back", () => {
  assert.equal(readLocalImageSize("/blog/a/absent.png"), null);
});

test("remote sources are never read from disk", () => {
  publish("blog/a/png.png", png(640, 1024));
  for (const src of [
    "https://zleague-public-prod.s3.us-east-2.amazonaws.com/blog/a/png.png",
    "//zleague-public-prod.s3.us-east-2.amazonaws.com/blog/a/png.png",
    "data:image/png;base64,AAAA",
    "blog/a/png.png",
    "",
  ]) {
    assert.equal(readLocalImageSize(src), null, src || "(empty)");
  }
});

test("a src cannot read outside public/", () => {
  writeFileSync(join(siteRoot, "secret.png"), png(11, 13));
  for (const src of [
    "/../secret.png",
    "/blog/../../secret.png",
    "/blog/a/../../../secret.png",
    "/%2e%2e/secret.png",
  ]) {
    assert.equal(readLocalImageSize(src), null, src);
  }
});

test("a src is matched to the file on disk, not to its URL spelling", () => {
  publish("blog/a/before and after.png", png(800, 1200));
  const expected = { width: 800, height: 1200 };
  assert.deepEqual(readLocalImageSize("/blog/a/before%20and%20after.png"), expected);
  assert.deepEqual(readLocalImageSize("/blog/a/before and after.png"), expected);

  publish("blog/a/cover.png", png(640, 1024));
  assert.deepEqual(readLocalImageSize("/blog/a/cover.png?v=2"), {
    width: 640,
    height: 1024,
  });
  assert.deepEqual(readLocalImageSize("/blog/a/cover.png#top"), {
    width: 640,
    height: 1024,
  });
});
