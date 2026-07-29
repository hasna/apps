# Database

`@hasna/servers` stores servers, projects, agents, operations, traces, webhooks, webhook deliveries, and resource locks in SQLite through `bun:sqlite`.

## Path selection

The first matching rule wins:

1. An explicit path passed to the SDK's `getDatabase(path)` call, or `SERVERS_DB_PATH` set by `servers --db <path>` or the environment.
2. The nearest existing `.servers/servers.db`, searching cwd and each parent directory.
3. `<git-root>/.servers/servers.db` when `SERVERS_DB_SCOPE=project` and a git root can be found.
4. `$HOME/.hasna/servers/servers.db`, or `%USERPROFILE%/.hasna/servers/servers.db` when `HOME` is unavailable.

Nearest-project discovery only selects an existing database. To create a new project-scoped database at the git root, set `SERVERS_DB_SCOPE=project`, pass `--db .servers/servers.db`, or initialize that file through the SDK.

The parent directory is created automatically. `:memory:` and `file::memory:` paths skip directory creation.

## Initialization

The first database handle in a process enables:

- A 15-second SQLite busy timeout.
- WAL journal mode.
- Foreign-key enforcement.
- Ordered schema migrations recorded in `_migrations`.

Schema migration writes retry `SQLITE_BUSY` failures every 100 ms for up to 15 seconds. `getDatabase()` returns one process-global handle until `closeDatabase()` is called. Passing a different path while that handle is open does not switch databases; close it first.

## Concurrency and expiry

WAL mode allows readers and writers from multiple CLI/MCP processes. Server row locks expire after 30 minutes and are cleared before lock-sensitive server operations. General resource locks store their own expiration timestamp and are cleaned when lock APIs inspect or explicitly clean them.

The database is local state. `servers export` exports servers, agents, operations, traces, projects, and webhooks; it does not include webhook delivery logs, resource locks, or migration records. Import a compatible export with `servers import --input <path>`.
