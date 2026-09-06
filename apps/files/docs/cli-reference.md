# CLI Reference

The `files` executable manages local indexes and the hosted files data plane.
Run `files <command> --help` for the exact options, defaults, and repeatable
flags for any command. This page mirrors the command hierarchy registered by
the current CLI.

## Client Transports

The hosted API transport is resolved through the ONE `@hasna/contracts`
credential chain, fresh on every call: an explicit `--api-key`/`--profile`
argument, then `HASNA_FILES_API_KEY_OVERRIDE` / `HASNA_PROFILE` /
`HASNA_FILES_API_KEY_REF`, then the macOS Keychain item
`hasna.credentials.files.api-key` (account `HASNA_STATION`, else the short
hostname, else `$USER`), then `~/.hasna/files/config/credentials` (owner-only
0400/0600, `HASNA_HOME`/`HASNA_CONFIG_HOME` move the root), then
`HASNA_FILES_API_KEY`. The authority follows the same ladder —
`HASNA_FILES_API_URL`, the Keychain `api-url` item, the credentials file — and
defaults to the fleet gateway `https://api.hasna.com/files` once a credential
resolves (the client appends `/v1`). The unprefixed `FILES_API_URL` /
`FILES_API_KEY` names survive only as a silent resolver alias for one release.

With no resolvable credential and no local opt-in, the CLI fails closed — a
command exits non-zero naming every tier the resolver consulted, and no on-disk
SQLite store is created, no `*-local-fallback` event is emitted. The local
transport is used only under the explicit opt-in `HASNA_FILES_LOCAL=1` (alias
`FILES_LOCAL=1`) — the retired `HASNA_FILES_LOCAL_MODE` /
`FILES_LOCAL_MODE`/`*_STORAGE_MODE` switches are gone — and every local run
prints one `files: LOCAL mode — ...` line on stderr. Local mode uses the
resolver-resolved data root (`~/.local/share/hasna/files/files.db` on Linux,
`~/Library/Application Support/Hasna/files/files.db` on macOS; the legacy
`~/.hasna/files/files.db` stays effective until migrated or `HASNA_DATA_HOME`
is set).

Commands marked **on-box** require local files, a local SQLite index, or local
ingestion state and fail explicitly on the hosted transport. Commands marked
**data plane** route through either the local or the hosted API store.
**Process-local** commands manage configuration, event state, or diagnostics on
the machine where they run.

## Top-Level Commands

| Command | Purpose | Availability |
| --- | --- | --- |
| `files sources` | Manage local, S3, and Google Drive source records | Mixed; see below |
| `files index [source-id]` | Index all enabled sources or one source | On-box |
| `files machines` | List known machines | Data plane |
| `files search <query>` | Search metadata and derived content | Data plane |
| `files context-pack [file-ids...]` | Build a bounded cited pack from IDs or refs | On-box |
| `files search-pack <query>` | Search and build a bounded cited pack | On-box |
| `files search-index` | Manage derived search documents and FTS | On-box |
| `files list` (`ls`) | List files | Data plane |
| `files tag <file-id> <tags...>` | Add tags | Data plane |
| `files untag <file-id> <tags...>` | Remove tags | Data plane |
| `files tags` | List tags | Data plane |
| `files download <file-id> [dest]` | Resolve/download bytes | On-box |
| `files upload <local-path> [source-id] [s3-key]` | Upload a local document. Cloud (api) mode: server-owned ingestion into the files service, optionally tagged + linked to a project (`--project`, `--tag`). Local mode: upload to an S3 source and reindex | Data plane |
| `files collections` | Manage collections | Data plane |
| `files projects` | Manage projects | Data plane |
| `files project-panel` | Build a project-panel contract from local data | Process-local |
| `files info <file-id>` | Show file metadata | Data plane |
| `files resolve <file-id>` | Resolve the current byte-storage location | On-box |
| `files stats` | Show aggregate statistics | Data plane |
| `files dupes` | Find duplicate hashes | Data plane |
| `files peers` | Manage saved peer endpoints | On-box |
| `files sync <peer-url...>` | Pull file indexes from peer servers | On-box |
| `files open <file-id>` | Open a local file with the OS default app | On-box |
| `files where <file-id>` | Print a local file's absolute path | On-box |
| `files cat <file-id>` | Print local file bytes | On-box |
| `files extract-text <file-id>` | Produce bounded chunk-ready text | On-box |
| `files extract-snapshot <file-id>` | Produce a deterministic semantic snapshot | On-box |
| `files knowledge` | Manifest, resolver, doctor, and outbox APIs | On-box |
| `files evidence` | Manage shared evidence assets | Data plane |
| `files organize` | Review imported Google Drive metadata | On-box |
| `files recent` | List recently touched files | Data plane |
| `files watch` | Watch enabled local sources in the foreground | On-box |
| `files ops` | Check/snapshot operational SQLite databases | Process-local |
| `files config` | Read/write local CLI configuration | Process-local |
| `files db` | Print the local SQLite path | On-box |
| `files events` | Emit, list, and replay shared Hasna events | Process-local |
| `files webhooks` | Manage event webhook/command subscriptions | Process-local |
| `files remove <source-id>` | Alias for `sources remove` | Data plane |

