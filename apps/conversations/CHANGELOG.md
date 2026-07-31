# Changelog

All notable changes to this project will be documented in this file.

## Unreleased

### Fixed
- **Every recency read returned the OLDEST messages, not the newest — `--limit`, `--since`, and `conversations since` alike.** Three call shapes were affected, and all three are the recommended way to answer "what happened recently", so any watcher, digest, or situational-awareness monitor built on them reported "nothing new" forever while looking perfectly healthy. Measured against the hosted API on 2026-07-30 at 0.5.11:
  - `read --channel internal-ea --limit 5 --json` returned ids `586455…586462` while `--since 6h` at the same moment reached `607377`.
  - `read --channel incidents --since 3h` returned the 20 **oldest** rows of a 110-row window, stopping at id `607270` against a true newest of `608099`.
  - `conversations since 3h --limit 5000` returned 500 rows stopping at `607592`, blind by 529 ids.

  There were **two distinct defects**. The first is ordering: both stores defaulted to `ORDER BY created_at ASC LIMIT N` whenever `latest` was unset (`src/lib/messages.ts`, `src/lib/store/api-store.ts`), and `--since` inherited it with the cap *defaulted* rather than passed. `conversations since` additionally hardcoded `order: "asc"` at its own call site, so it survived the store-layer fix untouched and had to be fixed separately. Ordering is now decided once, in a shared `resolveReadWindow` (`src/lib/message-window.ts`) used by the sqlite store, the HTTP store, and the CLI/MCP paging that windows their answer. A bare `limit` or a `since` filter selects the newest N and hands them back chronologically ascending, so a transcript still reads oldest-to-newest; over-fetched (`limit + 1`) pages now keep the tail rather than the head, which is what was dropping the newest message. A `since_id` is a genuine cursor and keeps ascending selection, so a catch-up walk cannot skip the middle of a backlog.

  The second defect is silent truncation. A capped read reported exit code 0 with no cursor and no signal, and three separate caps can do the truncating: an explicit `--limit`, the store default, and the server's own hard clamp of a `/messages` read at 500 rows (`clampLimit` in `src/server/api.ts`), which `--limit` cannot raise. `--json` reads bypass the compact footer entirely, so they printed a truncated array with nothing to distinguish it from a complete answer. They now emit a notice on **stderr** when a page comes back full, leaving stdout a parseable JSON array and the exit code unchanged.

  Note on the 500-row server clamp: this PR does not move it, and does not need to. Asking `asc` meant "the oldest 500 of the window", so a window over 500 could never reach the newest at any limit. Asking `desc` means the clamped page is the *newest* 500, so the ceiling now only bounds how far **back** a single page reaches — ordinary pagination rather than blindness. Everything here is a client-side fix: the `/v1` server already defaults to `DESC` and honours `?order=asc`, so **no server deploy is required**.

### Migration
- `--limit` / `limit` and `--since` now mean "the newest N". A caller that relied
  on the old behaviour to walk a backlog forward should pass `order: "asc"`
  (unchanged semantics) or anchor with `since_id`, which is treated as a cursor
  and still selects ascending. `--cursor`/`offset` now pages backwards into older
  messages, which is what a recency window's page 2 means.
- `--json` reads print a truncation notice on stderr when the page comes back
  full. Anything parsing stdout is unaffected; anything that treated stderr as
  fatal should check the exit code instead, which is still 0.

## 0.5.13 - 2026-07-31

### Added
- Run typechecking and tests in GitHub Actions for pull requests and pushes to `main`.

### Tests
- Add unit coverage for the contracts client HTTP transport and storage adapter, including configuration refusal, request retries, CRUD normalization, and error handling.

