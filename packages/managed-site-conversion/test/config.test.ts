/**
 * The bridge block decides which guest script a converted site loads, pinned by
 * Subresource Integrity. It used to be cast rather than read, so a config could
 * name one version, deliver another, and carry an unreplaced placeholder digest
 * all the way into a contract, where the browser would simply refuse to execute
 * the script it named.
 *
 * The checks are on the shape, not on one version: promoting the next bridge
 * must not need a code change here.
 */
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

import {
  MANAGED_SERVED_ASSET_ROOT,
  MAX_REPOSITORY_PATH_BYTES,
  MAX_REPOSITORY_PATH_SEGMENT_BYTES,
  bridgeSrcFor,
  CURRENT_BRIDGE_SRC,
  CURRENT_BRIDGE_VERSION,
  SUPPORTED_BRIDGE_VERSIONS,
} from "@landing-pages-websites/managed-site-contract";

import { defaultConfig, loadConfig, type PageSeoInput } from "../src/config.js";
import { FINDING_CODES } from "../src/report.js";
import { VALID_BRIDGE, run, workspace, type Workspace } from "./support/proposals.js";

function configWith(bridge: unknown): string {
  const directory = mkdtempSync(join(tmpdir(), "conversion-config-"));
  const path = join(directory, "site.conversion.json");
  writeFileSync(path, JSON.stringify({ bridge }));
  return path;
}

/**
 * Both roots prefix every source path the proposer emits, so an unrepresentable
 * one is a bad run rather than a bad field. Before this, a `contentRoot` with a
 * space reached the emitter and threw an unhandled SOURCE_PATH_INVALID stack
 * trace naming no config key and no file.
 */
