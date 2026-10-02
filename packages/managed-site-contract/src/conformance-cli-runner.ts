import { canonicalizeJson } from "./canonical.js";
import {
  MANAGED_SITE_MIGRATION_COMMAND,
  parseManagedSiteMigrationCliArguments,
  runManagedSiteMigrationCli,
  type ManagedSiteMigrationCliArguments,
} from "./conformance-cli-migration.js";
import { conformManagedSiteJsonText } from "./conformance-input.js";
import { ManagedSiteContractError } from "./errors.js";

export const MANAGED_SITE_CONFORMANCE_USAGE =
  "Usage: gomega-managed-site-conformance --contract <path> --content <path>\n" +
  "       gomega-managed-site-conformance migrate --production-contract <path> " +
  "--production-content <path> --contract <path> --content <path> " +
  "--migration <path> [--admit-bridge <version>=<integrity>]\n";

export type ManagedSiteConformanceExitCode = 0 | 1 | 2 | 3 | 4;

export interface ManagedSiteConformanceCliIo {
  readUtf8File(path: string): string;
  writeStdout(value: string): void;
  writeStderr(value: string): void;
}

interface ConformancePaths {
  readonly contract: string;
  readonly content: string;
}

type ParsedArguments =
  | { readonly kind: "help" }
  | { readonly kind: "conform"; readonly paths: ConformancePaths }
  | { readonly kind: "migrate"; readonly args: ManagedSiteMigrationCliArguments };

function usageFailure(): never {
  throw new ManagedSiteContractError(
    "CONFORMANCE_USAGE",
    MANAGED_SITE_CONFORMANCE_USAGE.trim(),
  );
}

function parseArguments(argv: readonly string[]): ParsedArguments {
  if (argv.length === 1 && argv[0] === "--help") return { kind: "help" };
  if (argv[0] === MANAGED_SITE_MIGRATION_COMMAND) {
    return {
      kind: "migrate",
      args: parseManagedSiteMigrationCliArguments(argv.slice(1), MANAGED_SITE_CONFORMANCE_USAGE),
    };
  }
  if (argv.length !== 4) return usageFailure();
  const paths = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (
      (flag !== "--contract" && flag !== "--content") ||
      value.length === 0 ||
      value.startsWith("--") ||
      paths.has(flag)
    ) {
      return usageFailure();
    }
    paths.set(flag, value);
  }
  const contract = paths.get("--contract");
  const content = paths.get("--content");
  if (contract === undefined || content === undefined) return usageFailure();
  return { kind: "conform", paths: { contract, content } };
}

function readInput(
  io: ManagedSiteConformanceCliIo,
  path: string,
  label: "contract" | "content",
): string {
  try {
    return io.readUtf8File(path);
  } catch {
    throw new ManagedSiteContractError(
      "CONFORMANCE_INPUT_IO",
      `Unable to read ${label} input`,
    );
  }
}

function errorExitCode(
  error: ManagedSiteContractError,
): ManagedSiteConformanceExitCode {
  if (error.code === "CONFORMANCE_USAGE") return 2;
  if (error.code === "CONFORMANCE_INPUT_IO") return 3;
  return 4;
}

function internalFailure(): ManagedSiteContractError {
  return new ManagedSiteContractError(
    "CONFORMANCE_INTERNAL",
    "Managed-site conformance failed unexpectedly",
  );
}

function normalizeFailure(error: unknown): {
  readonly error: ManagedSiteContractError;
  readonly exitCode: ManagedSiteConformanceExitCode;
} {
  if (error instanceof ManagedSiteContractError) {
    return { error, exitCode: errorExitCode(error) };
  }
  return { error: internalFailure(), exitCode: 1 };
}

function writeFailure(
  io: ManagedSiteConformanceCliIo,
  error: unknown,
): ManagedSiteConformanceExitCode {
  const failure = normalizeFailure(error);
  try {
    io.writeStderr(
      `${canonicalizeJson({
        code: failure.error.code,
        message: failure.error.message,
      })}\n`,
    );
    return failure.exitCode;
  } catch {
    return 1;
  }
}

function conform(paths: ConformancePaths, io: ManagedSiteConformanceCliIo): void {
  const contractText = readInput(io, paths.contract, "contract");
  const contentText = readInput(io, paths.content, "content");
  const artifacts = conformManagedSiteJsonText(contractText, contentText);
  io.writeStdout(`${canonicalizeJson(artifacts)}\n`);
}

export function runManagedSiteConformanceCli(
  argv: readonly string[],
  io: ManagedSiteConformanceCliIo,
): ManagedSiteConformanceExitCode {
  try {
    const parsed = parseArguments(argv);
    if (parsed.kind === "help") io.writeStdout(MANAGED_SITE_CONFORMANCE_USAGE);
    else if (parsed.kind === "migrate") runManagedSiteMigrationCli(parsed.args, io);
    else conform(parsed.paths, io);
    return 0;
  } catch (error) {
    return writeFailure(io, error);
  }
}
