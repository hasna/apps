# @hasna/clip

Open Clip is a local and self-hosted screenshot and clipboard sharing toolkit.
It captures screenshots or clipboard content, stores the artifact locally, and
returns a URL for the local HTTP server or a configured self-hosted host.

The package provides:

- CLI binary: `clip`
- MCP binary: `clip-mcp`
- HTTP binary: `clip-serve`
- SDK package: `@hasna/clip`
- Local data under `~/.hasna/clip/` by default
- A thin macOS menu bar app under `Sources/`

There is no SaaS mode. Local mode works without a remote service, and
self-hosted mode serves the same local store.

## Install

Open Clip requires Bun 1.3 or newer.

```bash
bun add --global @hasna/clip
```

An npm global install also works when Bun is already installed and available on
`PATH`:

```bash
npm install --global @hasna/clip
```

## Quick Start

```bash
clip capture full --json
clip clipboard --kind auto --json
clip history capture --kind text --json
clip history
clip history share <history-id-or-slug> --copy-link
clip share text "handoff note" --title "Note" --ttl 2h --json
clip share file ./screenshot.png --expires-at 2030-01-01T12:00:00Z --json
clip list --json
clip show <id-or-slug> --qr
clip copy-link <id-or-slug>
clip prune
```

`--json` is a global option and emits compact JSON from commands that produce
output. See [CLI reference](docs/cli.md) for every command and option.

## CLI

```
clip capture [full|window|region]   capture and optionally annotate a screenshot
clip clipboard                      share clipboard text, image, or file content
clip history                        manage opt-in local clipboard history
clip share text|file                create a share from explicit content
clip list                           list recent shares
clip show <id-or-slug>              show one share
clip delete <id-or-slug>            soft-delete one share
clip prune                          preview or apply expiry/artifact cleanup
clip open <id-or-slug>              open an artifact or share URL locally
clip open-recent                    open the most recent active share
clip copy-link <id-or-slug>         copy or render a share URL
clip serve                          start the self-hosted HTTP server
clip config get|set|list            manage local config
clip status                         show storage and platform status
clip doctor                         diagnose local capabilities
clip uninstall --yes                remove the local Clip store and config
```

Capture is best-effort and depends on local platform tools:

- macOS: `screencapture`; active-window metadata uses `osascript`.
- Linux: `gnome-screenshot`, `grim`, or `scrot`; window and region capture
  require `gnome-screenshot`, and active-window metadata uses `xdotool`.
- Windows: full-screen capture uses Windows PowerShell. Window and region
  capture are not implemented.

Clipboard support uses `pbpaste`/`pngpaste` on macOS, `wl-paste` or `xclip` on
Linux, and Windows PowerShell on Windows. `clip doctor` reports the capabilities
available on the current host. See [platform support](docs/platforms.md) for
the backend matrix, display/session constraints, and unsupported operations.

## HTTP API

```bash
clip serve
clip-serve
```

The default bind is `127.0.0.1:3741`. When binding beyond localhost, protect
mutating routes with a bearer token:

```bash
CLIP_AUTH_TOKEN="replace-with-a-secret" \
  clip serve --host 0.0.0.0 --base-url http://192.168.1.20:3741
```

`POST` and `DELETE` routes require the token when configured. Read routes remain
open unless an individual share has access-token or password protection.

See [HTTP API reference](docs/http-api.md) for routes, request fields, access
protection, and artifact serving behavior.

## MCP

```bash
clip-mcp
clip-mcp --http --port 8874
```

The default transport is stdio. Streamable HTTP binds to
`http://127.0.0.1:8874/mcp`. The server exposes seven tools for status, capture,
clipboard sharing, text sharing, listing, lookup, and deletion, plus
`clip://status` and `clip://shares` resources.

See [MCP reference](docs/mcp.md) for exact tool names and schemas.

## SDK

The SDK operates directly on the local SQLite and artifact store. `baseUrl`
controls generated share URLs; it does not turn the client into a remote HTTP
client.

```ts
import { createClipClient } from "@hasna/clip";

const clip = createClipClient({ baseUrl: "http://127.0.0.1:3741" });
const record = clip.createTextShare("hello from the SDK", {
  title: "Hello",
  ttl: "2h",
});
console.log(record.shareUrl);
```

See [SDK reference](docs/sdk.md) for client methods and package exports.

## Configuration

The default config path is `~/.hasna/clip/config.json`. `HASNA_CLIP_HOME` or the
global `--home` option moves both the default data directory and config path.
Supported config keys include `baseUrl`, `host`, and `port`.

Environment overrides:

- `HASNA_CLIP_HOME`: local data and config directory
- `HASNA_CLIP_DB_PATH` or `CLIP_DB_PATH`: SQLite database path
- `HASNA_CLIP_ARTIFACT_DIR`: artifact directory
- `CLIP_BASE_URL`: generated share URL base
- `HOST`, `PORT`: HTTP bind and generated share URL defaults
- `CLIP_AUTH_TOKEN`: bearer token required by mutating HTTP routes
- `MCP_HTTP`: set to `1` to run `clip-mcp` over Streamable HTTP
- `MCP_HTTP_PORT`: MCP HTTP port, default `8874`
- `HASNA_CLIP_CLI`: explicit CLI executable used by the macOS app

Command-line options take precedence over the corresponding environment
defaults.

## macOS Menu Bar App

The macOS app delegates capture, clipboard sharing, and opening recent content
to the `clip` CLI; it does not write SQLite or artifact files directly.

See [macOS app](docs/macos-app.md) for its actions, CLI resolution, and local
build instructions.
