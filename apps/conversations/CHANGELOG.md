# Changelog

All notable changes to this project will be documented in this file.

## Unreleased

## [0.5.7] - 2026-07-24

### Fixed
- **History reconciliation: `main` now contains the published 0.5.x self-hosted/cloud line.** The npm-published 0.5.x releases (ApiStore routing, cloud read/receipt endpoints, server uuid message filter, Docker/ECR base image, `@hasna/contracts ^0.4.1` pin, releases through 0.5.6) had been shipped to npm but never merged back to `main` (which sat at an unreleased 0.3.5). This release merges the published `v0.5.6` tag into `main`, adopting all deployed 0.5.x behavior while preserving `main`'s channel-project-diagnostics work, so future publishes flow from `main` again.
- **Channel project diagnostics re-applied on top of the 0.5.x refactor** (previously main-only, not on the published line): the self-hosted API now returns structured `Validation failed` field errors (`code`/`field`/`value`/`reason`/`hint`) for `POST /v1/channels` and `PATCH /v1/channels/{name}` when `project_id` references a non-existent conversations project (e.g. an external Projects `wks_*` id), when the channel name normalizes to empty, or when `metadata`/`tags` are malformed. The OpenAPI document documents the `400` error schema. `conversationsCloudEnv` treats a command-level `HASNA_CONVERSATIONS_DB_PATH`/`CONVERSATIONS_DB_PATH` as an explicit local override so local test/dev commands cannot accidentally write to cloud when cloud credentials are exported globally. Webhook delivery failures are logged with redacted URLs instead of being silently swallowed.

## [0.5.1] - 2026-07-08

### Fixed
- **Relative `--since` durations no longer 500 against the self_hosted API.** The CLI/MCP/SDK forwarded a raw relative duration (`7d`, `24h`, `1w`, `30m`, `45s`, combos like `1w2d3h`) straight into the cloud query as `since=7d`, which the service could not parse and returned `500`. Relative durations are now converted to an absolute ISO-8601 timestamp (`new Date(now - ms).toISOString()`) before the request in `read`, `digest`, `search`, `export`, and channel `notifications`; ISO/absolute values pass through untouched, so the change is backward-compatible and reversible. The same normalization also fixes the previously silent wrong-results case where a relative duration was string-compared against `created_at` in local mode. New shared helper `src/lib/since.ts` (`normalizeSince`) with unit tests.

### Added
- **Self-hosted HTTP API surface (`conversations-serve`)**: a pure-remote (Amendment A1) service that reads/writes the app's cloud Postgres directly via the vendored `@hasna/contracts` storage kit. Exposes `GET /health`, `/ready`, `/version` (`{status,version,mode}`) and a versioned `/v1` API (messages, channels, projects, agent presence) guarded by `@hasna/contracts` API-key auth (`conversations:read` / `conversations:write` scopes). `GET /v1/openapi.json` serves the OpenAPI document.
- **Generated typed SDK** under the `@hasna/conversations/sdk` export, generated from the serve OpenAPI (`bun run sdk:generate`).
- **Migration runner** (`src/server/migrate.ts`) that applies the app schema + `api_keys` table via the owner role (idempotent; never clobbers data).
- **Vendored storage kit** at `src/generated/storage-kit/` (`@hasna/contracts` kit v0.4.1).
- **`hasna.contract.json`** service-contract manifest + conformance test, `Dockerfile` (ARM64/bun), and `docker-compose.yml` for the self-hosted deploy.
- Channel rename support: `conversations channel rename <old> <new>` and `conversations channel update <name> --name <new>` rename a channel while preserving its messages, members, subscriptions, mentions, tasks, graph edges, and locks. Exposed over MCP via the new `rename_channel` tool and the `new_name` field on `update_channel`.
- Added cursored byte-capped channel digests for agents and loops via `conversations digest <channel> --cursor --max-bytes --json` and MCP `read_digest`.
- Digest payloads include `digest_id`, `message_ids`, `next_cursor`, bounded snippets, and byte length metadata so agents can continue without replaying long channels.

### Changed
- `digest` is non-destructive by default. Use `--unread` to restrict to unread messages and `--mark-read --from <agent>` when the returned digest should update read state.

## [0.3.0] - 2026-06-24

### Breaking
- Replaced the runtime spaces/sub-spaces model with flat Slack-like channels.
- Removed public space/sub-space API, CLI, MCP, SDK, dashboard, and storage names. Channel commands and tools are the supported surface.
- Legacy spaces are only read by the one-time database migration path. The application no longer keeps backwards-compatible space commands or tools alive.

### Migration
- Existing nested spaces are deterministically imported as flat channels. Parent context is preserved in channel `metadata.import_source`, `tags`, and descriptions instead of a nested runtime hierarchy.
- Migration preserves messages, channel participants, notification subscriptions/read positions, mentions, tasks, graph edges, resource locks, project links, webhooks, and storage metadata.
- Channel names are normalized to stable human-readable ids. Collisions are resolved deterministically with suffixes so no legacy content is dropped.

### Changed
- CLI, MCP tools/resources, SDK exports, dashboard routes, dashboard UI, tests, and examples now use channel-first naming.
- The dashboard Channels page now shows a flat channel list with unread counts and a channel feed.
- Message sessions for channel traffic are canonicalized as `channel:<name>`.

## [0.1.21] - 2026-03-12

### Performance
- MCP tool definitions reduced from ~4,025 to ~2,489 tokens per API call (38% reduction)
- Stripped all `.describe()` text and `title` fields from tool schemas
- `describe_tools()` covers all 33 tools with full param docs on demand

## [0.1.19] - 2026-03-12

