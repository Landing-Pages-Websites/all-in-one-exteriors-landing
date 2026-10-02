import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  renameSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test, { after, before } from "node:test";
import { isPostFile, listPostFilenames } from "../src/lib/post-file.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function read(relativePath) {
  return readFileSync(join(root, relativePath), "utf8");
}

/**
 * Removes a fixture, whatever kind of entry it is.
 *
 * `rmSync(path, { recursive: true })` silently NO-OPS on a dangling symlink
 * and does not throw, so a cleanup written that way reports success while
 * leaving the fixture behind to break the next run. `unlinkSync` removes files
 * and symlinks, including dangling ones, and only directories fall through.
 */
/** `existsSync` follows the link, so a dangling one reads as absent. */
function isPresent(path) {
  try {
    lstatSync(path);
    return true;
  } catch {
    return false;
  }
}

function removeFixture(path) {
  let entry;
  try {
    entry = lstatSync(path);
  } catch {
    return;
  }
  // Decided from what the entry IS, not by trying one removal and catching
  // whatever comes back. The previous shape wrapped the removal in a bare
  // `catch` and fell through to `rmSync`, which does nothing to a dangling
  // symlink — so a missing import turned into a fixture that silently
  // survived every run and made the next one fail on EEXIST.
  if (entry.isDirectory()) rmSync(path, { recursive: true, force: true });
  else unlinkSync(path);
}

/**
 * Every entry this suite creates inside the real `content/blog`.
 *
 * The tests run the real prebuild gate, which resolves its own repository
 * root, so the fixtures have to live in the real directory. That makes a
 * leaked fixture poison LATER tests: a stray duplicate id made four unrelated
 * cases fail with the gate correctly reporting a duplicate nobody had asked
 * about. Listed in one place so the suite can clear leftovers from a crashed
 * run before it starts, and prove it left none behind when it ends.
 */
const FIXTURES = [
  "dupe-id-a.md",
  "dupe-id-b.md",
  "collides.md",
  "declared.md",
  "archive.md",
  "nested.mdx",
  "broken-link.md",
  "link-to-dir.md",
  "unservable.md",
  "served.md",
  "bad-id-a.md",
  "bad-id-b.md",
  "ok-id-a.md",
  "ok-id-b.md",
];

function fixtureLeftovers() {
  return FIXTURES.filter((name) => {
    try {
      lstatSync(join(root, "content/blog", name));
      return true;
    } catch {
      return false;
    }
  });
}

// A previous run that was killed mid-test leaves litter that fails unrelated
// cases. Clear it rather than cascading, and only ever the suite's own names,
// so an author's uncommitted post is never touched.
before(() => {
  for (const name of fixtureLeftovers()) {
    removeFixture(join(root, "content/blog", name));
  }
  for (const name of readdirSync(join(root, "content/blog"))) {
    if (name.startsWith("_parked-")) {
      renameSync(
        join(root, "content/blog", name),
        join(root, "content/blog", name.slice("_parked-".length)),
      );
    }
  }
});

after(() => {
  assert.deepEqual(fixtureLeftovers(), [], "the suite leaked fixtures");
});

test("starter ships a blog index, post template, and markdown content dir", () => {
  for (const relativePath of [
    "src/app/blog/page.tsx",
    "src/app/blog/[slug]/page.tsx",
    "src/lib/blog.ts",
    "src/components/blog/MarkdownBody.tsx",
  ]) {
    assert.equal(existsSync(join(root, relativePath)), true, relativePath);
  }
  assert.match(read("src/lib/routes.ts"), /path:\s*"\/blog"/);
  assert.match(read("src/lib/blog.ts"), /content\/blog/);
  // Through the shared enumeration, like every other reader of this
  // directory: a test that filtered on the name alone would pick a
  // directory named `archive.md` as its sample and read it.
  const posts = listPostFilenames(join(root, "content/blog"));
  assert.ok(posts.length >= 1, "content/blog needs at least one markdown post");
  const sample = read(`content/blog/${posts[0]}`);
  assert.match(sample, /^---[\s\S]*title:/);
  assert.match(
    read("src/lib/blog-images.ts"),
    /zleague-public-prod\.s3\.us-east-2\.amazonaws\.com/,
  );
  assert.match(read("next.config.ts"), /megaArticleImageRemotePatterns/);
});

