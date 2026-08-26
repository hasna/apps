# CLI reference

The `catalog` binary reads and writes the local SQLite application read model.
Commands that open a database create its parent directory and schema when
needed.

## Global command

```text
catalog [options] [command]
```

`--help` prints help and `--version` prints the version embedded in the
binary.

## `catalog seed`

Scan the immediate child directories of an open-source checkout root and
upsert the resulting `hasna.app.v1` records.

```text
catalog seed [options]

--root <dir>             checkout directory
--db <path>              SQLite database path
--fixture <path>         also write seeded records as JSONL
--duplicates <path>      JSON alias-to-canonical folder map
--seeded-from <label>    provenance label for produced records
--no-projects-join       do not query the projects registry
--json                   print the complete seed report as JSON
```

The root defaults to `CATALOG_OPENSOURCE_ROOT`, then
`~/workspace/hasna/opensource`. Unless `--no-projects-join` is supplied, the
command makes a best-effort `projects list --json` lookup and joins records by
exact checkout path. A failed or malformed lookup is treated as no project
records.

The scanner considers direct child directories only. It requires an `open-`
folder name, a `.git` entry, a valid lowercase dashed app id, and a
`package.json` with a package name. It skips recognized worktree and duplicate
checkout patterns, then deduplicates remaining records by npm package name.
See [data model and seeding](data-model.md#seeding).

`--fixture` creates parent directories and overwrites the target with the
records from that scan. Keep real inventory outside this repository.
`--seeded-from` defaults to `scan`.

Without `--json`, the command prints scanned, seeded, joined, and skipped
counts followed by each skip reason. With `--json`, it prints the full
`SeedReport`.

## `catalog import`

```text
catalog import [options] <file>

<file>       JSONL file containing hasna.app.v1 records
--db <path>  SQLite database path
```

Blank lines are ignored. Every nonblank line is parsed as JSON and validated;
valid records are upserted by `appId`. The command prints the imported count.
An invalid line aborts the import transaction.

The packaged `fixtures/apps.seed.jsonl` file is a synthetic example, not live
inventory.

## `catalog list`

```text
catalog list [options]

--db <path>                   SQLite database path
--lifecycle <lifecycle>       active|stub|deprecated|archived
--channel <channel>           stable|beta|canary|internal
--limit <n>                   maximum apps to return
--json                        print a JSON array
```

Results are ordered by `appId`. The store defaults to 500 rows and clamps the
limit to 1–1000. Without `--json`, each row contains the app id, npm name,
optional version, and lifecycle. An empty result prints `No apps found.`.

## `catalog get`

```text
catalog get [options] <appId>

<appId>      lowercase dashed app id
--db <path>  SQLite database path
```

Prints the complete application record as JSON. A missing app exits through
Commander with `app not found: <appId>`.

## `catalog search`

```text
catalog search [options] <query>

<query>          case-insensitive search text
--db <path>      SQLite database path
--limit <n>      maximum apps to return
--json           print a JSON array
```

Search covers app id, npm name, summary, and tags. Literal `%` and `_`
characters are removed from the query before the SQLite `LIKE` search. Results
are ordered by `appId`; the default is 50 and the store clamps the limit to
1–500. Human-readable output matches `catalog list`.

## `catalog site`

```text
catalog site [options]

--db <path>     SQLite database path
--out <dir>     output directory (default: dist-site)
--name <name>   site title (default: Hasna App Catalog)
```

Reads up to 1000 apps and writes `<out>/index.html` plus
`<out>/apps/<appId>/index.html` for each app. Existing files at those paths are
overwritten; unrelated files in the output directory are not removed. The
generated pages link to npm and GitHub and show `bun add -g <npmName>`.

## `catalog serve`

```text
catalog serve [options]

--db <path>      SQLite database path
--host <host>    bind host
--port <port>    bind port
```

The host defaults to `CATALOG_HOST`, then `127.0.0.1`. The port defaults to
`CATALOG_PORT`, then `8797`. This server has no authentication; read the
[HTTP API security note](http-api.md#security) before changing the host.

## Environment variables

| Variable | Purpose | Fallback |
| --- | --- | --- |
| `CATALOG_HOME` | Catalog state directory (exact-app override) | `~/.hasna/catalog` until the XDG data home is adopted via `HASNA_DATA_HOME` or a migrated `catalog.db` |
| `CATALOG_DB_PATH` | Default SQLite file | `$CATALOG_HOME/catalog.db` |
| `CATALOG_OPENSOURCE_ROOT` | Default `seed` scan root | `~/workspace/hasna/opensource` |
| `CATALOG_DUPLICATE_CHECKOUTS` | Duplicate alias JSON file | no aliases |
| `CATALOG_HOST` | HTTP bind host | `127.0.0.1` |
| `CATALOG_PORT` | HTTP bind port | `8797` |

An explicit command option takes precedence over its environment variable.
