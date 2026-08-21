# @hasna/computers

## 0.1.2

### Patch Changes

- Fix the release-time audit gate (todos be6817f3) regression found by the publish-all live test: `VERSION` is derived from `package.json` at build time instead of a hardcoded constant, so `computers --version`, the help header, and the server `/version` endpoint always report the packaged version. Adds a regression test asserting the CLI version surface matches the package version.

## 0.1.1

### Patch Changes

- c853fa5: Fix the release-time audit gate (todos be6817f3): `verify:release` replaces the bare `bun audit` (which resolved against the MONOREPO lockfile from the member dir and reported every member's dependency closure) with the shared `tooling/ci/check-audit-packed.mjs` — pack the member, install the tarball into a scratch probe directory as a consumer would, and audit that shipped surface, propagating the exit code. `bun pm untrusted` is retained. The gate remains a check that can fail on the member's own shipped advisories.
