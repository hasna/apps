# PersonalNotes Sync — Client Design and Conflict Policy

The sync client (`sync/`) connects the canonical local markdown store
(`~/.hasna/apps/notes/notes/`) to a PersonalNotes server over `POST
/api/v1/sync`. It is **one dialect with two backends**: the hosted service
(`https://personalnotes.ai`, the default) or any self-hosted server that
implements the same `/api/v1` protocol. The base URL is the only switch:
`PERSONALNOTES_API_URL`, config `apiUrl`, or the default. Device-code auth
(`personalnotes auth device`) works identically against either.

```
personalnotes sync [--dry-run] [--json] [--api-url https://...]
personalnotes sync --watch [--interval 5m] [--log-file path]
personalnotes sync status [--json]
personalnotes sync --install-service [--dry-run] | --uninstall-service
```

A run prints one line: `Pushed N (a new, b updated, c purged) · Pulled M (...)
· Conflicts K (k kept both)`, plus `Skipped J too large` when notes were
skipped for size (see Push below; details ride in the JSON summary's
`errors` array as `{noteId, code, bytes, message}`).

## Principles

1. **The markdown store stays canonical.** Sync bookkeeping lives in
   `<data-root>/sync-state.json`; deleting it costs a full re-push/re-pull,
   never data.
2. **Wall clocks are display hints.** Versions are ordered by the local
   per-note `rev` (frontmatter schema v2) and the server per-note monotonic
   `revision` — never by `updatedAt`.
3. **Deletions must never resurrect.** Purges push tombstones and record them
   locally; stale rows are revision-checked before touching disk.
4. **No data loss on conflict.** Keep-both: the server version keeps the note
   id, diverging local edits are preserved as a new "(conflict copy)" note.

## Push (store → server)

The engine scans the store and builds sync items for every note whose `rev`
differs from the last acked `syncedRev` in the state file:

| Local state | Wire mapping |
|---|---|
| new note (no state entry) | upsert item, no `baseRevision` (first-create) |
| edited note | upsert item with `baseRevision` = last acked server revision |
| `status: archived` | upsert with `archived: true` (state, not an event) |
| `status: trash` | upsert; trash metadata rides in `frontmatterJson` (trash is restorable state, **not** a server delete) |
| restored over a tombstone | upsert with `baseRevision` = tombstone revision (server clears `deletedAt`) |
| file purged (CLI purge / retention) | two-phase: content-blanking upsert, then — once acked — a `{deleted: true, purged: true}` tombstone item guarded by the acked revision (an edit landing in between wins and the purge is dropped) |

All schema-v2 metadata (status, `contentFormat`, `rev`, machine + friendly
name, actor provenance, timestamps, title metadata) travels in
`frontmatterJson`, so every machine can still see **which note belongs to
which machine** after a pull. `purged: true` is the OSS-dialect marker
(self-hosted servers scrub content); the hosted platform ignores it, which is
why the client blanks the content itself before deleting. The blanking upsert
scrubs the title to `Untitled` (not `""`): the dialect's merge treats an empty
title as absent and would silently keep the old — possibly sensitive — title.

Batches are capped at 100 items / ~1.5 MiB. Every batch gets a fresh UUID
`Idempotency-Key` that is persisted — together with the exact request body —
into the state file **before** the request is sent. Retries (409/429, with
backoff) and post-crash resumes resend the same key with the byte-identical
body, so the server either applies once or replays its stored response.
A pending batch in the state file is always resolved first on the next run.

**Oversized notes never block the pipeline.** A single note whose serialized
item exceeds the server request cap (2 MiB on both backends) cannot be split
and can never be accepted: it is skipped-and-reported (`errors` entry, code
`oversized_note`) **before** any batch is parked as pending, and every other
note keeps syncing. Symmetrically, a 413 response is deterministic — the
server rejected the body before applying anything and will reject a
byte-identical resend forever — so a pending batch that 413s is dropped
(code `payload_too_large`), never resent head-of-line.

