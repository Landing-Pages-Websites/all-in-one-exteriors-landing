import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import process from "node:process";

import type { DeclaredRoute } from "./rendered-parity.js";
import {
  htmlUnder,
  parityHolds,
  renderedParity,
  renderParityText,
} from "./rendered-parity.js";

/**
 * The parity gate, as a command.
 *
 * A conversion is only as good as the proof that it changed nothing a reader
 * sees, and a proof nobody can run is not one. This takes the prerendered
 * output of the build before the conversion and of the build after it, and
 * exits non-zero on any difference it is not allowed to normalise away.
 */
const USAGE = `Usage: parity <before-dir> <after-dir> [options]

  <before-dir>   prerendered HTML from the build BEFORE the conversion
  <after-dir>    the same tree from the build after it

  --contract <path>   the proposed contract, so a DECLARED route that produced
                      no HTML is named and fails rather than passing unseen.
                      A route rendered on demand writes no file: fetch it from
                      a running build and drop it in both trees under the same
                      name.
  --css <a>,<b>       the two builds' stylesheet directories, compared as an
                      ordered sequence carrying at-rule context
`;

function walk(at: string): readonly string[] {
  return readdirSync(at).flatMap((entry) => {
    const full = join(at, entry);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

function flag(argv: readonly string[], name: string): string | null {
  const at = argv.indexOf(name);
  return at === -1 ? null : (argv[at + 1] ?? null);
}

function cssUnder(directory: string): readonly string[] {
  return walk(directory)
    .filter((file) => file.endsWith(".css"))
    .sort()
    .map((file) => readFileSync(file, "utf8"));
}

export function run(argv: readonly string[]): number {
  const [before, after] = argv.filter((one) => !one.startsWith("--"));
  if (before === undefined || after === undefined) {
    process.stdout.write(USAGE);
    return 2;
  }
  const contractPath = flag(argv, "--contract");
  const contract =
    contractPath === null
      ? null
      : (JSON.parse(readFileSync(contractPath, "utf8")) as {
          readonly pages: readonly { readonly route: DeclaredRoute }[];
        });
  const css = flag(argv, "--css")?.split(",") ?? null;
  // Required, not optional. Absent stylesheets compared to absent stylesheets
  // agree, so leaving it off turned the stylesheet half of this gate into a
  // silent pass -- the same shape as a check that never runs.
  if (css === null || css[0] === undefined || css[1] === undefined) {
    process.stdout.write(
      "parity: --css <before>,<after> is required. Without both stylesheet " +
        "directories this compares nothing and reports agreement.\n",
    );
    return 2;
  }
  const report = renderedParity({
    before: htmlUnder(before, walk),
    after: htmlUnder(after, walk),
    ...(contract === null
      ? {}
      : { declaredRoutes: contract.pages.map((page) => page.route) }),
    stylesheets: { before: cssUnder(css[0]), after: cssUnder(css[1]) },
  });
  process.stdout.write(renderParityText(report));
  return parityHolds(report) ? 0 : 1;
}

const invokedDirectly = process.argv[1]?.endsWith("parity-cli.ts") === true;
if (invokedDirectly) process.exitCode = run(process.argv.slice(2));