describe("content and asset roots in a conversion config", () => {
  function configWithRoots(roots: Record<string, unknown>): string {
    const directory = mkdtempSync(join(tmpdir(), "conversion-roots-"));
    const path = join(directory, "site.conversion.json");
    writeFileSync(path, JSON.stringify({ bridge: VALID_BRIDGE, ...roots }));
    return path;
  }

  it("accepts relative POSIX roots", () => {
    const config = loadConfig(
      configWithRoots({ contentRoot: "src/content", assetRoot: "public" }),
    );

    assert.equal(config.contentRoot, "src/content");
    assert.equal(config.assetRoot, "public");
  });

  it("falls back to the defaults when neither is given", () => {
    const config = loadConfig(configWithRoots({}));

    assert.equal(config.contentRoot, "src/content");
    assert.equal(config.assetRoot, "public");
  });

  for (const [label, root] of [
    ["a space", "my content"],
    ["an absolute path", "/src/content"],
    ["traversal", "src/../content"],
    ["a trailing slash", "src/content/"],
    ["a backslash", "src\\content"],
  ] as const) {
    it(`names the config key when contentRoot has ${label}`, () => {
      assert.throws(
        () => loadConfig(configWithRoots({ contentRoot: root })),
        /invalid contentRoot/u,
      );
    });
  }

  /**
   * The guarantee this validation is for: a root that loads cannot fail later at
   * emission. Checking the prefix alone did not provide it, because the contract
   * bounds a whole path at 512 bytes and the proposer appends
   * `/pages/<slug>.json` to every page.
   */
  it("refuses a root with no room for the paths derived from it", () => {
    // Valid in itself: two segments, each inside the 255-byte segment cap, and
    // 401 bytes in total. Only the derived path crosses the 512-byte limit, so
    // this fails on the derived check rather than on the root's own shape.
    const root = `${"a".repeat(200)}/${"b".repeat(200)}`;

    assert.throws(
      () => loadConfig(configWithRoots({ contentRoot: root })),
      /leaves no room for the longest page content path/u,
    );
  });

  it("accepts a long root that still leaves room", () => {
    const root = "a".repeat(200);

    assert.equal(loadConfig(configWithRoots({ contentRoot: root })).contentRoot, root);
  });

  /**
   * The worst case is a slug that is itself valid. `<slug>.json` is one segment
   * and the contract caps a segment at 255 bytes, so a 255-byte slug would be
   * refused for its own length and is not what a root must leave room for.
   */
  it("bounds a root against the longest slug that can actually exist", () => {
    const root = "content";
    const longestPath = `${root}/pages/${"a".repeat(250)}.json`;

    assert.equal(loadConfig(configWithRoots({ contentRoot: root })).contentRoot, root);
    assert.ok(longestPath.length < 512, "the derived path stays within the limit");
  });

  it("names assetRoot when it is assetRoot that is wrong", () => {
    assert.throws(
      () => loadConfig(configWithRoots({ assetRoot: "public assets" })),
      /invalid assetRoot/u,
    );
  });

  /**
   * `assetRoot` had no budget at all: only its own shape was checked, so a root
   * just inside the whole-path limit loaded cleanly and then produced an invalid
   * path the moment it was joined to an ordinary file name.
   *
   * What an asset root must clear is a floor rather than a worst case, because
   * an asset path is whatever the repository already calls the file. The floor
   * is one file name at the longest the contract permits: a root with no room
   * for that cannot address some legal file, whatever the repository contains.
   */
  const LONGEST_ASSET_ROOT =
    MAX_REPOSITORY_PATH_BYTES - 1 - MAX_REPOSITORY_PATH_SEGMENT_BYTES;

  /**
   * A root of an exact byte length that is otherwise beyond reproach: every
   * segment inside the segment cap and none of them empty, so any refusal is the
   * derived-path budget rather than the root's own shape.
   */
  function rootOfLength(bytes: number): string {
    const count = Math.ceil((bytes + 1) / (MAX_REPOSITORY_PATH_SEGMENT_BYTES + 1));
    let characters = bytes - (count - 1);
    const segments = Array.from({ length: count }, (_unused, index) => {
      const share = Math.ceil(characters / (count - index));
      characters -= share;
      return "a".repeat(share);
    });
    const root = segments.join("/");
    assert.equal(root.length, bytes, "the fixture root is the length it claims");
    assert.ok(
      segments.every(
        (segment) => segment.length > 0 && segment.length <= MAX_REPOSITORY_PATH_SEGMENT_BYTES,
      ),
      "the fixture root is refusable only for its derived paths",
    );
    return root;
  }

  it("refuses an assetRoot with no room for a file name beneath it", () => {
    assert.throws(
      () => loadConfig(configWithRoots({ assetRoot: rootOfLength(511) })),
      /invalid assetRoot.*leaves no room for the longest single file name/su,
    );
  });

  /**
   * The converter's accepted config can only emit content the pinned contract
   * accepts, and the contract takes an image only under its served root. A root
   * outside it would emit refused images; a root inside it (public/images) would
   * record /hero.png as a file other than the one served. So only the served
   * root itself loads, whatever else fits the budgets.
   */
  it("refuses every assetRoot but the contract's served root", () => {
    for (const root of ["public/images", "./public", "Public", "publicx", "static", "assets", rootOfLength(LONGEST_ASSET_ROOT)]) {
      assert.throws(() => loadConfig(configWithRoots({ assetRoot: root })), /invalid assetRoot/u, root);
    }
    for (const root of ["public/images", "static", "Public"]) {
      assert.throws(
        () => loadConfig(configWithRoots({ assetRoot: root })),
        /not the served root "public".*accepts an image only under public\//su,
        `${root}: the message names the served root`,
      );
    }
    const served = MANAGED_SERVED_ASSET_ROOT.slice(0, -1);
    assert.equal(loadConfig(configWithRoots({ assetRoot: served })).assetRoot, served);
  });

  /**
   * Both roots are budgeted, and neither budget is the other's. A single shared
   * rule would refuse content roots that are fine, or accept asset roots that
   * are not.
   */
  it("budgets each root against what is appended to that root", () => {
    // A content root may run only to 250 bytes, because `/pages/<slug>.json` is
    // longer than one file name; 253 bytes would still leave room for an asset
    // name, so this is the content budget refusing, not the asset one. (The
    // asset root itself is fixed at public.)
    const assetOnly = rootOfLength(253);

    assert.throws(
      () => loadConfig(configWithRoots({ contentRoot: assetOnly })),
      /invalid contentRoot/u,
    );
  });
});

