# Storage: SQLite + PostgreSQL duality

`@hasna/personalnotes` ships one storage contract with two interchangeable
backends. You choose the backend with environment variables — the code path is
identical (hasna-storage-standard).

## The contract

Every surface (CLI / MCP / HTTP API / SDK) talks to `NoteStorageContract`
(`@hasna/personalnotes/storage/contract`), never a concrete engine:

```ts
import { createNoteStorage } from "@hasna/personalnotes/storage";

const storage = await createNoteStorage(); // engine chosen from the environment
const note = await storage.createNote({ title: "Hello", body: "world" });
const page = await storage.listNotes({ status: "active", limit: 20 });
await storage.close();
```

## Choosing an engine (env)

All variables use the `HASNA_PERSONALNOTES_` prefix.

| Variable | Effect |
| --- | --- |
| _(none)_ | **local** — SQLite at `~/.hasna/personalnotes/personalnotes.db` |
| `HASNA_PERSONALNOTES_DB_PATH` | Override the SQLite file path |
| `HASNA_PERSONALNOTES_DATABASE_URL` | **self_hosted** — PostgreSQL DSN (server-side only: the serve/migrate binaries) |
| `HASNA_PERSONALNOTES_API_URL` + `_API_KEY` | Client routes over HTTP to a self_hosted/cloud server |
| `HASNA_PERSONALNOTES_STORAGE_MODE` | Force `local` \| `self_hosted` \| `cloud` |

Resolution order: `STORAGE_MODE` > `API_URL` > `DATABASE_URL` > local.

Clients (CLI/MCP/SDK) never hold a database URL; a remote mode without a
`DATABASE_URL` fails closed rather than silently falling back to a local
SQLite file (which would split-brain your data).

## Migrations

Both engines run **idempotent, ledgered** migrations:

- **SQLite** — `PRAGMA user_version` + a `personalnotes_schema_migrations`
  ledger; auto-migrates on open; refuses to open a database written by a newer
  binary.
- **PostgreSQL** — a ledger table guarded by a transaction-scoped
  `pg_advisory_xact_lock` so concurrent migrators serialize, with a per-migration
  sha256 checksum. Editing a released migration's SQL changes its checksum and
  the migrator refuses to run — append a new migration instead.

Dry-run the plan (used by `/ready` health checks):

```ts
const plan = await storage.migrate({ dryRun: true });
```

## Testing

```bash
bun test src                       # hermetic — no Postgres required
PERSONALNOTES_TEST_DATABASE_URL=postgres://user:pass@localhost:5432/postgres \
  bun test src/lib/storage/postgres-note-storage.test.ts   # live PG gate
```

The live gate must point at a **disposable** Postgres — it creates and drops a
throwaway database per run.
