# Loops Identity Migration

The canonical identities are:

- Product: `Loops`
- Repository: `hasna/loops`
- Package: `@hasna/loops`
- CLI and MCP server: `loops`
- Coordination channel: `#loops`

New output must use those identities. Legacy identifiers are accepted only at
bounded read or migration boundaries; they are never the default for newly
created state.

## Compatibility ledger

| Surface | Canonical behavior | Compatibility boundary | Removal condition |
| --- | --- | --- | --- |
| SDK runtime owner | New bindings emit `@hasna/loops`. | Persisted bindings with `open-loops` remain type-safe inputs. | Remove the old input in the next major release after every supported state exporter emits the scoped package identity. |
| Migration bundles | Export `loops.migration/v1`. | Import accepts `open-loops.migration/v1` and verifies its hash before use. | Remove after one full major-release cycle with no legacy import evidence. |
| Tenant-backfill bundles | Documentation and fixtures use `loops.tenant-backfill/v1`. | The parser accepts `open-loops.tenant-backfill/v1`. | Remove only after every tenant cutover bundle has been regenerated and archived with the canonical schema. |
| Lifecycle markers | New comments emit `loops:triage=*`, `loops:planner=*`, and `loops:pr-handoff=*`. | Gate readers accept the corresponding `openloops:*` markers from existing tasks. | Remove after all active routed tasks and persisted workflow plans have canonical markers, no earlier than the next major release. |
| Worktree artifacts | New artifacts live under `.loops/`. | PR handoff reads the equivalent `.openloops/` path only when the canonical path is absent. | Remove after active task worktrees have been migrated or expired and one major release has elapsed. |
| PostgreSQL tenant context | Migration 0013 makes `loops_current_tenant_id()` available for a later client cutover. | This release writes both `loops.*` and `open_loops.*` request settings but keeps runtime SQL, defaults, and RLS policies on `open_loops_current_tenant_id()` so the same binary works before and after 0013. The canonical reader falls back to the legacy tenant setting. | Move runtime SQL, defaults, and policies only after all supported clients write canonical settings; remove the fallback after every live policy uses the canonical function. |
| PostgreSQL auth functions | Migration 0013 makes `loops_authenticate_key` and `loops_append_auth_audit` available for a later client cutover. | This release continues calling the released functions. Canonical wrappers delegate to them and are not the runtime default yet. | Move service calls and provider grants together; remove old functions only after all supported service binaries use the canonical wrappers. |
| PostgreSQL migration ledger | Migration 0013 exposes `loops_schema_migrations` as the canonical inspection and future-client read surface. | This release keeps migration, bootstrap, and transfer reads on the physical `open_loops_schema_migrations` table so it also supports a pre-0013 database. The view preserves rows, timestamps, and checksums exactly. | A physical-table cutover requires a transactional copy, bidirectional row/checksum equality, fresh-install and existing-upgrade proof, and every supported binary reading the canonical table. |
| Provider capability roles | No source-only rename is attempted. | Existing `open_loops_*` roles own objects and provider credential memberships. | A provider-owned cutover must prove `CREATEROLE`, object ownership, membership, credential rotation, rollback, and live postconditions before the old roles can be removed. |
| Infrastructure physical IDs | Existing stack, bucket, service, and private-domain identifiers are unchanged. | Those values identify live or rollback resources rather than product display branding. | Replace only in the owner-approved deployment cutover with resource mapping and rollback evidence. |
| Project path and slug | Source code uses Loops identities. | `.project.json` keeps the current slug and primary path until workspace cutover. | Change both fields atomically with the shared-checkout and Projects registry cutover. |

## Database upgrade and rollback

Migration `0013_loops_identity_aliases` is additive at the database-object
layer. It creates canonical views, functions, and a canonical tenant-update
guard without changing or deleting the released physical ledger, capability
roles, auth functions, request settings, legacy tenant-update guard, defaults,
or RLS policy expressions. Its postconditions prove the canonical ledger view
contains exactly the same rows and checksums as the physical ledger and that
both tenant-update guards remain installed.

The migration is intentionally forward-only at the application-binary layer.
The immediately preceding binary does not recognize the 0013 ledger row, and
its closed-world service-role probe does not allow the new view and function
grants. Therefore deploy and verify the Loops-compatible binary before applying
0013. A binary rollback to the preceding release is supported only before the
migration is applied.

After 0013 is recorded, recover by rolling forward to a compatible build. If a
database restore is unavoidable, restore a validated pre-0013 backup under a
maintenance window and reconcile all writes made after that backup. Never
delete the canonical aliases or remove only the
`0013_loops_identity_aliases` ledger row; doing so would make a
checksum-guarded database claim an applied migration while missing its objects.

## Historical provenance

Released migration files, migration checksums, changelog entries, dated audit
documents, Git commits, tags, releases, task history, and conversation history
are immutable evidence. They retain the names that were true when recorded.
