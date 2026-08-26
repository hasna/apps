# @hasna/catalog

`@hasna/catalog` builds a local, SQLite-backed read model of
`hasna.app.v1` application records. It can scan a directory of source
checkouts, import JSONL records, query the result through a CLI or MCP server,
serve a small HTTP API, and generate a static HTML catalog.

The catalog stores application identity and release metadata only. It does not
write install or rollout state. The exported rollout ingestion hook currently
validates supported event envelopes and returns them with `persisted: false`.

## Install

```bash
bun add @hasna/catalog
# or install the CLI and MCP binaries globally
bun add -g @hasna/catalog
```

The package requires Bun. A global install provides `catalog` and
`catalog-mcp`.

## Quick start

```bash
# Scan immediate open-* child directories and upsert records into SQLite.
catalog seed --root <checkout-dir>

# Query the local read model.
catalog list
catalog get <appId>
catalog search "uptime"

# Generate index.html plus one page per app.
catalog site --out dist-site

# Bind the local, unauthenticated read API.
catalog serve
```

The catalog data home is resolved through `@hasna/paths` (XDG/macOS home
layout). The legacy `~/.hasna/catalog` default stays the effective data home
until the store is actually migrated to the XDG data home
(`~/.local/share/hasna/catalog` on Linux; `~/Library/Application
Support/Hasna/catalog` on macOS) or the operator sets the data-kind override
`HASNA_DATA_HOME`, so an existing local store never becomes invisible on
upgrade. Exact-app overrides win over that default: `CATALOG_HOME`, then the
direct `CATALOG_DB_PATH`; every data command also accepts `--db <path>`.

See [the CLI reference](docs/cli.md) for every command, option, default, and
output mode.

## Interfaces

- [CLI reference](docs/cli.md) — seeding, JSONL import, queries, site
  generation, and serving
- [HTTP API](docs/http-api.md) — routes, query parameters, responses, limits,
  and exposure warning
- [MCP server](docs/mcp.md) — stdio setup and the exact tool schemas
- [Data model and library API](docs/data-model.md) — records, seed behavior,
  storage, exports, and the rollout ingestion stub

## Duplicate checkouts

The scanner skips folders that do not start with `open-`, non-Git directories,
and checkout names matching its worktree, pull-request, release, fix, legacy,
or hash-suffix patterns. It also deduplicates candidates with the same npm
package name.

Deliberately renamed aliases cannot be recognized from their names. Supply a
JSON object mapping alias folder names to canonical folder names:

```bash
catalog seed --root <checkout-dir> --duplicates ./duplicates.json
# or
export CATALOG_DUPLICATE_CHECKOUTS=/path/to/duplicates.json
```

```json
{ "<alias-folder>": "<canonical-folder>" }
```

The built-in alias map is empty. Keep operator-specific maps outside this
repository. If two unconfigured folders share an npm name, the scanner prefers
`open-<unscoped-npm-name>`; otherwise it chooses the shortest folder name,
using alphabetical order as the tiebreaker. If the npm names differ, both
folders are seeded.

## Security and deployment scope

`catalog serve` is a local development convenience, not an authenticated
service. It binds to `127.0.0.1:8797` by default. Binding it to a non-loopback
address exposes all catalog records without authentication. The static site
command only writes files; deployment is a separate operation.

## Contracts

The package currently vendors the distribution schema shapes it needs in
`src/contracts.ts`: `hasna.app.v1`, `hasna.rollout_record.v1`, and related
event names. The validators are strict where the source defines closed records;
consult [the data model reference](docs/data-model.md) before producing JSONL.

## Development

```bash
bun install
bun run typecheck
bun test
bun run build
```

`bun run verify:release` runs typechecking, tests, the build, and the packed
artifact disclosure scan.

## License

Apache-2.0
