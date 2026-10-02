import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  ManagedSiteContractError,
  assertDistinctRepositoryPaths,
  parseJsonPointer,
  parseRepositoryPath,
  parseSourceAddress,
} from "../src/index.js";

function expectContractError(
  action: () => unknown,
  expectedCode: string,
): void {
  assert.throws(action, (error: unknown) => {
    assert.ok(error instanceof ManagedSiteContractError);
    assert.equal(error.code, expectedCode);
    return true;
  });
}

describe("portable repository source paths", () => {
  it("accepts an unambiguous relative POSIX path", () => {
    assert.equal(
      parseRepositoryPath("src/content/pages/home.json"),
      "src/content/pages/home.json",
    );
    assert.equal(parseRepositoryPath(".gomega/contract.json"),
      ".gomega/contract.json");
  });

  /**
   * The frameworks encode routing in directory names, so a path that cannot
   * express them cannot address a real repository. Next.js App Router reserves
   * all four of these shapes, and the starter itself uses none of them, which is
   * how a converter could reject an ordinary customer site at its first field.
   */
  it("accepts the directory syntax Next.js reserves for routing", () => {
    const valid = [
      "app/(site)/page.tsx",
      "app/(marketing)/(legal)/terms/page.tsx",
      "app/blog/[slug]/page.tsx",
      "app/(site)/[...slug]/page.tsx",
      "app/shop/[[...filters]]/page.tsx",
      "app/@modal/(.)photo/[id]/page.tsx",
    ];

    for (const value of valid) {
      assert.equal(parseRepositoryPath(value), value);
    }
  });

  /**
   * Widening the segment alphabet must not widen anything else. These are the
   * characters that make a path ambiguous, unsafe, or unportable, and every one
   * of them is still refused.
   */
  it("keeps refusing the characters that made a path unsafe", () => {
    const invalid = [
      "app/(site)/page .tsx",
      "app/(site)/pa:ge.tsx",
      "app/(site)/pa*ge.tsx",
      "app/(site)/pa|ge.tsx",
      "app/(site)/pa<ge.tsx",
      "app/(site)/pa\"ge.tsx",
      "app/(site)/../secrets.tsx",
      "app/(site)/%2e%2e/secrets.tsx",
    ];

    for (const value of invalid) {
      expectContractError(
        () => parseRepositoryPath(value),
        "SOURCE_PATH_INVALID",
      );
    }
  });

  it("rejects absolute, traversal, empty, encoded, and platform-specific paths", () => {
    const invalid = [
      "/src/content.json",
      "C:\\src\\content.json",
      "src\\content.json",
      "src/./content.json",
      "src/../content.json",
      "src//content.json",
      "src/content.json/",
      "src/%2e%2e/content.json",
      "src/content?.json",
      "src/content#fragment.json",
      "src/\u0000content.json",
      " src/content.json",
    ];

    for (const value of invalid) {
      expectContractError(
        () => parseRepositoryPath(value),
        "SOURCE_PATH_INVALID",
      );
    }
  });

  it("rejects non-portable Unicode and cross-platform case aliases", () => {
    expectContractError(
      () => parseRepositoryPath("src/cafe\u0301.json"),
      "SOURCE_PATH_INVALID",
    );
    expectContractError(
      () => parseRepositoryPath("src/Ｆoo.json"),
      "SOURCE_PATH_INVALID",
    );
    expectContractError(
      () =>
        assertDistinctRepositoryPaths([
          "src/content/Home.json",
          "src/content/home.json",
        ]),
      "SOURCE_PATH_ALIAS",
    );
  });

  it("requires every UTF-8 path segment to stay within 255 bytes", () => {
    for (const segmentBytes of [254, 255]) {
      const path = `root/${"a".repeat(segmentBytes)}`;
      assert.equal(parseRepositoryPath(path), path);
    }
    const path = `root/${"a".repeat(256)}`;
    expectContractError(() => parseRepositoryPath(path), "SOURCE_PATH_INVALID");
  });
});

describe("JSON Pointers", () => {
  it("parses the root pointer and decodes RFC 6901 tokens", () => {
    assert.deepEqual(parseJsonPointer(""), { value: "", tokens: [] });
    assert.deepEqual(parseJsonPointer("/pages/home/a~1b/~0key"), {
      value: "/pages/home/a~1b/~0key",
      tokens: ["pages", "home", "a/b", "~key"],
    });
  });

  it("rejects URI fragments, empty tokens, controls, and invalid escaping", () => {
    const cases: ReadonlyArray<readonly [string, string]> = [
      ["pages/home", "JSON_POINTER_INVALID"],
      ["#/pages/home", "JSON_POINTER_INVALID"],
      ["/pages//title", "JSON_POINTER_EMPTY_TOKEN"],
      ["/pages/title/", "JSON_POINTER_EMPTY_TOKEN"],
      ["/pages/~2title", "JSON_POINTER_INVALID_ESCAPE"],
      ["/pages/title~", "JSON_POINTER_INVALID_ESCAPE"],
      ["/pages/\u0000title", "JSON_POINTER_INVALID"],
      ["/pages/cafe\u0301", "JSON_POINTER_NOT_NFC"],
    ];

    for (const [value, code] of cases) {
      expectContractError(() => parseJsonPointer(value), code);
    }
  });

  it("creates an immutable source address from separately validated parts", () => {
    const address = parseSourceAddress({
      path: "src/content/pages/home.json",
      pointer: "/hero/title",
    });

    assert.deepEqual(address, {
      path: "src/content/pages/home.json",
      pointer: "/hero/title",
      tokens: ["hero", "title"],
    });
    assert.ok(Object.isFrozen(address));
    assert.ok(Object.isFrozen(address.tokens));
  });
});
