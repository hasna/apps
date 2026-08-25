---
"@hasna/contracts": patch
---

Kit `MigrationLedger` gains an opt-in `acknowledgedLegacyIds` option (todos O15-00671): applied ledger rows the build explicitly acknowledges as non-reproducible history pass the downgrade guard, are never checksum-compared (their SQL no longer exists), and are never re-applied. Any other unknown applied row still fails the downgrade guard, and every declared migration keeps its checksum bind. Unblocks `domains db migrate` against a prod ledger carrying an out-of-band legacy row from the 2026-07 cutover.
