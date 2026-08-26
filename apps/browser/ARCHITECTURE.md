# Hasna Browser Architecture

## Overview

Hasna Browser is a browser agent toolkit exposed as a CLI, MCP server, REST
server, and TypeScript SDK. It provides page understanding, bounded page
actions, evidence capture, storage, recordings, and session cleanup. Reusable
site or domain behavior belongs in skills or Browser-owned workflow manifests,
with Browser retaining authority for bounded execution and evidence capture.

## Workflow Ownership

Browser owns reusable workflow storage. File-backed workflow manifests live in:

```text
<resolver-resolved browser data home>/workflows/
```

Other projects may generate evidence, tests, or site-specific runner code, but
workflow definitions should be installed into Browser's data directory rather
than copied into project-local registries.

The first-class `browser workflow` CLI surface owns file-backed manifests:

- `dir` to print the canonical workflow directory.
- `list`, `show`, and `validate` for workflow discovery and schema checks.
- `run` for execution through Browser-owned engines, including Kernel.
- action scripts live beside their manifests under the Browser workflow
  directory and run with bounded helpers for screenshot/evidence capture,
  page text/elements, deterministic stop gates, and cleanup.

Agentic workflow steps should be typed and bounded. They can classify pages,
select among visible candidates, or propose selector repair, but deterministic
Browser code remains responsible for validation and execution. Secrets should
not be passed to agentic steps, and interactive CAPTCHA handling should use
supported provider behavior or a stop/human gate.

## Agent Surface

The primary agent-facing surface is semantic and bounded:

- `page-map` builds sanitized page text, forms, and interactive refs.
- `observe` maps a task instruction to structured candidate actions.
- `act` executes selected ref actions after risk classification.
- `validate` checks postconditions against sanitized page state.

Candidate actions are derived from the current page map. Model-assisted steps
can rank candidate IDs, but they cannot invent selectors, refs, JavaScript, or
new action kinds. `act` refreshes the page map and reclassifies cached or
direct actions before execution.

Risk is classified through generic DOM and form policy tags including account
creation, credential entry and submit, legal acceptance, CAPTCHA, MFA, payment,
file upload and download, destructive actions, navigation, and external
mutation. Sensitive and externally mutating actions fail closed unless the
caller explicitly allows risk for that operation.

## Engines

| Engine | Auto-selected | Primary Use |
| --- | --- | --- |
| `bun` | Yes, when available | Fast read-only scraping, status checks, screenshots, and navigation |
| `lightpanda` | Yes, fallback for static reads | Fast static extraction when Bun.WebView is unavailable |
| `playwright` | Yes | Forms, SPAs, auth flows, multi-tab work, uploads, PDFs |
| `cdp` | Yes for DevTools use cases | Network logs, HAR capture, performance profiling, coverage |
| `tui` | Explicit or terminal use case | Terminal UI testing through ttyd and Playwright |
| `extension` | No | Explicit real Chrome profile automation through a paired MV3 extension |
| `kernel` | No | Explicit kernel.sh cloud browser sessions |

Engine selection lives in `src/engines/selector.ts`. Per-call explicit engine
selection wins, then `OPEN_BROWSER_BACKEND`, then use-case routing. The
extension and kernel engines are explicit-only.

## Chrome Extension Engine

The extension engine runs bounded jobs inside a user-loaded Chrome MV3
extension. The extension connects back to `browser-serve` over loopback
WebSocket after the user enters a short-lived pairing code.

Core files:

- `extension/`: MV3 extension source and Vite build.
- `src/lib/extension-bridge.ts`: pairing codes, token store, socket registry,
  and job/result correlation.
- `src/engines/extension.ts`: Playwright-Page-compatible proxy for bounded
  jobs such as navigate, click, fill, select, wait, scroll, extract, and
  screenshot.
- `src/server/index.ts`: REST endpoints for extension pairing, status,
  dispatch, and token revocation.

Website credentials are never copied into Browser. Tokens are stored only by
the extension in `chrome.storage.local`. The default manifest does not request
`chrome.cookies`. DOM events created by the extension are synthetic page events,
not hardware-level user input.

## Package Layout

```
browser/
├── src/
│   ├── cli/                 # browser CLI commands
│   ├── db/                  # SQLite schema and optional storage sync support
│   ├── engines/             # Playwright, CDP, Bun, Lightpanda, TUI, extension, Kernel
│   ├── lib/                 # bounded browser primitives and shared runtime logic
│   ├── mcp/                 # MCP tool registration and transports
│   ├── server/              # REST server and request schemas
│   ├── sdk.ts               # package-level SDK facade
│   └── index.ts             # public package exports
├── dashboard/               # browser-serve dashboard
├── extension/               # Chrome MV3 extension
├── scripts/                 # build, test, and release verification scripts
├── package.json
├── README.md
└── ARCHITECTURE.md
```

## Storage

Local state is stored under the resolver-resolved browser data home
(`@hasna/paths`; the legacy `~/.hasna/browser` default until the XDG data home
is adopted or `BROWSER_DATA_DIR` is set) by default. SQLite owns local
sessions, snapshots, recordings, screenshots, downloads, network logs, console
logs, profiles, and gallery metadata. Optional package-local Postgres sync is
available through the storage commands and `@hasna/browser/storage`.

Legacy script, cron, and watch storage tables are intentionally dropped during
migrations and are not recreated by storage sync.

## Release Contract

Before publishing, `bun run verify:release` runs typecheck, full tests, build,
and release verification. The verifier checks package metadata, pack contents,
CLI bins, package imports, MCP startup, REST startup, and extension artifacts.
