# Vendored Fast URI entrypoint

This is the runtime source of `fast-uri@3.1.3` (BSD-3-Clause), copied from the
official npm package and carrying the literal-backslash authority fix tracked
in `patches/fast-uri@3.1.3.patch`. The package version predates the repository's
seven-day Bun release-age threshold.

The bundle configuration aliases bare `fast-uri` imports to this entrypoint.
That keeps the security fix inside every shipped Contacts runtime bundle without
publishing Bun's root-only `patchedDependencies` metadata to consumers.

Upstream: <https://github.com/fastify/fast-uri/tree/v3.1.3>
