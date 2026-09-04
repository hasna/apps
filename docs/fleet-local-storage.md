# Fleet local-storage doctrine — no SQLite in api mode

> Binding doctrine for the internal harness and every public `@hasna/*` app
> that runs on fleet stations. Supersedes the `hasna-storage-standard` SQLite+
> Postgres duality for the internal harness; builds on the 2026-07-29
> data-backend doctrine (which removed the placement axis) and the mode-removal
> work (hasna/apps#1570, which removes the *selector*). This doctrine removes
> the **local tier itself**: the file, the adapter, and every sidecar.
>
> Date: 2026-09-04 · Source issue: hasna/apps#1613 · Status: adopted, wave in
> progress.

## The rule

**In api mode (`HASNA_<APP>_API_URL` + `HASNA_<APP>_API_KEY` configured), a
fleet CLI must not create, open, or migrate any local database — not in
`~/.hasna`, not in the working directory, not anywhere on the station.**

Concretely, every app and the shared storage kit must:

1. **Resolve the transport first.** When the transport is `http`, do not
   instantiate the SQLite adapter at all: no shadow outbox, no mirror, no
   dual-write tier, no ingest cache, no agent-registry sidecar, no
   schema-on-first-run. The hosted API is the **only** write path.
2. **Keep `new Database(` unreachable in api mode.** Acceptance:
   `grep -rn "new Database(" apps/<app>/src` must match only code paths that
   are unreachable when `HASNA_<APP>_API_URL` is set. Prefer lazy loading so
   the sqlite module is not even imported in an api-mode process.
3. **Never ship a lifecycle script that pre-creates local storage.**
   A package `postinstall`/`prepare` must not `mkdir ~/.hasna/<app>` — a
   station that installs the package in api mode must be left with zero local
   storage. (`@hasna/calendar`'s storage-creating `postinstall` was removed
   2026-09-04 as the first conversion.)
4. **Caches that are genuinely needed** (machine registry, session identity)
   are small **JSON files with an explicit name** — never a database.
5. **Local-only surfaces of hosted apps must be gated.** A local-only command
   (e.g. legacy one-time migrations) must refuse to run in api mode with a
   clear message, *before* loading the sqlite layer. Local-only mode keeps its
   semantics only when the API URL is not configured.

## What is legitimate local SQLite usage

The doctrine forbids the local tier **in api mode on stations**. These uses
remain legitimate:

- **Documented local-only packages with no hosted service**, run locally by
  other tooling outside the harness — feedback, brains, monitor, access,
  holdings, mcps, browser, prompts, agent-registry, logs-local. They have no
  API to route through; their local database is their product.
- **Explicit local-only surfaces of hosted apps**, documented as such and
  gated off in api mode (e.g. `calendar db-migrate`, the one-time legacy
  migration).
- **Test fixtures** — in-memory or temp-path SQLite, never `~/.hasna` and
  never the default path.
- **Self-hosted deployments on non-station machines.**

Station wrappers must **not** run the unhosted group at all: the station
wrapper generator refuses to render wrappers for packages without a hosted
service until they are hosted (hasna/apps#1613 ask 4).

## Forbidden in api mode (removal targets)

- Mirrors / dual-write shadows: `todos` "shadow outbox"/"mirror"
  (`storage shadow-status` / `shadow-drain`), `projects` mirror
  (`machines` populated), `mementos` mirror + `_sync_meta`.
- Outboxes: `loops`/`knowledge` outboxes.
- Ingest caches: `economy` ingest cache.
- Agent-registry sidecars: `economy/agent-registry.db`, `logs/agent-registry.db`.
- Schema-on-first-run databases in hosted apps (telephony, recordings,
  attachments, calendar, secrets, logs).

## Audit inventory — 24 SQLite databases under `~/.hasna` (station03, 2026-09-04)

Found by the audit that filed hasna/apps#1613. Ten were written **that day**
through the station wrappers in api mode. Almost all tables are empty
(schema + migrations only); the exceptions are caches (`projects.machines`
16 rows, `todos.activity_log` 32 rows). The files are not holding user data —
they are the SQLite+Postgres duality still executing on every invocation.

| file | size | last write | what the package calls it |
|---|---|---|---|
| `todos/todos.db` | 1.9 MB | 2026-09-04 13:32 | "shadow outbox", "mirror" (dual-write) |
| `emails/emails.db` | 995 KB | 2026-09-04 13:03 | local store schema |
| `mementos/mementos.db` | 889 KB | Sep 1 | "sqlite store", "mirror" |
| `conversations/messages.db` | 496 KB | 2026-09-04 12:13 | local store |
| `projects/projects.db` | 393 KB | 2026-09-04 12:10 | "mirror" (machines table populated) |
| `loops/loops.db` | 352 KB | Sep 3 | "outbox"; `status` reports `storage=sqlite connection=api` |
| `economy/ingest-cache.db` | 209 KB | 2026-09-04 | ingest cache |
| `economy/agent-registry.db` | 4 KB | 2026-09-04 | agent-registry sidecar |
| `telephony/telephony.db` | 4–209 KB | Sep 2–04 | schema created on first run |
| `recordings/recordings.db` | 4–209 KB | Sep 2–04 | schema created on first run |
| `attachments/db.sqlite` | 4–209 KB | Sep 2–04 | schema created on first run |
| `calendar/calendar.db` | 4–209 KB | Sep 2–04 | schema created on first run |
| `secrets/vault.db` | 4–209 KB | Sep 2–04 | schema created on first run |
| `logs/logs.db` | 4–209 KB | Sep 2–04 | schema created on first run |
| `logs/agent-registry.db` | 4–209 KB | Sep 2–04 | agent-registry sidecar |
| `brains/*` | 4–295 KB | Sep 2–04 | no hosted service; local-only package |
| `monitor/*` | 4–295 KB | Sep 2–04 | no hosted service; local-only package |
| `access/*` | 4–295 KB | Sep 2–04 | no hosted service; local-only package |
| `holdings/*` | 4–295 KB | Sep 2–04 | no hosted service; local-only package |
| `feedback/*` | 4–295 KB | Sep 2–04 | no hosted service; local-only package |
| `agent-registry/*` | 4–295 KB | Sep 2–04 | no hosted service; local-only package |
| `mcps/*` | 4–295 KB | Sep 2–04 | no hosted service; local-only package |
| `browser/*` | 4–295 KB | Sep 2–04 | no hosted service; local-only package |
| `prompts/*` | 4–295 KB | Sep 2–04 | no hosted service; local-only package |

## Follow-on work (wave)

1. **Per-app conversion** (this wave): api-mode path becomes remote-only, no
   on-disk databases; local-only mode kept where the package is documented
   local-only. First conversion: `apps/calendar` (2026-09-04).
2. **`<app> storage purge-local`** removes leftover files after confirming
   outboxes are empty; **doctor fails when a local DB exists in api mode** and
   `<app> status`/`doctor` reports `storage: none (remote)` with no SQLite path.
3. **Delete the shadow/dual-write tier** (`todos` shadow status/drain, the
   loops/knowledge outboxes, mementos `_sync_meta`). Offline writes, if ever
   wanted, are a separate explicit feature.
4. **Station wrapper generator** refuses to render wrappers for unhosted
   packages (brains, monitor, access, holdings, feedback, mcps, browser,
   prompts, agent-registry, logs-local) until they are hosted; their local
   databases are removed from station03.

## Acceptance

- After running the wrapper CLIs on a clean station
  (`todos list`, `emails inbox list`, `projects list`, `loops list`,
  `mementos search`, `conversations read`),
  `find ~/.hasna -name '*.db' -newer <marker>` returns nothing.
- `<app> status`/`doctor` in api mode reports `storage: none (remote)` and no
  SQLite path.
- `grep -rn "new Database(" apps/<app>/src` matches only code paths that are
  unreachable when `HASNA_<APP>_API_URL` is set.
- Installing a hosted app (`bun install -g @hasna/<app>`) creates no
  `~/.hasna/<app>` directory (no lifecycle-script storage creation).