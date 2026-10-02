import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import process from "node:process";

import {
  applyAnchorNames,
  describeName,
  nameAmbiguousAnchors,
  revertAnchorNames,
  verifyAnchorNames,
} from "./name-anchors.js";
import {
  fieldMigrationOutcome,
  removeSidecar,
  sidecarPath,
  type FieldMigrationOptions,
} from "./cli-migration.js";
import { loadConfig } from "./config.js";
import { propose, sourceDocumentsFor } from "./propose.js";
import { renderReportText } from "./report.js";
import { applyRewrite, parseErrorsOf, planRewrite } from "./rewire.js";
import { CONTRACT_FILE, LEDGER_FILE, runtimeModule } from "./runtime-module.js";
import { runtimeRequirementRefusals } from "./runtime-requirements.js";

interface CliOptions {
  readonly repositoryRoot: string;
  readonly outputDirectory: string;
  readonly configPath: string | null;
  readonly ledgerPath: string;
  readonly writeSources: boolean;
  readonly nameAnchors: boolean;
  readonly applyAnchorNames: boolean;
  readonly rewire: string | null;
  readonly migration: FieldMigrationOptions;
}

const USAGE = `Usage: propose --repo <path> [--out <path>] [--config <path>] [--ledger <path>] [--write-sources]

Proposes a managed-site contract for a Next.js repository. Values it cannot
classify with confidence are reported, never guessed.

  --repo           repository to inspect (required)
  --out            directory for the proposal (default: <repo>/.managed-site-proposal)
  --config         conversion config supplying platform and governance facts
  --ledger         anchor-to-ID ledger (default: <repo>/<contentRoot>/managed-site.idmap.json).
                   COMMIT IT. It is what keeps a field's ID the same across
                   conversions, and the CMS addresses a customer's edits by
                   that ID.
  --write-sources  also write the proposed src/content JSON documents
  --name-anchors   also propose an \`id\` for every ambiguity it can name safely
  --apply-anchors  write those ids into the repository (implies --name-anchors)
  --rewire <spec>  rewrite the repository to read its values from the contract,
                   importing the runtime from <spec> (e.g. @/src/content/managed-site).
                   Also writes the contract, the content documents and that
                   runtime into the repository, so the site builds as it stands.
  --migration-plan <path>
                   the merge steps a person wrote for the fields this run
                   replaced. Written, bound to production, as
                   managed-site.migration.json (beside the idmap with --rewire).
  --production-contract <path>, --production-content <path>
                   the production artifacts the plan migrates (required with
                   --migration-plan).
`;

function readOptions(argv: readonly string[]): CliOptions | null {
  const values = new Map<string, string>();
  const flags = new Set<string>();
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === undefined || !argument.startsWith("--")) continue;
    const next = argv[index + 1];
    if (next === undefined || next.startsWith("--")) {
      flags.add(argument.slice(2));
      continue;
    }
    values.set(argument.slice(2), next);
    index += 1;
  }
  const repository = values.get("repo");
  if (repository === undefined) return null;
  const repositoryRoot = resolve(repository);
  const outputDirectory = resolve(
    values.get("out") ?? join(repositoryRoot, ".managed-site-proposal"),
  );
  const configPath =
    values.get("config") === undefined ? null : resolve(values.get("config")!);
  return {
    repositoryRoot,
    outputDirectory,
    configPath,
    // Inside the repository by default, beside the content the conversion
    // writes. The old default put it under `--out`, a report folder nobody
    // commits, so a re-run minted a fresh id for every field and orphaned
    // whatever a customer had edited -- and remembering `--ledger` was the only
    // thing standing between a site and that, which is the shape of a safeguard
    // that fails silently. The path follows `contentRoot` so it moves with the
    // documents rather than being a second statement of where they live.
    ledgerPath: resolve(
      values.get("ledger") ??
        join(repositoryRoot, loadConfig(configPath).contentRoot, LEDGER_FILE),
    ),
    writeSources: flags.has("write-sources"),
    nameAnchors: flags.has("name-anchors") || flags.has("apply-anchors"),
    applyAnchorNames: flags.has("apply-anchors"),
    rewire: values.get("rewire") ?? null,
    migration: {
      planPath: optionalPath(values.get("migration-plan")),
      productionContractPath: optionalPath(values.get("production-contract")),
      productionContentPath: optionalPath(values.get("production-content")),
    },
  };
}

function optionalPath(value: string | undefined): string | null {
  return value === undefined ? null : resolve(value);
}

/** The two names for the content document; exactly one exists after a run. */
const CONTENT_ARTIFACTS = {
  accepted: "managed-site.content.json",
  rejected: "managed-site.content.rejected.json",
} as const;

