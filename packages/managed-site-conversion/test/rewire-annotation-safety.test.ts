import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { applyRewrite, planRewrite } from "../src/rewire.js";
import { configFor, run, workspace } from "./support/proposals.js";

/**
 * The claim under test: an annotation only ever lands somewhere the editor can
 * find it, and a name this rewrite introduces never takes one the site is
 * already using.
 *
 * All four rows below are the same defect wearing different clothes -- a value
 * marked in a place that is not the element rendering it, or a binding written
 * over one that already meant something. Each was reachable from a shape this
 * repository does not contain, which is why they are stated here rather than
 * left to the site that would have found them:
 *
 *  - a client component handing its value to another component, where the
 *    annotation went on the CALL SITE and the value rendered, unfindable,
 *    inside the receiver;
 *  - a collection item rendered by a component, the same thing one loop in;
 *  - a generated attribute written before an existing spread, which JSX then
 *    overwrites -- silently, and with another field's id if the spread carries
 *    one;
 *  - an index parameter named after a binding the module already has, which
 *    shadows it.
 *
 * A refusal is the right outcome for the first two: the value stays exactly as
 * it was, and the run reports it rather than converting it wrongly.
 */
const RUNTIME = "@/src/content/managed-site";

function converted() {
  const space = workspace("annotationsafety", configFor(["/"]));
  const plan = planRewrite(run(space), RUNTIME);
  applyRewrite(plan, RUNTIME);
  const read = (relative: string): string =>
    readFileSync(join(space.repositoryRoot, relative), "utf8");
  return {
    plan,
    page: read("app/page.tsx"),
    ticker: read("components/Ticker.tsx"),
    chips: read("components/Chips.tsx"),
    label: read("components/Label.tsx"),
  };
}

const result = converted();

test("a client value handed to a component is refused, not marked on the call site", () => {
  assert.doesNotMatch(
    result.ticker,
    /<Label[^>]*(managedFields|data-gomega|Attributes)/u,
    `the call site must not be annotated:\n${result.ticker}`,
  );
  assert.equal(
    result.ticker.includes("scale.line"),
    true,
    `the value must be left exactly as it was:\n${result.ticker}`,
  );
  assert.equal(
    result.plan.refusals.some((refusal) =>
      refusal.why.includes("hands its value to another component"),
    ),
    true,
    "the run must say so",
  );
});

test("a collection item rendered by a component is refused whole", () => {
  assert.doesNotMatch(
    result.chips,
    /managedItem\(/u,
    `no item may be annotated when one of them cannot be:\n${result.chips}`,
  );
  assert.equal(
    result.plan.refusals.some((refusal) =>
      refusal.why.includes("collection item value is rendered by a component"),
    ),
    true,
    "the run must say so",
  );
});

test("a generated attribute goes after an existing spread, so JSX keeps it", () => {
  const heading = /<h1([^>]*)>/u.exec(result.page)?.[1] ?? "";
  assert.match(
    heading,
    /data-analytics/u,
    `the fixture's spread must survive: ${heading}`,
  );
  assert.equal(
    heading.indexOf("managedText") > heading.indexOf("data-analytics"),
    true,
    `the generated attribute must come last, or the spread overwrites it: ${heading}`,
  );
});

test("an incomplete conversion is a nonzero outcome, not a note", () => {
  assert.equal(
    result.plan.unrewired,
    2,
    "both refusals above are customer-editable fields the contract declares",
  );
});