describe("bridge delivery in a conversion config", () => {
  it("accepts a promoted version whose src delivers it", () => {
    const config = loadConfig(configWith(VALID_BRIDGE));

    assert.deepEqual(config.bridge, VALID_BRIDGE);
  });

  /**
   * The loader must not be looser than the canonical parser. A config naming a
   * version the contract cannot express would load cleanly and fail later as
   * `contract: null`, with the config that caused it already accepted and
   * nothing saying why.
   *
   * The versions are derived from the supported list, so promoting the next
   * bridge cannot leave this test asserting that the newly supported version is
   * refused -- which is exactly what a find-and-replace did to it when v6
   * became v7.
   */
  it("refuses a version the contract cannot express", () => {
    const newest = Number(CURRENT_BRIDGE_VERSION.slice(1));
    const oldest = Number(SUPPORTED_BRIDGE_VERSIONS[0].slice(1));
    for (const unsupported of [`v${newest + 1}`, `v${oldest - 1}`]) {
      const next = {
        ...VALID_BRIDGE,
        version: unsupported,
        src: `https://app.gomega.ai/review-bridge/${unsupported}/review-bridge.js`,
      };

      assert.throws(
        () => loadConfig(configWith(next)),
        new RegExp(`version ${unsupported} is not one of the supported`, "u"),
      );
    }
  });

  /**
   * Sites certified on an older bridge are converted and re-proposed on that
   * bridge, so the loader accepts every version the contract accepts, each at
   * its own asset, and keeps the version it was given.
   */
  for (const version of SUPPORTED_BRIDGE_VERSIONS) {
    it(`accepts supported bridge ${version} at its own src`, () => {
      const bridge = { ...VALID_BRIDGE, version, src: bridgeSrcFor(version) };
      assert.deepEqual(loadConfig(configWith(bridge)).bridge, bridge);
    });

    for (const other of SUPPORTED_BRIDGE_VERSIONS.filter((candidate) => candidate !== version)) {
      it(`refuses bridge ${version} delivered by ${other}'s asset`, () => {
        const bridge = { ...VALID_BRIDGE, version, src: bridgeSrcFor(other) };
        assert.throws(
          () => loadConfig(configWith(bridge)),
          new RegExp(`is not ${bridgeSrcFor(version).replaceAll(/[./]/gu, "\\$&")}`, "u"),
        );
      });
    }
  }

  /**
   * The two packages agree by construction rather than by two copies of a
   * literal, so promoting the next bridge is one edit in the contract package.
   */
  it("takes the current delivery from the contract package", () => {
    assert.equal(VALID_BRIDGE.version, CURRENT_BRIDGE_VERSION);
    assert.equal(VALID_BRIDGE.src, CURRENT_BRIDGE_SRC);
    assert.equal(CURRENT_BRIDGE_SRC, bridgeSrcFor(CURRENT_BRIDGE_VERSION));
  });

  it("treats an absent bridge as absent, not as an error", () => {
    assert.equal(loadConfig(configWith(undefined)).bridge, null);
  });

  /**
   * The exact state the shipped example was in: a superseded version and a
   * digest nobody replaced.
   */
  it("refuses the example placeholder digest", () => {
    const path = configWith({
      ...VALID_BRIDGE,
      integrity:
        "sha384-REPLACE-WITH-THE-CURRENT-PLATFORM-SUBRESOURCE-INTEGRITY-VALUE-000",
    });

    assert.throws(() => loadConfig(path), /integrity is not a sha384 digest/u);
  });

  /**
   * Absent and malformed are different answers. Reporting `"bridge": "yes"` as
   * no bridge sends the reader looking for a missing key rather than at the one
   * they wrote wrong.
   */
  for (const [label, value] of [
    ["a string", "not-an-object"],
    ["an array", []],
    ["a boolean", false],
    ["a number", 7],
  ] as const) {
    it(`refuses a bridge that is ${label} rather than treating it as absent`, () => {
      assert.throws(
        () => loadConfig(configWith(value)),
        /invalid bridge: it must be an object/u,
      );
    });
  }

  it("treats an explicit null bridge as absent", () => {
    assert.equal(loadConfig(configWith(null)).bridge, null);
  });

  it("refuses a src that delivers a superseded version", () => {
    const path = configWith({
      ...VALID_BRIDGE,
      src: "https://app.gomega.ai/review-bridge/v4/review-bridge.js",
    });

    assert.throws(() => loadConfig(path), /is not https:\/\/app\.gomega\.ai/u);
  });

  for (const [label, bridge] of [
    ["a version that is not a version", { ...VALID_BRIDGE, version: "latest" }],
    ["a foreign src host", { ...VALID_BRIDGE, src: "https://cdn.example.com/b.js" }],
    ["a truncated digest", { ...VALID_BRIDGE, integrity: "sha384-abc" }],
    ["a sha256 digest", { ...VALID_BRIDGE, integrity: `sha256-${"a".repeat(64)}` }],
    ["a foreign crossOrigin", { ...VALID_BRIDGE, crossOrigin: "use-credentials" }],
    ["a foreign load strategy", { ...VALID_BRIDGE, load: "body_async" }],
  ] as const) {
    it(`refuses ${label}`, () => {
      assert.throws(() => loadConfig(configWith(bridge)), /invalid bridge/u);
    });
  }
});

