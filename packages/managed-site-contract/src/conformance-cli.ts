#!/usr/bin/env node

import { readManagedSiteConformanceFile } from "./conformance-cli-files.js";
import { runManagedSiteConformanceCli } from "./conformance-cli-runner.js";

const exitCode = runManagedSiteConformanceCli(process.argv.slice(2), {
  readUtf8File: readManagedSiteConformanceFile,
  writeStdout(value) {
    process.stdout.write(value);
  },
  writeStderr(value) {
    process.stderr.write(value);
  },
});

process.exitCode = exitCode;
