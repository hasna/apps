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

CLI output is compact by default so agent terminals do not fill context with
large records. List and status commands show essential fields, cap row counts,
truncate long text/URLs, and print a hint for the detail path.

Use gradual disclosure when you need more:

```bash
browser session list --limit 50 --verbose
browser session show <id>
browser gallery get <id> --json
browser downloads list --json
```

`--json` is the machine-readable path and returns full records where the command
previously exposed them. MCP list tools follow the same rule: compact summaries
by default, `limit`/`offset` for pagination, `verbose=true` for full records in
the selected page, and explicit payload flags such as `include_base64=true`,
`include_thumbnail=true`, or `include_har=true` for large binary or HAR data.

## Semantic Browser Tools

Browser is the substrate for agents and skills, not a recipe registry. Agents
should use Browser to inspect a sanitized page model, choose from structured
actions, execute refs deterministically, validate results, and record evidence.

```bash
browser page-map https://example.com --json
browser observe https://example.com "find the login form" --json
browser act https://example.com "click the login button" --screenshot --json
browser validate https://example.com "the cart drawer is open" --json
```

The same surface is exposed through MCP as `browser_page_map`,
`browser_observe`, `browser_act`, and `browser_validate`.

`observe` builds deterministic candidate actions first. Model assistance, when
enabled, ranks those bounded candidate IDs; it cannot invent selectors, refs,
JavaScript, or new actions. `act` refreshes the current page map before running
cached or direct actions and reclassifies the target against generic policy
tags such as `account_creation`, `credential_entry`, `legal_acceptance`,
`captcha`, `mfa`, `payment`, and `external_mutation`.

Actions tagged as sensitive or externally mutating require explicit approval.
This is intentionally generic: the policy is based on DOM/form semantics and
labels, not website-specific scripts.

Skills should describe the task, risk policy, model prompts, output schema, and
stop conditions. Browser owns the page map, refs, actions, screenshots,
recordings, downloads, evidence, and session cleanup. Site-specific JavaScript
and durable site-specific manifests are not the primary automation model.

## Choose The Control Lane

Use the narrowest browser lane that can finish the job:

| Lane | Use it for | Boundary |
|------|------------|----------|
| Browser-native automation | Owned sites, local fixtures, staging apps, CI, extraction, screenshots, audits, forms, and repeatable workflows in controlled browser sessions. | Use Playwright, CDP, Bun, or Lightpanda through the CLI, SDK, MCP, or REST API. `--headed` makes the automation browser visible; it does not turn automation into user-trusted hardware input. |
| Extension engine | Authorized workflows inside an operator-paired visible Chrome profile that is already logged in. | Use `--engine extension` only after `browser-serve` and `browser extension pair`. Extension sessions are explicit-only, policy-gated, and never selected by `auto`. |
| Pixel computer control | Browser chrome, OS dialogs, cross-app workflows, or visual-only UI that browser APIs cannot reach. | Use `@hasna/computer` for display-level mouse, keyboard, and screenshot control, then keep browser page work in this package when possible. |

Do not use browser automation, headed mode, CDP, stealth settings, or the
extension engine to bypass CAPTCHA, MFA, bot detection, rate limits, paywalls,
access controls, website terms, or anti-abuse systems. Prefer official APIs.
Use automation only on domains, accounts, and data you are authorized to
operate, and stop for manual approval when a site presents authentication,
CAPTCHA, MFA, payment, or account-safety challenges.

## Workflow Ownership

Reusable browser workflows are Browser-owned runtime assets. Local workflow
manifests belong under the Browser data directory (resolved through
`@hasna/paths` — the legacy `~/.hasna/browser` default until the XDG data home
is adopted):

```text
<resolver-resolved browser data home>/workflows/
```

Project folders may contain source notes, tests, and run evidence, but they
should not become separate workflow registries. Use the first-class workflow
CLI surface for file-backed manifests:

```bash
browser workflow dir
browser workflow list
browser workflow show farfetch
browser workflow validate farfetch
browser workflow run farfetch public-smoke --json
```

Workflow bundles can either be single `*.workflow.json` files or directories
with `manifest.json` plus action scripts. Relative `scriptFile` paths are
resolved from the manifest directory, so site-specific executable workflow code
stays under the Browser workflow directory.

Workflow runs that use Kernel, Secrets, Mailery, or agentic decision steps
should keep Browser as the authority for safety gates, evidence capture, secret
redaction, and session cleanup.

## MCP Server

```bash
browser-mcp
```

## HTTP mode

Run a long-lived Streamable HTTP MCP server on `127.0.0.1` (default port **8851**):

```bash
browser-mcp --http
# or: MCP_HTTP=1 browser-mcp
# port override: --port 8851  or  MCP_HTTP_PORT=8851
```

- Health: `GET http://127.0.0.1:8851/health` → `{"status":"ok","name":"browser"}`
- MCP: `http://127.0.0.1:8851/mcp`

