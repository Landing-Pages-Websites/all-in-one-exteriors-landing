import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import {
  mintStableId,
  type StableId,
  type StableIdKind,
} from "@landing-pages-websites/managed-site-contract";

/**
 * Stable IDs are random (exactly as the platform mints them). Their *binding*
 * to the source is what has to be durable, and that binding is the anchor path.
 *
 * The ledger is the memory that makes re-running the proposer idempotent: an
 * anchor that already has an ID keeps it, a new anchor mints a fresh one, and
 * an anchor that disappeared is tombstoned rather than recycled.
 */

const LEDGER_VERSION = "1";

export interface LedgerRecord {
  readonly kind: StableIdKind;
  readonly id: string;
  readonly anchor: string;
}

interface LedgerDocument {
  readonly version: string;
  readonly entries: readonly LedgerRecord[];
  readonly tombstonedIds: readonly string[];
}

function isLedgerRecord(value: unknown): value is LedgerRecord {
  if (typeof value !== "object" || value === null) return false;
  const record: Record<string, unknown> = { ...value };
  return (
    typeof record["kind"] === "string" &&
    typeof record["id"] === "string" &&
    typeof record["anchor"] === "string"
  );
}

function parseLedgerDocument(text: string): LedgerDocument {
  const parsed: unknown = JSON.parse(text);
  if (typeof parsed !== "object" || parsed === null) {
    throw new Error("ID ledger is not a JSON object");
  }
  const document: Record<string, unknown> = { ...parsed };
  const entries = document["entries"];
  const tombstones = document["tombstonedIds"];
  if (!Array.isArray(entries) || !entries.every(isLedgerRecord)) {
    throw new Error("ID ledger entries are malformed");
  }
  const tombstonedIds =
    Array.isArray(tombstones) && tombstones.every((id) => typeof id === "string")
      ? tombstones
      : [];
  return { version: LEDGER_VERSION, entries, tombstonedIds };
}

export class IdLedger {
  readonly #known = new Map<string, LedgerRecord>();
  readonly #used = new Set<string>();
  readonly #minted = new Set<string>();
  readonly #tombstones: string[];

  private constructor(document: LedgerDocument) {
    for (const entry of document.entries) {
      this.#known.set(entry.anchor, entry);
    }
    this.#tombstones = [...document.tombstonedIds];
  }

  static empty(): IdLedger {
    return new IdLedger({ version: LEDGER_VERSION, entries: [], tombstonedIds: [] });
  }

  static load(path: string): IdLedger {
    try {
      return new IdLedger(parseLedgerDocument(readFileSync(path, "utf8")));
    } catch (error) {
      if (isMissingFile(error)) return IdLedger.empty();
      throw new Error(`Could not read ID ledger at ${path}: ${describe(error)}`);
    }
  }

  /** Reuse the ID already bound to this anchor, or mint one and bind it. */
  resolve<Kind extends StableIdKind>(kind: Kind, anchor: string): StableId<Kind> {
    const existing = this.#known.get(anchor);
    if (existing !== undefined && existing.kind === kind) {
      this.#used.add(anchor);
      return existing.id as StableId<Kind>;
    }
    if (existing !== undefined) {
      throw new Error(
        `Anchor ${anchor} is already bound to a ${existing.kind} ID; refusing to rebind it as ${kind}`,
      );
    }
    const minted = mintStableId(kind);
    this.#minted.add(minted);
    this.#known.set(anchor, { kind, id: minted, anchor });
    this.#used.add(anchor);
    return minted;
  }

  /** Whether this run minted the id, rather than finding it already bound. */
  mintedThisRun(id: string): boolean {
    return this.#minted.has(id);
  }

  /**
   * The ledger records this run retired: bound in the ledger it loaded, with
   * an anchor this run never resolved. Their anchors are the structural
   * evidence of what replaced them.
   */
  retiredRecords(): readonly LedgerRecord[] {
    return [...this.#known.values()].filter((entry) => !this.#used.has(entry.anchor));
  }

  /** IDs whose anchor vanished this run. Never reused; surfaced to the contract. */
  retiredIds(): readonly string[] {
    const retired = [...this.#known.values()]
      .filter((entry) => !this.#used.has(entry.anchor))
      .map((entry) => entry.id);
    return [...new Set([...this.#tombstones, ...retired])].sort();
  }

  save(path: string): void {
    const entries = [...this.#known.values()]
      .filter((entry) => this.#used.has(entry.anchor))
      .sort((left, right) => left.anchor.localeCompare(right.anchor));
    const document: LedgerDocument = {
      version: LEDGER_VERSION,
      entries,
      tombstonedIds: this.retiredIds(),
    };
    // The ledger's directory is the site's content root, which a plain
    // proposal run has not written to yet -- only `--write-sources` and
    // `--rewire` create it. Left to the caller, the default path threw at the
    // very end of every run that had not asked for one of those.
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, `${JSON.stringify(document, null, 2)}\n`, "utf8");
  }
}

function isMissingFile(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { readonly code: unknown }).code === "ENOENT"
  );
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
