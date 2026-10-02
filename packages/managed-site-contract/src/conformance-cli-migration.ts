import * as z from "zod";

import { canonicalizeJson } from "./canonical.js";
import { parseManagedSiteContentDocument } from "./content.js";
import { parseManagedSiteContractV1 } from "./contract.js";
import { ManagedSiteContractError } from "./errors.js";
import type { ManagedSiteBridgeAdmission } from "./field-migration-bridge.js";
import { validateManagedSiteContractV1MigrationCompatibility } from "./field-migration-verify.js";
import { parseJsonText } from "./json-text.js";

export const MANAGED_SITE_MIGRATION_COMMAND = "migrate";

const INPUT_FLAGS = Object.freeze({
  "--production-contract": "productionContract",
  "--production-content": "productionContent",
  "--contract": "candidateContract",
  "--content": "candidateContent",
  "--migration": "migration",
} as const);

type InputName = (typeof INPUT_FLAGS)[keyof typeof INPUT_FLAGS];
type InputFlag = keyof typeof INPUT_FLAGS;

export interface ManagedSiteMigrationCliArguments {
  readonly paths: Readonly<Record<InputName, string>>;
  /** The one bridge the caller vouches the platform serves, or none. */
  readonly admittedBridge: { readonly version: string; readonly integrity: string } | null;
}

export interface ManagedSiteMigrationCliIo {
  readUtf8File(path: string): string;
  writeStdout(value: string): void;
}

const ADMIT_FLAG = "--admit-bridge";
const ADMIT_VALUE = /^(v[1-9]\d{0,3})=(sha384-[A-Za-z0-9+/]{64})$/u;

function usageFailure(usage: string): never {
  throw new ManagedSiteContractError("CONFORMANCE_USAGE", usage.trim());
}

function isInputFlag(flag: string): flag is InputFlag {
  return Object.hasOwn(INPUT_FLAGS, flag);
}

function readFlagPairs(argv: readonly string[], usage: string): ReadonlyMap<string, string> {
  if (argv.length % 2 !== 0) usageFailure(usage);
  const pairs = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 2) {
    const [flag, value] = [argv[index], argv[index + 1]];
    const known = isInputFlag(flag) || flag === ADMIT_FLAG;
    if (!known || value.length === 0 || value.startsWith("--") || pairs.has(flag)) {
      usageFailure(usage);
    }
    pairs.set(flag, value);
  }
  return pairs;
}

function admittedBridge(
  value: string | undefined,
  usage: string,
): ManagedSiteMigrationCliArguments["admittedBridge"] {
  if (value === undefined) return null;
  const match = ADMIT_VALUE.exec(value);
  if (match === null) return usageFailure(usage);
  return { version: match[1], integrity: match[2] };
}

/** `migrate` and its flags: every input once, and at most one admitted bridge. */
export function parseManagedSiteMigrationCliArguments(
  argv: readonly string[],
  usage: string,
): ManagedSiteMigrationCliArguments {
  const pairs = readFlagPairs(argv, usage);
  const paths = {} as Record<InputName, string>;
  for (const [flag, name] of Object.entries(INPUT_FLAGS)) {
    const path = pairs.get(flag);
    if (path === undefined) usageFailure(usage);
    paths[name] = path;
  }
  return { paths, admittedBridge: admittedBridge(pairs.get(ADMIT_FLAG), usage) };
}

function readJson(io: ManagedSiteMigrationCliIo, path: string, label: string): unknown {
  let text: string;
  try {
    text = io.readUtf8File(path);
  } catch {
    throw new ManagedSiteContractError("CONFORMANCE_INPUT_IO", `Unable to read ${label} input`);
  }
  return parseJsonText(text);
}

function admission(admitted: ManagedSiteMigrationCliArguments["admittedBridge"]): ManagedSiteBridgeAdmission {
  return (version, integrity) =>
    admitted !== null && admitted.version === version && admitted.integrity === integrity;
}

function verify(args: ManagedSiteMigrationCliArguments, io: ManagedSiteMigrationCliIo): unknown {
  const read = (name: InputName) => readJson(io, args.paths[name], name);
  return validateManagedSiteContractV1MigrationCompatibility(
    parseManagedSiteContractV1(read("productionContract")),
    parseManagedSiteContentDocument(read("productionContent")),
    parseManagedSiteContractV1(read("candidateContract")),
    parseManagedSiteContentDocument(read("candidateContent")),
    read("migration"),
    { admitBridge: admission(args.admittedBridge) },
  );
}

/**
 * Verifies a site's `managed-site.migration.json` against the production
 * contract and content it names, and prints the proof as canonical JSON. A
 * bridge change passes only with `--admit-bridge <version>=<integrity>`
 * naming exactly the candidate's bridge: the CLI cannot see what the platform
 * serves, so the caller must vouch for it, and without that it refuses.
 */
export function runManagedSiteMigrationCli(
  args: ManagedSiteMigrationCliArguments,
  io: ManagedSiteMigrationCliIo,
): void {
  let proof: unknown;
  try {
    proof = verify(args, io);
  } catch (error) {
    if (error instanceof z.ZodError) {
      throw new ManagedSiteContractError("SCHEMA_VALIDATION", "Managed-site schema validation failed");
    }
    throw error;
  }
  io.writeStdout(`${canonicalizeJson(proof)}\n`);
}
