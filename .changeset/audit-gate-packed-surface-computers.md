---
"@hasna/computers": patch
---

Fix the release-time audit gate (todos be6817f3): `verify:release` replaces the bare `bun audit` (which resolved against the MONOREPO lockfile from the member dir and reported every member's dependency closure) with the shared `tooling/ci/check-audit-packed.mjs` — pack the member, install the tarball into a scratch probe directory as a consumer would, and audit that shipped surface, propagating the exit code. `bun pm untrusted` is retained. The gate remains a check that can fail on the member's own shipped advisories.
