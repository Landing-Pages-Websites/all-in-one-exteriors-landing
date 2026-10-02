import assert from "node:assert/strict";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";
import {
  BLOG_CONTENT_DIR,
  getPublishedPost,
  isPostFile,
  listPublishedPosts,
  publishedDate,
} from "./blog.ts";
import { listPostFilenames, servablePost } from "./post-file.mjs";
import { parseFrontmatter } from "./frontmatter.mjs";

// The loader resolves `content/blog` against `process.cwd()`, so every case
// runs from a throwaway site root, the same way imageSize.test.ts does.
const originalCwd = process.cwd();
const roots: string[] = [];

after(() => {
  process.chdir(originalCwd);
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

/** Makes a throwaway site root, chdirs into it, and returns its path. */
function siteWithoutContentDir(): string {
  const root = mkdtempSync(join(tmpdir(), "site-starter-blog-"));
  roots.push(root);
  process.chdir(root);
  return root;
}

/** Makes a throwaway site root containing these files, and chdirs into it. */
function siteWith(files: Record<string, string>): void {
  const root = siteWithoutContentDir();
  mkdirSync(join(root, BLOG_CONTENT_DIR), { recursive: true });
  for (const [name, contents] of Object.entries(files)) {
    writeFileSync(join(root, BLOG_CONTENT_DIR, name), contents);
  }
}

function post(frontmatter: string, body = "Body copy."): string {
  return `---\n${frontmatter}\n---\n\n${body}\n`;
}

/** Loads a single-post site and returns the post, asserting it was listed. */
function onlyPostOf(files: Record<string, string>) {
  siteWith(files);
  const posts = listPublishedPosts();
  assert.equal(posts.length, 1, "expected exactly one listed post");
  return posts[0];
}

// Verified against the real minter in the managed-site contract: these are the
// encodings of real UUIDs, not hand-written strings.
const VALID_ID = "item_hd3wbx7k4502zcg8txwcsg2s6g";
const VALID_ID_SUFFIX = VALID_ID.slice("item_".length);
const OTHER_VALID_ID = "item_q85hr59xz953zfghkv9pwnevng";

// --- Identity ----------------------------------------------------------------

test("a valid id is carried through verbatim", () => {
  const found = onlyPostOf({
    "a.md": post(`id: ${VALID_ID}\ntitle: A`),
  });
  assert.equal(found.id, VALID_ID);
});

test("a quoted id is accepted, and surrounding whitespace is trimmed", () => {
  assert.equal(onlyPostOf({ "a.md": post(`id: "${VALID_ID}"\ntitle: A`) }).id, VALID_ID);
  assert.equal(onlyPostOf({ "a.md": post(`id:    ${VALID_ID}   \ntitle: A`) }).id, VALID_ID);
});

test("a post with no id still renders, with id null", () => {
  // Fail OPEN, deliberately. Hundreds of posts are already live without an id
  // and a hard requirement would empty those blogs. Not-yet-editable beats
  // gone.
  const found = onlyPostOf({ "a.md": post("title: A") });
  assert.equal(found.id, null);
  assert.equal(found.title, "A");
});

test("every malformed id shape reads as no id, and the post still lists", () => {
  // One row per way an id can be wrong, each isolating a single dimension so a
  // future loosening of the pattern cannot pass by accident. A malformed id is
  // worse than a missing one: it would attach a customer's edit to the wrong
  // post. Identity fails closed; the page still renders.
  const malformed: Array<[string, string]> = [
    ["named in the spec: obviously not an id", "item_NOTVALID"],
    ["wrong kind prefix", `page_${VALID_ID_SUFFIX}`],
    ["no prefix at all", VALID_ID_SUFFIX],
    ["uppercased prefix", `ITEM_${VALID_ID_SUFFIX}`],
    ["25 characters", `item_${"0".repeat(25)}`],
    ["27 characters", `item_${"0".repeat(27)}`],
    ["final character outside [048cgmrw]", `item_${"0".repeat(25)}1`],
    ["uppercase Crockford is a second spelling, not the same id", `item_${VALID_ID_SUFFIX.toUpperCase()}`],
    ["excluded Crockford letter i", `item_i${"0".repeat(25)}`],
    ["excluded Crockford letter l", `item_l${"0".repeat(25)}`],
    ["excluded Crockford letter o", `item_o${"0".repeat(25)}`],
    ["excluded Crockford letter u", `item_u${"0".repeat(25)}`],
    ["a UUID, not the encoded form", "8b47c5f4-f321-402f-b208-d778ccc05934"],
    ["leading junk", `x${VALID_ID}`],
    ["trailing junk", `${VALID_ID}x`],
    ["empty", '""'],
  ];
  for (const [label, raw] of malformed) {
    const found = onlyPostOf({ "a.md": post(`id: ${raw}\ntitle: A`) });
    assert.equal(found.id, null, label);
    assert.equal(found.title, "A", `${label}: post must still be listed`);
  }
});

test("a boolean id is not an id", () => {
  // `id: true` parses to a boolean, so the string check must reject it rather
  // than stringify it into a plausible-looking identity.
  assert.equal(onlyPostOf({ "a.md": post("id: true\ntitle: A") }).id, null);
});

test("a trailing YAML comment on the id line fails closed", () => {
  // The frontmatter reader takes the rest of the line verbatim, so
  // `id: item_x # minted 2026-01-01` is not a valid id and reads as none.
  // That is the safe direction: no identity beats a truncated one.
  const found = onlyPostOf({
    "a.md": post(`id: ${VALID_ID} # minted by the pipeline\ntitle: A`),
  });
  assert.equal(found.id, null);
});

test("the loader never mints an id, so repeat reads agree", () => {
  // A loader that minted would hand out a different id on every build, which
  // is the exact opposite of stable and would orphan every CMS edit.
  siteWith({ "a.md": post("title: A") });
  assert.equal(listPublishedPosts()[0].id, null);
  assert.equal(listPublishedPosts()[0].id, null);
});

test("two posts sharing one id are both listed", () => {
  // De-duplication is NOT the loader's job; pre-live QA grades a duplicate id
  // from the repo. A loader that silently dropped one would make a post
  // disappear from a customer's blog with no error anywhere.
  siteWith({
    "a.md": post(`id: ${VALID_ID}\ntitle: A`),
    "b.md": post(`id: ${VALID_ID}\ntitle: B`),
  });
  const posts = listPublishedPosts();
  assert.equal(posts.length, 2);
  assert.deepEqual(
    posts.map((entry) => entry.id),
    [VALID_ID, VALID_ID],
  );
});

// --- Which files are posts ---------------------------------------------------

test("documentation, scratch files and dotfiles are not posts", () => {
  siteWith({
    "welcome.md": post(`id: ${VALID_ID}\ntitle: Welcome`),
    "README.md": "# content/blog\n\nWritten by the pipeline.\n",
    "readme.md": "# lowercase spelling of the same file\n",
    "_draft.md": post("title: Draft"),
    "_inventory.json": JSON.stringify({ items: [{ id: OTHER_VALID_ID }] }),
    ".gitkeep": "",
    "notes.txt": post("title: Notes"),
    "welcome.md.bak": post("title: Backup"),
  });
  assert.deepEqual(
    listPublishedPosts().map((entry) => entry.title),
    ["Welcome"],
  );
});

test("isPostFile states the rule directly", () => {
  for (const name of ["a.md", "a.mdx", "A.MD", "a.b.md", "-a.md"]) {
    assert.equal(isPostFile(name), true, name);
  }
  for (const name of [
    "README.md",
    "readme.md",
    "ReadMe.MD",
    "_draft.md",
    "_inventory.json",
    ".gitkeep",
    ".hidden.md",
    "notes.txt",
    "a.markdown",
    "a.md.bak",
    "md",
    "",
  ]) {
    assert.equal(isPostFile(name), false, name || "(empty)");
  }
});

test("listPostFilenames is the one answer to what the directory contains", () => {
  // The loader and the prebuild gate both enumerate content/blog. When they
  // enumerated it separately they disagreed: the gate filtered on the name
  // alone, then read `archive.md/` and aborted the build with EISDIR on a
  // directory the site itself ignores. A verifier that rejects what the loader
  // accepts is worse than none, so there is now one enumeration and this table
  // covers every entry type it can meet.
  siteWith({
    "real.md": post("title: Real"),
    "upper.MD": post("title: Upper"),
    "README.md": "# docs\n",
    "_draft.md": post("title: Draft"),
    ".gitkeep": "",
    "notes.txt": post("title: Notes"),
    "target.md": post("title: Target"),
  });
  const dir = join(process.cwd(), BLOG_CONTENT_DIR);
  mkdirSync(join(dir, "archive.md"));
  mkdirSync(join(dir, "plain-directory"));
  symlinkSync(join(dir, "target.md"), join(dir, "link-to-file.md"));
  symlinkSync(join(dir, "archive.md"), join(dir, "link-to-dir.md"));
  symlinkSync(join(dir, "gone.md"), join(dir, "broken-link.md"));

  assert.deepEqual(listPostFilenames(dir).sort(), [
    // A symlink to a real file is kept: dropping it would lose a real post.
    "link-to-file.md",
    "real.md",
    "target.md",
    "upper.MD",
  ]);

  // And the loader agrees, because it asks the same function. "Target" twice
  // because the symlink is a second post: same content, different slug.
  assert.deepEqual(
    listPublishedPosts()
      .map((entry) => entry.title)
      .sort(),
    ["Real", "Target", "Target", "Upper"],
  );
  assert.deepEqual(
    listPublishedPosts()
      .map((entry) => entry.slug)
      .sort(),
    ["link-to-file", "real", "target", "upper"],
  );
});

test("the gate's set of posts equals the loader's, derived not enumerated", () => {
  // Four review rounds on this PR were the same mistake: a rule that decides
  // whether a file becomes a post lived in the loader and not in the prebuild
  // gate, so the gate judged a set the site does not serve. Patching each rule
  // as it was named is what made it four rounds.
  //
  // So this asserts the PROPERTY instead of the rules: whatever the loader
  // serves, `servablePost` accepts, and nothing else. A new eligibility rule
  // added to only one side fails here rather than in review.
  siteWith({
    "plain.md": post("title: Plain"),
    "declared-slug.md": post("title: Declared\nslug: chosen"),
    "blank-slug.md": post("title: Blank slug\nslug: '   '"),
    "upper.MD": post("title: Upper"),
    "dated.md": post("title: Dated\ndate: 2026-01-15"),
    "untitled.md": post(`id: ${VALID_ID}\ndate: 2026-01-15`),
    "blank-title.md": post('title: "   "'),
    "boolean-title.md": post("title: true"),
    "draft-true.md": post("title: Draft\ndraft: true"),
    "draft-string.md": post('title: Draft string\ndraft: "true"'),
    "no-frontmatter.md": "Just a body.\n",
    "nested-title-only.md": post("faq:\n  - title: Nested"),
    "README.md": "# docs\n",
    "_draft.md": post("title: Scratch"),
    ".gitkeep": "",
    "notes.txt": post("title: Notes"),
  });
  const dir = join(process.cwd(), BLOG_CONTENT_DIR);
  mkdirSync(join(dir, "directory.md"));
  symlinkSync(join(dir, "missing.md"), join(dir, "dangling.md"));

  // What the gate would consider, built the way check-config.mjs builds it.
  const gate = listPostFilenames(dir)
    .map((filename) => {
      const { data } = parseFrontmatter(readFileSync(join(dir, filename), "utf8"));
      return servablePost(filename, data);
    })
    .filter((entry) => entry !== null)
    .map((entry) => entry.slug)
    .sort();

  const loader = listPublishedPosts().map((entry) => entry.slug).sort();

  assert.deepEqual(gate, loader);
  // And it is a real set, not two empty ones agreeing.
  assert.deepEqual(loader, [
    "blank-slug",
    "chosen",
    "dated",
    "plain",
    "upper",
  ]);
});

test("a subdirectory in the content dir does not crash the loader", () => {
  // readFileSync on a directory throws, and a thrown read at build time takes
  // the whole site down rather than losing one post.
  siteWith({ "a.md": post("title: A") });
  mkdirSync(join(process.cwd(), BLOG_CONTENT_DIR, "images.md"));
  mkdirSync(join(process.cwd(), BLOG_CONTENT_DIR, "assets"));
  assert.deepEqual(
    listPublishedPosts().map((entry) => entry.title),
    ["A"],
  );
});

test("an unreadable post costs one post, not the whole build", () => {
  // `isReadablePost` screens the directory entry, but it screens it earlier
  // than the read: permissions can change in between. A throw here would fail
  // the build for every post at once.
  siteWith({
    "readable.md": post("title: Readable"),
    "locked.md": post("title: Locked"),
  });
  const locked = join(process.cwd(), BLOG_CONTENT_DIR, "locked.md");
  chmodSync(locked, 0o000);
  try {
    readFileSync(locked, "utf8");
    // Running as a user that ignores the mode bits (root in a container), so
    // the case cannot be staged here. Skipping beats asserting nothing.
    return;
  } catch {
    // Unreadable as intended.
  }
  const warnings: string[] = [];
  const realWarn = console.warn;
  console.warn = (message: string) => void warnings.push(message);
  try {
    assert.deepEqual(
      listPublishedPosts().map((entry) => entry.title),
      ["Readable"],
    );
  } finally {
    console.warn = realWarn;
    chmodSync(locked, 0o644);
  }
  // Dropped loudly. A post that vanishes with no signal anywhere is the
  // failure this module works hardest to avoid.
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /locked\.md/);
});

test("a missing content directory lists nothing rather than throwing", () => {
  siteWithoutContentDir();
  assert.deepEqual(listPublishedPosts(), []);
  assert.equal(getPublishedPost("anything"), null);
});

// --- Frontmatter -------------------------------------------------------------

test("dates are preserved as written, and undated posts sort last", () => {
  siteWith({
    "unquoted.md": post("title: Unquoted\ndate: 2026-01-15"),
    "quoted.md": post('title: Quoted\ndate: "2026-02-15"'),
    // A full ISO datetime is kept verbatim rather than reduced to a day. ISO
    // strings sort lexicographically the same way they sort chronologically,
    // which is what the index ordering relies on.
    "datetime.md": post("title: Datetime\ndate: 2026-03-15T09:30:00Z"),
    "undated.md": post("title: Undated"),
  });
  const posts = listPublishedPosts();
  assert.deepEqual(
    posts.map((entry) => [entry.title, entry.date]),
    [
      ["Datetime", "2026-03-15T09:30:00Z"],
      ["Quoted", "2026-02-15"],
      ["Unquoted", "2026-01-15"],
      ["Undated", null],
    ],
  );
});

test("publishedDate accepts only ISO-8601, and pins a calendar day to UTC", () => {
  // Every machine-readable consumer asks this: <lastmod> in the sitemap, the
  // Article schema's datePublished, and the <time dateTime> on the post and
  // the index card. `date` is free text, so anything else has to be dropped
  // rather than emitted — Google rejects a rich result with a bad
  // datePublished, and an invalid dateTime attribute is worse than no <time>.
  const usable: Array<[string, string]> = [
    ["2026-01-15", "2026-01-15T00:00:00.000Z"],
    ["  2026-01-15  ", "2026-01-15T00:00:00.000Z"],
    ["2026-03-15T09:30:00Z", "2026-03-15T09:30:00.000Z"],
    ["2026-03-15T09:30Z", "2026-03-15T09:30:00.000Z"],
    ["2026-03-15T09:30:00.500Z", "2026-03-15T09:30:00.500Z"],
    ["2026-03-15T09:30:00+02:00", "2026-03-15T07:30:00.000Z"],
    ["2026-03-15T09:30:00-05:00", "2026-03-15T14:30:00.000Z"],
    // No offset means UTC, not the build host's zone. `new Date` would read
    // this as local time, so the same file would publish a different instant
    // depending on where it was built.
    ["2026-03-15T09:30:00", "2026-03-15T09:30:00.000Z"],
    ["2026-03-15 09:30:00", "2026-03-15T09:30:00.000Z"],
  ];
  for (const [date, iso] of usable) {
    assert.equal(publishedDate({ date } as never)?.toISOString(), iso, date);
  }

  for (const date of [
    null,
    "",
    "sometime last spring",
    "next Tuesday",
    "TODO_DATE",
    // Shapes `new Date` accepts and reads as LOCAL midnight. Passing one
    // through would publish the previous day on any host ahead of UTC, so the
    // same post would date itself differently per build machine.
    "March 4, 2026",
    "2026/03/04",
    "Mar 4 2026",
    "04-03-2026",
    // Well-formed but not a real day.
    "2026-13-45",
    "2026-02-30",
    // Nearly ISO, and rejected rather than guessed at.
    "2026-3-4",
    "26-03-04",
    "2026-03-15T09:30:00+2:00",
    "2026-03-15T09:30:00 (UTC)",
  ]) {
    assert.equal(publishedDate({ date } as never), null, String(date));
  }
});

test("publishedDate gives the same instant whatever zone the build host is in", () => {
  // CI runs in UTC, so a local-time bug would pass every other assertion in
  // this file. Node re-reads process.env.TZ, so the zones that would expose
  // one are exercised directly: a date-only value read as local midnight
  // publishes the previous day from anywhere ahead of UTC.
  const original = process.env.TZ;
  try {
    for (const zone of [
      "UTC",
      "America/Los_Angeles",
      "Asia/Tokyo",
      "Pacific/Kiritimati",
      "Asia/Kathmandu",
    ]) {
      process.env.TZ = zone;
      assert.equal(
        publishedDate({ date: "2026-01-15" } as never)?.toISOString(),
        "2026-01-15T00:00:00.000Z",
        zone,
      );
      assert.equal(
        publishedDate({ date: "2026-03-15T09:30:00" } as never)?.toISOString(),
        "2026-03-15T09:30:00.000Z",
        zone,
      );
    }
  } finally {
    process.env.TZ = original;
  }
});

test("a date the loader cannot encode still shows on the page", () => {
  // Dropping the machine-readable attribute is right; hiding the date the
  // author wrote is not. The post keeps `date` verbatim either way, and the
  // renderers decide whether it earns a <time> element.
  const found = onlyPostOf({ "a.md": post("title: A\ndate: March 4, 2026") });
  assert.equal(found.date, "March 4, 2026");
  assert.equal(publishedDate(found), null);
});

test("the index orders posts by instant, not by the text of the date", () => {
  // Offset datetimes are accepted, and they do not sort chronologically as
  // strings: "2026-03-15T09:30:00+02:00" is 07:30Z, older than
  // "2026-03-15T08:00:00Z", yet it sorts after it character by character.
  // Accepting offsets in the previous round is what created this hazard.
  siteWith({
    "offset.md": post("title: Offset 0930+02 is 0730Z\ndate: 2026-03-15T09:30:00+02:00"),
    "utc.md": post("title: UTC 0800Z\ndate: 2026-03-15T08:00:00Z"),
    "west.md": post("title: West 2330-05 is next day\ndate: 2026-03-15T23:30:00-05:00"),
    "plain.md": post("title: Plain day\ndate: 2026-03-15"),
    "unusable.md": post("title: Unusable date\ndate: sometime last spring"),
    "undated.md": post("title: Undated"),
  });
  assert.deepEqual(
    listPublishedPosts().map((entry) => entry.title),
    [
      "West 2330-05 is next day", // 2026-03-16T04:30Z
      "UTC 0800Z", // 08:00Z
      "Offset 0930+02 is 0730Z", // 07:30Z
      "Plain day", // 00:00Z
      // A date nobody can place in time sorts with no date at all.
      "Undated",
      "Unusable date",
    ],
  );
});

test("posts sharing one instant are ordered deterministically", () => {
  // Otherwise the order depends on readdir order, which differs by filesystem.
  siteWith({
    "z.md": post("title: Zebra\ndate: 2026-01-15"),
    "a.md": post("title: Apple\ndate: 2026-01-15T00:00:00Z"),
  });
  assert.deepEqual(
    listPublishedPosts().map((entry) => entry.title),
    ["Apple", "Zebra"],
  );
});

test("frontmatter the previous reader accepted is still accepted", () => {
  // The replacement reader is stricter, and a post that stops parsing does not
  // error, it DISAPPEARS: no title means no post in the index, the generated
  // route params, the sitemap or llms.txt, indistinguishable on a customer
  // site from one that was never published. So the accept-set was diffed
  // against the previous reader rather than spot-checked, and every shape it
  // used to handle is pinned here.
  const legacy: Array<[string, string]> = [
    ["column zero", "---\ntitle: Kept\n---\n\nBody.\n"],
    ["indented two spaces", "---\n  title: Kept\n  date: 2026-01-15\n---\n\nBody.\n"],
    ["indented four spaces", "---\n    title: Kept\n---\n\nBody.\n"],
    ["indented with a tab", "---\n\ttitle: Kept\n---\n\nBody.\n"],
    ["blank line first", "---\n\ntitle: Kept\n---\n\nBody.\n"],
    ["tab before the colon", "---\ntitle\t: Kept\n---\n\nBody.\n"],
    ["CRLF throughout", "---\r\ntitle: Kept\r\ndate: 2026-01-15\r\n---\r\n\r\nBody.\r\n"],
    ["a byte-order mark", "\uFEFF---\ntitle: Kept\n---\n\nBody.\n"],
    ["a BOM and CRLF together", "\uFEFF---\r\ntitle: Kept\r\n---\r\n\r\nBody.\r\n"],
  ];
  for (const [label, raw] of legacy) {
    siteWith({ "a.md": raw });
    const posts = listPublishedPosts();
    assert.equal(posts.length, 1, label);
    assert.equal(posts[0].title, "Kept", label);
  }
});

test("a nested key never becomes a root key, at any depth or indentation", () => {
  // "Root" is the shallowest depth the document uses, not column zero, so the
  // nesting rule has to survive a uniformly indented document too.
  const nested: Array<[string, string]> = [
    ["nested under a root key", "title: Real\nfaq:\n  - question: Q\n    title: Nested"],
    ["nested under an indented root", "  title: Real\n  faq:\n    - question: Q\n      title: Nested"],
    ["nested under a tab-indented root", "\ttitle: Real\n\tfaq:\n\t\ttitle: Nested"],
    ["four levels deep", "title: Real\na:\n  b:\n    c:\n      title: Nested"],
    ["a sibling deeper than root", "  title: Real\n  b:\n    title: Nested\n  c: keep"],
    ["CRLF with nesting", "title: Real\r\nfaq:\r\n  - question: Q\r\n    title: Nested"],
  ];
  for (const [label, frontmatter] of nested) {
    const found = onlyPostOf({ "a.md": post(frontmatter) });
    assert.equal(found.title, "Real", label);
  }
});

test("excerpt stands in for a missing description", () => {
  assert.equal(
    onlyPostOf({ "a.md": post("title: A\nexcerpt: From the excerpt") })
      .description,
    "From the excerpt",
  );
  assert.equal(
    onlyPostOf({
      "a.md": post("title: A\ndescription: Real one\nexcerpt: Fallback"),
    }).description,
    "Real one",
  );
});

test("unknown frontmatter keys are ignored, not fatal", () => {
  // The pipeline's frontmatter projection is per-customer: live configs emit
  // targetKeyword, category, pet_type and more. A key this site does not read
  // must never break the post.
  const found = onlyPostOf({
    "a.md": post(
      `id: ${VALID_ID}\ntitle: A\ntargetKeyword: emergency electrician\ncategory: Guides\npet_type: dog\ndateModified: 2026-01-20`,
    ),
  });
  assert.equal(found.id, VALID_ID);
  assert.equal(found.title, "A");
});

test("a nested faq block degrades quietly and cannot forge an identity", () => {
  // cosello-construction really emits this shape: a `faq:` key with indented
  // `- question:` children and `answer: >` folded scalars. The reader takes
  // one line at a time, so an indented `id:` or `description:` inside a nested
  // block must not be mistaken for the post's own.
  const found = onlyPostOf({
    "a.md": post(
      [
        `id: ${VALID_ID}`,
        "title: Real title",
        "description: Real description",
        "date: 2026-01-15",
        "faq:",
        "  - question: How long does it take?",
        "    answer: >",
        "      Usually two weeks, depending on permits.",
        `  - id: ${OTHER_VALID_ID}`,
        "    description: Nested description",
        "    title: Nested title",
        "    date: 1999-01-01",
      ].join("\n"),
    ),
  });
  assert.equal(found.id, VALID_ID);
  assert.equal(found.title, "Real title");
  assert.equal(found.description, "Real description");
  assert.equal(found.date, "2026-01-15");
});

test("a block scalar header reads as empty, in every spelling", () => {
  // `description: >` put the literal ">" into <meta name="description">, and
  // `date: |` rendered a bare "|" where the date belongs, because the marker
  // line was read as the value. The content is on the following lines, which
  // are indented and so are not key lines, so from this line the value is
  // empty. cosello-construction really emits `answer: >`.
  //
  // The class is the whole block-scalar header grammar, not the two markers:
  // an indentation indicator and a chomping indicator may follow, in either
  // order, plus a trailing comment.
  for (const header of [">", "|", ">-", ">+", "|-", "|+", "|2", ">2", ">2-", ">-2", "|2+", "| # keep"]) {
    const found = onlyPostOf({
      "a.md": post(`title: A\ndescription: ${header}\n  Folded text here.`),
    });
    assert.equal(found.description, "", `description: ${header}`);
  }

  // A date that is a block header is no date at all, rather than a literal
  // "|" shown to a reader where the date belongs.
  const dated = onlyPostOf({ "a.md": post("title: A\ndate: |\n  2026-01-15") });
  assert.equal(dated.date, null);

  // Not block headers: text that merely starts with the marker stays verbatim,
  // so a real value is never silently emptied.
  for (const [value, expected] of [
    [">>", ">>"],
    ["> text", "> text"],
    ["|pipe|", "|pipe|"],
    ["|0", "|0"],
    ["Costs > $100", "Costs > $100"],
  ]) {
    assert.equal(
      onlyPostOf({ "a.md": post(`title: A\ndescription: ${value}`) }).description,
      expected,
      value,
    );
  }
});

test("listPublishedPosts hands back an array the caller may sort", () => {
  // The list is memoized for a production build, so returning the cached array
  // itself would let one caller's sort reorder every later caller's list.
  siteWith({
    "a.md": post("title: A\ndate: 2026-01-01"),
    "b.md": post("title: B\ndate: 2026-02-01"),
  });
  const first = listPublishedPosts();
  first.reverse();
  assert.deepEqual(
    listPublishedPosts().map((entry) => entry.title),
    ["B", "A"],
  );
});

test("whole-line comments in frontmatter are not keys", () => {
  // The seed post documents its id with a `#` comment, which is valid YAML.
  const found = onlyPostOf({
    "a.md": post(
      ["# Minted once. A reslug keeps it.", `id: ${VALID_ID}`, "title: A"].join(
        "\n",
      ),
    ),
  });
  assert.equal(found.id, VALID_ID);
  assert.equal(found.title, "A");
});

test("a draft is not published", () => {
  siteWith({
    "a.md": post("title: A"),
    "draft.md": post("title: Draft\ndraft: true"),
    "draft-string.md": post('title: Draft string\ndraft: "true"'),
  });
  assert.deepEqual(
    listPublishedPosts().map((entry) => entry.title),
    ["A"],
  );
});

// --- Slugs -------------------------------------------------------------------

test("the slug falls back to the filename when frontmatter has none", () => {
  siteWith({
    "filename-slug.md": post("title: A"),
    "b.mdx": post("title: B\nslug: explicit-slug"),
  });
  const bySlug = Object.fromEntries(
    listPublishedPosts().map((entry) => [entry.slug, entry.title]),
  );
  assert.deepEqual(bySlug, { "filename-slug": "A", "explicit-slug": "B" });
});

test("two posts claiming one slug are both listed, and the first wins the route", () => {
  // Current behaviour, asserted so a change to it is a visible decision rather
  // than a silent one. The loader does not de-duplicate: both stay in the
  // index, and getPublishedPost resolves to whichever sorts first, which is
  // the newer post because the index sorts by date descending.
  siteWith({
    "a.md": post(`id: ${VALID_ID}\ntitle: Older\nslug: shared\ndate: 2026-01-01`),
    "b.md": post(
      `id: ${OTHER_VALID_ID}\ntitle: Newer\nslug: shared\ndate: 2026-06-01`,
    ),
  });
  assert.deepEqual(
    listPublishedPosts().map((entry) => entry.title),
    ["Newer", "Older"],
  );
  assert.equal(getPublishedPost("shared")?.title, "Newer");
});

test("a post with no title is skipped entirely", () => {
  siteWith({
    "a.md": post("title: A"),
    "untitled.md": post(`id: ${VALID_ID}\ndate: 2026-01-15`),
    "no-frontmatter.md": "Just a body, no frontmatter at all.\n",
  });
  assert.deepEqual(
    listPublishedPosts().map((entry) => entry.title),
    ["A"],
  );
});