/**
 * Absent and wrong are different answers, at every key, not only at the two the
 * reviewer happened to stand on.
 *
 * The loader used to read each key with a function that returned the default
 * whenever the value was not the shape it wanted, which is the same defect the
 * bridge block had before it was read rather than cast. `"pages": 42` loaded as
 * zero declared pages and the run then died on `internalSeo: null` three stages
 * later; `"assetRoot": 42` loaded as `public` and the proposer went looking for
 * images somewhere nobody asked for. The table below is every key, so a key
 * added without a reader is a key with no row.
 */
describe("a supplied conversion config value is never read as an absent one", () => {
  function configOf(entries: Record<string, unknown>): string {
    const directory = mkdtempSync(join(tmpdir(), "conversion-supplied-"));
    const path = join(directory, "site.conversion.json");
    writeFileSync(path, JSON.stringify(entries));
    return path;
  }

  const NOT_AN_OBJECT: readonly unknown[] = [42, [], false, "text", ""];

  const CASES: readonly {
    readonly key: string;
    readonly valid: unknown;
    readonly invalid: readonly unknown[];
    readonly reads: (config: ReturnType<typeof loadConfig>) => unknown;
  }[] = [
    {
      key: "contentRoot",
      valid: "src/content",
      invalid: [...NOT_AN_OBJECT.filter((value) => typeof value !== "string"), "", "a b"],
      reads: (config) => config.contentRoot,
    },
    {
      key: "assetRoot",
      valid: "public",
      invalid: [...NOT_AN_OBJECT.filter((value) => typeof value !== "string"), "", "a b"],
      reads: (config) => config.assetRoot,
    },
    {
      key: "bridge",
      valid: VALID_BRIDGE,
      invalid: NOT_AN_OBJECT,
      reads: (config) => config.bridge,
    },
    {
      key: "text",
      valid: { bodyMaxLength: 500 },
      invalid: [
        ...NOT_AN_OBJECT,
        { bodyMaxLength: "500" },
        { bodyMaxLength: -1 },
        { bodyMaxLength: 1.5 },
        { bodyMaxLength: null },
        { bodyMaxLenght: 500 },
      ],
      reads: (config) => config.text.bodyMaxLength,
    },
    {
      key: "collections",
      valid: { maxItems: 64 },
      invalid: [...NOT_AN_OBJECT, { maxItems: "lots" }, { maxItem: 64 }],
      reads: (config) => config.collections.maxItems,
    },
    {
      key: "assets",
      valid: { maxBytes: 1_000 },
      invalid: [...NOT_AN_OBJECT, { maxBytes: "1kb" }, { maxbytes: 1_000 }],
      reads: (config) => config.assets.maxBytes,
    },
    {
      key: "businessIdentity",
      valid: { legalName: "All Points Media" },
      invalid: [
        ...NOT_AN_OBJECT,
        { legalName: 42 },
        { legalName: "" },
        { sameAs: "https://example.com" },
        { sameAs: [42] },
        { sameAs: [""] },
      ],
      reads: (config) => config.businessIdentity.legalName,
    },
    {
      key: "pages",
      valid: { "/": { purpose: "home" } },
      invalid: [
        ...NOT_AN_OBJECT,
        { "/": 42 },
        { "/": [] },
        { "/": { purpose: "banana" } },
        { "/": { purpose: 42 } },
        { "/": { canonical: 42 } },
        { "/": { sitemap: "monthly" } },
        { "/": { sitemap: { included: true, changeFrequency: "monthly", priority: 5 } } },
        { "/": { sitemap: { included: true, changeFrequency: "fortnightly", priority: 1 } } },
        { "/": { sitemap: { included: true, changeFrequency: "monthly" } } },
        { "/": { performanceBudget: 42 } },
        {
          "/": {
            performanceBudget: {
              maxLcpMilliseconds: 2_500,
              maxCls: 2,
              maxInpMilliseconds: 200,
              maxPageBytes: 1_500_000,
            },
          },
        },
        { "/": { performanceBudget: { maxLcpMilliseconds: 2_500 } } },
      ],
      reads: (config) => config.pages.size,
    },
  ];

  for (const testCase of CASES) {
    it(`reads a valid ${testCase.key}`, () => {
      assert.notEqual(
        testCase.reads(loadConfig(configOf({ [testCase.key]: testCase.valid }))),
        undefined,
      );
    });

    it(`takes the default when ${testCase.key} is absent or explicitly null`, () => {
      const fallback = testCase.reads(loadConfig(configOf({})));

      assert.deepEqual(testCase.reads(loadConfig(configOf({ [testCase.key]: null }))), fallback);
    });

    for (const [index, invalid] of testCase.invalid.entries()) {
      it(`refuses ${testCase.key} case ${index}: ${JSON.stringify(invalid) ?? "undefined"}`, () => {
        assert.throws(
          () => loadConfig(configOf({ [testCase.key]: invalid })),
          new RegExp(`invalid ${testCase.key}`, "u"),
        );
      });
    }
  }

  /**
   * The keys are the reason this table can claim completeness: a config key with
   * no row above is a key nobody proved refuses a bad value.
   */
  it("covers every key the loader reads", () => {
    assert.deepEqual(
      CASES.map(({ key }) => key).sort(),
      Object.keys(defaultConfig()).sort(),
    );
  });
});

