# PersonalNotes

A dead-simple, voice-first macOS notes app (a native WKWebView shell around a small
web UI). Notes are stored as plain Markdown files with YAML frontmatter, so they stay
forward-compatible with the installable `@hasna/personalnotes` CLI/MCP package.

## What it is

- A minimal, Google-Keep-simple UI: a slim sidebar (machines dropdown, Home,
  collapsible Notes/Labels, Archive, Trash) beside one clean content area — a
  centered quick-note composer on Home, a flat notes list, and a plain
  title + body editor.
- **Voice capture is the core loop**: press record, watch the transcript stream in
  real time, and the note writes itself. Recording survives in-app navigation.
- **Markdown editing** with a selection popover (bold/italic) and slash commands for
  headings, lists, quotes, code, checklists, and dividers — no toolbar. Markdown on
  disk is the contract.
- **Agentic tools** shared by the app's sidecar chat, CLI, and MCP: note search,
  summarization, organization, consolidation, and confirmation-gated writes.
- Per-note **status / labels / machine attribution** with Archive and per-machine
  Trash (configurable retention), searchable via a Cmd+K popover.

## Data format — the contract

The Markdown files are the **source of truth**. PersonalNotes reads and writes them so any
other tool, including the `@hasna/personalnotes` CLI/MCP package, can index the same directory.

- Data root: `~/.hasna/apps/notes/`
- Preferred override: `PERSONALNOTES_ROOT`
- Legacy override: `HASNA_NOTES_ROOT`
- Notes: `~/.hasna/apps/notes/notes/<id>.md` (id is a lowercased UUID)
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
createdAt: 2026-06-22T09:00:00Z
updatedAt: 2026-06-22T09:00:00Z
author: hasna
agent: personalnotes-app  # legacy `hasna-notes-app` / `open-notes-app` still parse
machine: Mac
---
The markdown body goes here.
```

Frontmatter key order is fixed: `id, title, labels, status, folder,
contentFormat, title metadata, createdAt, updatedAt, author, agent, machine`,
followed by provenance and lifecycle fields. Notes written by older versions
(`tags`, no `folder` key, no `contentFormat` key, `agent: open-notes-app`) still
parse — unknown/missing keys are tolerated. The user's folder list is persisted separately in
`~/.hasna/apps/notes/folders.json`; labels can also be persisted in
`~/.hasna/apps/notes/labels.json` so empty labels survive.

AI-generated titles are concise, capped to 3-4 words, and use the local sidecar's
cheap OpenAI title model by default (`HASNA_NOTES_TITLE_MODEL`, default
`gpt-4o-mini`). Title generation reads Markdown as plain text so syntax and raw
HTML do not leak into titles. Manual titles are locked and are not overwritten
unless a caller explicitly forces generation.

Markdown rendering is intentionally restricted. CLI, MCP, and web bridge helpers
escape raw HTML, drop unsafe links, and expose plain-text extraction for titles
and search:

```bash
node cli/personalnotes.mjs markdown commands
node cli/personalnotes.mjs markdown render <note-id>
node cli/personalnotes.mjs markdown plain-text <note-id>
node cli/personalnotes.mjs markdown apply-command bold --text hello --selection-start 0 --selection-end 5
```

Archive and Trash are first-class note states. Normal Delete moves a note to
per-machine Trash; deleting a note already in Trash, or calling an explicit purge,
permanently removes the file. Trash retention defaults to 30 days and is stored in
`~/.hasna/apps/notes/settings.json`. Notes also carry provenance metadata for
agent-created notes and synced notes: actor type/name, source machine, origin/current
machine, previous machine, opened-from/source context, and lifecycle timestamps.

## Project layout

```
Package.swift                       SwiftPM manifest (platform .macOS("26.0"))
Sources/PersonalNotesCore/              Pure, UI-free logic (a library product)
  Note.swift                        Note model + NoteStatus enum (+ folder field)
  MarkdownStore.swift               Markdown + YAML-frontmatter read/write (atomic)
  RichTextMarkdown.swift            Pure Markdown ↔ rich-text document bridge (tested)
  FolderStore.swift                 folders.json persistence (empty folders survive)
  LabelStore.swift                  labels.json persistence + normalization
  SettingsStore.swift               settings.json persistence (trash retention)
  MachineManifest.swift             machines.json manifest read (machine attribution)
Sources/PersonalNotesApp/              Native WKWebView shell (recording, bridges, sidecar)
Sources/PersonalNotesSmoke/             CLI smoke test for the store + bridges (no Xcode needed)
web/                                The app UI (index.html, app.js, styles.css)
scripts/build_personalnotes.sh         WKWebView app build with bundled web UI + sidecar
cli/personalnotes.mjs               CLI for notes, labels, pagination, and titles
mcp/personalnotes-mcp.mjs           MCP stdio server exposing the same functionality
```

## Build & run

This project builds with **SwiftPM only** — no Xcode required. It targets macOS 26
(Liquid Glass APIs) and has been built and launched on a Mac with Command Line Tools.

### On the Mac (macOS 26)

```bash
bash scripts/build_personalnotes.sh   # swift build -c release + bundle web UI/sidecar + codesign
open "dist/PersonalNotes.app"
```

### Verify the store logic

```bash
swift run -c release PersonalNotesSmoke   # round-trips a note through the markdown store
node --test test/notes-functionality.test.mjs
```

### CLI / MCP

```bash
personalnotes list --limit 10
personalnotes-mcp

