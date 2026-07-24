# Changelog

All notable changes to `@hasna/personalnotes` (the Personal Notes OSS core) are
documented here. This project adheres to [Semantic Versioning](https://semver.org/).

## 0.1.0

### Added

- **Contracts adoption.** Introduced `hasna.contract.json`
  (`hasna.service_contract.v1`, `kitVersion` 0.5.2) declaring the OSS core as a
  `class: service` repo: the four surfaces (CLI `personalnotes`, MCP
  `personalnotes-mcp`, HTTP API `personalnotes-serve`, and the generated `./sdk`
  export), `deploymentModes` `local | self-hosted | cloud`, the `user-hosted` and
  `hasna-saas` hosting stories, and the dual SQLite/Postgres storage capability
  matrix with the `HASNA_PERSONALNOTES_` env prefix.
- **Conformance gate.** Added `scripts/check-contract-conformance.mjs`
  (`bun run check:contracts`) running `@hasna/contracts`' `runRepoConformance`, plus
  `scripts/check-contract-conformance.test.mjs` covering schema validity, the
  four-surface + storage-capability + hosting declarations, the public-manifest
  no-infra-leak rule, and the strict-schema negative cases.
- **CI.** Added `.github/workflows/contracts.yml` to run `check:contracts` and the
  contract tests on every push and pull request.
- Introduced the root `package.json` (`@hasna/personalnotes`) required to run the
  conformance gate and wire the surface bins.

### Notes

- `hosting`, `storage.engines`, and per-surface `kind` (including `sdk`) are recorded
  under `metadata` because the `@hasna/contracts` 0.5.2 schema is strict and does not
  yet host them as first-class fields. They move to top-level fields once the
  `hasna-contracts-gap-spec` schema vNext ships.
- No private-tier infrastructure references (secret refs, `*.hasna.xyz` hosts, ARNs,
  or account ids) appear in the public manifest; storage is expressed via `engines[]`
  + `envPrefix` only.