test("post identity, file filtering and route safety survive a clone", () => {
  // A customer site is a clone of this starter, so these three rules have to
  // be visible in the files themselves, not only in a unit test that a clone
  // might never run.

  // The id format is owned by the managed-site contract package. Derive the
  // expected pattern from ITS source rather than restating the alphabet here,
  // so changing the contract fails this test instead of silently leaving the
  // loader accepting ids the CMS will reject. The loader cannot simply import
  // the package: CI runs `npm test` before the package is built.
  const contractPattern = read("packages/managed-site-contract/src/ids.ts")
    .match(/^const STABLE_ID_PATTERN = \/\^\(\[a-z\]\+\)_\((.+)\)\$\/;$/m)?.[1];
  assert.ok(
    contractPattern,
    "cannot read STABLE_ID_PATTERN from the managed-site contract",
  );
  // Stated in `post-file.mjs`, which the loader AND the prebuild gate read, and
  // stated there ONLY: a second copy in the loader is how the gate came to
  // compare raw frontmatter strings against ids the loader had already
  // rejected, and fail a build over an identity neither post had.
  assert.match(
    read("src/lib/post-file.mjs"),
    new RegExp(
      `const POST_ID_PATTERN = /\\^item_${contractPattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\$/;`,
    ),
    "src/lib/post-file.mjs no longer accepts exactly the contract's item ids",
  );
  for (const path of ["src/lib/blog.ts", "scripts/check-config.mjs"]) {
    assert.doesNotMatch(
      read(path),
      /item_\[0-9a-hjkmnp-tv-z\]/,
      `${path} restates the id format instead of reading it from post-file.mjs`,
    );
  }

  // Every post the pipeline writes carries a stable id, and the seed post has
  // to model it. Its value is the starter's placeholder, which check-config
  // reports until a site re-mints it; only the format is asserted here, so a
  // clone that HAS re-minted still passes.
  const id = read("content/blog/welcome.md").match(/^id:\s*(\S+)\s*$/m)?.[1];
  assert.ok(id, "content/blog/welcome.md has no id in its frontmatter");
  assert.match(id, new RegExp(`^item_${contractPattern}$`));

  // One statement of which files are posts, shared by the loader and by the
  // prebuild gate. Assert behaviour, not spelling: a rewrite that preserves
  // the rule must pass, and a changed rule must fail.
  assert.match(read("src/lib/blog.ts"), /from "\.\/post-file\.mjs"/);
  assert.match(read("scripts/check-config.mjs"), /post-file\.mjs"/);
  for (const [name, expected] of [
    ["welcome.md", true],
    ["a.mdx", true],
    ["A.MD", true],
    ["README.md", false],
    ["readme.md", false],
    ["_draft.md", false],
    [".gitkeep", false],
    ["_inventory.json", false],
    ["notes.txt", false],
    ["a.markdown", false],
  ]) {
    assert.equal(isPostFile(name), expected, name);
  }

  // Rule and rationale: src/app/blog/[slug]/page.tsx.
  assert.match(
    read("src/app/blog/[slug]/page.tsx"),
    /export const dynamicParams = false/,
  );
});

test("the renderer supports the block set the MEGA migrator emits", () => {
  // The go-live blog migrator converts a customer's existing posts into this
  // markdown subset. A block the renderer cannot draw ships as literal
  // markdown on a live site, so the set is a contract, not an implementation
  // detail. Keep in sync with BLOCK_KINDS in src/lib/markdown.ts.
  const documented = [
    "heading",
    "paragraph",
    "list",
    "blockquote",
    "table",
    "code",
    "image",
  ];
  // The block set and the inline set are separate contracts that happen to
  // share two names ("code", "image"), so each is derived from its own type
  // declaration rather than from one union of string literals. `Block` is
  // declared beside BLOCK_KINDS; `InlineNode` is declared in the leaf module
  // both grammars build nodes with.
  const DECLARED_IN = { Block: "src/lib/markdown.ts", InlineNode: "src/lib/inline.ts" };
  const markdown = read("src/lib/markdown.ts");
  const union = (name) => {
    const declaration = read(DECLARED_IN[name]).match(
      new RegExp(`export type ${name} =([\\s\\S]*?);\\n`),
    );
    assert.ok(declaration, `cannot read the ${name} declaration in ${DECLARED_IN[name]}`);
    const kinds = [...declaration[1].matchAll(/kind:\s*"([a-z]+)"/g)].map((m) => m[1]);
    assert.ok(kinds.length > 0, `${name} declares no kinds`);
    return kinds;
  };
  assert.deepEqual(
    [...new Set(union("Block"))].sort(),
    [...documented].sort(),
    "the Block type and the documented set disagree",
  );

  // BLOCK_KINDS is the value the migrator's SUPPORTED_BLOCKS mirrors, and it is
  // written out by hand, so it is checked against the type rather than trusted.
  const listed = [...markdown.matchAll(/^ {2}"([a-z]+)",$/gm)].map((m) => m[1]);
  assert.deepEqual(
    [...listed].sort(),
    [...documented].sort(),
    "BLOCK_KINDS and the documented set disagree",
  );

  const known = new Set([...union("Block"), ...union("InlineNode")]);
  // Every module that builds nodes is a place the sets could be widened without
  // the declarations changing, so the list of modules to check is READ from the
  // directory rather than named here — a new module is covered the day it lands.
  // A kind any of them names that is in neither declaration means the migrator
  // in mega-clawhub (SUPPORTED_BLOCKS) and the CMS rich-text grammar are now out
  // of sync.
  const modules = readdirSync(join(root, "src/lib"))
    .filter((name) => name.endsWith(".ts") && !name.endsWith(".test.ts"))
    .map((name) => [name, read(`src/lib/${name}`)])
    // A module that names neither type builds neither, so its own `kind` fields
    // are its own business: the scanner's `kind: "comment"` is a construct, not
    // a node.
    .filter(([, source]) => /\b(Block|InlineNode)\b/.test(source));
  assert.ok(modules.length >= 4, `expected the parser modules, found ${modules.length}`);
  for (const [name, source] of modules) {
    for (const [, kind] of source.matchAll(/kind:\s*"([a-z]+)"/g)) {
      assert.ok(known.has(kind), `src/lib/${name} emits the unknown kind "${kind}"`);
    }
  }
  // And the Block type still comes from the module that documents the contract.
  assert.match(
    read("src/lib/html-blocks.ts"),
    /import type \{[^}]*\bBlock\b[^}]*\} from "\.\/markdown"/,
    "src/lib/html-blocks.ts no longer takes its Block type from markdown.ts",
  );
  // The renderer must handle every kind the parser can emit. Asserting on
  // branches rather than on literal tags: the list tag is chosen dynamically,
  // so matching "<ol" would fail on a correct renderer.
  const renderer = read("src/components/blog/MarkdownBody.tsx");
  for (const kind of ["heading", "list", "blockquote", "table", "code", "image"]) {
    assert.match(
      renderer,
      new RegExp(`case "${kind}"`),
      `MarkdownBody has no branch for the "${kind}" block`,
    );
  }
  // paragraph is the default branch, so it has no case label.
  assert.match(renderer, /default:/, "MarkdownBody lost its paragraph fallback");
});