`list` and `search` run identically on both backends. In API mode the full
local filter surface — source, machine, tag, collection, project, extension,
date (`--after`/`--before`), size (`--min-size`/`--max-size`), `--sort`
(name/size/date) and `--asc` — is transmitted to `/v1/files` and applied
server-side. Remote `search` is a ranked full-text search over metadata
(name/path/mime/canonical/description) AND the derived-content index
(`search-index` documents) with `--scope all|metadata|content`; the server
returns a per-row `rank` and the `search_match_sources` that actually matched.

## Source Commands

```txt
files sources list|ls
files sources add <path-or-s3>
files sources add-google-drive
files sources bootstrap-prod-files
files sources bootstrap-prod-emails        # alias
files sources google-drive-profiles
files sources rename <id> <name>
files sources enable <id>
files sources disable <id>
files sources remove <id> --yes
files sources shared-drives <id>
files sources google-drive-items <id>
files sources google-drive-status [id]
files sources sync-google-drive [id]
```

`list`, `add`, `rename`, `enable`, `disable`, and `remove` use the active data
plane. Google Drive discovery/sync, bootstrap, and shared-drive commands are
on-box. `add` rejects static access/secret keys; use `--aws-profile` or the AWS
provider chain. `bootstrap-prod-files` requires `--bucket` or
`HASNA_FILES_S3_BUCKET` and has no built-in production bucket.

## Search and Context Commands

```txt
files search <query>
files context-pack [file-ids...] [--source-ref <ref>...]
files search-pack <query>

files search-index add <file-id> --text-file <path>
files search-index list [file-id]
files search-index remove <document-id>
files search-index stats
files search-index rebuild-fts
```

`search-index add|list|remove` route through the active data plane: the local
store writes FTS5 rows, the hosted store writes `/v1` search documents — so a
document indexed on either backend is searchable by `files search --scope
content` on that backend. `search-index stats` and `search-index rebuild-fts`
remain on-box: stats is a local-database diagnostic, and rebuild-fts maintains
the SQLite FTS5 side table (the hosted store's tsvector is a generated column
with nothing to rebuild).

Context packs default to 5 files, 12 excerpts, 900 characters per excerpt,
6,000 excerpt characters total, and 262,144 bytes read per file. Secret-like
text is redacted by default. `--out` writes formatted JSON; `--dry-run` previews
the output pointer without writing.

## Collections, Projects, and Peers

```txt
files collections list
files collections create <name> [description]
files collections add <collection-id> <file-id>
files collections remove <id> --yes

files projects list
files projects create <name> [description]
files projects add <project-id> <file-id>
files projects remove <id> --yes

files peers list|ls
files peers add <url>
files peers remove <id-or-url> --yes
files sync <peer-url...>
```

Source, collection, project, and peer removals require `--yes`.

## Knowledge Commands

```txt
files knowledge manifest
files knowledge doctor [sourceRefs...]
files knowledge resolve <source-ref>
files knowledge outbox poll
files knowledge outbox ack <consumer-id> <cursor>
```

Manifest output is selected with `--format json|jsonl`; there is no `--jsonl`
flag. Use `--out <path>` for a local artifact. Resolver modes are `metadata`,
`content`, `extracted_text`, `snapshot`, and `signed_url`.

## Evidence Commands

```txt
files evidence configure-prod
files evidence create-upload
files evidence upload <path>
files evidence complete <intent-id>
files evidence link <asset-id>
files evidence sign-download <asset-id>
files evidence verify <asset-id>
files evidence list
files evidence audit <asset-id>
```

The create/upload commands require organization, app, and kind metadata. Local
mode honors per-command storage overrides. In API mode evidence metadata and
storage policy belong to the service; client bucket/local-root overrides are
not used by the remote store.

Evidence is write-once. Use `--provenance-type`, `--provenance-id`,
`--provenance-ref`, `--evidence-version`, repeatable `--external-ref`, and
`--idempotency-key` to create a stable authority record. Consumers retain the
asset ID or `canonical_ref`; they do not retain or duplicate the file bytes.
`files evidence list` accepts the same metadata filters, including an exact
external-reference match.

## Organization Commands

```txt
files organize bootstrap-google-drive
files organize stats
files organize list
files organize review <id-or-file-id>
files organize infer-google-drive
files organize apply-drive-policy
files organize duplicates
files organize unassigned
files organize approval-packet
files organize export
files organize events <id-or-file-id>
```

Organization is a metadata review workflow over locally imported Google Drive
rows. `apply-drive-policy` is a dry run unless `--apply` is supplied.

## Operational, Event, and Configuration Commands

```txt
files ops db-integrity
files ops snapshot

files events emit <type>
files events list
files events replay
files webhooks add <target>
files webhooks list
files webhooks remove <id>
files webhooks test <id>

files config list|ls
files config get <key>
files config set <key> <value>
```

Supported files config keys are `auto_watch`, `hash_skip_bytes`,
`default_limit`, `ignore_patterns`, and
`google_drive_default_destination_source_id`.

## Other Shipped Executables

```txt
files-mcp [--http] [--port <number>]
files-serve [--port <number>]
files-migrate [--check|--dry-run]
```

See [MCP](mcp.md) and [service and SDK](service-and-sdk.md) for their complete
runtime contracts.