Stdio remains the default when no `--http` / `MCP_HTTP=1` is set.

## REST API

```bash
browser-serve
```

## Kernel Cloud Browsers

The `kernel` engine is explicit-only unless `OPEN_BROWSER_BACKEND=kernel` or
`OPEN_BROWSER_REMOTE=1` is set. Local fallback remains unchanged for `auto`:
the CLI still picks Bun, Lightpanda, or Playwright locally unless you ask
for Kernel.

Configure Kernel with the established secret first. The CLI checks the
vault key before `KERNEL_API_KEY` and never prints the key:

```bash
secrets set hasna/xyz/opensource/browser/prod/kernel_api_key <kernel-api-key>
# or provide KERNEL_API_KEY in the process environment for one process
browser kernel status --remote
```

Create an autonomous remote browser:

```bash
browser kernel open --url https://example.com --headed --kernel-profile-name example-agent
browser navigate https://example.com --engine kernel --kernel-profile-name example-agent --screenshot
browser session create --engine kernel --url https://example.com --kernel-timeout-seconds 600
```

Kernel session options are available through CLI, SDK, MCP, and REST:

- Profiles: `--kernel-profile-name`, `--kernel-profile-id`, or
  `--kernel-persistence-id`; named profiles are created when the SDK supports
  it. Profile state is saved when the Kernel browser is explicitly deleted or
  times out.
- Runtime: `--kernel-timeout-seconds`, `--kernel-proxy-id`, `--kernel-gpu`,
  `--kernel-kiosk-mode`, `--kernel-tag key=value`, `--kernel-project-id`, and
  `--kernel-base-url`.
- Secrets/env: `--kernel-env KEY=VALUE` for non-secrets and
  `--kernel-env-secret ENV_VAR=secret/key` for values resolved from
  `@hasna/secrets`.
- Auth: `--kernel-auth-mode managed|auto|cdp_autofill|off`. Managed auth uses
  Kernel connections/credentials when a matching vault login exists; `auto`
  falls back to CDP autofill if managed auth cannot start.

Remote operations:

```bash
browser kernel sessions --json
browser kernel exec <session> "await page.goto('https://example.com'); return await page.title();"
browser kernel computer screenshot <session>
browser kernel files list <session> --path /tmp
browser kernel files download <session> /tmp/report.pdf
browser kernel replays start <session>
browser kernel replays stop <session> <replay_id>
browser kernel replays download <session> <replay_id>
browser kernel close <session>
```

MCP tools include `browser_kernel_status`, `browser_kernel_sessions`,
`browser_kernel_playwright_execute`, `browser_kernel_computer_action`,
`browser_kernel_computer_screenshot`, `browser_kernel_files_*`, and
`browser_kernel_replay_*`. REST endpoints are exposed under
`/api/kernel/...`. SDK methods are available on `BrowserSDK`, for example
`sdk.executeKernel(session, code)`, `sdk.kernelFiles(session, "/tmp")`, and
`sdk.downloadKernelReplay(session, replayId)`.

Kernel create-time `start_url` is best-effort, so the CLI performs an
explicit navigation after attaching through CDP when `startUrl` is provided.
Use headful sessions (`--headed`) when live view or computer controls matter;
headless is still useful for fast script-only work. Kernel File I/O artifacts
are available only while the remote session is active, so download files or
replays before closing or allowing the session to time out.

## Chrome Extension Engine

The `extension` engine is explicit-only: it is never auto-selected. It runs
jobs inside a paired, user-loaded Chrome MV3 extension, so actions execute in
the user's real logged-in browser session and network context.
Creating extension sessions requires explicit operator approval through
`BROWSER_ALLOW_EXTENSION_SESSION=1` for a trusted local session, or
`BROWSER_CAPABILITY_TOKEN` plus the matching approval token.

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
- Arbitrary JavaScript jobs are not part of the extension dispatch protocol.
- Pairing codes are short-lived and single-use; tokens can be revoked with
  `browser extension unpair`.
- The default extension does not request `chrome.cookies`; provider-specific
  cookie export should be added only behind an explicit opt-in build/scope.
- DOM actions are injected into the real tab, but synthetic DOM events are not
  browser-trusted user input (`Event.isTrusted` stays false). Use the extension
  engine for authorized real-profile/session automation, not as a claim of
  hardware-level human input or a way around site anti-abuse controls.

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

The browser data home is resolved through `@hasna/paths` (XDG/macOS home
layout). The legacy `~/.hasna/browser` default stays the effective data home
until the store is actually migrated to the XDG data home
(`~/.local/share/hasna/browser` on Linux; `~/Library/Application
Support/Hasna/browser` on macOS) or the operator sets the data-kind override
`HASNA_DATA_HOME`, so an existing local store never becomes invisible on
upgrade. The exact-app override `BROWSER_DATA_DIR` wins over that default;
`BROWSER_DB_PATH` pins the SQLite database path directly.

## License

Apache-2.0 -- see [LICENSE](LICENSE)