/**
 * The README lists every finding code and what it means, which makes it a second
 * statement of `FINDING_CODES`. A second statement drifts: the table was already
 * missing two codes before this test existed, so a reader deciding whether the
 * tool had refused something could be reading a list that did not mention it.
 */
describe("the documented finding codes", () => {
  it("are exactly the codes the tool can emit", () => {
    const readme = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "..", "README.md"),
      "utf8",
    );
    const documented = [...readme.matchAll(/^\| `([A-Z_]+)` \|/gmu)].map(([, code]) => code);

    assert.deepEqual(documented.sort(), [...FINDING_CODES].sort());
  });
});

/**
 * The loader cannot catch a route that does not exist, because it has not read
 * the repository yet. The proposer can, and until now did not: a declaration
 * matched by exact path simply went nowhere, and the only symptom was
 * `SEO_INPUT_REQUIRED` raised against the real route, telling a person to supply
 * what they had already supplied one character away.
 */
describe("a declared route the repository does not serve", () => {
  it("is reported against the config, not against the route that does exist", () => {
    const declared = {
      purpose: "landing",
      canonical: "https://example.com/",
      sitemap: { included: true, changeFrequency: "monthly", priority: 0.5 },
      performanceBudget: {
        maxLcpMilliseconds: 2500,
        maxCls: 0.1,
        maxInpMilliseconds: 200,
        maxPageBytes: 2097152,
      },
    };
    const proposal = run(
      workspace("site", {
        contentRoot: "src/content",
        assetRoot: "public",
        businessIdentity: {
          legalName: "Fixture Ltd",
          displayName: "Fixture",
          telephone: "+15555550100",
          email: "hello@example.com",
          description: "A fixture business.",
          sameAs: ["https://example.com/"],
        },
        pages: { "/": declared, "/nowhere": declared },
      }),
    );
    const finding = proposal.report.findings.find(
      (entry) => entry.anchor === "config:/nowhere",
    );

    assert.notEqual(finding, undefined, "the unserved route is reported");
    assert.match(finding?.decision ?? "", /serves no such route/u);
  });

  it("says nothing about a route the repository does serve", () => {
    const proposal = run(workspace("site", { pages: { "/": {} } }));

    assert.equal(
      proposal.report.findings.some((entry) => entry.anchor?.startsWith("config:")),
      false,
    );
  });
});