## Pull (server → store)

A run pulls before it pushes (fresh revisions minimize conflicts) and drains
the feed: repeat `{items: [], cursor}` until a page comes back short (hosted)
or `hasMore` is false (self-hosted). Timestamp cursors are overlap-rewound by
5 s per request to survive the hosted in-flight-commit race; opaque cursors
(the self-hosted `s:<seq>` shape) pass through untouched. "Timestamp-shaped"
is decided by an ISO-8601 **pattern match**, never by `Date.parse()`
leniency — V8 happily parses `s:100` as a year-0099 date, and rewinding an
opaque cursor re-feeds the tenant's history from epoch and stalls the pull
forever (P3 regression: a 172-note store froze at exactly 100 notes on the
second device). Rows are deduped by `(id, revision)`; a replayed response's
older cursor snapshot never moves the stored cursor backwards.

Applying a row (atomic tmp+rename writes via the shared store library,
`preserveRev: true` — a sync-applied write keeps the originating machine's
`rev`; only genuine local mutations bump it):

| Row | Action |
|---|---|
| `revision` ≤ last acked/tombstoned revision | skip (stale — never clobber) |
| new note | create file; adopt `clientId` as the local id (server `id` if the row was born elsewhere) |
| newer row, local note clean | overwrite file, ack revision |
| newer row, local note dirty, content differs | **keep both** (below) |
| `deletedAt` set, local clean/absent | delete file, record tombstone in state |
| `deletedAt` set, local dirty | conflict copy of the local edits, then delete + tombstone |

Recorded tombstones permanently block older rows for that note; a *newer*
non-deleted row is an intentional restore and recreates the file.

## Conflict policy (normative)

The authoritative version counter is the server's per-note `revision`. The
client sends `baseRevision` on every update/delete (blind last-write-wins
overwrites are forbidden except first-create). When versions diverge — a
conflicting push response or a pulled newer row over dirty local edits:

1. The **server version keeps the note id** (converges every machine on one
   winner per id without trusting clocks).
2. The **local diverging content is saved as a new note** titled
   `<title> (conflict copy)` and pushed as a first-create in the same run, so
   both versions reach every machine.
3. A **conflicted purge is dropped** — the note comes back from the server
   (data safety beats delete intent; purge again if you mean it).
4. If the contents turn out identical, the client just acks the new revision
   (`converged` — no copy created).

`updatedAt` is never used for conflict decisions.

## Scheduling (S3)

Nothing about sync requires a GUI. The scheduling layer lives in
`sync/daemon.mjs`; every path below calls the SAME `runSync` engine.

**Daemon** — `personalnotes sync --watch` runs two triggers:

1. an interval poll — `syncIntervalMinutes` from the client config
   (`~/.config/personalnotes/config.json`), `--interval`, or
   `PERSONALNOTES_SYNC_INTERVAL_MINUTES`; default **5 minutes**, floor **1
   minute**, each tick jittered 0–10 % late so a fleet never stampedes one
   server — and
2. a debounced (3 s) `fs.watch` on the notes folder, so a local edit reaches
   the server within seconds while the poll remains the safety net for remote
   changes.

The interval is re-read every cycle, so config edits and a fresh login apply
without a restart. SIGTERM/SIGINT stop cleanly: pending timers cancel, an
in-flight run gets up to 15 s to finish, the lock is released.

**Locks (stale-safe, pid-based)** — two files in the data root:

- `sync.lock`: held for the duration of ANY non-dry sync run (manual CLI,
  daemon tick, GUI timer). A colliding one-shot run exits 0 with
  `{skipped: true, reason: "already_running"}` — coordination, not failure.
- `sync-daemon.lock`: one daemon per data root.

A lock whose owner pid is dead (or whose file is unreadable) is reclaimed; a
live owner is always respected.