/** Runs the real prebuild gate and returns its exit code and output. */
function runCheckConfig(env = {}) {
  const result = spawnSync(process.execPath, [join(root, "scripts/check-config.mjs")], {
    encoding: "utf8",
    env: { ...process.env, ...env },
  });
  return { status: result.status, output: `${result.stdout}${result.stderr}` };
}

test("the prebuild gate rejects two posts sharing an id or a slug", () => {
  // The loader deliberately lists both and lets the site render, because
  // dropping one silently is how a post goes missing. That makes this gate the
  // only thing standing between a duplicated post file and two posts with one
  // identity, so it is exercised for real rather than grepped for.
  const written = [];
  const write = (name, body) => {
    const path = join(root, "content/blog", name);
    writeFileSync(path, body);
    written.push(path);
  };
  try {
    // Same id, different slugs: a CMS edit would land on whichever the
    // resolver happened to pick.
    write("dupe-id-a.md", "---\nid: item_hd3wbx7k4502zcg8txwcsg2s6g\ntitle: A\n---\nBody.\n");
    write("dupe-id-b.md", "---\nid: item_hd3wbx7k4502zcg8txwcsg2s6g\ntitle: B\n---\nBody.\n");
    let run = runCheckConfig({ ALLOW_TODO: "1" });
    assert.equal(run.status, 1, "a duplicate id must fail even under ALLOW_TODO=1");
    assert.match(run.output, /dupe-id-a\.md, dupe-id-b\.md share id/);

    // A duplicate slug is just as bad in a different way, and the frontmatter
    // slug has to be compared against the OTHER post's filename fallback, not
    // only against another declared slug.
    for (const path of written.splice(0)) removeFixture(path);
    write("collides.md", "---\ntitle: Filename slug\n---\nBody.\n");
    write("declared.md", "---\ntitle: Declared slug\nslug: collides\n---\nBody.\n");
    run = runCheckConfig({ ALLOW_TODO: "1" });
    assert.equal(run.status, 1, "a duplicate slug must fail even under ALLOW_TODO=1");
    assert.match(run.output, /share slug "collides"/);
  } finally {
    for (const path of written) removeFixture(path);
  }
});

