# Stage A storage-kit compatibility surface

This directory preserves the `@hasna/contracts` storage-kit 0.4.0 public type
and reflection contract. During Stage A it is intentionally inert: no function
creates a PostgreSQL pool, reads database configuration, executes SQL, runs a
migration, performs a health query, or accesses a provider. Capability methods
return the typed Stage A containment result before inspecting caller values.

Names such as `PoolQueryClient`, `Migration`, `sql`, and `ledgerTable` remain
only for source and declaration compatibility. They do not grant runtime
database capability. Re-vendoring the operational contracts kit is not a Stage
A enablement path and would violate containment.

The repository build regenerates `.storage-kit-manifest.json`, and
`scripts/verify-generated-artifacts.mjs` verifies that inner manifest plus the
exact outer `src/generated` inventory. The published package ships only the
contained declarations and bundles recorded in `generated-artifacts.json`.
