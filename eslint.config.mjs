import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Workspace package build output is verified by its source type-check.
    "packages/**/dist/**",
    // Astro emits framework-owned declarations during check/build.
    "**/.astro/**",
    // `.next/**` above is root-relative, and the parity reference builds its
    // own. Lint runs after that build, so without this the run reports
    // thousands of problems in bundler output.
    "**/.next/**",
    // The work tree the parity check converts into, removed when it finishes.
    "fixtures/.parity-work/**",
    // Conversion-proposer fixtures are deliberately unconverted sample sites.
    "packages/managed-site-conversion/test/fixtures/**",
  ]),
]);

export default eslintConfig;