**Status** — every attempt (success or failure) merges into
`<data-root>/sync-status.json`: `{status: ok|error, lastSyncAt,
lastSuccessAt, error, apiUrl, cursor, pushed, pulled, conflicts, runner}`.
`personalnotes sync status` prints it; the app shows it in Settings →
Machines. An error is stored as `status: "error"` — status surfaces must
never map a failed run (e.g. a revoked key) to a synced state.

**Logs** — `~/Library/Logs/PersonalNotes/sync.log` on macOS,
`$XDG_STATE_HOME/personalnotes/sync.log` (default
`~/.local/state/personalnotes/sync.log`) on Linux; one line per run, rotated
once at 512 KiB (`sync.log.1`).

**Install story** — `personalnotes sync --install-service` writes the
user-level service that keeps the daemon alive and prints the enable command:

- macOS: `~/Library/LaunchAgents/com.personalnotes.sync.plist` (launchd,
  RunAtLoad + KeepAlive), then `launchctl load <plist>`.
- Linux: `~/.config/systemd/user/personalnotes-sync.service`, then
  `systemctl --user enable --now personalnotes-sync`. Linux is a first-class
  sync citizen: CLI + daemon + service run identically there.

`--uninstall-service` removes the file and prints the disable command.

**macOS Local Network Privacy (LNP) check** — macOS silently blocks
background launchd agents from LAN (RFC1918/link-local) addresses:
`EHOSTUNREACH`, no permission prompt, while the same command works in a
manual/ssh session (found during the first real cutover). On macOS,
`--install-service` therefore resolves the configured API URL first
(`sync/lnp.mjs`): a LAN-resolving host triggers a loud warning, and when the
host is a node on a Tailscale tailnet (parsed from `tailscale status --json`
when the binary exists) the installer rewrites the URL to the MagicDNS FQDN
(`http://<host>.<tailnet>.ts.net:<port>` — utun traffic is not LNP-gated) and
persists it to the client config so daemon and manual runs agree. Without a
tailnet match it prints instructions instead. Loopback, mesh (100.64/10 /
Tailscale ULA), and public addresses install unchanged; changing the apiUrl
resets sync bookkeeping by design (the markdown store is canonical, notes
re-converge). `--dry-run` previews the check and the service file without
writing anything. Fetch-level failures everywhere in the client surface the
underlying code (`err.cause.code`) — an `EHOSTUNREACH` against a LAN address
carries the LNP explanation in the error message, so `sync status` and the
Settings row show the actual cause instead of a bare `fetch failed`.

**GUI** — the macOS shell app additionally runs a background timer
(`SyncScheduler` in `PersonalNotesApp/main.swift`, its own serial queue,
never the main thread) that spawns the bundled CLI (`Resources/bin/
personalnotes.mjs sync --json`) on the same interval setting, then rebuilds
the boot payload and hydrates the web UI so pulled notes and the Settings
sync row appear without user action. The `sync.lock` coordination above means
GUI + daemon can coexist without double-running; the GUI timer no-ops when
the CLI is not signed in.

## Known limits (hosted platform)

- The hosted change feed is capped at 100 rows per call with a wall-clock
  cursor; a burst of >100 foreign changes between syncs can skip rows. The
  overlap rewind narrows the window (and the scheduler's frequent small syncs
  keep bursts rare); a periodic full reconcile via `POST /api/v1/export`
  remains a planned follow-up.
- `labels.json` (the empty-label registry) and `settings.json` are not synced
  yet; labels attached to notes travel with the notes. Follow-up filed.
- The hosted platform keeps deleted note content server-side (no purge kind);
  the client blanks content before deleting as a best-effort scrub (title →
  `Untitled`, body/labels → empty).
- CRLF line endings in note bodies are normalized to LF by the local parse
  layer on every machine (the v1→v2 migrator, by contrast, preserves body
  bytes exactly). Symmetric on all devices, so convergence is unaffected;
  byte-fidelity to an externally authored CRLF file is not preserved.
