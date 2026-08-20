---
"@hasna/loops": patch
---

Fix the release supply-chain audit gate (todos be6817f3): `check:supply-chain:audit` no longer runs `bun audit && bun audit --production` from the member dir, which resolved against the MONOREPO lockfile and reported every member's dependency closure (`workspace:` / `workspace-transitive:` entries) — a never-passing gate that blocked every `@hasna/*` publish since the monorepo migration.

The gate now audits what the member actually SHIPS via the shared `tooling/ci/check-audit-packed.mjs`: pack the member, install the tarball into a scratch probe directory as a consumer would (`bun add <tarball>`), and run `bun audit` there, propagating its exit code. The gate remains a check that can fail — an advisory in the member's own shipped closure fails the audit at the member's own publish time. No blanket disable, no `--ignore` allowlist, no `--audit-level` lowering.

Known edge recorded in the script header: the probe resolves ranges at registry time, so the fleet 7-day `minimumReleaseAge` quarantine applies — a dependency publishing a brand-new version would fail the probe install closed (fail-closed, safe direction). Two-sided regression shipped in `tooling/ci/tests/standard/check-audit-packed.test.mjs`.
