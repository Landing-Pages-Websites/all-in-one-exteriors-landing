/**
 * A dynamic route is one file serving many URLs, and the contract addresses
 * pages by concrete route. Emitting `/blog/[slug]` puts a string that is not a
 * URL where a URL belongs, which the contract's route rule rejects outright --
 * so before this, one templated route failed the entire proposal rather than
 * just itself.
 *
 * Which URLs a template serves is not readable from the source. The data behind
 * it decides, and on a real site most of it belongs in a collection rather than
 * as pages at all, so this is reported for a person instead of guessed.
 */
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";

import { propose } from "../src/propose.js";

/** Distinct per route: two components sharing a name anchor to neither. */
function componentNameFor(route: string): string {
  const cleaned = route.replace(/[^A-Za-z0-9]/gu, "") || "Root";
  return `Page${cleaned.charAt(0).toUpperCase()}${cleaned.slice(1)}`;
}

function repoWithRoutes(routes: readonly string[]): string {
  const root = mkdtempSync(join(tmpdir(), "dynamic-routes-"));
  for (const route of routes) {
    const file = join(root, "app", route, "page.tsx");
    mkdirSync(dirname(file), { recursive: true });
    // Real rendered text and literal metadata, so the route actually reaches
    // the contract. With a trivial page no field is proposed, no page is
    // emitted, the contract is null, and an assertion that no template reached
    // it passes for the wrong reason.
    const heading = `Heading for ${route}`;
    writeFileSync(
      file,
      `export const metadata = {\n` +
        `  title: "Title for ${route}",\n` +
        `  description: "Description for ${route}",\n` +
        `};\n\n` +
        `export default function ${componentNameFor(route)}() {\n` +
        `  return <h1>${heading}</h1>;\n}\n`,
    );
  }
  return root;
}

/**
 * A contract is only emitted when every scanned page has SEO input, so a config
 * is required to see one at all. Declaring exactly the static routes is also the
 * point: a template has no canonical URL to declare, so excluding it is what
 * makes the page set completable.
 */
function configFor(root: string, staticRoutes: readonly string[]): string {
  const path = join(root, "site.conversion.json");
  writeFileSync(
    path,
    JSON.stringify({
      bridge: {
        version: "v10",
        src: "https://app.gomega.ai/review-bridge/v10/review-bridge.js",
        integrity:
          "sha384-/+5J7l1l8JNgnIgvgOqEHDgx92NrGmbjezpRb/MZb2y0RildsCcaOVu8+mLZbrmF",
        crossOrigin: "anonymous",
        load: "head_defer",
      },
      businessIdentity: {
        legalName: "Example Holdings Ltd",
        displayName: "Example",
        telephone: "+15555550100",
        email: "hello@example.com",
        description: "What the business does, in one sentence.",
        sameAs: ["https://www.example.com/"],
      },
      pages: Object.fromEntries(
        staticRoutes.map((route) => [
          route,
          {
            purpose: route === "/" ? "home" : "other",
            canonical: `https://www.example.com${route === "/" ? "/" : route}`,
            sitemap: { included: true, changeFrequency: "monthly", priority: 1 },
            performanceBudget: {
              maxLcpMilliseconds: 2500,
              maxCls: 0.1,
              maxInpMilliseconds: 200,
              maxPageBytes: 2097152,
            },
          },
        ]),
      ),
    }),
  );
  return path;
}

function proposeFrom(root: string, staticRoutes?: readonly string[]) {
  return propose({
    repositoryRoot: root,
    configPath: staticRoutes === undefined ? null : configFor(root, staticRoutes),
    ledgerPath: join(root, ".out", "idmap.json"),
  });
}

function contractRoutes(proposal: ReturnType<typeof proposeFrom>): string[] {
  const contract = proposal.contract as {
    readonly pages?: readonly { readonly route?: { readonly path?: string } }[];
  };
  return (contract.pages ?? [])
    .map((page) => page.route?.path ?? "")
    .sort();
}

function dynamicFindings(report: ReturnType<typeof proposeFrom>) {
  return report.report.findings.filter(
    (finding) => finding.code === "DYNAMIC_ROUTE_NOT_A_PAGE",
  );
}

describe("templated routes are reported, never emitted as pages", () => {
  it("reports every shape of dynamic segment", () => {
    const root = repoWithRoutes([
      ".",
      "blog/[slug]",
      "docs/[...path]",
      "shop/[[...filters]]",
    ]);

    const findings = dynamicFindings(proposeFrom(root));

    assert.deepEqual(
      findings.map((finding) => finding.evidence).sort(),
      [
        "route /blog/[slug] is a template, not a URL",
        "route /docs/[...path] is a template, not a URL",
        "route /shop/[[...filters]] is a template, not a URL",
      ],
    );
  });

  /**
   * The static half of a mixed repository must still produce a proposal. Before,
   * a single templated route took the whole run down with it.
   */
  it("keeps proposing the static routes beside them", () => {
    const root = repoWithRoutes([".", "about", "blog/[slug]"]);

    const proposal = proposeFrom(root, ["/", "/about"]);

    assert.equal(dynamicFindings(proposal).length, 1);
    // The static routes are emitted as pages, and the template is not one of
    // them. Asserting the whole set, because asserting only the template's
    // absence passes on an empty contract.
    assert.deepEqual(contractRoutes(proposal), ["/", "/about"]);
  });

  it("leaves a repository of only static routes unreported", () => {
    const root = repoWithRoutes([".", "about", "contact"]);

    assert.deepEqual(dynamicFindings(proposeFrom(root)), []);
  });

  /**
   * Route groups are transparent to the URL, so a grouped static route is not a
   * template and must not be swept up with them.
   */
  it("does not mistake a route group for a template", () => {
    const root = repoWithRoutes([".", "(marketing)/pricing"]);

    assert.deepEqual(dynamicFindings(proposeFrom(root)), []);
  });
});