/**
 * Writes the content document under the name this outcome calls for, and
 * removes the other.
 *
 * Only these two names are ever removed, and this tool already overwrites both
 * without asking, so the removal claims nothing new. Anything else in the
 * output directory is left alone.
 */
function writeExclusive(
  directory: string,
  outcome: keyof typeof CONTENT_ARTIFACTS,
  document: unknown,
): void {
  const other = outcome === "accepted" ? "rejected" : "accepted";
  rmSync(join(directory, CONTENT_ARTIFACTS[other]), { force: true });
  writeJson(join(directory, CONTENT_ARTIFACTS[outcome]), document);
}

/** The anchor-naming artifacts; a run writes both of them or neither. */
const ANCHOR_NAME_ARTIFACTS = [
  "anchor-names.json",
  "anchor-names.txt",
] as const;

/**
 * Removes the anchor-naming artifacts, for a run that proposes no names.
 *
 * The same bound `writeExclusive` relies on: only these two names are ever
 * removed, and a `--name-anchors` run already overwrites both without asking,
 * so the removal claims nothing new. Without it, names proposed by an earlier
 * run stood beside a later run that proposed none, and a reader following
 * `anchor-names.txt` would write ids this conversion no longer offers.
 */
function removeAnchorNames(directory: string): void {
  for (const name of ANCHOR_NAME_ARTIFACTS) {
    rmSync(join(directory, name), { force: true });
  }
}

function writeJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

