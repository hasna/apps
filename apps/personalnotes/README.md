# Personal Notes

A Markdown-first notes core with a clean CLI, an MCP server, and a local serve
surface — plus a beautiful native desktop UI. Notes are stored as plain Markdown
files with YAML frontmatter, so they stay forward-compatible with any tool that reads
the same directory.

Published as the public npm package [`@hasna/personalnotes`](https://www.npmjs.com/package/@hasna/personalnotes).

## Two ways to run it

Personal Notes has exactly two product stories:

1. **Host it yourself** — clone this repo (`hasna/personalnotes`) or install
   `@hasna/personalnotes` from npm and run it in any environment of yours (laptop,
   server, your own cloud). Notes live as Markdown on your disk; nothing leaves your
   machine.
2. **Personal Notes Cloud** — a hosted, multi-tenant offering operated for you, if you
   would rather not run it yourself.

There is no other tier — no license keys, no bring-your-own-cloud split. Host it, or
use the Cloud.

## Install

```bash
# one-off, no install
npx @hasna/personalnotes list --limit 10

# or install the bins globally
npm install -g @hasna/personalnotes   # (bun add -g @hasna/personalnotes)
```

This gives you three bins:

| Bin | Purpose |
| --- | --- |
| `personalnotes` | CLI for notes, labels, pagination, titles, and the notes agent |
| `personalnotes-mcp` | MCP stdio server exposing the same functionality to agents |
| `personalnotes-serve` | Local AI serve surface (auto-title, transcription, chat) |

## What it is

- A clean, Apple-Notes-style desktop UI: a narrow **purple Liquid-Glass sidebar**
  (Library / Folders / Labels) beside ONE continuous **white canvas** — a compact
  header line ("12 notes · Updated 3m ago"), a searchable **note list**, and a
  **rich-text editor** — separated only by subtle hairline dividers, no boxed panels.
- **Markdown editing** with stable commands for bold, italic, code, links, headings,
  lists, quotes, code blocks, checklists, and dividers. Markdown on disk is the
  contract.
- **Agentic Chat contracts** for tool-capable note search, summarization,
  organization, consolidation, and safe write previews. The repo exposes the
  state/events/tools; the visual Chat UI consumes them.
- Per-note **status / labels / folder** live behind a subtle settings popover, keeping
  the editor surface clean.
- **Folders** (persisted to `folders.json`, empty folders survive).
- Liquid Glass on the sidebar (`.glassEffect`, interactive) over an "infinity purple"
  gradient, with light/dark and reduce-transparency support.

## Data format — the contract

The Markdown files are the **source of truth**. Personal Notes reads and writes them so
any other tool can index the same directory.

- Data root: `~/.hasna/apps/notes/`
- Notes: `~/.hasna/apps/notes/notes/<id>.md` (id is a lowercased UUID)
- Writes are **atomic** (temp file in the same dir, then `rename`).
- A missing/empty directory is created automatically.
- Files without frontmatter are treated as a body with a title derived from the first line.
- The closing `---` is followed by a single newline and then the body **immediately**
  (no blank separator line); the body is preserved byte-for-byte on round-trip.
- Scalar fields (title/author) are double-quoted when they contain special characters,
  with `\\`, `\"`, and `\n` escaped; labels that contain a comma, bracket, quote, or
  surrounding space are double-quoted in the `[...]` list.

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
agent: hasna-notes-app  # legacy on-disk token, kept for back-compat
---
The markdown body goes here.
```

Notes written by older versions (`tags`, no `folder` key, no `contentFormat` key,
`agent: open-notes-app`) still parse — unknown/missing keys are tolerated. The user's
folder list is persisted separately in `~/.hasna/apps/notes/folders.json`; labels can
also be persisted in `~/.hasna/apps/notes/labels.json` so empty labels survive.

> The on-disk `HASNA_NOTES_*` environment prefix, the `~/.hasna/apps/notes/` data root,
> and the `agent: hasna-notes-app` token are retained for back-compatibility with
> existing note stores.

AI-generated titles are concise, capped to 3-4 words, and use the local serve surface's
cheap OpenAI title model by default (`HASNA_NOTES_TITLE_MODEL`, default `gpt-4o-mini`).
Title generation reads Markdown as plain text so syntax and raw HTML do not leak into
titles. Manual titles are locked and are not overwritten unless a caller explicitly
forces generation.

Markdown rendering is intentionally restricted. CLI, MCP, and web bridge helpers escape
raw HTML, drop unsafe links, and expose plain-text extraction for titles and search:

```bash
personalnotes markdown commands
personalnotes markdown render <note-id>
personalnotes markdown plain-text <note-id>
personalnotes markdown apply-command bold --text hello --selection-start 0 --selection-end 5
```

Archive and Trash are first-class note states. Normal Delete moves a note to Trash;
deleting a note already in Trash, or calling an explicit purge, permanently removes the
file. Trash retention defaults to 30 days and is stored in
`~/.hasna/apps/notes/settings.json`.

## CLI

```bash
personalnotes list --limit 10
personalnotes labels assign <note-id> research
personalnotes archive <note-id>
personalnotes delete <note-id>          # moves to Trash
personalnotes purge <note-id>           # permanent delete
personalnotes settings set-trash-retention 30
personalnotes title <note-id> --apply
personalnotes markdown commands
personalnotes agent "summarize notes" --json
personalnotes agent "consolidate notes" --json       # preview
personalnotes agent "consolidate notes" --yes --json # write
```

The CLI and MCP both default lists to the latest 10 notes and return pagination
metadata in JSON/MCP responses. Destructive or broad writes return a preview unless
confirmed (`--yes` in CLI or `confirm: true` in MCP): `delete`, `trash`,
`cleanup-trash`, `notes_delete`, `notes_trash`, and `trash_cleanup` preview unless
confirmed, while permanent `purge` / `notes_purge` require `--yes` / `--force` or
`confirm: true`.

## MCP

```bash
personalnotes-mcp        # stdio MCP server
```

Markdown helpers are available in MCP as `markdown_commands`, `markdown_render`,
`markdown_plain_text`, and `markdown_apply_command`. Agentic note operations are
available through `agent_tools`, `agent_run`, and `agent_tool_call`. The shared tool
registry supports list/search/read, create/update/append, label/unlabel,
archive/trash/restore, summarize, related-note discovery, and consolidation into a
larger note. The CLI and MCP call the SAME storage/domain layer (`tools/notes-lib.mjs`,
`tools/notes-agent.mjs`) — no copy-paste handlers.

## Serve surface

```bash
OPENAI_API_KEY=... PORT=8765 personalnotes-serve
curl -s localhost:8765/health
```

`personalnotes-serve` is a tiny dependency-light HTTP server (Node's built-in `http`,
no framework) that exposes local AI capabilities over the Vercel AI SDK:

- `POST /title` — summarize a note body into a short 3–4 word title.
- `POST /transcribe` — speech-to-text for voice notes.
- `WS /realtime-transcribe` — normalized streaming transcript events.
- `POST /chat` — tool-call chat over a provided note snapshot.
- `GET /health` — liveness probe.

Configuration is entirely via env: `OPENAI_API_KEY` (never logged) and `PORT` (bound on
`127.0.0.1`). The API key is never written to stdout/stderr.

## Desktop app

This repo also contains a native macOS desktop app (SwiftUI + a WKWebView shell hosting
the bundled web UI) that consumes the notes core. It builds with **SwiftPM only** — no
Xcode required — and targets macOS 26 (Liquid Glass APIs).

```bash
bash scripts/build_hasnanotes.sh   # swift build -c release + bundle web UI + serve surface + codesign
open "dist/Personal Notes.app"
```

Older systems fall back to `.ultraThinMaterial`; a Swift 6.x toolchain is required.

## Verify

```bash
bun test                                    # rename/package-identity checks
npm run test:node                           # node --test store round-trip suite
```