/**
 * A value that loads must not be able to fail later. That was the rule the roots
 * were held to, and every other key was left to the contract that consumes it --
 * so `"not-a-url"` loaded, reached the descriptor, and came back as
 * `contract: null` naming neither the route nor the key. Worse, a limit the
 * emitter never happened to use was simply ignored.
 *
 * Each of these is checked by running the contract's own parser over the value
 * the emitter would build from it, so the bounds live in one place.
 */
describe("a config value the standard would refuse", () => {
  function configOf(entries: Record<string, unknown>): string {
    const directory = mkdtempSync(join(tmpdir(), "conversion-bounds-"));
    const path = join(directory, "site.conversion.json");
    writeFileSync(path, JSON.stringify(entries));
    return path;
  }

  for (const [label, canonical] of [
    ["a bare word", "not-a-url"],
    ["a relative path", "/about"],
    ["plain http", "http://example.com/"],
    ["credentials in the authority", "https://user:pw@example.com/"],
    ["a fragment", "https://example.com/#top"],
    ["a protocol-relative URL", "//example.com/"],
    ["over the length the standard carries", `https://example.com/${"a".repeat(2_100)}`],
  ] as const) {
    it(`refuses a canonical that is ${label}`, () => {
      assert.throws(
        () => loadConfig(configOf({ pages: { "/": { canonical } } })),
        /invalid pages.*absolute https URL/su,
      );
    });
  }

  it("accepts a canonical the standard accepts", () => {
    const config = loadConfig(configOf({ pages: { "/": { canonical: "https://example.com/" } } }));

    assert.equal(config.pages.get("/")?.canonical, "https://example.com/");
  });

  for (const [key, policy, override] of [
    ["text", "text", { labelMaxLength: 0 }],
    ["text", "text", { bodyMaxLength: -1 }],
    ["text", "text", { headingMaxLength: 131_073 }],
    ["text", "text", { linkLabelMaxLength: 2_001 }],
    ["text", "text", { richTextMaxNodes: 2_001 }],
    ["text", "text", { richTextMaxCharacters: 0 }],
    ["collections", "collections", { maxItems: 0 }],
    ["collections", "collections", { maxItems: 501 }],
    ["collections", "collections", { minItems: -1 }],
    ["collections", "collections", { minItems: 10, maxItems: 5 }],
    ["assets", "assets", { maxBytes: 0 }],
    ["assets", "assets", { maxBytes: -1 }],
  ] as const) {
    it(`refuses ${policy} ${JSON.stringify(override)}`, () => {
      assert.throws(
        () => loadConfig(configOf({ [policy]: override })),
        new RegExp(`invalid ${key}`, "u"),
      );
    });
  }

  /**
   * `linkLabelMaxLength` has a lower ceiling than other text, and a limit for a
   * field type the emitter never reaches would otherwise be accepted and ignored.
   */
  it("accepts a link label at its own ceiling and refuses one past it", () => {
    assert.equal(
      loadConfig(configOf({ text: { linkLabelMaxLength: 2_000 } })).text.linkLabelMaxLength,
      2_000,
    );
    assert.throws(() => loadConfig(configOf({ text: { linkLabelMaxLength: 2_001 } })), /invalid text/u);
  });

  it("accepts collection bounds in order and refuses them reversed", () => {
    assert.equal(loadConfig(configOf({ collections: { minItems: 2, maxItems: 2 } })).collections.maxItems, 2);
    assert.throws(
      () => loadConfig(configOf({ collections: { minItems: 3, maxItems: 2 } })),
      /invalid collections/u,
    );
  });
});

