/* eslint-disable @typescript-eslint/no-require-imports */
declare function require(specifier: string): { metadata: { robots: { index: boolean } } };

export function rewriteThroughRequire(): void {
  require("../app/required/page").metadata.robots.index = false;
}
