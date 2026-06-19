# @hasna/browser

General-purpose browser agent toolkit — Playwright, Chrome DevTools Protocol, Lightpanda with auto engine selection. CLI + MCP + REST + SDK.

[![npm](https://img.shields.io/npm/v/@hasna/browser)](https://www.npmjs.com/package/@hasna/browser)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue)](LICENSE)

## Install

```bash
npm install -g @hasna/browser
```

## CLI Usage

```bash
browser --help
```

## MCP Server

```bash
browser-mcp
```

## HTTP mode

Run a long-lived Streamable HTTP MCP server on `127.0.0.1` (default port **8802**):

```bash
browser-mcp --http
# or: MCP_HTTP=1 browser-mcp
# port override: --port 8802  or  MCP_HTTP_PORT=8802
```

- Health: `GET http://127.0.0.1:8802/health` → `{"status":"ok","name":"browser"}`
- MCP: `http://127.0.0.1:8802/mcp`

Stdio remains the default when no `--http` / `MCP_HTTP=1` is set.

## REST API

```bash
browser-serve
```

## Chrome Extension Engine

The `extension` engine is explicit-only: it is never auto-selected. It runs
jobs inside a paired, user-loaded Chrome MV3 extension, so actions execute in
the user's real logged-in browser session and network context.

```bash
bun run build:extension
browser-serve
browser extension pair
browser extension status
browser navigate https://example.com --engine extension
```

Load `extension/dist` in Chrome via `chrome://extensions` -> Developer mode ->
Load unpacked, then enter the six-digit pairing code in the toolbar popup. The
service worker dials out to `browser-serve` over loopback WebSocket and keeps
the MV3 worker alive with 20s pings plus `chrome.alarms`.

Security defaults:

- No server-side website credentials are stored; the user's Chrome session is
  the auth.
- The bridge accepts only explicit, token-authenticated jobs.
- Arbitrary JavaScript `evaluate` jobs are disabled unless
  `BROWSER_EXTENSION_ALLOW_EVAL=1`.
- Pairing codes are short-lived and single-use; tokens can be revoked with
  `browser extension unpair`.
- The default extension does not request `chrome.cookies`; provider-specific
  cookie export should be added only behind an explicit opt-in build/scope.
- DOM actions are injected into the real tab, but synthetic DOM events are not
  browser-trusted user input (`Event.isTrusted` stays false). Use the extension
  engine for real-profile/session automation, not as a claim of hardware-level
  human input.

## Video Recording

Record browser sessions as WebM video instead of one-off screenshots:

```bash
browser video record https://example.com --duration 5 --quality high
browser video record "htop" --engine tui --duration 10 --quality high
browser video record "codewith --auth-profile account002" --engine tui --duration 30 --preset x-square
browser video record "codewith --auth-profile account002" --engine tui --duration 30 --preset reels --format mp4
browser video record https://example.com --duration 30 --quality ultra --format mp4 --capture-mode cdp --encoding crisp --crf 10
browser video record https://example.com --duration 30 --quality ultra --format mov --capture-mode cdp --encoding prores
browser video record http://spark01.taild59be2.ts.net:3325/ --duration 20 --quality ultra --format mp4 --capture-mode x11 --fps 60 --display-scale 2 --crf 10
browser video list
```

MCP tools are available as `browser_video_start`, `browser_video_stop`,
`browser_videos_list`, and `browser_video_delete`. REST endpoints are exposed
under `/api/videos`. Quality presets map to the recording viewport (`medium`
= 720p, `high` = 1080p, `ultra` = 4K), and files are saved into the browser
downloads store with video metadata. TUI recording uses the existing ttyd
engine, so terminal apps are recorded through the rendered xterm.js browser
surface.

For crisp marketing captures, use `--quality ultra --format mp4
--capture-mode cdp --encoding crisp --crf 10` to record a 4K canvas through
lossless PNG frames and export a high-bitrate H.264 file.
MP4 defaults to crisp UI-friendly encoding (`CRF 12`, x264 `slow`, animation
tuning) instead of ffmpeg's generic defaults, and high-fidelity MP4/MOV
exports automatically prefer CDP capture unless you pass `--capture-mode
native`. For a Mac/QuickTime-style master file, use `--format mov
--capture-mode cdp --encoding prores`; this creates a much larger ProRes 422 HQ
`.mov` intended for editing or archival handoff before social export. Use
`--encoding lossless` with MP4 only when you need a huge H.264 lossless
intermediate, and `--fps 60`, `--video-bitrate 40M`, or `--ffmpeg-preset
veryslow` when you need explicit encoder control.

For smooth real-time marketing video, use `--capture-mode x11`. This launches
a headed Chromium window on a private Xvfb display and records that display via
ffmpeg `x11grab`, avoiding Playwright WebM compression and screenshot polling.
Use `--quality ultra --fps 60 --display-scale 2` for a Retina-style 4K output:
the browser lays out like 1920x1080 CSS pixels, while the captured video is
3840x2160 pixels. This mode requires `Xvfb` and an ffmpeg build with `x11grab`
and `libx264`; set `BROWSER_XVFB_PATH` or pass `--xvfb-path` if Xvfb is not on
`PATH`.

For social demos, use `--preset x-square` for X/Twitter feed posts or
`--preset reels` / `--preset tiktok` for vertical video. These presets render
the terminal inside a realistic light window with larger text, instead of
capturing an oversized raw desktop that becomes hard to read after platform
downscaling. Override the composition with `--tui-font-size`,
`--tui-zoom`, `--tui-frame-fit canvas`, `--tui-padding`, `--tui-window-width`,
`--tui-window-height`, `--tui-theme`, `--background`, or `--tui-frame off`.
Use `--tui-frame-fit canvas --tui-padding 24` for a terminal window that fills
almost the whole video, `--tui-frame-fit canvas --tui-padding 0` for framed
edge-to-edge output, or `--tui-frame off` for raw fullscreen terminal output.
Use `--tui-zoom 0.85` for slightly smaller text without changing the preset.
For colorized terminal demos, run commands with `FORCE_COLOR=3`,
`CLICOLOR_FORCE=1`, and `TERM=xterm-256color`. Native capture produces WebM;
use `--format mp4 --capture-mode cdp` for a social-upload-friendly H.264 MP4
export or `--format mov --capture-mode cdp --encoding prores` for the
highest-fidelity master. Conversion uses the bundled `ffmpeg-static` binary and
falls back to `BROWSER_FFMPEG_PATH` or system `ffmpeg`.

## Storage Sync

This package supports optional remote storage sync through a package-local Postgres connection:

```bash
export HASNA_BROWSER_DATABASE_URL=postgres://...
browser storage status
browser storage push
browser storage pull
browser storage sync
```

The MCP server also exposes `storage_status`, `storage_push`, `storage_pull`, and `storage_sync`.

Programmatic storage helpers are available from `@hasna/browser/storage`.
Programmatic video helpers are available from `@hasna/browser/video`, and the
extension bridge helpers are available from `@hasna/browser/extension`.

## Data Directory

Data is stored in `~/.hasna/browser/`.

## License

Apache-2.0 -- see [LICENSE](LICENSE)
