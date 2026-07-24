# @hasna/ui

Offline-first UI design toolkit. It mirrors the **ui.sh** design skill locally and
previews UI variants in the browser with a **self-contained, dependency-free
picker** — no remote MCP, no hosted picker script. Bring your own ui.sh access,
harvest the design skill once, and work fully offline after that.

`@hasna/ui` is stateless at the package level. Harvested ui.sh content is a
user-managed local mirror under `content/` and can be deleted or regenerated.

> **Note on content:** this repo ships the *tooling* only. The ui.sh design
> guidelines are ui.sh's content and are **not redistributed here** — run
> `ui harvest` with your own ui.sh MCP credentials to populate `content/`
> locally (git-ignored). The variant picker (`src/picker.ts`) is an original,
> behaviour-compatible reimplementation of ui.sh's picker.

## What's here

| Piece | File | Role |
| --- | --- | --- |
| MCP client | `src/mcp-client.ts` | Minimal MCP-over-HTTP client (initialize + tools/call), SSE/JSON aware |
| Harvester | `src/harvest.ts` | Crawls the design skill from its root resource and mirrors the tree to `content/` |
| Fetch shim | `src/fetch.ts` | Offline resource fetch (reads `content/`) |
| Picker | `src/picker.ts` → `public/ui-picker.js` | Self-contained variant picker (`data-uidotsh-*` contract), ~9 KB, zero deps |
| Server | `src/server.ts` | Serves a demo, the picker, and an HTTP fetch shim |
| CLI | `src/cli.ts` (`ui`) | `ui fetch <uri…>`, `ui list`, `ui serve [port]` |
| Demo | `src/demo.ts` | Three hero variants for picker comparison |

## Install

```sh
bun add -g @hasna/ui     # or: bunx @hasna/ui ...
```

The package does not include the harvested `content/` mirror. Until you create
one, `ui fetch` and `ui list` fail with setup guidance instead of pretending
the package has zero resources.

## Use

```sh
bun install
# configure access (git-ignored): UIDOTSH_TOKEN + UIDOTSH_MCP_URL
cp .env.example .env.local && $EDITOR .env.local
set -a; source .env.local; set +a

ui harvest               # mirror the design skill into content/ (your token)
bun run build:picker     # build public/ui-picker.js
bun run serve            # http://localhost:5173  (?picker=local | ?picker=reference)
bun test                 # fetch-shim + content-tree tests (needs content/)

ui fetch uidotsh://ui/design-guidelines/buttons
ui list
```

By default the CLI reads `./content` from the current project directory. Set
`HASNA_UI_CONTENT_DIR=/path/to/content` when the mirror lives somewhere else.

## The variant picker

Mark up variants with the picker contract and one option visible:

```html
<div data-uidotsh-pick="Hero style" class="contents">
  <div data-uidotsh-option="Minimal" class="contents">…</div>
  <div data-uidotsh-option="Bold" class="contents" hidden>…</div>
</div>
<script src="/ui-picker.js"></script>   <!-- our local, self-contained picker -->
```

The picker renders a fixed bottom-center toolbar (prev / select / next, ←/→ to
change, ↑/↓ to open the list) to toggle variants live, then you keep the chosen
one. No external script is loaded.

## License

MIT © hasna
