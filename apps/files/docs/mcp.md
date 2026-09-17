# MCP Server

`files-mcp` exposes the files data plane and on-box file workflows as MCP
tools. Stdio is the default transport.

```bash
files-mcp              # stdio (the default)
files-mcp --stdio
files-mcp --help
files-mcp --version
```

`--help` and `--version` answer before the credential gate and never bind a
port; without a resolvable credential (or the explicit `HASNA_FILES_LOCAL=1`
opt-in) the server exits non-zero before serving on either transport.

## Streamable HTTP

```bash
files-mcp --http
files-mcp --http --port 8863
MCP_HTTP=1 MCP_HTTP_PORT=8863 files-mcp
```

The HTTP server binds to `127.0.0.1` by default. Its endpoints are:

- `GET /health`
- `POST /mcp`

The default port is `8863`. `--port` takes precedence over `MCP_HTTP_PORT`.

## Token-bounded profiles

`files-mcp` defaults to `HASNA_FILES_MCP_PROFILE=standard`. The legacy alias
`OPEN_FILES_MCP_PROFILE` is also accepted. `--profile <name>` has highest
precedence and is validated before stdio connects or an HTTP listener binds.

- `minimal`: file/source/tag/collection/project discovery and metadata reads.
- `standard`: minimal plus bounded content, extraction, evidence audit, agent
  and activity reads; context-pack tools are included only in explicit local
  mode.
- `full`: the complete historical tool inventory.

Reduced profiles omit tools outside the selected profile and omit
capability-gated tools until every required `OPEN_FILES_MCP_ALLOW_*` flag is
enabled. The `full` profile preserves historical discovery and call-time
capability refusals.

`list_files` and `search_files` preserve the historical full bare-array
response by default (`format: "legacy"`). Set `format: "page"` for the
agent-oriented contract. Page mode defaults to 20 compact rows and minified
JSON and returns `items` plus `_meta.count`, `limit`, `offset`, `next_offset`,
`has_more`, `end_reached`, whole-query `complete`, `all`, and `detail`.
Compact pages also include the actual projected `fields` plus
`byte_length`/`max_bytes`/`byte_limited` and default to a 32-KiB ceiling;
callers may request 1 KiB through 1 MiB. Normal pages are capped at 500 rows.
Set `detail: "full"` for full page records or pass `fields` for a compact
projection; the two options are mutually exclusive and full IDs are always
retained. `get_file` remains the exact full-detail path.

`all: true` requires `format: "page"`, compact detail, and offset zero. It
walks bounded 500-row service pages and succeeds only if the whole query fits
within the hard 5,000-row and 1-MiB boundaries. It refuses on either bound;
it never returns a partial result with `complete: true`. `end_reached` means
there is no page after the current offset. `complete` means the response covers
the whole query from offset zero.

## Capability Gates

Tools named in the capability map are denied by default unless every required
capability is enabled. The capabilities are `mutations`, `destructive`,
`imports`, `signed_urls`, `downloads`, and `indexing`.

```bash
OPEN_FILES_MCP_ALLOW_MUTATIONS=1 files-mcp
OPEN_FILES_MCP_ALLOW_IMPORTS=1 files-mcp
OPEN_FILES_MCP_ALLOW_SIGNED_URLS=1 files-mcp
OPEN_FILES_MCP_ALLOW_DOWNLOADS=1 files-mcp
OPEN_FILES_MCP_ALLOW_INDEXING=1 files-mcp
OPEN_FILES_MCP_ALLOW_DESTRUCTIVE=1 files-mcp
```

`OPEN_FILES_ALLOW_<CAPABILITY>=1` enables the same capability for files
surfaces generally. `OPEN_FILES_MCP_ALLOW_ALL=1` and `OPEN_FILES_ALLOW_ALL=1`
enable every capability. Accepted true values are determined by the shared MCP
harness. Remote imports are limited to 100 MiB by default; set
`OPEN_FILES_MCP_IMPORT_MAX_BYTES` to a positive byte limit, capped at 2 GiB.

Some calls require more than one capability. Upload-intent creation requires
`mutations` and `signed_urls`; evidence download signing requires `signed_urls`
and `downloads`. A hard `delete_file` additionally checks `destructive`.
Writing a context pack or knowledge manifest artifact additionally checks
`mutations`.

Tools with no capability-map entry are not denied by this guard. The reduced
profiles omit state-writing agent, feedback, and organization operations; the
`full` legacy profile still exposes them. Read-oriented tools that accept an
agent ID may record activity telemetry.

## Local and API Modes

Data-plane tools use the same local/API store selection as the CLI. Physical
operations that need files or ingestion state on the current machine fail in
API mode. These include source indexing and Google Drive sync, byte download or
upload, context/extraction/knowledge resolution, imports, copies, starting
watchers, and all organization-review tools.

Two process-local exceptions do not route through the API store:
`resolve_id` consults the local SQLite ID resolver even in API mode, and
`unwatch_source` only updates the current process's watcher registry.

`build_context_pack` and `search_context_pack` also remain explicitly on-box.
The hosted transport has no owned bounded-pack `/v1` route yet, so both tools
have regression-tested refusals in API mode. They never substitute a local
store or assemble an unbounded pack client-side; a hosted implementation is a
follow-up service contract, not part of this output-only change.

Evidence tools work through both stores. In API mode the service owns evidence
storage configuration; client bucket and local-root overrides are ignored.

## Tool Catalog

The exact JSON schemas and descriptions are available through MCP `tools/list`.
The current tool names are grouped below.

### Sources and Google Drive

```txt
list_sources
add_source
remove_source
index_source
list_machines
list_google_drive_profiles
add_google_drive_source
list_google_drive_items
preflight_google_drive_sync
sync_google_drive
normalize_source
```

### Files, search, and context

```txt
list_files
search_files
get_file
get_file_by_path
resolve_id
recent_files
find_duplicates
get_stats
list_deleted_files
list_conflicts
resolve_conflict
build_context_pack
search_context_pack
describe_file
resolve_file_storage
get_file_content
extract_file_text
extract_file_snapshot
```

### File mutations and imports

```txt
download_file
upload_file
get_file_url
bulk_tag
move_file
copy_file
rename_file
delete_file
restore_file
annotate_file
import_from_url
import_from_local
bulk_import
purge_deleted
watch_source
unwatch_source
```

### Tags, collections, and projects

```txt
list_tags
tag_file
untag_file
delete_tag
list_collections
create_collection
update_collection
get_collection
get_or_create_collection
auto_populate_collection
add_to_collection
remove_from_collection
delete_collection
list_projects
create_project
update_project
get_project
get_or_create_project
add_to_project
remove_from_project
delete_project
```

### Knowledge

```txt
export_knowledge_manifest
resolve_knowledge_source
doctor_knowledge_sources
resolve_extracted_text
poll_knowledge_outbox
ack_knowledge_outbox
```

### Evidence

```txt
create_evidence_upload_intent
upload_evidence_file
complete_evidence_upload
link_evidence_asset
sign_evidence_download
verify_evidence_asset
list_evidence_assets
audit_evidence_asset
```

### Organization review

```txt
files_organization_bootstrap_google_drive
files_organization_stats
files_organization_reviews
files_organization_update_review
files_organization_export_audit
files_organization_events
```

### Agents and activity

```txt
register_agent
heartbeat
set_focus
list_agents
get_file_history
get_agent_activity
get_session_activity
```

### Feedback

```txt
send_feedback
```
