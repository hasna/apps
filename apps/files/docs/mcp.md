# MCP Server

`files-mcp` exposes the files data plane and on-box file workflows as MCP
tools. Stdio is the default transport.

```bash
files-mcp
files-mcp --help
```

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

Tools with no capability-map entry are not denied by this guard. Consequently,
the default server is not strictly read-only: `register_agent`, `heartbeat`,
`set_focus`, `send_feedback`, `files_organization_bootstrap_google_drive`, and
`files_organization_update_review` can write state without a capability flag.
Read-oriented tools that accept an agent ID may also record activity telemetry.

## Local and API Modes

Data-plane tools use the same local/API store selection as the CLI. Physical
operations that need files or ingestion state on the current machine fail in
API mode. These include source indexing and Google Drive sync, byte download or
upload, context/extraction/knowledge resolution, imports, copies, starting
watchers, and all organization-review tools.

Two process-local exceptions do not route through the API store:
`resolve_id` consults the local SQLite ID resolver even in API mode, and
`unwatch_source` only updates the current process's watcher registry.

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