### Fixed
- **MCP heartbeats no longer hijack the machine identity, and the CLI now persists it.** `register_agent`/`heartbeat` used to rewrite `~/.hasna/conversations/agent-id` on every call. The MCP server is one long-lived daemon under a single HOME, so whichever agent heartbeated last owned the whole box — last writer wins, no audit trail. They now record the caller *per MCP connection* only. In exchange, the identity file gets two deliberate writers: `conversations agents register <name> --identity` (opt-in, reports write failures instead of claiming success) and `conversations agents rename <old> <new>` (only when the renamed agent *is* this installation's identity, decided from the file on disk rather than a possibly days-stale in-process cache).
- **A box with no identity file adopts the first agent that registers over MCP.** Seed-if-absent, never last-writer-wins: an identity that already exists is left alone. Without this, a fresh install split in two — the MCP session spoke as the registered agent while every CLI process and `conversations-hook` fell through to the auto-name generator, invented a pool name, persisted it as the machine identity, and then polled blocking messages addressed to an agent nobody was. (Superseded below: the auto-name generator no longer exists, so the split this seeding prevented can no longer occur that way. Seeding is retained only so a deliberate first `register_agent` still claims an unclaimed box.)
- **Per-connection MCP session state.** The "agent that registered on this connection" rung is keyed by the MCP server instance instead of a module-level global. On the default Streamable HTTP transport (one process, many agents, a fresh stateless server per request) a global meant one client's `register_agent` silently became the implicit author for every other client on the box — one agent's unattributed channel posts stored under another agent's name. Covered by a two-client test over the real HTTP transport.

- **Identity is never borrowed or invented. Resolution fails loudly instead.** `~/.hasna/conversations/agent-id` is a single *machine-level* file, and every process that passed neither `--from` nor `CONVERSATIONS_AGENT_ID` answered to it. On 2026-07-30 one agent seat wrote `agent-ceo` into it — correct for that seat — and six other seats sharing the box posted under that name for a day; the stored rows carry no record of which process wrote them, so the misattribution is not separable after the fact. With no file at all, resolution instead minted a random pool name and persisted it as the machine identity, making a name nobody chose the default author for the CLI, the MCP server and the blocking-message hook alike. Resolution is now exactly three rungs — `--from`, then `CONVERSATIONS_AGENT_ID`, then the machine identity file **only when the process sets `CONVERSATIONS_USE_MACHINE_IDENTITY=1`** — and there is no fourth: anything undeclared raises `IdentityError` (`code: "IDENTITY_NOT_SET"`) naming the identity it refused to borrow. The opt-in gate is evaluated *before* the in-process identity cache, because that cache is written by `register_agent`'s seeding and by both self-rename paths: checking it first reproduced the whole defect inside a long-lived daemon, where one seat's deliberate identity write became every later undeclared caller's identity.
- **`whoami` no longer misreports where the identity came from.** It printed `auto-generated (<path>)` even when the value had plainly been *read* from the file, which made an inherited identity indistinguishable from an invented one in the single diagnostic an operator reaches for. It now reports the true source, exits non-zero with `code: "IDENTITY_NOT_SET"` when nothing is declared, and the string is owned by `describeIdentitySource()` so it cannot drift from the resolver again.
- **`create_task` no longer records `reporter: "unknown"`.** It caught the resolution failure and substituted a sentinel — unreachable code before this change, live after it — which would have made it the one write that never refuses, seeding the task registry with unattributable reporters.

### Changed
- Removed the unused `ink-spinner` runtime dependency.

### Migration
- **Nothing changes for callers that pass `--from`/`from` or export `CONVERSATIONS_AGENT_ID`.** That env var already outranked the identity file before this change, so a durable agent seat keeps a stable identity across sessions exactly as it did, with no re-registration.
- **Everything else must now declare an identity.** `conversations agents register <name> --identity` is **no longer sufficient on its own** — it writes the identity file, and reading that file is a separate, opt-in decision. Writing and reading were split deliberately so that claiming the box does not hand an identity to sessions that never chose one.
  - Several agent seats sharing one machine: give each its own `CONVERSATIONS_AGENT_ID`, set **per process at launch**. Note `tmux setenv` cannot do this — tmux environment is per *session*, not per *window*, so targeting a window silently overwrites one shared value and recreates the same last-writer-wins defect. A shell profile is wrong for the same reason.
  - Unattended callers that genuinely own the machine's identity (cron entries, loops, the blocking-message hook, a single-seat install): set `CONVERSATIONS_USE_MACHINE_IDENTITY=1` **on that one caller**, never as a blanket export.
- **Check every unattended caller before upgrading, especially any that discards stderr.** A cron job that pipes stderr to `/dev/null` will now exit 1 and write nothing, silently — and monitoring jobs are exactly the ones that do this, so "no alert" and "no incident" become the same observation. Prefer `--from <name>` on such callers; it is explicit and needs no environment at all.
- Verify with `conversations whoami --json`, which reports the resolved identity and its true source. See "Agent Identity" in the README.

## [0.5.9] - 2026-07-24

### Added
- **Audited local-SQLite message redaction: `conversations admin redact-messages [ids...]`.** Redacts known credential-shaped messages by id without ever printing message bodies. Dry-run is the default; live mutation (`--apply`) is gated on `--backup-confirmed`, `--dry-run-confirmed`, and an owner `--authority <ref>`. On apply it overwrites `content`, `metadata`, and attachment references, deletes managed attachment files (path-traversal-safe: only files under the message's managed attachments dir are removed), scrubs the FTS/export surfaces, records a hashed audit row in `message_redaction_audit`, and clears SQLite residual storage via `secure_delete` + `wal_checkpoint(TRUNCATE)` + `VACUUM`. Exposed programmatically as `redactMessagesById`. The tool is on-box SQLite maintenance only: it refuses to run when the station is flipped to cloud/self_hosted mode (`isCloudStore()`), so a security remediation is never silently applied to an empty local DB while the real data lives in the cloud store.

## [0.5.8] - 2026-07-24

### Security
- **Removed internal Hasna infrastructure identifiers from the published package.** Deleted `docs/CUTOVER-RUNBOOK.md`, an internal ops runbook that had no place in a public package: it contained a real AWS account ID, the full RDS endpoint DNS hostname, a bastion EC2 instance ID, Secrets Manager paths, and an internal chat channel name. Also removed the stale "Storage Sync" section from `README.md`, which documented the long-removed `conversations storage status/push/pull` CLI commands and leaked the production RDS cluster name and the runtime Secrets Manager path. The current self-hosted database configuration is documented, without internal identifiers, under "Self-hosted HTTP API". The high-severity runtime leak reported for earlier releases (canonical RDS cluster/secret-path baked into `getCanonicalConversationsRdsConfig` and surfaced by `conversations storage status`) no longer exists — that code path was removed in the 0.5.x store refactor. Note: the self-hosted client-flip default host still resolves to `https://<app>.hasna.xyz` via the vendored `@hasna/contracts` transport; that is an intentional product default (not a secret) and is tracked as a separate `@hasna/contracts` follow-up.

### Fixed
- `conversations react <id> <emoji>` on a nonexistent message now fails cleanly with `Message #<id> not found.` (exit 1), matching sibling commands (`show`, `receipts`), instead of leaking a raw server error / HTTP 500 or silently inserting an orphan reaction row. The `react` CLI now pre-checks existence via the active store (`getStore().getMessageById`), so it is correct in both local and self-hosted/cloud modes; `addReaction()` also validates message existence and throws a typed `MessageNotFoundError` as a single source of truth for all consumers (CLI, MCP, SDK).

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