export function run(argv: readonly string[]): number {
  const options = readOptions(argv);
  let unrewired = 0;
  if (options === null) {
    process.stdout.write(USAGE);
    return 64;
  }
  const proposal = propose({
    repositoryRoot: options.repositoryRoot,
    configPath: options.configPath,
    ledgerPath: options.ledgerPath,
  });

  // A site that is already converted cannot be converted again, and the check
  // belongs BEFORE the first write rather than beside the rewrite it protects.
  // Its values are contract reads now, not literals, so a second proposal finds
  // a fraction of them -- 92 of 286 on All Points Media -- and `--out` may
  // legitimately BE the content root, in which case writing the report first
  // overwrites the real contract with that fraction and only then refuses.
  if (options.rewire !== null) {
    const converted = join(
      options.repositoryRoot,
      proposal.contentRoot,
      CONTRACT_FILE,
    );
    if (existsSync(converted)) {
      process.stdout.write(
        `rewire: refused, because ${relative(options.repositoryRoot, converted)} ` +
          "already exists. This repository is converted: its values are contract " +
          "reads rather than literals, so a second pass would propose a fraction " +
          "of them and overwrite the contract with it. Convert from a checkout " +
          "that has not been converted.\n",
      );
      return 1;
    }
    // The runtime this run would write is fixed by now, and a site whose
    // installed contract package is older than the one it is verified against
    // would fail its own build on it. The converter never edits dependencies,
    // so this is said before anything is written, with the version to move to.
    const requirements = runtimeRequirementRefusals(
      options.repositoryRoot,
      runtimeModule(proposal, proposal.contentRoot).text,
    );
    if (requirements.length > 0) {
      process.stdout.write(
        "rewire: refused, the generated runtime would not build against this " +
          `repository's packages:\n  ${requirements.join("\n  ")}\n`,
      );
      return 1;
    }
  }

  mkdirSync(options.outputDirectory, { recursive: true });
  writeJson(
    join(options.outputDirectory, CONTRACT_FILE),
    proposal.contractDraft,
  );
  // Writing the sources is what makes this directory checkable on its own.
  writeJson(
    join(options.outputDirectory, "managed-site.sources.json"),
    sourceDocumentsFor(proposal.sourceDocuments),
  );
  // `managed-site.content.json` only ever holds a projection, and the two names
  // are mutually exclusive: the README says the rejection is written INSTEAD of
  // the content. The output directory is reused across runs, so writing one
  // without removing the other left a refused run standing beside the previous
  // run's content, and a consumer following the documented path would package
  // content this conversion refused. Removing the alternate is bounded to these
  // two names, both of which this tool already overwrites unconditionally, so
  // it reaches nothing a normal run does not already claim.
  writeExclusive(
    options.outputDirectory,
    proposal.content === null ? "rejected" : "accepted",
    proposal.content ?? proposal.contentDraft,
  );
  writeJson(join(options.outputDirectory, "needs-human.json"), proposal.report);
  writeFileSync(
    join(options.outputDirectory, "needs-human.txt"),
    renderReportText(proposal.report),
    "utf8",
  );
  if (options.writeSources) {
    for (const [path, document] of proposal.sourceDocuments) {
      writeJson(join(options.outputDirectory, "sources", path), document);
    }
  }
  if (!options.nameAnchors) removeAnchorNames(options.outputDirectory);
  // Fields this run replaced are a migration of production content, which the
  // platform accepts only with a declaration. Checked before any rewrite, so a
  // plan the evidence refuses stops the run before the repository changes.
  const migration = fieldMigrationOutcome(proposal, options.migration);
  for (const line of migration.lines) process.stdout.write(`${line}\n`);
  if (migration.sidecar === null) removeSidecar(options.outputDirectory);
  else writeFileSync(sidecarPath(options.outputDirectory), migration.sidecar, "utf8");
  if (options.rewire !== null) {
    // The SAME proposal that produced the contract drives the rewrite. Two
    // `propose` runs mean two ledgers, and a ledger mints the ids: doing this
    // as a separate pass emitted a read for an id the shipped contract did not
    // declare, and the site threw at build time. One run, one ledger, or the
    // rewrite is describing a contract nobody published.
    if (proposal.contract === null) {
      process.stdout.write(
        "rewire: refused, because the contract was. Rewritten code reads a " +
          "contract, and there is none to read.\n",
      );
      return 1;
    }
    const plan = planRewrite(proposal, options.rewire);
    unrewired = plan.unrewired;
    applyRewrite(plan, options.rewire);
    // Everything the rewritten code reads goes into the REPOSITORY, not just
    // the output directory: the edits are made in place, so a run that wrote
    // only the edits left the site importing a contract and documents that were
    // sitting in a report folder. It built here only because those files were
    // being copied across by hand, which is not a step anyone else would know
    // to take.
    writeJson(
      join(options.repositoryRoot, proposal.contentRoot, CONTRACT_FILE),
      proposal.contract,
    );
    const contentDirectory = join(options.repositoryRoot, proposal.contentRoot);
    if (migration.sidecar === null) removeSidecar(contentDirectory);
    else writeFileSync(sidecarPath(contentDirectory), migration.sidecar, "utf8");
    for (const [path, document] of proposal.sourceDocuments) {
      writeJson(join(options.repositoryRoot, path), document);
    }
    // The runtime the rewritten calls resolve to, written beside the content it
    // reads. Generated with the contract, from the same proposal, so a site
    // cannot end up with a runtime that imports a document the contract never
    // projected.
    const runtime = runtimeModule(proposal, proposal.contentRoot);
    // Parsed before it is written, for the same reason every rewritten file is:
    // this module is generated from a template, and a template can be wrong in
    // ways only a parser notices. A missing `)` in it reached a customer build
    // and was reported as a syntax error in generated code, which is the least
    // useful place for one to surface.
    const brokenRuntime = parseErrorsOf(runtime.path, runtime.text);
    if (brokenRuntime.length > 0) {
      process.stdout.write(
        `rewire: refused, the generated runtime would not parse:\n  ${brokenRuntime
          .slice(0, 3)
          .join("\n  ")}\n`,
      );
      return 1;
    }
    for (const target of [
      join(options.repositoryRoot, runtime.path),
      join(options.outputDirectory, "sources", runtime.path),
    ]) {
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, runtime.text, "utf8");
    }
    writeJson(join(options.outputDirectory, "rewire.json"), {
      rewritten: plan.rewritten,
      pagesAnnotated: plan.pagesAnnotated,
      edits: plan.edits.length,
      files: [...plan.filesTouched]
        .map((file) => relative(options.repositoryRoot, file))
        .sort(),
      unhandled: Object.fromEntries(
        [...plan.unhandled].sort((a, b) => b[1] - a[1]),
      ),
      refusals: plan.refusals,
      // The number worth failing a conversion on, so a caller reading this
      // file does not have to re-derive it from the refusals.
      unrewired: plan.unrewired,
    });
    process.stdout.write(
      `rewired ${String(plan.rewritten)} fields and ${String(plan.pagesAnnotated)} page roots ` +
        `in ${String(plan.filesTouched.size)} files\n`,
    );
    for (const [why, count] of [...plan.unhandled].sort(
      (a, b) => b[1] - a[1],
    )) {
      process.stdout.write(
        `  left alone: ${String(count).padStart(4)}  ${why}\n`,
      );
    }
    if (plan.unrewired > 0) {
      process.stdout.write(
        `  ${String(plan.unrewired)} of those are customer-editable, so this ` +
          "conversion is incomplete\n",
      );
    }
  }
  // Whether this run left the repository's anchors DIFFERENT from the ones it
  // resolved against. Only that makes the ledger it is holding stale; see the
  // save below.
  let anchorsChanged = false;
  if (options.nameAnchors) {
    const naming = nameAmbiguousAnchors(proposal.ambiguous, options.repositoryRoot, {
      outputDirectory: options.outputDirectory,
      // The ledger belongs in the repository -- it is what keeps a field's id
      // the same across conversions -- and it records the anchor every id was
      // minted for, so every name it holds reads as taken by the scan that
      // mints the next one. Excluded here rather than moved out of the tree.
      ledgerPath: options.ledgerPath,
    });
    writeJson(join(options.outputDirectory, "anchor-names.json"), naming);
    writeFileSync(
      join(options.outputDirectory, "anchor-names.txt"),
      `${naming.names.map(describeName).join("\n")}\n`,
      "utf8",
    );
    const applied = options.applyAnchorNames
      ? applyAnchorNames(naming.names)
      : null;
    process.stdout.write(
      `anchor names: ${naming.names.length} proposed, ${naming.findings.length} left to a person` +
        (applied === null
          ? "\n"
          : `, written into ${applied.files.length} files\n`),
    );
    for (const file of applied?.rejected ?? []) {
      process.stdout.write(
        `anchor names: NOT written, the edited file would not parse: ${file}\n`,
      );
    }
    // The edit is checked against what it promised, by re-reading the
    // repository rather than by trusting the analysis that produced it. A
    // duplicate id or a surviving ambiguity withdraws the whole edit.
    anchorsChanged = applied !== null && applied.files.length > 0;
    if (anchorsChanged && applied !== null) {
      const after = propose({
        repositoryRoot: options.repositoryRoot,
        configPath: options.configPath,
        ledgerPath: options.ledgerPath,
      });
      const broken = verifyAnchorNames(
        naming.names,
        after.ambiguous,
        options.repositoryRoot,
      );
      if (broken.length > 0) {
        revertAnchorNames(applied);
        // Put back as they were, so the anchors are the ones this run
        // resolved against after all, and the ledger it holds is current.
        anchorsChanged = false;
        for (const reason of broken) {
          process.stdout.write(`anchor names: WITHDRAWN, ${reason}\n`);
        }
        process.stdout.write(
          `anchor names: ${String(applied.files.length)} files put back as they were\n`,
        );
      }
    }
  }
  // A run that CHANGED the repository's anchors does not write the ledger.
  //
  // `save` keeps the anchors this run used and tombstones the rest, which is
  // right for a run that saw the site's final anchor set and wrong for one
  // that has just moved it: applying a name changes the anchor of the value it
  // names, so every anchor resolved here is stale the moment the ids are
  // written. Saving recorded the pre-naming anchors, dropped the post-naming
  // ones the NEXT pass needs, and tombstoned their ids so they could never
  // come back -- 182 of All Points Media's 366 fields were re-minted on a
  // second conversion for exactly this reason, with the ledger sitting right
  // there. The pass that follows resolves the post-naming anchors against the
  // ledger as it was, which is the set that lasts, and saves that.
  //
  // The condition is what this run DID, not what it was asked to do. Asking
  // for `--apply-anchors` and writing nothing -- no safe name to apply, every
  // edited file refused by the parser, or verification putting all of them
  // back -- leaves the anchors exactly as resolved, so this ledger is the
  // current one and withholding it loses every id the run minted. On a first
  // conversion that is the whole ledger.
  if (!anchorsChanged) proposal.ledger.save(options.ledgerPath);

  const report = proposal.report;
  process.stdout.write(
    `proposed ${report.proposedFieldCount} fields, ${report.proposedCollectionCount} collections, ` +
      `${report.proposedAssetCount} asset slots\n` +
      `needs human decision: ${report.findings.length}\n` +
      `contract validates: ${proposal.contract === null ? "no" : "yes"}\n` +
      `written to ${options.outputDirectory}\n`,
  );
  if (proposal.validationError !== null) {
    process.stdout.write(
      `validation: ${proposal.validationError}\n` +
        "content: withheld, nothing can project it. The values read are in " +
        "managed-site.content.rejected.json\n",
    );
  }
  // A rewrite that left a customer-editable field behind is a failed
  // conversion, whatever else succeeded: the contract says the customer may
  // edit it and the site does not render it that way. Reporting it in the
  // summary and exiting 0 made it a note rather than a gate.
  return proposal.contract === null ||
    report.findings.length > 0 ||
    unrewired > 0 ||
    migration.unresolved > 0
    ? 1
    : 0;
}

const invokedDirectly = process.argv[1]?.endsWith("cli.ts") === true;
if (invokedDirectly) process.exitCode = run(process.argv.slice(2));
