#!/usr/bin/env node
/**
 * Prove a conversion changes nothing a reader can see, end to end.
 *
 * Build the reference site, convert a COPY of it, build that, and compare the
 * two sets of prerendered HTML and stylesheets. Every defect this tool has had
 * was caught by exactly this loop run by hand against a customer site --
 * whitespace eaten between words, an HTML entity rendered literally, a fragment
 * replaced by a wrapper, a span reported as deleted. Run by CI it catches the
 * next one before a customer's repository does.
 *
 * The reference site contains only shapes the rewriter HANDLES, formatted text
 * blocks among them. A documented refusal -- a rich-text list, a link, a value
 * split across text nodes -- would leave
 * a customer-editable field unconverted and make this gate unpassable by
 * design, which would teach whoever meets it to ignore the gate rather than
 * the shape.
 *
 * The copy is made inside the repository rather than in a temporary directory
 * because the converted code imports the contract package, which resolves by
 * walking up to the workspace root. A copy outside the tree cannot find it.
 */
import { execFileSync } from "node:child_process";
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const reference = join(root, "fixtures", "next-unconverted");
const work = join(root, "fixtures", ".parity-work");
const conversion = join(root, "packages", "managed-site-conversion");

function run(command, args, cwd) {
  execFileSync(command, args, { cwd, stdio: "inherit" });
}

/**
 * The conversion commands, whose exit code says something else.
 *
 * `propose` exits non-zero whenever its report carries findings, and a real
 * site always has some -- this fixture's are a component's bound props and a
 * collection whose item count is policy. Treating that as failure would make
 * the gate impossible to pass; what it actually asserts is below, on the
 * proposal it wrote.
 */
function convert(args, cwd) {
  try {
    execFileSync("npx", args, { cwd, stdio: "inherit" });
  } catch (error) {
    if (typeof error.status !== "number") throw error;
  }
}

/**
 * The prerendered HTML and the stylesheets a build wrote, copied out.
 *
 * Stylesheets are found by extension rather than by directory: Next 14 writes
 * them to `static/css`, Next 16 to `static/chunks`, and a hard-coded directory
 * is a check that silently stops running when the bundler moves them.
 */
function capture(from, into) {
  mkdirSync(into, { recursive: true });
  cpSync(join(from, ".next", "server", "app"), join(into, "app"), {
    recursive: true,
    filter: (path) => statSync(path).isDirectory() || path.endsWith(".html"),
  });
  const styles = join(into, "css");
  mkdirSync(styles, { recursive: true });
  const walk = (at) => {
    for (const entry of readdirSync(at)) {
      const full = join(at, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (entry.endsWith(".css")) cpSync(full, join(styles, entry));
    }
  };
  walk(join(from, ".next", "static"));
  if (readdirSync(styles).length === 0) {
    throw new Error(`no stylesheet was built under ${from}; nothing to compare`);
  }
}

const captures = mkdtempSync(join(tmpdir(), "managed-site-parity-"));

process.stdout.write("building the reference site\n");
run("npx", ["next", "build"], reference);
capture(reference, join(captures, "before"));

process.stdout.write("\nconverting a copy of it\n");
rmSync(work, { recursive: true, force: true });
cpSync(reference, work, {
  recursive: true,
  filter: (path) => !path.includes("node_modules") && !path.includes(`${".next"}`),
});
const proposal = join(captures, "proposal");
// Anchors first, exactly as the runbook orders it: the rewrite reads a site
// whose elements already have durable names.
convert(["tsx", "src/cli.ts", "--repo", work, "--out", join(proposal, "anchors"),
  "--config", join(work, "conversion.json"), "--apply-anchors"], conversion);
convert(["tsx", "src/cli.ts", "--repo", work, "--out", join(proposal, "rewire"),
  "--config", join(work, "conversion.json"), "--write-sources",
  "--rewire", "@/src/content/managed-site"], conversion);

// What the conversion itself has to have achieved, as distinct from what it
// reported: a contract, and no customer-editable field left behind. A field the
// contract hands to the customer and the site does not render that way is a
// failed conversion however identical the pages are.
const rewire = JSON.parse(
  readFileSync(join(proposal, "rewire", "rewire.json"), "utf8"),
);
process.stdout.write(
  `\nrewrote ${String(rewire.rewritten)} fields, ${String(rewire.unrewired ?? 0)} customer-editable left behind\n`,
);
if ((rewire.unrewired ?? 0) > 0) {
  process.stdout.write("parity: the conversion is incomplete, so parity says nothing\n");
  rmSync(work, { recursive: true, force: true });
  process.exit(1);
}

process.stdout.write("\nbuilding the converted copy\n");
run("npx", ["next", "build"], work);
capture(work, join(captures, "after"));

process.stdout.write("\ncomparing what the two builds rendered\n");
try {
  run("npx", ["tsx", "src/parity-cli.ts",
    join(captures, "before", "app"), join(captures, "after", "app"),
    "--contract", join(proposal, "rewire", "managed-site.contract.json"),
    "--css", `${join(captures, "before", "css")},${join(captures, "after", "css")}`,
  ], conversion);
} finally {
  rmSync(work, { recursive: true, force: true });
}
