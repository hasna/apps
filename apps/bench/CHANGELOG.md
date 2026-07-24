# Changelog

All notable changes to `@hasna/bench` are documented here.

## 0.0.3

- Fix: CLI `--version` reported a stale hardcoded value (`0.0.1`) that had
  drifted from `package.json`. `src/lib/version.ts` is now auto-generated from
  `package.json` by `scripts/sync-version.mjs`, run at the start of `build`
  (and therefore `prepublishOnly`), so the CLI-reported version can no longer
  drift from the published package version.

## 0.0.2

- Adopt `@hasna/contracts` payloads in open-bench (PR #1): contract adapters
  (`src/lib/contract-adapters.ts`), contract conformance examples under
  `examples/contracts/`, and supporting docs. Publishes the merged `main` line
  so npm matches `main`.

## 0.0.1

- Initial scaffold of the open-bench benchmark aggregator: CLI, SDK, and MCP
  foundation.
