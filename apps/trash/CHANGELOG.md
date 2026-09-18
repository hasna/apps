# @hasna/trash

## 0.1.1

### Patch Changes

- Verify payload integrity before restore and eviction, serialize entry mutations, and retain files when capture fails even with force or legacy exclusions.
- Default retention to 90 days; add station and agent provenance, bounded verified capsules, PostgreSQL metadata, signed station authorization, recovery leases, and protected Backup handoff.
- Bound list responses and use scoped cursor pagination and durable idempotency for retryable mutations.
- Repair executable package entrypoints and expose package identity for agent hooks.

## 0.1.0

### Minor Changes

- 232ec1b: Bootstrap @hasna/trash as a new hasna/apps member (generated from tooling/member-scaffold):

  - Four surfaces: `trash` CLI bin, `trash-mcp` bin, `trash-serve` bin, `./sdk` export.
  - hasna.contract.json at contracts kit 0.11.1 (schema hasna.service_contract.v1).
  - tsconfig extending tsconfig.base.json; contract:check + verify gates wired.
