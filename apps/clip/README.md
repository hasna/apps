# @hasna/clip

Open Clip is a local and self-hosted screenshot and clipboard sharing toolkit.
It captures screenshots or clipboard content, stores the artifact locally, and
returns a share URL for the local HTTP server or a configured self-hosted host.

It ships in one repo:

- CLI binary: `clip`
- MCP binary: `clip-mcp`
- HTTP binary: `clip-serve`
- SDK package: `@hasna/clip`
- Local data: `~/.hasna/clip/`
- macOS menu bar app source under `Sources/`

There is no SaaS mode. Local mode works without any remote service, and
self-hosted mode serves the same local store.

## Install

```bash
npm install -g @hasna/clip
```

## Quick Start

```bash
clip capture full --json
clip clipboard --json
clip history capture --kind text --json
clip history
clip history share <history-id-or-slug> --json
clip share text "handoff note" --title "Note" --json
clip share file ./screenshot.png --json
clip list --json
clip show <id-or-slug> --json
clip copy-link <id-or-slug>
clip serve --host 0.0.0.0 --port 3741 --base-url http://192.168.1.20:3741
```

`--json` is a global option on every subcommand; output is compact JSON for agents.

## CLI

```
clip capture [full|window|region]   capture a screenshot when OS tools allow it
clip clipboard                      share clipboard text, image, or file content
clip history                        list opt-in local clipboard history
clip history capture                capture clipboard content into local history
clip history share <id-or-slug>     create a share from a history item
clip share text <text...>           create a text share
clip share file <path>              import and share a local file
clip list                           list recent shares
clip show <id-or-slug>              show one share
clip delete <id-or-slug>            soft-delete a share
clip open <id-or-slug>              open the artifact or share URL locally
clip open-recent                    open the most recent non-deleted share
clip copy-link <id-or-slug>         copy the share URL to the clipboard
clip serve                          start the self-hosted HTTP server
clip config get|set|list            manage local config
clip doctor                         inspect capture and clipboard capabilities
clip status                         show storage and platform status
```

Screenshot and active-window support is best-effort. On macOS the CLI uses
`screencapture` when available. On Linux it uses tools such as
`gnome-screenshot`, `grim`, `wl-paste`, and `xclip` when installed. When active
window or browser detection is unavailable, commands report that clearly instead
of pretending certainty.

## HTTP API

```bash
clip serve
clip-serve
```

Default bind is `127.0.0.1:3741`.

Useful routes:

- `GET /health`
- `GET /api/status`
- `GET /api/shares?limit=25`
- `POST /api/shares` with JSON `{ "text": "hello" }` (optional `title`; or `dataBase64` + `mimeType` for uploads)
- `POST /api/capture` with JSON `{ "mode": "full" }`
- `POST /api/clipboard` with JSON `{ "kind": "auto" }`
- `GET /api/shares/:idOrSlug`
- `DELETE /api/shares/:idOrSlug`
- `GET /s/:slug`
- `GET /s/:slug/raw`

## MCP

```bash
clip-mcp
clip-mcp --http --port 8874
```

Tools include capture, clipboard sharing, list, get, delete, status, and text
share creation. Resources include `clip://status` and `clip://shares`.

## SDK

```ts
import { createClipClient } from "@hasna/clip";

const clip = createClipClient({ baseUrl: "http://127.0.0.1:3741" });
const record = clip.createTextShare("hello from the SDK", { title: "Hello" });
console.log(record.shareUrl);
```

## Configuration

Environment overrides:

- `HASNA_CLIP_HOME`: local data directory
- `HASNA_CLIP_DB_PATH` or `CLIP_DB_PATH`: SQLite database path
- `HASNA_CLIP_ARTIFACT_DIR`: artifact directory
- `CLIP_BASE_URL`: share URL base
- `HOST`, `PORT`: server bind

Config is stored at `~/.hasna/clip/config.json`.

## macOS Menu Bar App

The macOS app is a thin native shell. It builds menu actions and delegates every
mutation to the `clip` CLI so the CLI remains the write-path source of truth.
See `docs/macos-app.md`.
