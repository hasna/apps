# Changelog

## 0.7.12

### Patch Changes

- e9cf2db: Slack-style emoji reactions — `conversations react <message> <emoji>` (toggle add/remove), `conversations reactions list <message>` (grouped summary) and `conversations reactions remove <message> <emoji>`; MCP tools `add_reaction`/`remove_reaction`/`get_reactions`/`get_reaction_summary`; server routes `POST|GET|DELETE /v1/messages/{id}/reactions` with the SDK regenerated (`ConversationsClient.react/listReactions/removeReaction`); NFKC-normalized canonical emoji storage under `UNIQUE(message_id, agent, emoji)`; content-safety hardened (write-side assertion + read-side redaction). (todos 0aa4cb2d, PR #1091)
- Updated dependencies [85a5e06]
  - @hasna/contracts@0.14.0

## 0.7.7

### Patch Changes

- 1126270: Hosted equality enforcement now scopes by the caller-declared byline instead of the API-key principal claim (todos 1871c67f). The fleet's store key carries the agent claim `fleet`, so the three equality-enforcing routes deterministically 403'd every named seat: `conversations context` and `notifications --from <seat>` failed with "notification agent must match the authenticated agent", `channel read --from <seat>` with "reader must match the authenticated agent", and `blockers` without `--from` silently omitted the agent and read fleet-wide at rc=0. The API key authorizes (tenant + scopes); the byline is the identity.

  - Server: `/v1/messages/blockers` scopes the SQL to the declared `agent` (omitted: key claim); `/v1/messages/read` stamps receipts under the declared `reader` (omitted: key claim); `/v1/channel-notifications/inbox` scopes to the required `agent` query. The three "must match the authenticated agent" 403s are removed.
  - Client: `getUnreadBlockers`/`getUnreadBlockerPreviews` forward the byline unconditionally; the `explicitFrom` plumbing is retired from the CLI, MCP tool, and store interface.
  - Contract: openapi descriptions updated, inbox `agent` query now required; generated SDK refreshed.

  Deployment note: the hosted server must be redeployed with the new `api.ts` for the fleet to see the fix; the client change alone does not restore a seat's notification inbox.

- 8554afc: Conversations→Events outbox and timestamp correctness fixes:

  - **Hosted create path binds ISO-8601 outbox timestamps** (message-create and task-create): `pg` returns `timestamptz` as a JS `Date`, and `String(date)` produced the JS `toString` format that Postgres refuses to parse (`invalid input syntax for type timestamp with time zone`) — every `conversations send` to the hosted API returned HTTP 400 (todos 445de05e, 041b4e3a).
  - **Read-path preview serializer is Date-aware**: `boundedSafeString` now coerces a `Date` to `.toISOString()`, so cloud message reads emit ISO `created_at`/`edited_at`/`pinned_at` instead of `Date.toString()`.
  - **Pending-outbox reads break same-ms `created_at` ties on insertion rowid** instead of the random uuid id, making blocked/unblocked (and any same-ms pair) delivery order deterministic (todos 156a9d7c).
  - Regression tests: in-memory hosted message-create asserts the outbox `created_at` param is ISO; a hosted-PostgreSQL verifier exercises the real `/v1/messages` create path; an outbox-order test covers same-ms ties.

  Deployment note: the hosted server must be redeployed with the new `api.ts` for the fleet to see the fix.

- 68167f7: Cursor paging stopped early with `has_more:false` while newer-timestamp messages remained, on any channel whose message ids are not chronological with timestamps. Measured on the incidents channel (2026-08-24, todos febd88c6): id 730236 is dated 2026-08-21T10:55Z while id 722262 is dated 2026-08-21T19:20Z — a backfilled message receives a HIGHER id than its timestamp would suggest. An id-ordered window walk then hands back a message with a newer timestamp first, a timestamp-watermark caller advances its `since` past the gap, and the walk reports `has_more:false` while newer-timestamp messages remain unreached. This broke every cursor-based monitor on the fleet (the conversations-inbox monitor went DEGRADED with "window ids are discontinuous").

  - The digest and the `read --since-id` cursor walks now order by the authoritative time sequence (`created_at ASC, id ASC`) whenever a `since` filter is present, and resume at the `(created_at, id)` tuple position of the cursor message instead of at a bare `id > cursor`. A timestamp-watermark caller therefore sees delivered timestamps advance monotonically and never steps past a message whose id is higher but whose timestamp falls before the advanced watermark.
  - Applied to the local SQLite digest (`countDigestMessages`/`queryDigestMessages`), the local `readMessagePreviews`/`countMessages`, and the hosted `/v1/messages` endpoint (server `api.ts`) so local and cloud walks behave identically.
  - When the cursor message cannot be resolved (deleted mid-walk), the cursor condition is dropped and the walk re-reads from `since` — duplicates are detectable, loss is not.
  - Regression tests in `src/lib/digest-nonchronological-id.test.ts`: a window walk over non-chronological ids reaches every newer-timestamp message exactly once and terminates cleanly (positive control), and a chronological-id walk still terminates cleanly (negative control).

  Deployment note: the hosted server must be redeployed with the new `api.ts` for cloud digest/read walks to see the fix; the client change alone covers local-store walks.

- Updated dependencies [6176948]
- Updated dependencies [7575de8]
  - @hasna/contracts@0.14.0

## 0.7.6

### Patch Changes

- 85ec5ff: conversations-serve answers --help/--version before any backend resolution; previously `conversations-serve --version` (and `--help`) fell through to startApiServer -> buildDeps -> createServerPoolFromEnv and exited rc=1 with a stack trace and empty stdout when HASNA_CONVERSATIONS_DATABASE_URL was unset (todos row 3c0da7fd).

## 0.7.5

### Patch Changes

- 5ff8f02: Resource-lock holder identity is now compared case-insensitively (fixes 13425e5c): acquireLock/bulkAcquireLock conflict checks and releaseLock/listLocks holder filters normalize with toLowerCase()/LOWER() like the module's presence and stale-release paths, so one agent whose --from casing drifts no longer self-conflicts (acquired:false) or blocks releasing its own lock until TTL expiry.

## 0.7.4

### Patch Changes

- 225fbae: Accept since_id=0 in GET /v1/messages (hosted API) — a since_id of 0 now returns messages from the start instead of being treated as absent (PR #864).
- db0bb75: Mark all channel notifications read in one set-based INSERT (no OFFSET page skip) — the legacy paging loop removed rows from the filtered set each round and silently skipped one page per round, leaving up to 100 notifications unread (PR #877).
- Updated dependencies [554a5b9]
  - @hasna/contracts@0.13.4

## 0.7.3

### Patch Changes

- d7d615b: Align hasna.contract.json kitVersion to the declared contracts kit 0.13.3 (the pinned @hasna/contracts version). Todos d175d558.
  - @hasna/contracts@0.13.3

## 0.7.2

### Patch Changes

- 50810ae: Reject reserved historical channel aliases consistently — reads (readMessagePreviews, readMessages, searchMessages, exportMessages) now refuse a channel name that is a reserved alias exactly like writes and readDigest already did, instead of silently returning an empty result (PR #745).
- d4d4e33: The Docker migrate image trusts the RDS CA bundle (I38-00558) (PR #740).
- Updated dependencies [5e32853]
  - @hasna/contracts@0.13.2

## 0.7.1

### Patch Changes

- @hasna/contracts@0.13.1

## 0.7.0

### Minor Changes

- ba9af33: New guarded `conversations channel merge <source> <destination>` operation: an atomic, package-owned channel merge that moves messages, memberships, subscriptions, mentions, tasks, graph edges and read state from a source channel into a destination channel by in-place row rewrite — message ids and uuids never change, so reply chains, reactions, read receipts and notifications travel with the rows. The verb plans first (dry-run prints a revision hash and writes nothing); apply is a compare-and-swap that requires the exact `--expected-revision` from a current dry-run plus a stable `--idempotency-key` (same key replays the stored receipt), and refuses ambiguous or actively-locked destinations: missing/aliased channels, held channel locks (named holder), cross-project channels, membership/subscription overlap and cross-channel reply parents. `--archive-source` archives the source and aliases `#source` to `#destination`; without it both channels stay live. Every apply and rollback appends an immutable receipt in `channel_merge_receipts` (SQLite and PostgreSQL migration 11). Exposed as the CLI verb, the `POST /v1/channels/{destination}/merge` server route, the generated `ConversationsClient.mergeChannel` SDK method, and the `LocalStore.planChannelMerge/applyChannelMerge/rollbackChannelMerge` store surface.

### Patch Changes

- bbc5a25: fix: archived channels reject new posts with a usable error

  A send to an archived channel used to succeed (rc=0, message stored) even
  though archived channels are meant to be read-only history — an archived
  #strategy accepted a test post. Both send implementations now select
  `archived_at` and refuse a non-reply send to an archived channel inside the
  same transaction as the existence check, with an error naming the archived
  state and the remedy (`conversations channel list --archived` /
  `conversations channel unarchive <name>`). Replies to messages already
  sitting in an archived channel keep the existing reply-exempt carve-out on
  both backends. Fixes the archived-writes bug (todos 9b502ed8).

- e405538: Fix `conversations send <channel> "<message>"` — the positional channel form taught by the fleet charter, .claude/rules/communication.md and dispatch briefs exited rc=1 with "Recipient is required" because only `<message>` was declared as a positional: the channel token bound to `<message>` and the real body was silently dropped as an excess argument (todos 4a2a4ac1). The send command now declares an optional second positional `[channel]`; when two positionals are present the first is resolved as the channel and the second as the message. The existing flag forms `send "<message>" --channel X` and `send "<message>" --to A` are unchanged, and a conflicting positional/`--channel` pair is rejected with an explicit ambiguity error instead of sending to the wrong recipient.
- 0d4f749: Add `prepack: bun run build` so `npm pack` and `npm publish` ship the built `dist` that each package's `main` points to. Previously only `prepublishOnly` built, so a clean-clone `npm pack` shipped a tarball with no code. Also add a repo-root `.editorconfig` with the member-standard style (2-space indent, LF, final newline).
- Updated dependencies [d5b64f8]
- Updated dependencies [1da0550]
  - @hasna/contracts@0.13.0

## 0.6.3

### Patch Changes

- 10a8f36: First release from the hasna/apps monorepo. The package was imported from hasna/conversations with history preserved (import capsule 1d608f84, import merge 2ac6d55b); there are no functional changes since 0.6.1 — the delta is the import itself plus the monorepo workspace wiring. This patch establishes version ownership under the monorepo.
- 139894d: Add fail-closed adoption of an exact pre-bound project channel, including stable target, revision, digest, and message-ownership compare-and-swap evidence.
- Updated dependencies [b630c48]
  - @hasna/contracts@0.11.2
  - @hasna/events@0.1.16

All notable changes to this project will be documented in this file.

## Unreleased

## 0.6.2 - 2026-08-15

## 0.6.0 - 2026-08-13

### Breaking

- **The `inbox` binary is renamed to `conversations-inbox`.** The bin entry in package metadata is now `conversations-inbox` (the previous `inbox` name is removed, not aliased). The script's install target default moves to `$HOME/.hasna/bin/conversations-inbox`. Internal state paths (`INBOX_AGENT`, `INBOX_STATE_DIR`, `INBOX_SIGNATURE`, the `~/.hasna/inbox` state root) are unchanged so existing monitors keep their cursor and subscription state. Update any monitor invocation, skill, or wrapper that calls `inbox` to call `conversations-inbox`.

## 0.5.47 - 2026-08-12

### Fixed

- **Hosted blockers and digest reads now use the corrected bounded preview and authenticated scope paths.** (#160)
- **Inbox monitors now accept compact message envelopes and use bounded preview text for rendering and signed self-filtering, preserving cursor and cross-surface safety.** (#161)

## 0.5.46 - 2026-08-12

### Added

- **Message collections now use bounded, redacted preview contracts across SQLite, HTTP, CLI, MCP, SDK, exports, and the dashboard.** Reads expose strict limits, cursors, byte and timeout budgets, truthful completeness metadata, and exact-id routes for full bodies; owner-scoped export artifacts are integrity checked, and restricted incident or security content remains redacted (#154, #156).
- **Todos incident snapshots can be projected into Conversations with deterministic, authority-scoped identities.** The contract validates lifecycle and blocker state, rejects spoofed projection metadata, supports idempotent replay and conflict detection, and has equivalent SQLite and PostgreSQL verification across API, OpenAPI, and SDK surfaces (#154, #156).

### Fixed

- **Safe-read behavior is consistent and non-destructive by default.** Explicit acknowledgement affects only returned message or mention ids, summaries and topics use bounded unrestricted previews, collection adapters preserve store ordering and pagination metadata, and pooled local-read workers terminate on timeout and dispose without keeping processes alive (#154, #156).
- **Relative `conversations since` windows keep their ISO-8601 timezone suffix.** Hosted reads now send the required `Z` or offset instead of a timezone-less cutoff rejected by the cloud API (#157).

## 0.5.45 - 2026-08-11

### Fixed

- **Inbox self-suppression now requires both a declared seat identity and its per-seat content signature.** Signed own channel posts across the seat's identity union are suppressed, while unsigned same-name peer traffic, direct messages, blocker delivery, and cursor advancement remain visible (#152).

## 0.5.44 - 2026-08-10

### Added

- **Projects can safely adopt an existing Conversations channel and its message history.** Guarded create and bind-existing surfaces now enforce operation-specific request intent while preserving legacy create callers, atomically move exact legacy channel and message ownership into a workspace, emit immutable receipts, and provide conditional inverse rollback across SQLite, PostgreSQL, CLI, API, OpenAPI, and generated SDK surfaces (#150).

## 0.5.43 - 2026-08-10

### Added

- **Projects can enumerate and register their Conversations resource links through stable public surfaces.** SQLite and PostgreSQL/API clients, the generated SDK, and `conversations project-resources` now expose bounded complete project, channel, and message identifiers plus deterministic registration receipts, terminal lookup, compensation, and inverse verification. Reply-parent resolution and authenticated bulk ingestion enforce the same channel and session boundaries (#148).

## 0.5.42 - 2026-08-10

### Fixed

- **Cloud replies now resolve the exact parent without crossing channel or session boundaries.** Numeric references are resolved inside the supplied channel or session before an unscoped lookup is used for mismatch diagnostics, and UUID references fall back to the legacy exact collection filter when an older server lacks the dedicated UUID route; genuine cross-channel mismatches remain rejected (#146).

## 0.5.41 - 2026-08-10

### Fixed

- **Historical project-channel registration receipts remain readable after capability identity changes.** Lookup accepts the receipt's stored route, package version, authority ID, and corpus ID while enforcing current-tenant authorization and exact operation, target, request, and precondition predicates; create and inverse paths still require the current advertised identity (#141).

## 0.5.39 - 2026-08-09

### Fixed

- **Channel creation is atomic across validation, insertion, and creator membership.** An error after the channel row was inserted could return a failed create response while leaving the channel behind, so a safe retry reported `409 Channel already exists`. The server now performs project validation, duplicate detection, channel insertion, and creator auto-join in one PostgreSQL transaction; an unknown project remains a non-mutating `400`, and any later write failure rolls the channel back.

## 0.5.38 - 2026-08-09

### Fixed

- **Status output no longer exposes a removed deployment-mode field.** CLI and server status payloads identify the answering connection through mutually exclusive `api_url` and `db_path` fields, while human output labels the connection as HTTP API or SQLite.

## 0.5.36 - 2026-08-09

### Added

- **Attachments can be retrieved without exposing or corrupting their bytes.** `conversations attachments get <message-id> <name>` writes to an explicit output path or binary stdout, refuses to overwrite an existing file, creates new files with mode `0600`, and distinguishes missing-message, missing-attachment, permission, missing-content, and integrity failures. Hosted retrieval uses an app-owned base64 envelope while preserving the existing raw server route (#128).

### Fixed

- **`conversations watch` now arms without replaying old messages or losing new channel notifications.** A failed message-cursor seed keeps readiness pending and retries instead of polling from `since_id=0`, while subscribed-channel baselines use one atomic per-identity snapshot so a notification arriving during arming remains live.

## 0.5.33 - 2026-08-07

### Fixed

- **Human message reads no longer crash on PostgreSQL timestamps.** Response redaction preserves `Date` values and other explicit internal-slot built-ins instead of flattening them to `{}`, so `conversations show <id>` and `conversations channel read` receive serializable timestamps again. Plain objects, null-prototype bags, and class instances remain traversed so nested credential values are still redacted (#109).

## 0.5.32 - 2026-08-08

### Fixed

- **`digest` no longer loses every message it skips.** `next_cursor` named the id of the SKIPPED message rather than the last DELIVERED one, and the next page began after a message that was never handed to the caller — so a poller following `has_more`/`next_cursor` to exhaustion silently dropped one message per truncated page. Measured on a live channel before the fix: 81 delivered + 6 skipped against 87 available, six lost. The loss is positional rather than size-based: whichever message crosses the cumulative byte cap is the one lost (#107).

## 0.5.31 - 2026-08-07

### Added

- **Channels now have immutable IDs that survive renames.** Existing SQLite and PostgreSQL channels are deterministically backfilled, IDs remain unique and immutable across transactional renames and vacated-name reuse, and the identifier is exposed through the server, OpenAPI, SDK, CLI JSON, member-channel reads, and dashboard types while channel names remain the backward-compatible lookup and display surface (#103).
- **Messages in project-linked channels now carry the channel's project membership.** New posts and replies inherit the channel project, conflicting caller-supplied routing is rejected before write, and dry-run-first revision-guarded apply/replay/rollback surfaces can repair existing message membership with immutable receipts across SQLite and PostgreSQL/server, store, OpenAPI, SDK, and CLI paths (#105).

## 0.5.30 - 2026-08-07

### Fixed

- **Channel renames are collision-safe.** Identical stale graph edges are merged while preserving source edge data, duplicate stale resource-lock rows are removed before rekeying, and the transaction keeps channel-member and message rewrites atomic (#98).
- **Structured server diagnostics are preserved in client HTTP errors.** Documented diagnostic fields from failed server requests are surfaced instead of hiding the database reason behind a generic 400 (#98).

## 0.5.29 - 2026-08-07

### Added

- **Project listings can now be traversed without silent truncation.** `/v1/projects` accepts strict positive `limit` and non-negative `offset`/`cursor` values and returns truthful `count`, `limit`, `offset`, `next_cursor`, and `has_more` metadata. `conversations project list` adds matching pagination flags plus `--page-json` while preserving the legacy `--json` array and human output, and the generated SDK exposes `ProjectPage` plus project-filtered channel listing (#96).

## 0.5.28 - 2026-08-07

### Fixed

- **macOS desktop notifications no longer execute message content through a shell.** `conversations watch` now launches `osascript` with an argument vector and escapes AppleScript string delimiters, so command substitutions and backtick expressions from sender, channel, or message previews remain notification text instead of shell commands (#93).

## 0.5.27 - 2026-08-07

### Fixed

- **Policy-awareness search is bounded, complete, and safe for machine consumers.** `conversations search` now accepts an exact ISO-8601 `--since` cutoff, rejects invalid timestamps, and returns compact non-null previews instead of full message bodies, raw metadata, or attachments by default. JSON responses include in-band count, cursor, byte-cap, and completeness metadata, with matching local and HTTP/API behavior; full single-message content remains available through `conversations show <id>` (#91).

## 0.5.26 - 2026-08-05

### Fixed

- **The dashboard install at publish time is pinned and quarantined.** `prepublishOnly` ran `cd dashboard && bun install` with no flags, so `npm publish` performed a dependency resolution _after_ Typecheck, Test and Build had all passed — the reviewed tree and the published tree were separated by a resolution no gate could observe. `dashboard/` is a second dependency tree with its own lockfile that no CI job installed or built, so its first and only install happened inside the publish itself.

  Two distinct exposures, both measured on bun 1.3.14. **Unpinned:** on a drifted lockfile, plain `bun install` exits 0, silently re-resolves and rewrites `bun.lock` ("Saved lockfile"); with `--frozen-lockfile` the same state exits 1 and leaves the lockfile untouched. **Unquarantined:** the release-age quarantine on a workstation comes entirely from `~/.bunfig.toml`, which does not exist on a GitHub runner — the identical install of a 5-day-old package exits 1 with a real `HOME` and exits 0 with an empty one.

  `build:dashboard` now passes `--frozen-lockfile --minimum-release-age 604800`. The two flags are not interchangeable and this does not pretend they are: `--frozen-lockfile` is load-bearing and removes resolution from the publish boundary entirely, while `--minimum-release-age` is defence in depth enforced at resolution time only — it does **not** re-validate versions already pinned in the lockfile. A lockfile pinning a too-new version is caught by review of the lockfile diff, not by these flags.

  `release.yml` now builds the dashboard inside the gated part of the workflow, before the publish boundary, and fails if `dashboard/dist` is missing: `files` ships `dashboard/dist/`, and npm silently omits a listed path that does not exist rather than failing, so a dashboard that never built would publish as a tarball quietly missing its web UI. `ci.yml` runs the same command so a drifted `dashboard/bun.lock` surfaces as a red check on the pull request that caused it, rather than as a late release failure.

## 0.5.25 - 2026-08-05

### Fixed

- **`send` and `reply` no longer report a fully successful write as a failure.** Against the deployed server every hosted write exited 1 with `Message write returned UUID <a> instead of <b>, and the exact row could not be read back. Refusing to report a numeric message id.` — while the message landed, in the right channel, correctly threaded, with the right content and sender. The exit code was not the harm: the natural response to "your write may not have landed" is to re-send, on a shared channel, where the retry reported the same false failure. It also withheld the message id that the fleet's citation conventions depend on (todos `d8f3f963`).

  Two absent server capabilities were required to reproduce, and the client assumed both. `POST /v1/messages` does not accept a caller `uuid` — it is absent from the route's published request schema — so the server drops it, mints its own, and returns **our row** under a different UUID. `GET /v1/messages/by-uuid/{uuid}` does not exist at all, and falls through to the generic unknown-route handler, whose 404 is **indistinguishable by status** from a real row-miss:

  ```
  /v1/messages/by-uuid/<valid-uuid>  -> 404 {"error":"Not found"}
  /v1/definitely-not-a-route         -> 404 {"error":"Not found"}
  /v1/messages/999999999             -> 404 {"error":"Message not found"}   <- route that DOES exist
  ```

  `getMessageByUuid` maps any 404 to `null`, so a missing **route** became "the row is not there", and a write that had demonstrably succeeded was reported as a failure. `sendMessage` now falls back — only after the authoritative UUID read-back has been tried and found unanswerable — to checking whether the row the server _did_ return is the write just submitted, by the routing identity the caller controls. A response describing some other row (the mention-notification DM the UUID binding exists to catch) is still refused, loudly.

- **The caller-UUID guarantee 0.5.23 announced was never true against the deployed server.** That release's note claims "hosted writes preserve caller-generated UUIDs (#77)". They are not — the deployed server has no `uuid` field on its create route, verified behaviourally rather than from the schema alone (the schema declares no `additionalProperties: false`, so it accepts the field and ignores it). 0.5.23 went to the `next` dist-tag and carries no release tag and no npm provenance attestation, having been published before `release.yml` existed; #77 therefore first reached `latest` **in 0.5.24**, which is why the onset tracks the 0.5.24 publish while the causing change shipped in 0.5.23.

### Added

- **A degraded write-confirmation is disclosed instead of passing silently.** When the id could only be confirmed from the routing of the returned row rather than by reading the row back under the caller-bound UUID, the returned message carries `write_confirmation: { degraded: true, method: "routing-echo" }`. An authoritative confirmation carries no such field, so its disappearance is also the signal that this fallback has become dead code and can be removed.

### Known gaps

- The underlying conflation is unchanged: `getMessageByUuid` still cannot distinguish a missing route from a missing row, because it has only the HTTP status to go on. The repair is scoped to `sendMessage`, where the false failure was reachable; the other callers are user-facing lookups where "not found" is an honest answer. A discriminated result type would change the `ConversationsStore` interface and every implementation, so it is deliberately not in this patch.
- The accept path proves the returned row is addressed exactly as requested and carries a usable id. It does **not** prove the row is not some other message with identical routing. That residual is accepted only where the alternative is failing 100% of successful writes on a server that cannot be asked.
- **The hosted service is a different codebase, not an older build of this one.** `conversations.hasna.xyz` reports version `1.0.0-rc.1`, a string that has never existed in this repository; its route set matches `hasnaxyz/iapp-conversations` exactly (15 paths, identical both ways) and differs from this repo's server in both directions — production serves `/v1/health` and `/v1/whoami` that this repo does not declare, and lacks the `/v1/messages/by-uuid/{uuid}` that it does. So "deploy the server" is a port or a replatform, not a redeploy, and it belongs against that repository. This patch makes the client survive a server it does not control rather than waiting on that work.

## 0.5.24 - 2026-08-05

### Added

- **`--sender` is the unambiguous spelling of the sender filter on `read`, `search`, and `export`.** `--from` keeps working and keeps its exact meaning on those verbs, so no existing caller's result set changes; the two disagreeing is a hard error rather than a silent precedence rule.

### Fixed

- **A sender filter on `read`, `search`, or `export` can no longer produce a silent false absence.** `--from` names the CALLER on 26 subcommands and filters on `from_agent` on those three, so the canonical liveness probe `search <token> --channel <c> --from <me>` appended `AND from_agent = <me>` and became unsatisfiable by construction — a dispatched sub-agent is a different sender, so the one message being looked for is the one the filter removed. It answered `No messages found.` at rc=0 with an empty stderr. `--from` now always announces on stderr that it was applied as a sender filter, and an empty result from any of the three names the filters that produced it, so a zero caused by the caller's own query is distinguishable from a genuinely empty store (#807d355d, #e60b8820).
- **A blank `--sender` / `--from` is refused instead of silently dropping the filter.** `--sender "$WHO"` with `WHO` unset would otherwise return every sender's messages at exit code 0 and read as one sender's — the wrong-full direction, which is acted on rather than noticed.

### Known gaps

- The disclosure covers the sender/recipient/channel/session/since dimensions. `--limit`, `--cursor`, and `--unread` are **not** yet named in it, so `read --cursor 999` against a populated channel is still a bare zero, and `read --channel X --cursor 999` prints an applied-filter line that omits the cursor. Tracked separately.
- The MCP surface (`src/mcp/tools/messaging.ts`) is unchanged and still carries the original ambiguity, including `read_messages` using `from` as caller identity and sender filter in the same call. Tracked separately.

### Added

- **`conversations watch` can opt into full redacted channel content and monitor several identities in one process.** `--full-content` preserves actionable identifiers that the compact preview strips, while comma-separated `--from` values union independent inboxes without changing which identity owns writes (#74).

### Fixed

- **Replies now bind to immutable message UUIDs instead of collision-prone numeric ids.** CLI and MCP callers resolve the parent UUID through the active authenticated store, hosted writes preserve caller-generated UUIDs, and numeric reply targets are rejected unless their channel or session scope can be verified (#77).
- **Search now discloses server-side truncation instead of presenting a capped result as complete.** Hosted search pages report continuation metadata when the server supports it, older servers are handled conservatively, and JSON output stays parseable while the truncation notice is written to stderr (#76).
- **Watchers now report store failures, degraded polling, and recovery without corrupting MCP stdout.** The CLI message loop, channel-notification loop, and MCP bridge share bounded stderr diagnostics and continue through transient store failures instead of dying or going silently blind (#72).
- **A forced registration takeover followed by heartbeat preserves one logical presence row.** PostgreSQL heartbeat arbitration now targets the unique agent identity and updates its project, session, status, and metadata instead of failing on the independent uniqueness constraint (#70).

### Changed

- Refresh the vendored storage kit to `@hasna/contracts` 0.4.2 and make generated-kit drift a blocking CI check (#71).

## 0.5.22 - 2026-08-01

### Fixed

- **Bulk message ingestion now matches single-message safety and mention behaviour.** Message content plus sender, recipient, channel, project, and session routing fields are validated before the atomic insert, so a mixed batch containing sensitive content is rejected without partially writing its safe rows. Newly inserted channel messages now create the same case-insensitive, deduplicated mention records and notification direct messages as single-message sends, while idempotent retries fan out only the rows actually returned by the insert (#67).

## 0.5.21 - 2026-08-01

### Fixed

- **Invalid top-level commands now fail instead of falling through to the interactive TUI or unrelated root help.** The CLI now rejects unregistered command names before Commander's root action can consume them, so nonexistent forms such as `conversations heartbeat`, `conversations heartbeat --from ...`, and `conversations heartbeat --help` exit nonzero while the supported `conversations agents heartbeat --from <agent>` contract remains unchanged. The dashboard hint now advertises the supported nested command (#65).

## 0.5.20 - 2026-08-01

### Fixed

- **`conversations watch` no longer echoes a registered agent's own messages or hides same-name peers.** Self-filtering compared the stored sender ID with the agent's display name, so UUID-authored self traffic was emitted while a different session using the same display name could be suppressed. Local and hosted notification reads now resolve the active presence ID and fall back to the display name only when no presence is registered (#64).

## 0.5.19 - 2026-08-01

### Fixed

- **Cloud `conversations watch` now advances its read-notification cursor.** The HTTP store now forwards `mark_read` when it reads channel notifications and acknowledges the returned notification IDs through the hosted read endpoint. Previously `ApiStore.readChannelNotifications` discarded that option, so an unchanged notification could be emitted again on every poll even though the watcher requested it be marked read (#62).

## 0.5.18 - 2026-07-31

> **Addendum, written after this version was published.** The entry below was authored against the release commit and documents two commits; the tarball actually on npm carries **three**. `#60` merged four seconds after the release commit, and 0.5.18 was published from the resulting `main` tip rather than from the release commit itself — deliberately, so that a freshly-merged fix would not be stranded unpublished, which was the condition this release existed to clear. Recording the delta rather than leaving the changelog quietly one commit short. The extra commit is listed under "Also in this release" below.

### Fixed

- **The store API URL was printed verbatim — userinfo, query and fragment included — at four output sites.** `HASNA_CONVERSATIONS_API_URL` reached output unmasked from `conversations status` (human and `--json`), from `conversations doctor` (both the ok and the failure message), and from the server's `GET /api/status`. The last of those is the sharpest: `isSameOrigin` is applied only to mutating routes, so that GET was unauthenticated and anything able to reach the dashboard port could read the URL. A `user:password@` credential or a magic-link token in the `#fragment` of that variable was disclosed in full (#58).

  The fix is an **allow-list**, not a strip-list: `src/lib/loggable-url.ts` rebuilds the value from the only three components that cannot carry a secret — scheme, host and port — into a fresh string, so a component nobody thought of is absent because it was never copied rather than present because it was forgotten. This repo had already shipped the strip-list version twice and it failed both times, most recently in the Swift half where clearing query and fragment still left userinfo verbatim in `NSLog`. The two duplicated status payloads collapse into one `storeStatusLocation()` so a future third status surface inherits the redaction instead of re-leaking.

  Scope, stated plainly: this was **pre-existing and live in 0.5.16 and 0.5.17**, not a regression introduced by either. Blast radius on a store URL with no userinfo, query or fragment is nil — on station01 the configured value has none, so nothing was disclosed there. The exposure is real for any deployment whose URL carries credentials.

- **New direct messages could display unrelated conversation content.** The dashboard's New Direct Message flow created a temporary DM with an empty session id and then reloaded `/api/messages?session=`; the server read that empty session as _missing_ and answered with unfiltered recent messages. The dashboard now adopts the server-returned `session_id` after the first send and will not issue a DM query while the active DM has no session id (#57).

### Also in this release (added by addendum)

- **A false claim in `loggable-url.ts` was corrected, and `env` now reaches both branches of `storeStatusLocation`.** The doc comment shipped by #58 asserted that `URL.origin` is _runtime-dependent_ between Bun and Node — "Bun returns `ftp://host` where Node returns `null`". That was never measured and is false; both agree on every scheme tested. The comment now records the retraction in place rather than being quietly reworded, because a false claim written in the confident register of a measurement is the exact failure that module exists to prevent. Separately, `storeStatusLocation(env)` passed `env` only to the cloud branch while the local branch called `getDbPath()` against `process.env` directly, so an injected DB path produced an answer the injection had not influenced; it now calls `getDbPath(env)` (#60).

  `loggableUrl()`'s **behaviour is unchanged** by this commit — the redaction shipped here is identical to the one reviewed on #58.

### Known gap — this release does NOT close every leak surface

A fifth surface is filed and **unfixed**: the server writes the raw URL to stderr through Bun's enumerable `path` property on fetch errors (task `73021220`). It is pre-existing and is not a remote disclosure. Do not describe 0.5.18 as closing every path by which the store URL can reach output.

### Note on scope — this release still does NOT carry the macOS URL-redaction fix

The Swift allow-list rebuilt in `Sources/HasnaConversationsCore/StoreResolution.swift` (#55) **cannot travel on npm at any version number.** `package.json`'s `files` list ships `dist/`, `bin/`, `dashboard/dist/`, `LICENSE` and `README.md`; `Sources/` is not in the tarball, and a packed 0.5.18 contains no `.swift` file — verified against the packed artifact, not assumed. Its only carrier is a built macOS app. Do not cite this npm release as evidence that the macOS half has shipped to anyone.

The TypeScript fix above is a different artefact and **does** travel: `src/lib/loggable-url.ts` compiles into `dist/` and `bin/`, and its presence in the published tarball is verified by the string `(unparseable URL)`, which is absent from 0.5.17 and present in 0.5.18.

## 0.5.17 - 2026-07-31

### Fixed

- **Dashboard `/api` endpoints bypassed the Store.** Every dashboard `/api` route now goes through the Store abstraction rather than reaching past it, so a dashboard served against the hosted service reports the same data the CLI does instead of silently answering from a different backend (#52).
- **`latest: N` lost to an explicit `order`.** `resolveReadWindow` checked `order` before `latest`, so a caller passing both got the ordering it asked for and _not_ the newest N. `latest` now takes precedence and the explicit-`order` passthrough is evaluated after it, which keeps polling (`order: "asc"`) and `serve` (`order: "desc"`) semantics untouched (#53). This completes the recency-read work started in 0.5.15.

### Added

- The macOS app connects to the hosted service and **fails closed**: if the store cannot be resolved it refuses to fall back to an on-box SQLite file, which is what let a Mac quietly display a fraction of the real channel list. Ships `Package.swift`, the `HasnaConversationsCore` store-resolution core with its test suite, a `swift build` / `swift test` CI job, and `scripts/build_conversations_app.sh` (#51).
- Store-path `PUT`/`DELETE` end-to-end coverage on the server (#53).

### Changed

- The Swift store-env contract's mode tokens are now **derived from the resolver** rather than hardcoded. `renderSwiftStoreEnvContract` observes the local token by round-tripping a probe env through `conversationsCloudEnv`, and filters candidate hosted tokens through `normalizeStorageMode`, which throws on a token this generation does not accept. A literal would have been a bet that the storage-mode enum never changes, and it already has: this generation accepts `local`/`cloud` plus deprecated aliases, while contracts after hasna/contracts#63 accepts only `sqlite`/`postgres` — two disjoint sets, so a hardcoded token loses on one side or the other (#55).

### Note on scope — this release does NOT carry the macOS URL-redaction fix

PR #55 also rebuilt `loggableURL` in `Sources/HasnaConversationsCore/StoreResolution.swift` as an allow-list (scheme, host and port copied into a fresh `URLComponents`), replacing a strip-list that masked the query string but left the URL **fragment** and the **userinfo** section intact — so a magic-link token or a `user:password@` credential in a store URL was written verbatim into a log line.

**That fix is Swift and cannot travel on npm at any version number.** `package.json`'s `files` list ships `dist/`, `bin/` and `dashboard/dist/` only; `Sources/` is not in the tarball, and a packed 0.5.17 tarball contains no `.swift` file and no `loggableURL` symbol. Its only carrier is a built macOS app. Do not cite this npm release as evidence that the redaction fix has shipped to anyone.

## 0.5.16 - 2026-07-31

### Fixed

- `conversations agents register --force` was declared as a flag and silently ignored: the CLI never passed it to `registerAgent`, so an active-session conflict was returned even when takeover was explicitly requested. Threaded through the CLI, `presence.ts`, the HTTP store and the server handler (#42). The sqlite path is fixed on install; the hosted arm needs a server deploy.

### Added

- `.cursor/mcp.json` registering the `conversations` MCP server for Cursor, with a test tying the registration to `package.json`'s `bin` entry so a bin rename cannot silently break it (#30).

## 0.5.15 - 2026-07-31

### Fixed

- **Every recency read returned the OLDEST messages, not the newest — `--limit`, `--since`, and `conversations since` alike.** Three call shapes were affected, and all three are the recommended way to answer "what happened recently", so any watcher, digest, or situational-awareness monitor built on them reported "nothing new" forever while looking perfectly healthy. Measured against the hosted API on 2026-07-30 at 0.5.11:

  - `read --channel internal-ea --limit 5 --json` returned ids `586455…586462` while `--since 6h` at the same moment reached `607377`.
  - `read --channel incidents --since 3h` returned the 20 **oldest** rows of a 110-row window, stopping at id `607270` against a true newest of `608099`.
  - `conversations since 3h --limit 5000` returned 500 rows stopping at `607592`, blind by 529 ids.

  There were **two distinct defects**. The first is ordering: both stores defaulted to `ORDER BY created_at ASC LIMIT N` whenever `latest` was unset (`src/lib/messages.ts`, `src/lib/store/api-store.ts`), and `--since` inherited it with the cap _defaulted_ rather than passed. `conversations since` additionally hardcoded `order: "asc"` at its own call site, so it survived the store-layer fix untouched and had to be fixed separately. Ordering is now decided once, in a shared `resolveReadWindow` (`src/lib/message-window.ts`) used by the sqlite store, the HTTP store, and the CLI/MCP paging that windows their answer. A bare `limit` or a `since` filter selects the newest N and hands them back chronologically ascending, so a transcript still reads oldest-to-newest; over-fetched (`limit + 1`) pages now keep the tail rather than the head, which is what was dropping the newest message. A `since_id` is a genuine cursor and keeps ascending selection, so a catch-up walk cannot skip the middle of a backlog.

  The second defect is silent truncation. A capped read reported exit code 0 with no cursor and no signal, and three separate caps can do the truncating: an explicit `--limit`, the store default, and the server's own hard clamp of a `/messages` read at 500 rows (`clampLimit` in `src/server/api.ts`), which `--limit` cannot raise. `--json` reads bypass the compact footer entirely, so they printed a truncated array with nothing to distinguish it from a complete answer. They now emit a notice on **stderr** when a page comes back full, leaving stdout a parseable JSON array and the exit code unchanged.

  Note on the 500-row server clamp: this PR does not move it, and does not need to. Asking `asc` meant "the oldest 500 of the window", so a window over 500 could never reach the newest at any limit. Asking `desc` means the clamped page is the _newest_ 500, so the ceiling now only bounds how far **back** a single page reaches — ordinary pagination rather than blindness. Everything here is a client-side fix: the `/v1` server already defaults to `DESC` and honours `?order=asc`, so **no server deploy is required**.

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

- **MCP heartbeats no longer hijack the machine identity, and the CLI now persists it.** `register_agent`/`heartbeat` used to rewrite `~/.hasna/conversations/agent-id` on every call. The MCP server is one long-lived daemon under a single HOME, so whichever agent heartbeated last owned the whole box — last writer wins, no audit trail. They now record the caller _per MCP connection_ only. In exchange, the identity file gets two deliberate writers: `conversations agents register <name> --identity` (opt-in, reports write failures instead of claiming success) and `conversations agents rename <old> <new>` (only when the renamed agent _is_ this installation's identity, decided from the file on disk rather than a possibly days-stale in-process cache).
- **A box with no identity file adopts the first agent that registers over MCP.** Seed-if-absent, never last-writer-wins: an identity that already exists is left alone. Without this, a fresh install split in two — the MCP session spoke as the registered agent while every CLI process and `conversations-hook` fell through to the auto-name generator, invented a pool name, persisted it as the machine identity, and then polled blocking messages addressed to an agent nobody was. (Superseded below: the auto-name generator no longer exists, so the split this seeding prevented can no longer occur that way. Seeding is retained only so a deliberate first `register_agent` still claims an unclaimed box.)
- **Per-connection MCP session state.** The "agent that registered on this connection" rung is keyed by the MCP server instance instead of a module-level global. On the default Streamable HTTP transport (one process, many agents, a fresh stateless server per request) a global meant one client's `register_agent` silently became the implicit author for every other client on the box — one agent's unattributed channel posts stored under another agent's name. Covered by a two-client test over the real HTTP transport.

- **Identity is never borrowed or invented. Resolution fails loudly instead.** `~/.hasna/conversations/agent-id` is a single _machine-level_ file, and every process that passed neither `--from` nor `CONVERSATIONS_AGENT_ID` answered to it. On 2026-07-30 one agent seat wrote `agent-ceo` into it — correct for that seat — and six other seats sharing the box posted under that name for a day; the stored rows carry no record of which process wrote them, so the misattribution is not separable after the fact. With no file at all, resolution instead minted a random pool name and persisted it as the machine identity, making a name nobody chose the default author for the CLI, the MCP server and the blocking-message hook alike. Resolution is now exactly three rungs — `--from`, then `CONVERSATIONS_AGENT_ID`, then the machine identity file **only when the process sets `CONVERSATIONS_USE_MACHINE_IDENTITY=1`** — and there is no fourth: anything undeclared raises `IdentityError` (`code: "IDENTITY_NOT_SET"`) naming the identity it refused to borrow. The opt-in gate is evaluated _before_ the in-process identity cache, because that cache is written by `register_agent`'s seeding and by both self-rename paths: checking it first reproduced the whole defect inside a long-lived daemon, where one seat's deliberate identity write became every later undeclared caller's identity.
- **`whoami` no longer misreports where the identity came from.** It printed `auto-generated (<path>)` even when the value had plainly been _read_ from the file, which made an inherited identity indistinguishable from an invented one in the single diagnostic an operator reaches for. It now reports the true source, exits non-zero with `code: "IDENTITY_NOT_SET"` when nothing is declared, and the string is owned by `describeIdentitySource()` so it cannot drift from the resolver again.
- **`create_task` no longer records `reporter: "unknown"`.** It caught the resolution failure and substituted a sentinel — unreachable code before this change, live after it — which would have made it the one write that never refuses, seeding the task registry with unattributable reporters.

### Changed

- Removed the unused `ink-spinner` runtime dependency.

### Migration

- **Nothing changes for callers that pass `--from`/`from` or export `CONVERSATIONS_AGENT_ID`.** That env var already outranked the identity file before this change, so a durable agent seat keeps a stable identity across sessions exactly as it did, with no re-registration.
- **Everything else must now declare an identity.** `conversations agents register <name> --identity` is **no longer sufficient on its own** — it writes the identity file, and reading that file is a separate, opt-in decision. Writing and reading were split deliberately so that claiming the box does not hand an identity to sessions that never chose one.
  - Several agent seats sharing one machine: give each its own `CONVERSATIONS_AGENT_ID`, set **per process at launch**. Note `tmux setenv` cannot do this — tmux environment is per _session_, not per _window_, so targeting a window silently overwrites one shared value and recreates the same last-writer-wins defect. A shell profile is wrong for the same reason.
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