/**
 * The load-time budget on `contentRoot` promises room for the longest slug ONE
 * route segment can produce. `routeSlug` folds every segment of a route into one
 * file name, and a static route may be 2,048 characters, so a long enough route
 * is unrepresentable under any root at all. That is a fact about the route, and
 * it is reported where the routes are known rather than reaching the contract as
 * an invalid path.
 */
describe("a route that folds into a file name the standard cannot carry", () => {
  function siteWithRoute(segments: readonly string[]): Workspace {
    const space = workspace("site", { contentRoot: "src/content", assetRoot: "public" });
    const directory = join(space.repositoryRoot, "app", ...segments);
    mkdirSync(directory, { recursive: true });
    writeFileSync(
      join(directory, "page.tsx"),
      "export default function Deep() {\n  return <p>Deep</p>;\n}\n",
      "utf8",
    );
    return space;
  }

  it("is reported against the route, not left to fail as an invalid path", () => {
    const proposal = run(siteWithRoute(["a".repeat(200), "b".repeat(200)]));
    const finding = proposal.report.findings.find(
      (entry) => entry.code === "ROUTE_PATH_UNREPRESENTABLE",
    );

    assert.notEqual(finding, undefined, "the unrepresentable route was not reported");
    assert.match(finding?.decision ?? "", /Shorten the route/u);
  });

  it("still proposes every route that does fit", () => {
    const proposal = run(siteWithRoute(["a".repeat(200), "b".repeat(200)]));

    assert.ok(
      proposal.report.findings.some((entry) => entry.code === "ROUTE_PATH_UNREPRESENTABLE"),
    );
    assert.ok(proposal.contentDraft.values.length > 0, "the rest of the site stopped being proposed");
  });

  it("says nothing about a route whose file name fits", () => {
    const proposal = run(siteWithRoute(["about", "team"]));

    assert.equal(
      proposal.report.findings.some((entry) => entry.code === "ROUTE_PATH_UNREPRESENTABLE"),
      false,
    );
  });
});

/**
 * The last key that could load and fail later. Identity values are emitted as
 * internal-protected content unchanged, so a `legalName` past the cap or a
 * hundred-and-first `sameAs` entry loaded, reached the document, and came back as
 * `contract: null` with nothing said about which key put it there.
 */
