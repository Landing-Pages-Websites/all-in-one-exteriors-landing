/**
 * The reference site a conversion is proved against.
 *
 * It is deliberately NOT converted: the parity check builds it, converts a
 * copy, builds that, and refuses any difference a reader could see. A repository
 * whose only Next application is already a managed site cannot make that
 * comparison, which is why this one exists.
 *
 * `turbopack.root` is set because this app lives inside a workspace and
 * resolves `next` from the repository root: without it the build infers its own
 * directory as the root and cannot find the package it is being built by.
 *
 * @type {import("next").NextConfig}
 */
const nextConfig = {
  turbopack: { root: new URL("../..", import.meta.url).pathname },
  outputFileTracingRoot: new URL("../..", import.meta.url).pathname,
};

export default nextConfig;