test("the prebuild gate ignores the same entries the loader ignores", () => {
  // The gate used to filter on the name alone and then read the path, so
  // `content/blog/archive.md/` aborted the whole prebuild with EISDIR on a
  // directory the site itself quietly ignores. A verifier that fails the build
  // over something the loader accepts is worse than no verifier at all, so
  // both now enumerate the directory through one function.
  const dir = join(root, "content/blog");
  const made = [];
  // Cleared before it is created, not only after. A run that dies partway
  // through leaves a fixture behind, and the next run then fails on EEXIST
  // before it has created anything to clean up — so the litter becomes
  // permanent and the failure points at the wrong thing.
  const claim = (name) => {
    const path = join(dir, name);
    removeFixture(path);
    made.push(path);
    return path;
  };
  const makeDir = (name) => mkdirSync(claim(name));
  try {
    makeDir("archive.md");
    makeDir("nested.mdx");
    symlinkSync(join(dir, "does-not-exist.md"), claim("broken-link.md"));
    symlinkSync(join(dir, "archive.md"), claim("link-to-dir.md"));

    const run = runCheckConfig({ ALLOW_TODO: "1" });
    assert.equal(run.status, 0, run.output);
    assert.doesNotMatch(run.output, /EISDIR|ENOENT|cannot be read/);
    for (const name of ["archive.md", "nested.mdx", "broken-link.md", "link-to-dir.md"]) {
      assert.doesNotMatch(run.output, new RegExp(name.replace(".", "\\.")));
    }
  } finally {
    for (const path of made.reverse()) removeFixture(path);
  }
  // A fixture that survives its own test litters the directory every later
  // reader enumerates — and a DANGLING symlink is invisible to `existsSync`,
  // which is exactly the entry this test creates.
  assert.deepEqual(
    made.filter((path) => existsSync(path) || isPresent(path)),
    [],
    "the fixture entries must not survive the test",
  );
});

/**
 * A file the loader will not serve is not a post to this gate either.
 *
 * `toPost` drops a file with no title, so `/blog`, the sitemap, llms.txt and
 * the generated params never see it. A gate that counted it satisfied "at
 * least one post" for a blog with nothing on it, and could fail a build over a
 * duplicate identity between a served post and a file nobody can reach. Both
 * directions are wrong in the same way: the gate must judge exactly the posts
 * the site serves.
 */
const UNSERVABLE = [
  ["no title at all", "---\nid: item_hd3wbx7k4502zcg8txwcsg2s6g\n---\nBody.\n"],
  ["a blank title", "---\ntitle: \"   \"\nid: item_hd3wbx7k4502zcg8txwcsg2s6g\n---\nBody.\n"],
  ["a draft", "---\ntitle: Hidden\ndraft: true\nid: item_hd3wbx7k4502zcg8txwcsg2s6g\n---\nBody.\n"],
];