describe("business identity the standard would refuse", () => {
  function identityOf(identity: Record<string, unknown>): string {
    const directory = mkdtempSync(join(tmpdir(), "conversion-identity-"));
    const path = join(directory, "site.conversion.json");
    writeFileSync(path, JSON.stringify({ businessIdentity: identity }));
    return path;
  }

  const TEXT_KEYS = ["legalName", "displayName", "telephone", "email", "description"] as const;

  for (const key of TEXT_KEYS) {
    it(`refuses a ${key} longer than the standard carries`, () => {
      assert.throws(
        () => loadConfig(identityOf({ [key]: "a".repeat(10_001) })),
        new RegExp(`invalid businessIdentity: ${key} is longer`, "u"),
      );
    });

    it(`accepts a ${key} at the longest the standard carries`, () => {
      const config = loadConfig(identityOf({ [key]: "a".repeat(10_000) }));

      assert.equal(config.businessIdentity[key]?.length, 10_000);
    });
  }

  for (const [label, sameAs] of [
    ["an entry longer than the standard carries", [`https://example.com/${"a".repeat(2_100)}`]],
    ["more entries than the standard carries", Array.from({ length: 101 }, (_u, i) => `https://example.com/${i}`)],
  ] as const) {
    it(`refuses sameAs with ${label}`, () => {
      assert.throws(
        () => loadConfig(identityOf({ sameAs })),
        /invalid businessIdentity: sameAs is not a list/u,
      );
    });
  }

  it("accepts sameAs at the most entries the standard carries", () => {
    const sameAs = Array.from({ length: 100 }, (_unused, index) => `https://example.com/${index}`);

    assert.equal(loadConfig(identityOf({ sameAs })).businessIdentity.sameAs?.length, 100);
  });

  /** An identity field with no case above is a field nobody proved is bounded. */
  it("covers every identity field the loader reads", () => {
    assert.deepEqual(
      [...TEXT_KEYS, "sameAs"].sort(),
      Object.keys(defaultConfig().businessIdentity).sort(),
    );
  });
});

/**
 * Every key that reaches the contract is bounded where it is written, not where
 * it lands. This is the list of them, so a key added without a check has no row.
 */
describe("a route that declares who owns its words", () => {
  function pageOf(entry: Record<string, unknown>): PageSeoInput | undefined {
    const directory = mkdtempSync(join(tmpdir(), "conversion-managed-"));
    const path = join(directory, "site.conversion.json");
    writeFileSync(path, JSON.stringify({ pages: { "/admin": entry } }));
    return loadConfig(path).pages.get("/admin");
  }

  it("is the customer's by default, so declaring a route changes nothing else", () => {
    assert.equal(pageOf({})?.managedContent, true);
  });

  it("reads an explicit true", () => {
    assert.equal(pageOf({ managedContent: true })?.managedContent, true);
  });

  it("reads an explicit false", () => {
    assert.equal(pageOf({ managedContent: false })?.managedContent, false);
  });

  /**
   * A boolean is the one shape where a permissive read is invisible: every
   * value below is truthy or falsy in JavaScript, so a loader that coerced
   * would silently answer the opposite of what some of them look like.
   * `"false"`, in particular, is truthy.
   */
  for (const [label, managedContent] of [
    ["the string false", "false"],
    ["the string true", "true"],
    ["zero", 0],
    ["one", 1],
    ["an empty string", ""],
    ["an array", []],
    ["an object", {}],
  ] as const) {
    it(`refuses ${label}`, () => {
      assert.throws(
        () => pageOf({ managedContent }),
        /invalid pages: route \/admin managedContent it must be true or false/u,
      );
    });
  }

  /** JSON has no `undefined`, so an explicit null is how a person writes "not set". */
  it("reads an explicit null as absence", () => {
    assert.equal(pageOf({ managedContent: null })?.managedContent, true);
  });
});

describe("the config keys held to the standard's own rules", () => {
  it("covers every page-level SEO input", () => {
    const directory = mkdtempSync(join(tmpdir(), "conversion-coverage-"));
    const path = join(directory, "site.conversion.json");
    writeFileSync(path, JSON.stringify({ pages: { "/": {} } }));
    const page = loadConfig(path).pages.get("/");

    assert.notEqual(page, undefined);
    assert.deepEqual(Object.keys(page ?? {}).sort(), [
      "canonical",
      "managedContent",
      "performanceBudget",
      "purpose",
      "sitemap",
    ]);
  });
});
