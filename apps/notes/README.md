# Hasna Notes

A local-first, headless notes engine: a **CLI**, an **MCP server**, an importable
**SDK**, and a **self-hosted HTTP server** (SQLite or PostgreSQL). Notes are plain
Markdown files with YAML frontmatter, so the on-disk store is the contract and
stays readable without any of this tooling.

> **There is no desktop app in this package.** The macOS desktop app is a separate
> product and is owned by **[hasna-products/personalnotes](https://github.com/hasna-products/personalnotes)**.
> `@hasna/notes` ships no `Sources/`, no bundled web UI, no AI sidecar, and no
> `.app` build — it is headless by design. The two remain interoperable through the
> `personalnotes/v1` wire dialect and the Markdown-on-disk format documented below.

## What it is

- **`notes` — the CLI.** Create, list, search, label, archive, trash, purge,
  paginate, retitle, and migrate notes. JSON output on every read path.
- **`notes-mcp` — an MCP stdio server.** The same functionality exposed to any
  MCP client, including Markdown helpers and the agent tool registry.
- **`notes-serve` — a self-hosted HTTP server.** Speaks the `personalnotes/v1`
  dialect over SQLite by default, or PostgreSQL when `HASNA_NOTES_DATABASE_URL`
  is set — never both.
- **`@hasna/notes` — an importable SDK** (`.`, `./sdk`, `./events`) over the same
  domain logic the CLI and MCP server call.
- **Agentic tools** shared by CLI, MCP, and SDK: note search, summarization,
  organization, consolidation, and confirmation-gated writes.
- Per-note **status / labels / machine attribution** with Archive and Trash
  (configurable retention).

## Data format — the contract

The Markdown files are the **source of truth** for the CLI, MCP server, and SDK
when running against the local store. Point any of them at a notes server instead
with `HASNA_NOTES_API_URL` + `HASNA_NOTES_API_KEY` (personalnotes/v1 dialect); an
API URL without its key fails closed, and without an API URL the client never
guesses a server.

- Data root: resolved via `@hasna/paths` — `~/.hasna/notes/` by default (the pre-rename `~/.hasna/apps/notes/` root is copied forward once on first use). The XDG data home (`~/.local/share/hasna/notes` on Linux, `~/Library/Application Support/Hasna/notes` on macOS) is adopted only when the operator sets `HASNA_DATA_HOME` or the store has already been physically migrated there — an existing local store never becomes invisible on upgrade.
- Overrides (highest first): `HASNA_NOTES_HOME`, then `HASNA_NOTES_ROOT`, then `NOTES_HOME`
- Notes: `<data root>/notes/<id>.md` (id is a lowercased UUID)
- Writes are **atomic** (temp file in the same dir, then `rename`).
- A missing/empty directory is created automatically.
- Files without frontmatter are treated as a body with a title derived from the first line.
- The closing `---` is followed by a single newline and then the body **immediately**
  (no blank separator line); the body is preserved byte-for-byte on round-trip.
- Scalar fields (title/author/machine) are double-quoted when they contain special
  characters, with `\\`, `\"`, and `\n` escaped; labels that contain a comma, bracket,
  quote, or surrounding space are double-quoted in the `[...]` list.

Each file looks like:

```markdown
---
id: 4a4e04bd-d838-4ac6-962a-0d074c90f001
title: My Note
labels: [ideas, macos]
status: active          # inbox | active | reviewed | promoted | archived | trash | stale
folder: Work            # optional; empty string = no folder (back-compat: absent on old notes)
contentFormat: markdown # canonical body format; legacy plain text is Markdown-compatible
titleLocked: false      # true means the user manually named the note
titleSource: generated  # default | generated | manual
titleContentFingerprint: 7a9f2d
rev: 3                  # per-note monotonic revision; bumped on every local mutation
createdAt: 2026-06-22T09:00:00Z
updatedAt: 2026-06-22T09:00:00Z
author: hasna
agent: notes-app  # current value; legacy `hasna-notes-app` / `open-notes-app` still parse for back-compat
machine: studio-mac       # informational attribution: which machine owns the note.
                          # Stable identity: $HASNA_NOTES_MACHINE -> `machine` in
                          # ~/.config/hasna-notes/config.json -> short hostname.
machineFriendlyName: ""   # optional display name for `machine`
createdByActorType: human # human | agent | system
createdByName: hasna
archivedAt: ""
trashedAt: ""
trashExpiresAt: ""
restoredAt: ""
---
The markdown body goes here.
```

This is frontmatter **schema v2**. Key order is fixed: `id, title, labels,
status, folder, contentFormat, title metadata, rev, createdAt, updatedAt,
author, agent, machine, machineFriendlyName, actor provenance, archive/trash
timestamps`. `rev` is a per-note monotonic integer bumped past the on-disk
value on every local mutation; `updatedAt` wall clocks are a display hint only
and never decide version order.

Notes written by older versions still parse without migration (v2 auto-detects
on read): `tags`, `contentType`, missing `folder`/`contentFormat`/`rev` keys,
the legacy `agent: open-notes-app` value, and the retired v1 machine-provenance keys
(`sourceMachine`, `originMachine`, `previousMachine`, `targetMachineFriendlyName`,
`openedFrom`, `sourceContext`, `trashMachine`, `movedAt`) are all tolerated —
legacy source/origin friendly names map onto `machineFriendlyName` when they
describe the note's own machine. To rewrite a store to v2 in one pass, run
`notes migrate --to-v2` (alias `migrate-frontmatter`, `--dry-run`
supported): it is idempotent, backs originals up once to
`<root>/backup-frontmatter-v1/`, rewrites atomically per file, preserves the
body byte-for-byte, and logs every dropped v1/unknown key. The user's folder
list is persisted separately in `<data root>/folders.json`; labels can
also be persisted in `<data root>/labels.json` so empty labels survive.

AI-generated titles are concise and capped to 3-4 words. Title generation is
heuristic by default and needs no network. Passing `--sidecar <url>` (plus
`--sidecar-token`, or `HASNA_NOTES_SIDECAR_TOKEN`) delegates to any HTTP endpoint
exposing `POST /title` — this package ships the client, not the server. Title
generation reads Markdown as plain text so syntax and raw HTML do not leak into
titles. Manual titles are locked and are not overwritten unless a caller
explicitly forces generation.

Markdown rendering is intentionally restricted. The CLI, MCP, and SDK helpers
escape raw HTML, drop unsafe links, and expose plain-text extraction for titles
and search:

```bash
bun cli/notes.mjs markdown commands
bun cli/notes.mjs markdown render <note-id>
bun cli/notes.mjs markdown plain-text <note-id>
bun cli/notes.mjs markdown apply-command bold --text hello --selection-start 0 --selection-end 5
```

## Note creation events

Hasna Notes records each new local note as a durable `notes` / `note.created`
event. It does not run a filesystem watcher or a polling monitor. CLI, MCP,
notes-agent, consolidation, and server-applied imports write the event from
their existing create path. The shared JavaScript save boundary also emits for
every absent target, so direct SDK callers are covered.

The stable event identity and dedupe key are both
`notes:note:<uuid>:created`; the schema is `notes.v1`. Event data contains only
`noteId`, `createdAt`, and `originMachine`. Titles, bodies, labels, and webhook
credentials are never written to intents, event payloads, or status output.
Existing notes are marked as a clean baseline on first use and are not replayed
as new. Baseline creation requires a strict, complete read of every note; an
enumeration, read, or parse failure leaves the baseline absent rather than
silently accepting a partial store. A metadata-only pre-save intent plus startup
and post-write reconciliation recovers a crash between saving the note and
enqueuing its event. When `<root>/events` is unavailable, the intent is fsynced
to the owner-only `<root>/notes/.note-created-intents` fallback on the same
note-store filesystem and migrated after the canonical event state recovers.

The Node paths use the Node-safe `@hasna/events/durable-spool` boundary. A Bun
delivery worker can import that spool and route it through the durable events
broker. The webhook channel helper is disabled by default, accepts only an
`env:NAME` secret reference, rejects URL credentials, and requires HTTPS except
for loopback test receivers. This package does not configure a destination or
enable delivery automatically.

Webhook delivery is at least once: a crash, timeout, or expired delivery lease
can repeat the same stable event identity. A receiver must verify the request,
durably deduplicate by `dedupeKey` (falling back to `id`), and return HTTP 2xx
only after that durable enqueue or existing-idempotency record has committed.

Inspect metadata-only health without reading event payloads:

```bash
notes events status --json
```

Archive and Trash are first-class note states. Normal Delete moves a note to
Trash; deleting a note already in Trash, or calling an explicit purge,
permanently removes the file. Trash retention defaults to 30 days and is stored in
`<data root>/settings.json`. Notes also carry provenance metadata:
actor type/name, machine attribution, opened-from/source context, and lifecycle
timestamps.

## Project layout

```
bin/                        Published executables (notes, notes-mcp, notes-serve)
cli/notes.mjs               CLI for notes, labels, pagination, and titles
mcp/notes-mcp.mjs           MCP stdio server exposing the same functionality
sdk/index.mjs               Importable SDK surface (@hasna/notes/sdk)
client/http-store.mjs       personalnotes/v1 HTTP client (used when an API URL is set)
server/                     Self-hosted HTTP server (SQLite + PostgreSQL adapters)
  app.mjs                   Routes and request handling
  db.mjs                    SQLite store
  pg-adapter.mjs            PostgreSQL store
  pg-migrations.ts          PostgreSQL migrations
tools/notes-lib.mjs         Markdown + YAML-frontmatter read/write (atomic), domain logic
tools/notes-agent.mjs       Shared agent tool registry (confirmation-gated writes)
tools/notes-events.mjs      Shared Node note.created contract + spool state
src/generated/storage-kit/  Generated storage/pool/TLS helpers
scripts/                    PostgreSQL migration runner, test gate, artifact scan
test/                       Test suite (bun test)
```

## Build & run

This package is **JavaScript/TypeScript on Bun** — there is no compile step and no
platform-specific toolchain. It runs anywhere Bun runs.

```bash
bun install --frozen-lockfile
bun test
```

### CLI / MCP

```bash
notes list --limit 10
notes-mcp

# running straight from the repo
bun cli/notes.mjs list --limit 10
bun cli/notes.mjs labels assign <note-id> research
bun cli/notes.mjs move <note-id> <machine>
bun cli/notes.mjs archive <note-id>
bun cli/notes.mjs delete <note-id>          # moves to Trash
bun cli/notes.mjs purge <note-id>           # permanent delete
bun cli/notes.mjs settings set-trash-retention 30
bun cli/notes.mjs title <note-id> --apply
bun cli/notes.mjs markdown commands
bun cli/notes.mjs agent "summarize notes" --json
bun cli/notes.mjs agent "consolidate notes" --json       # preview
bun cli/notes.mjs agent "consolidate notes" --yes --json # write
bun cli/notes.mjs events status --json
bun mcp/notes-mcp.mjs
```

Installable package:

```bash
bun install -g @hasna/notes
notes --help
notes-mcp
```

`notes`, `notes-mcp`, and `notes-serve` are the documented binaries. The
deprecated `hasna-notes` / `hasna-notes-mcp` aliases are dropped, and the
pre-rename binaries are not shipped.

> **Wire dialect note.** The protocol between this package and any Hasna
> Notes-compatible server is `personalnotes/v1` (the hosted SaaS and the
> `hasna-products/personalnotes` desktop app keep that dialect name, so it is
> preserved verbatim in the codebase and in this README). The protocol is not
> renamed as part of the `notes` rename — only the package and binary names are.

### Talking to a notes server (single-server model)

The client is a plain HTTP API client speaking the `personalnotes/v1` dialect
to exactly one notes server. Server access is optional: local mode never calls
any API unless configured. Point the client at a server with
`HASNA_NOTES_API_URL` (or config `apiUrl`); `HASNA_NOTES_API_KEY` is the
bearer credential for the self-hosted server. Without an API URL the client
fails closed — it never guesses a server.

```bash
# Run the self-hosted server (SQLite by default; PostgreSQL when
# HASNA_NOTES_DATABASE_URL is set):
bunx notes-server            # or: bun server/index.mjs --port 8788
```

Multi-machine sync machinery (the `notes sync`/`cloud`/`billing` verbs, the
sync daemon and service install, sync-state files, the machine manifest, and
the Machines UI surface) was removed in 0.2.0 — see
[docs/sync.md](docs/sync.md) for the removal note. The `personalnotes/v1`
dialect and the server's CRUD/export endpoints are unchanged.

The CLI and MCP both default lists to the latest 10 notes and return pagination
metadata in JSON/MCP responses. CLI/MCP creation supports actor provenance
(`actorType`, `actorName`) and machine attribution (`targetMachine`, plus a
friendly display name).
Markdown helpers are available in MCP as `markdown_commands`, `markdown_render`,
`markdown_plain_text`, and `markdown_apply_command`.

Agentic note operations are available through `notes agent ...` and MCP
`agent_tools`, `agent_run`, and `agent_tool_call`. The shared tool registry
supports list/search/read, friendly provenance metadata, create/update/append,
label/unlabel, archive/trash/restore, summarize, related-note discovery, and
consolidation into a larger note. Destructive or broad writes return a preview
unless confirmed (`--yes` in CLI or `confirm: true` in MCP). Agent-created notes
write provenance metadata (`createdByActorType: agent`, friendly actor name,
opened-from/source context).
Direct CLI/MCP deletion paths are also gated: `delete`, `trash`,
`cleanup-trash`, `notes_delete`, `notes_trash`, and `trash_cleanup` preview
unless confirmed, while permanent `purge` / `notes_purge` require `--yes` /
`--force` or `confirm: true`.

### Voice capture, transcription, and chat UI

Not in this package. Audio recording, realtime transcription, and the chat UI were
surfaces of the desktop app and moved with it to
[hasna-products/personalnotes](https://github.com/hasna-products/personalnotes).
What remains here is the storage and tooling layer they were built on: the
Markdown-on-disk contract, the agent tool registry, and the `personalnotes/v1`
server. A transcript committed by any client is an ordinary note write and needs
no special support from this package.

## Requirements

- **Bun >= 1.0.** No Swift toolchain, no Xcode, no platform-specific build.
- Optional: PostgreSQL, if you set `HASNA_NOTES_DATABASE_URL` instead of using
  the default SQLite store.
