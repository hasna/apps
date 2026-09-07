# Shared machine registry and migration

`todos machines` now uses the same authenticated API as task commands. Saved account credentials work for CLI and MCP machine operations. Starting an MCP server is read-only: it does not register a machine or open SQLite merely to start an inactive shadow worker.

The new server exposes `GET /v1/machines` (capability version 1 and the complete registry) and `POST /v1/machines` (register, heartbeat, set-primary, archive, unarchive, delete, import). Writes require the existing `todos:write` scope. The existing server is a single configured corpus: machine records use its PostgreSQL service namespace. New machine routes/imports require a key tenant matching `HASNA_TODOS_TENANT_ID` (default `default`); legacy untenanted keys are accepted only in that default corpus. A mismatched tenant is denied before registry access. This is not a claim that all existing task routes are tenant-isolated: the pre-existing task adapter is cached globally and ignores principal tenant IDs. A multi-tenant host needs a separately reviewed tenant-aware adapter for every resource before serving independent accounts. Mutations require a same-connection transaction and serialize with a service-scoped registry lock. This uses the existing JSON record table; no numbered SQL migration is required.

Upgrade the server before migrating. API 0.15.51 does not advertise this capability. CLI/MCP and generated SDK machine imports fail before posting when it is absent. Installing a new client alone does not migrate or delete local data.

## Preserving the original records

The storage snapshot now includes `machines`, alongside existing task `machine_id` and project-machine-path relationships. SQLite export retains ID, name, hostname, platform, SSH address, metadata, created/last-seen timestamps, primary flag and archive timestamp. Malformed or unrepresentable metadata is an error, not an empty object. Unknown future columns represented in an input machine record are rejected instead of discarded.

For a machine-only migration, export a snapshot through the explicit storage library using an existing read-only SQLite handle, preserve that snapshot, then run:

```sh
todos machines import /path/to/preserved-snapshot.json --json
todos machines --all --json
```

This command imports only the snapshot's `machines` array. It does not claim to import other tables. Full snapshots can use the updated SDK `importSnapshot`; the SDK checks machine capability first. Full-snapshot imports retain the existing per-record receipt model: any returned errors mean the complete snapshot has not been migrated. Verify all counts and readback before retiring any source file. This patch performs no automatic station migration, checkpoint, database deletion or installation.

A replay with exactly identical records is skipped. A changed same-ID record, a name already assigned to a different ID, multiple primaries, an archived primary, or a retired identity fails the machine batch without applying its valid prefix. Resolve conflicts explicitly; the importer never replaces one station's identity with another's. Machine tombstones cannot bypass lifecycle rules through a generic snapshot import. The legacy low-level sync pull fails explicitly if it encounters retired machine tombstones it cannot represent safely.

Registration and heartbeat preserve existing IDs and creation timestamps. Omitted metadata fields preserve their values; a client does not overwrite another named machine with its own hostname. Supply workstation metadata explicitly. `--id` supports a stable creation identity. Archive refuses primary machines and machines with active tasks. Delete also refuses existing record references; retired IDs remain reserved. The existing JSON store has no foreign keys, so operators must quiesce concurrent legacy writers before retirement; this patch does not retrofit every task/project writer with registry locking.

## Changed SSH commands and remaining boundaries

On API clients, `machines tasks <name>` reads shared tasks attributed to that machine. `machines sync` reads the authoritative shared registry and explicitly reports that no transfer occurred. The old `--ssh`/`--push` bridge flags are rejected before I/O; they are not silently ignored. Explicit local-library compatibility retains its historical bridge behavior.

Topology/status reports use shared machine metadata and last-seen timestamps. They do not claim that remote filesystem paths or network connectivity were checked.

The implicit SQLite singleton now refuses access unless the existing deliberate local-storage opt-in selects it. Explicit storage paths/handles remain supported for fixtures and deliberate migration/library use. This prevents an unconverted MCP or UI branch from silently creating a `.db` while using the API. It does not make those remaining local-only tools functional over HTTP: they still require separate API implementations before Todos can be declared fully migrated. Keep original databases until that broader command audit and actual deployment/readback are complete.