for (const [description, body] of UNSERVABLE) {
  test(`the prebuild gate does not count a post with ${description}`, () => {
    const seed = listPostFilenames(join(root, "content/blog"));
    const parked = seed.map((name) => {
      const from = join(root, "content/blog", name);
      const to = join(root, "content/blog", `_parked-${name}`);
      renameSync(from, to);
      return [from, to];
    });
    const unservable = join(root, "content/blog", "unservable.md");
    try {
      writeFileSync(unservable, body);
      const run = runCheckConfig({ ALLOW_TODO: "1" });
      assert.equal(run.status, 1, run.output);
      assert.match(run.output, /no markdown posts/);
    } finally {
      removeFixture(unservable);
      for (const [from, to] of parked) renameSync(to, from);
    }
  });

  test(`the prebuild gate does not collide a served post with one with ${description}`, () => {
    const unservable = join(root, "content/blog", "unservable.md");
    const served = join(root, "content/blog", "served.md");
    try {
      writeFileSync(unservable, body);
      writeFileSync(
        served,
        "---\ntitle: Served\nid: item_hd3wbx7k4502zcg8txwcsg2s6g\n---\nBody.\n",
      );
      const run = runCheckConfig({ ALLOW_TODO: "1" });
      assert.equal(run.status, 0, run.output);
      assert.doesNotMatch(run.output, /share id|share slug/);
    } finally {
      removeFixture(unservable);
      removeFixture(served);
    }
  });
}

/**
 * The gate must compare the identity the LOADER would attach.
 *
 * `parsePostId` treats a present-but-malformed id as absent, because a
 * mismatched identity attaches a CMS edit to the wrong post. Two files
 * carrying the same malformed id therefore share nothing the site can see, and
 * failing the build over it fails it for an identity neither post has. The
 * same rule reading both sides is the only way these stay in step.
 */
const MALFORMED_IDS = [
  ["a sentinel left in place", "PENDING_MINT"],
  ["a truncated id", "item_hd3wbx7k4502zcg8txwcs"],
  ["an id with an excluded character", "item_hd3wbx7k4502zcg8txwcsg2sil"],
  ["a bare uuid", "3f1a2b7c-9d4e-4f10-8a55-6b2c9e0d1f34"],
];

for (const [description, value] of MALFORMED_IDS) {
  test(`two posts sharing ${description} do not fail the gate`, () => {
    const written = [];
    const write = (name, body) => {
      const path = join(root, "content/blog", name);
      writeFileSync(path, body);
      written.push(path);
    };
    try {
      write("bad-id-a.md", `---\nid: ${value}\ntitle: A\n---\nBody.\n`);
      write("bad-id-b.md", `---\nid: ${value}\ntitle: B\n---\nBody.\n`);
      const run = runCheckConfig({ ALLOW_TODO: "1" });
      assert.equal(run.status, 0, run.output);
      assert.doesNotMatch(run.output, /share id/);
    } finally {
      for (const path of written) removeFixture(path);
    }
  });
}

/** A WELL-FORMED duplicate still fails: the leniency is about the rule, not
 * about giving up on duplicates. */
test("two posts sharing a well-formed id still fail the gate", () => {
  const written = [];
  const write = (name, body) => {
    const path = join(root, "content/blog", name);
    writeFileSync(path, body);
    written.push(path);
  };
  try {
    write("ok-id-a.md", "---\nid: item_hd3wbx7k4502zcg8txwcsg2s6g\ntitle: A\n---\nBody.\n");
    write("ok-id-b.md", "---\nid: item_hd3wbx7k4502zcg8txwcsg2s6g\ntitle: B\n---\nBody.\n");
    const run = runCheckConfig({ ALLOW_TODO: "1" });
    assert.equal(run.status, 1, run.output);
    assert.match(run.output, /share id/);
  } finally {
    for (const path of written) removeFixture(path);
  }
});

test("the starter's own seed post id is a placeholder, not a hard failure", () => {
  // It is a placeholder in the same sense as a TODO_ sentinel, so it travels
  // the same path: this template stays green in its own CI, which sets
  // ALLOW_TODO=1, while a configured site's real build fails until the id is
  // re-minted. A second bypass flag would be a second thing to get wrong.
  const allowed = runCheckConfig({ ALLOW_TODO: "1" });
  assert.equal(allowed.status, 0, allowed.output);
  assert.match(allowed.output, /seed post id/);
  assert.match(allowed.output, /WARNING/);

  const strict = runCheckConfig({ ALLOW_TODO: "" });
  assert.equal(strict.status, 1);
  assert.match(strict.output, /seed post id/);
  // Actionable, because whoever reads it is a builder or a provisioning bot.
  assert.match(strict.output, /re-mint it/);
});

test("check-config treats a missing blog contract as a hard failure", () => {
  const source = read("scripts/check-config.mjs");
  assert.match(source, /collectBlogContractProblems/);
  assert.match(source, /ALLOW_TODO/);
  assert.match(source, /blogProblems/);
});
