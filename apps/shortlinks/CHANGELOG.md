# Changelog

## 0.2.10

### Patch Changes

- fix: make the shortlinks tarball publish-guard-clean and align the contracts pin. README and the Cloudflare example config no longer reference the internal `shortlinks.hasna.xyz` domain (packed content must carry no `.hasna.xyz` strings per the repo publish guard); the `@hasna/contracts` devDependency is pinned to the published `0.13.1` (the registry `0.13.3` carries the unsatisfiable peer `@hasna/secrets@0.3.4`, and the manifest/kitVersion already declare 0.13.1), with the root lockfile regenerated.

## 0.2.9

### Patch Changes

- d7d615b: Pin @hasna/contracts to the published 0.13.1 (was ^0.13.0; 0.13.0 is unpublished, which makes the standard-suite conformance validator cannot-run) and align hasna.contract.json kitVersion to the declared contracts kit 0.13.1. Todos d175d558.

## 0.2.8

### Patch Changes

- b5e05fd: CLI output projects signed capability destination URLs (S3/GCS presigned, CloudFront signed) to their plain unsigned reference — capability query parameters are stripped before any output surface (human, JSON, verbose, resolve, stats). Incident 716957 / todos b03cc058: a stored destination that was itself a presigned read URL was previously emitted verbatim into CLI output and reproduced in session transcripts, granting bearer read access until expiry.

## Unreleased

- ci: run install, typecheck, build, and tests for pull requests and pushes to
  `main`.

## 0.2.7

- feat(cli): compact human output by default across shortlinks-owned
  list/detail/status/setup commands (`link list/get`, `domain list/get/setup`,
  `stats`, `doctor`, `config show`, `cloudflare`, `local`). Long URLs/text are
  truncated, human rows are capped, and each command prints the next command to
  use for details. Machine output is unchanged: `--json` still returns full
  objects; `--verbose` prints the full object for human debugging; `--limit`
  controls row caps.
- feat(cli): bound external `domains` passthrough output (`domain check/buy`)
  by default; `--verbose`/`--json` still expose the full command output.
- feat(events): replace the generic `@hasna/events` command registration with
  shortlinks-owned compact wrappers so `events list` and `webhooks list` are
  capped by default (part of the fleet-wide compact-CLI-output initiative).
- test(cli): make the CLI test harness hermetic — neutralize any ambient cloud
  client-flip (`HASNA_SHORTLINKS_MODE`/`STORAGE_MODE` + `API_URL` + `API_KEY`)
  so `bun test` always exercises the on-box LocalStore and never touches the
  real shortlinks cloud API on a self_hosted-configured machine.

## 0.2.6

- chore(reconcile): reconcile `main` to the published npm line. `main` had
  fallen 7 commits behind the published release tag `npm/shortlinks/v0.2.5`
  (npm dist-tag `latest` = 0.2.5); the deployed/published code was never merged
  back to `main`. `main` was a strict ancestor of the tag (0 commits ahead), so
  the published work (`5003522`..`bdf5556`) was merged back non-destructively —
  no `main` commits lost, no force-push. Version bumped above the published
  line (published tag's package.json read 0.2.4 vs dist-tag 0.2.5 — a
  bump-vs-tag mismatch upstream; skipping 0.2.5 to avoid reuse).

## 0.2.1

- fix(mcp): remove the unpublished `@hasna/mcp-harness` (`file:../open-mcp`)
  dependency that made `shortlinks-mcp` unstartable on a fresh install. The MCP
  HTTP transport is now self-contained (published `@modelcontextprotocol/sdk` +
  Bun.serve), matching the reference apps.
- feat(domains): add domain deletion end-to-end — `shortlinks domain remove`
  CLI command, `delete_domain` MCP tool, `Store.deleteDomain`, and
  `DELETE /v1/domains/:hostname` API endpoint (cascades links + clicks).
  Requires an ECS redeploy of the self-hosted server for the new route.
- chore(deps): depend on the published `@hasna/contracts` instead of a `file:`
  link so `bun install` / `npm i` resolve cleanly.

## 0.1.0

- Initial CLI-only shortlinks package.