# running straight from the repo
node cli/personalnotes.mjs list --limit 10
node cli/personalnotes.mjs labels assign <note-id> research
node cli/personalnotes.mjs move <note-id> <machine>
node cli/personalnotes.mjs archive <note-id>
node cli/personalnotes.mjs delete <note-id>          # moves to Trash
node cli/personalnotes.mjs purge <note-id>           # permanent delete
node cli/personalnotes.mjs settings set-trash-retention 30
node cli/personalnotes.mjs title <note-id> --apply
node cli/personalnotes.mjs markdown commands
node cli/personalnotes.mjs agent "summarize notes" --json
node cli/personalnotes.mjs agent "consolidate notes" --json       # preview
node cli/personalnotes.mjs agent "consolidate notes" --yes --json # write
node mcp/personalnotes-mcp.mjs
```

Installable package:

```bash
bun install -g @hasna/personalnotes
personalnotes --help
personalnotes-mcp
```

`personalnotes` and `personalnotes-mcp` are the documented binaries. The
`hasna-notes` and `hasna-notes-mcp` binaries are deprecated aliases kept for one
release: they print a one-line deprecation warning to stderr, then delegate to
the primary binaries (same arguments, stdio, and exit codes). They will be
removed in the next release. `hasna-notes-mcp` always serves the local notes
store, as it always has — hosted mode is only reachable through
`personalnotes-mcp`.

Hosted PersonalNotes.ai mode is optional. Local mode never calls the hosted API
unless explicitly configured.

```bash
personalnotes auth login --email you@example.com
personalnotes auth verify --email you@example.com --code 123456
personalnotes cloud status
personalnotes cloud list --json
PERSONALNOTES_MODE=hosted PERSONALNOTES_API_KEY=pn_... personalnotes-mcp
```

The CLI and MCP both default lists to the latest 10 notes and return pagination
metadata in JSON/MCP responses. CLI/MCP creation supports agent provenance fields
such as `actorType`, `actorName`, `sourceMachine`, `targetMachine`, `openedFrom`,
and `sourceContext`. Machine details are available through `personalnotes machines
list`, `personalnotes machines details <id>`, and MCP `machines_list` /
`machines_details`; details combine open-machines fields with notes-derived
fallback counts and activity timestamps.
Markdown helpers are available in MCP as `markdown_commands`, `markdown_render`,
`markdown_plain_text`, and `markdown_apply_command`.

Agentic note operations are available through `personalnotes agent ...` and MCP
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

The web bridge exposes `window.PersonalNotes.chat.state/tools/send/approve/clear`
and dispatches `hasna:chat-*` events for state, messages, deltas, tool calls,
tool results, source references, confirmations, finish, and errors. The local
sidecar also exposes `POST /chat` as an optional AI SDK streaming endpoint over a
provided note snapshot; disk writes remain in the app/CLI/MCP tool layer.

### Recording and transcription

The native app keeps recording as app-level state. The web bridge exposes
`window.PersonalNotes.recording.state/start/pause/resume/stop` and dispatches
`hasna:recording-state`, `hasna:recording-progress`,
`hasna:transcript-delta`, and `hasna:transcript-complete` events. Exposed
states are `idle`, `recording`, `paused`, `stopping`, `transcribing`,
`complete`, and `error`, so stop-to-transcribing is observable. Realtime
transcription uses OpenAI realtime
transcription when `OPENAI_API_KEY` is available, with ElevenLabs Scribe v2
Realtime as an optional fallback when `ELEVENLABS_API_KEY` is present. Bounded
OpenAI transcription remains the fallback and defaults to `gpt-4o-transcribe`.
For OpenAI realtime, the sidecar uses the transcription-session WebSocket
endpoint (`/v1/realtime?intent=transcription`) and sends
`HASNA_NOTES_OPENAI_REALTIME_TRANSCRIPTION_MODEL` (default
`gpt-realtime-whisper`) as `audio.input.transcription.model`. No `model=` query
parameter is sent on that WebSocket. Transcription-only models are rejected from
the legacy realtime session-model slot; if an override puts
`gpt-realtime-whisper`, `gpt-4o-transcribe`, `gpt-4o-mini-transcribe`, or
`whisper-1` there, the sidecar falls back to `gpt-realtime` and reports a
`configWarnings` entry from `/health`. `HASNA_NOTES_TRANSCRIBE_MODEL=
gpt-realtime-whisper` is also ignored, because bounded transcription uses
request/response speech-to-text models.

## Requirements

- macOS 26 (Liquid Glass). Older systems fall back to `.ultraThinMaterial`.
- Swift 6.x toolchain (Xcode or Command Line Tools).
