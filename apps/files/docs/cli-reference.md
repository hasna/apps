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
transport is used under the explicit opt-in `HASNA_FILES_LOCAL=1` (alias
`FILES_LOCAL=1`) — the retired `HASNA_FILES_LOCAL_MODE` /
`FILES_LOCAL_MODE`/`*_STORAGE_MODE` switches are gone — and every run that
touches the on-box store prints one `files: LOCAL mode — ...` line on stderr.
Local mode uses the resolver-resolved data root
(`~/.local/share/hasna/files/files.db` on Linux,
`~/Library/Application Support/Hasna/files/files.db` on macOS; the legacy
`~/.hasna/files/files.db` stays effective until migrated or `HASNA_DATA_HOME`
is set).

The storage-mode axis is retired: **every command runs on every transport**.
Data-plane commands route through the Store, so they read and write whatever
dataset the configured transport serves. Content commands (`cat`, `open`,
`where`, `resolve`, `extract-snapshot`, context packs, `search-index`) have
hosted implementations that use the service's own content/sign/extract routes.
Machine commands (`index`, Google Drive sync, `peers`, `sync`, `watch`, `db`,
`organize`, `knowledge`) operate on the machine where the CLI runs in BOTH
environments — they are explicit machine operations, and a hosted-configured
run that touches the on-box store announces it on stderr. There are no
transport-conditional refusals.

## Top-Level Commands

| Command | Purpose |
| --- | --- |
| `files sources` | Manage local, S3, and Google Drive source records |
| `files index [source-id]` | Index enabled sources on this machine |
| `files machines` | List known machines |
| `files search <query>` | Search metadata and derived content |
| `files context-pack [file-ids...]` | Build a bounded cited pack from IDs or refs |
| `files search-pack <query>` | Search and build a bounded cited pack |
| `files search-index` | Manage derived search documents and FTS |
| `files list` (`ls`) | List files |
| `files tag <file-id> <tags...>` | Add tags |
| `files untag <file-id> <tags...>` | Remove tags |
| `files tags` | List tags |
| `files download <file-id> [dest]` | Resolve/download bytes |
| `files upload <local-path> [source-id] [s3-key]` | Upload a local document as a tagged, project-linked file resource. On the hosted transport the service owns ingestion (`source-id` unused); on the local transport the document uploads to an S3 source and is reindexed |
| `files collections` | Manage collections |
| `files projects` | Manage projects |
| `files project-panel` | Build a project-panel contract |
| `files info <file-id>` | Show file metadata |
| `files resolve <file-id>` | Resolve the current byte-storage location (storage summary on-box, signed URL on the hosted transport) |
| `files stats` | Show aggregate statistics |
| `files dupes` | Find duplicate hashes |
| `files peers` | Manage saved peer endpoints on this machine |
| `files sync <peer-url...>` | Pull file indexes from peer servers |
| `files open <file-id>` | Open a file with the OS default app (hosted files download to a temp copy first) |
| `files where <file-id>` | Print a file's current location (absolute on-box path; signed URL on the hosted transport) |
| `files cat <file-id>` | Print file bytes (hosted files stream through the service's content route) |
| `files extract-text <file-id>` | Produce bounded chunk-ready text |
| `files extract-snapshot <file-id>` | Produce a deterministic semantic snapshot |
| `files knowledge` | Manifest, resolver, doctor, and outbox APIs |
| `files evidence` | Manage shared evidence assets |
| `files organize` | Review imported Google Drive metadata |
| `files recent` | List recently touched files |
| `files watch` | Watch enabled local sources in the foreground |
| `files ops` | Check/snapshot operational SQLite databases |
| `files config` | Read/write local CLI configuration |
| `files db` | Print the on-box SQLite path |
| `files events` | Emit, list, and replay shared Hasna events |
| `files webhooks` | Manage event webhook/command subscriptions |
| `files remove <source-id>` | Alias for `sources remove` |

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
machine operations that run on the machine where the CLI executes, on both
transports (announcing the on-box store under a hosted credential).
`add` rejects static access/secret keys; use `--aws-profile` or the AWS
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
content` on that backend. `search-index stats` computes coverage on the local
database (on-box) or from the hosted `/v1` API surface (`hosted: true` in the
JSON). `search-index rebuild-fts` rebuilds the SQLite FTS5 side table on-box;
on the hosted transport the derived-content index is a server-maintained
generated column, and the command truthfully reports `refreshed 0` —
there are no client-side FTS entries to rebuild.

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

Peers are a machine registry and peer sync is a machine operation; both run on
the machine where the CLI executes in either environment.

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

The create/upload commands require organization, app, and kind metadata. Both
transports are first-class: the local store honors per-command storage
overrides (`--storage s3|local`, `--local-root`); the hosted store keeps
evidence metadata and storage policy with the service, and client overrides
are not used by the remote store.

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

Organization is a metadata review workflow over the machine's imported Google
Drive rows and is a machine operation on both transports. `apply-drive-policy`
is a dry run unless `--apply` is supplied.

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