### Performance
- `readMessages` and `searchMessages` default limit lowered from 50 to 20
- Added `compact: true` option to `readMessages` — strips null fields from results (~50% smaller)
- MCP error messages shortened for leaner tool results

## [0.1.18] - 2026-03-11

### Added
- **Reactions** — emoji reactions on any message (`addReaction`, `removeReaction`, `getReactions`, `getReactionSummary`)
- **File/image attachments** — files copied to `~/.conversations/attachments/{id}/` with MIME detection
- **Threaded replies** — `reply_to` column on messages, `getThreadReplies(messageId)`
- **Webhook notifications** — async POST to configured URLs on dm/blocker/space/mention events (`~/.conversations/config.json`)
- `conversations whoami` — show identity, source, and online status
- `conversations watch --all` — unified stream of DMs + all subscribed spaces
- `conversations dashboard --open` — auto-open browser after server starts
- Terminal markdown rendering in `conversations read` and `conversations space read`
- `search_tools` and `describe_tools` MCP meta-tools for tool discovery

### Dashboard
- Agents page with online/offline cards, colored avatars, last-seen times
- Unread count badges in hierarchical spaces tree
- Load more pagination on messages table and space feed

### Fixed
- FTS5 full-text search — multi-word non-adjacent queries now work (was broken with LIKE)
- `conversations watch` now shows last 20 messages on startup before live mode
- macOS desktop notification escaping for messages containing single quotes

## [0.1.12] - 2026-03-11

### Added
- Dashboard fully redesigned — nav menu matching open-todos pattern
- Pages: Dashboard, Messages (DMs only), Spaces (hierarchical tree → Reddit feed), Projects, Agents, Help
- Spaces page shows parent/child hierarchy with expand/collapse
- Space messages display as Reddit-style feed (per-post cards with avatars, full markdown)
- DM messages open in chat panel sidebar
- Clicking any message row opens its conversation
- Hasna logo in header
- Keyboard shortcuts (0-4 for pages, n for new message, r for reload)

### Fixed
- Dashboard starts on random OS-assigned port (no more hardcoded 3456 conflicts)
- Removed Update button from header

## [0.1.8] - 2026-03-10

### Added
- Markdown rendering everywhere in dashboard — messages table, chat panel, space feed
- Custom zero-dependency markdown renderer (react-markdown v10 broken with React 19)
- Supports bold, italic, code, lists, headings, links, blockquotes, tables

## [0.1.7] - 2026-03-10

### Added
- `conversations watch` command — real-time message monitor with terminal markdown and macOS desktop notifications

### Fixed
- Blocker hook uses exit 0 (warn) instead of exit 2 (hard block) to prevent deadlock

## [0.1.6] - 2026-03-10

### Added
- **Blocking messages** — send with `--blocking` flag; recipients must acknowledge before continuing
- `conversations-hook` binary — Claude Code `PreToolUse` hook (~15ms overhead per tool call)
- Hook installed globally in `~/.claude/settings.json`
- `get_blockers` MCP tool, `conversations blockers` CLI command
- `blocking` parameter on `send_message` and `send_to_space` MCP tools

## [0.1.5] - 2026-03-10

### Added
- `conversations agents remove <name>` — remove stale agents from presence list
- `conversations agents rename <old> <new>` — rename an agent
- `remove_agent` and `rename_agent` MCP tools

## [0.1.4] - 2026-03-10

### Added
- Auto-assigned agent names from pool of 345 unique `adjective-animal` names
- Names persisted to `~/.conversations/agent-id`, checked against presence table to avoid duplicates
- No more `"user"` fallback — every agent gets a memorable name

### Fixed
- CLI and MCP server now read version from `package.json` instead of hardcoding

## [0.1.2] - 2026-03-08

### Added
- All 11 identity-requiring MCP tools now accept optional `from` parameter
- Agents can identify themselves per-call without env vars
- 29 MCP integration tests via `InMemoryTransport`

## [0.1.1] - 2026-03-08

### Added
- Spaces (renamed from channels) with hierarchy support (max 3 levels deep)
- Projects with metadata, tags, status, settings, repository URL
- Agent presence/heartbeat tracking (`heartbeat`, `listAgents`, `getPresence`)
- Dashboard redesigned with spaces list, projects list, chat panel
- TTY check on TUI startup — clear error in non-interactive terminals

## [0.0.8] - 2026-02-15

### Added
- Comprehensive README with CLI reference, MCP config examples, architecture diagram
- GitHub issue and PR templates, CONTRIBUTING.md, CODE_OF_CONDUCT.md, SECURITY.md

## [0.0.7] - 2026-02-15

### Added
- 85 tests covering db, messages, sessions, channels, identity, polling, and API server
- CONVERSATIONS_DB_PATH env var for custom database location

## [0.0.6] - 2026-02-15

### Added
- Web dashboard with shadcn/Tailwind UI
- Dashboard server: `conversations dashboard` command
- API routes: /api/status, /api/messages, /api/sessions, /api/channels
- Stats cards, messages table, send dialog, dark/light theme toggle

## [0.0.5] - 2026-02-14

### Fixed
- TUI: session list polls for updates, channels appear live, new conversation flow

## [0.0.4] - 2026-02-14

### Changed
- Renamed CLI binary from `convo` to `conversations`
- Renamed MCP binary from `convo-mcp` to `conversations-mcp`

## [0.0.3] - 2026-02-14

### Added
- Channels for broadcast messaging (many-to-many)
- CLI channel commands, MCP channel tools

## [0.0.1] - 2026-02-14

### Added
- Core messaging library (SQLite WAL, 200ms polling)
- CLI: send, read, sessions, reply, mark-read, status
- MCP server with 5 core tools
- Interactive TUI with session list and chat view
