import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  ManagedSiteContractError,
  STABLE_ID_KINDS,
  assertDistinctStableIds,
  getStableIdKind,
  mintStableId,
  parseStableId,
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

describe("stable IDs", () => {
  it("mints deterministic opaque IDs from exactly 128 bits of supplied entropy", () => {
    const entropy = Uint8Array.from({ length: 16 }, (_, index) => index);

    assert.equal(
      mintStableId("page", entropy),
      "page_000g40r40m30e209185gr38e1w",
    );
  });

  it("round-trips minted IDs for every stable ID kind", () => {
    const entropy = Uint8Array.from({ length: 16 }, (_, index) => 255 - index);

    for (const kind of STABLE_ID_KINDS) {
      const minted = mintStableId(kind, entropy);

      assert.equal(parseStableId(minted, kind), minted);
      assert.equal(getStableIdKind(minted), kind);
    }
  });

  it("parses the kind without allowing callers to reinterpret another kind", () => {
    const value = "field_000g40r40m30e209185gr38e1w";

    assert.equal(parseStableId(value, "field"), value);
    assert.equal(getStableIdKind(value), "field");
    expectContractError(
      () => parseStableId(value, "page"),
      "STABLE_ID_KIND_MISMATCH",
    );
  });

  it("rejects array-, slug-, title-, case-, and length-shaped identities", () => {
    const invalid = [
      "page_0",
      "page_home",
      "page_home-page",
      "page_HomePage00000000000000000",
      "page_000g40r40m30e209185gr38e1",
      "page_000g40r40m30e209185gr38e1x",
      "unknown_000g40r40m30e209185gr38e1w",
      " page_000g40r40m30e209185gr38e1w",
    ];

    for (const value of invalid) {
      expectContractError(() => parseStableId(value), "STABLE_ID_INVALID");
    }
  });

  it("rejects duplicate IDs and payload reuse across kinds", () => {
    const suffix = "000g40r40m30e209185gr38e1w";

    expectContractError(
      () => assertDistinctStableIds([`page_${suffix}`, `page_${suffix}`]),
      "STABLE_ID_DUPLICATE",
    );
    expectContractError(
      () => assertDistinctStableIds([`page_${suffix}`, `field_${suffix}`]),
      "STABLE_ID_CROSS_KIND_COLLISION",
    );
  });

  it("rejects missing or incorrectly sized entropy", () => {
    expectContractError(
      () => mintStableId("page", new Uint8Array(15)),
      "STABLE_ID_ENTROPY_LENGTH",
    );
    expectContractError(
      () => mintStableId("not-a-kind" as "page", new Uint8Array(16)),
      "STABLE_ID_KIND_INVALID",
    );
    expectContractError(
      () =>
        parseStableId(
          "page_000g40r40m30e209185gr38e1w",
          "not-a-kind" as "page",
        ),
      "STABLE_ID_KIND_INVALID",
    );
  });
});
