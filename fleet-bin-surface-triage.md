# Fleet CLI bin naming & machine-readable surface — triage (hasna/apps#1602)

Audit date: 2026-09-04. Baseline: `origin/main` (4144075d2 era). Scope: every
publishable member of hasna/apps that ships a CLI bin, plus the serve-side
route-policy item. Companion PR: **fix(fleet): bin naming and machine-readable
surface drift (part 1)** — Closes #1602.

## 1. Bin naming: package.json `bin` vs `hasna.contract.json` `bins`

Legend: `ctr` = contract declares the bin; `–` = app has no `hasna.contract.json`
(recorded MANIFEST_MISSING exception); `!` = bin in package.json but **not**
declared in the manifest (bins_match_package class).

| App | package.json bins | contract bins | Deviation / disposition |
|---|---|---|---|
| attachments | attachments, attachments-mcp, attachments-serve | all | none |
| automations | automations, automations-daemon | all | no `-mcp` — deliberate, accepted (fleet-compat) |
| bridge | bridge, bridge-mcp | all | no `-serve` — deliberate |
| calendar | calendar, calendar-mcp, calendar-serve | all | none |
| changelog | changelog, changelog-mcp, changelog-serve | changelog only | **contract understates** (mcp/serve undeclared) — manifest lane, tracked |
| computers | computers, computers-mcp, computers-migrate, computers-serve, computers-worker | all | none |
| connectors | connectors, connectors-mcp, connectors-serve | – | no manifest (recorded exception) |
| contacts | contacts, contacts-mcp, contacts-serve | all | none |
| contracts | contracts, contracts-cli | all | none |
| conversations | conversations, conversations-hook, conversations-inbox, conversations-mcp, conversations-serve | first 3 | **!** inbox/hook — recorded exception (todos ee9fbb4d); keep as documented extras |
| dispatch | dispatch, dispatch-daemon, dispatch-mcp | all | none |
| domains | domains, domains-mcp, domains-serve | all | none |
| economy | economy, economy-mcp, economy-otel, economy-serve | first 3 | **!** economy-otel — recorded exception (todos 2a70ece0); `-otel` not an allowlisted suffix |
| emails | emails, emails-mcp, emails-serve | all | none |
| events | events, **hasna-events** | events | **!** `hasna-events` = deprecated duplicate alias (npm parity since 0.1.15), recorded exception (todos 9b78ba7e) — **kept, documented deprecated**; drop at next major |
| feedback | feedback, feedback-mcp, feedback-serve | all | none |
| files | files, files-mcp, files-migrate, files-serve | all | none |
| guardrails | guardrails | all | no `-mcp` — deliberate |
| hooks | hooks, hooks-serve | all | no `-mcp` — deliberate |
| instructions | instructions, instructions-mcp, instructions-serve + **configs, configs-mcp** | first 3 | **!** `configs`/`configs-mcp` = legacy fleet-compat aliases, recorded exception (todos c15cca18) — **kept, documented deprecated**; drop at next major |
| knowledge | knowledge, knowledge-mcp, knowledge-serve | all | none |
| logs | logs, logs-mcp, logs-serve | all | none |
| loops | loops, loops-daemon, loops-mcp, loops-runner, loops-serve | all | none |
| mementos | mementos, mementos-mcp, mementos-serve | all | none |
| messages | messages, messages-mcp, messages-serve | all | none |
| monitor | monitor, monitor-mcp, monitor-daemon, monitor-server, monitor-web→**dropped on main (#1678)** | first 3 | **!** `monitor-server` renamed to **`monitor-serve`** (canonical, this PR) with `monitor-server` kept as a one-release deprecated alias; `monitor-web` was removed by the dashboard-removal wave on main before this PR rebased — the remaining undeclared bins are `monitor-serve`/`monitor-server` (baseline pinned in-contract) |
| notes | NO CLI bin in package.json | – | no-cli class, accepted |
| orgs | orgs | all | no `-mcp` — deliberate |
| projects | projects, projects-mcp, projects-serve | all | none |
| prompts | prompts, prompts-mcp, prompts-serve | all | none |
| recordings | recordings, recordings-mcp, recordings-serve | all | none |
| releases | releases, releases-mcp | all | no `-serve` — deliberate |
| repos | repos, repos-mcp, repos-serve, repos-verify-release | – | no manifest (recorded exception); 4th bin documented extra |
| secrets | secrets, secrets-mcp, secrets-serve | all | none |
| servers | servers, servers-mcp | all | no `-serve` — deliberate |
| shortlinks | shortlinks, shortlinks-mcp, shortlinks-serve | all | none |
| skills | skills, skills-mcp, skills-server, skills-worker, skills-migrate | – | no manifest (recorded exception). **`skills-server` → `skills-serve` canonical added (this PR)**; `skills-server` kept as deprecated alias; worker/migrate documented extras |
| snapshots | snapshots, **snapshots-agent**, snapshots-mcp, snapshots-serve | – | no manifest (recorded exception). **`snapshots-agent` documented** as daemon-mode wrapper (this PR) |
| statusline | statusline, statusline-mcp | – | no manifest (recorded exception) |
| tai | tai, tai-mcp | – | no manifest (recorded exception) |
| telephony | telephony, telephony-mcp, telephony-serve | all | none |
| todos | todos, todos-mcp, todos-serve | all | none |
| workflows | workflows, workflows-mcp, workflows-serve | all | none |
| **uptime** | `uptimemon` per issue audit | – | **not present in this repo** — no `apps/uptime` member, no `"uptime"` package name anywhere in-tree. The observed `uptimemon` binary cannot be produced by this tree; if it ships, it is published from another repo (internal-apps) or an unpublished legacy package. **Action: verify registry ownership of `@hasna/uptime`/`uptimemon`; out of reach for this repo** |

### Dispositions this PR applies

1. **skills**: add canonical `skills-serve` bin (`bin/server.js`); `skills-server`
   stays installed as a deprecated one-release alias; both point at the same
   build. README updated.
2. **monitor**: add canonical `monitor-serve` bin (`./bins/monitor-server.js`);
   `monitor-server` stays as a deprecated alias; `monitor-web` was already
   dropped on main by the dashboard-removal wave (#1678). Manifest: bins
   unchanged
   (declaring `-serve` flips cli-with-store → service-capable and invalidates
   the sqlite-only storage waiver — verified against the 0.11.1 validator);
   `pendingBinRenames` records both remaining bins; `conformanceBaseline` pins
   the exact failing detail; census cause updated.
3. **events** (`hasna-events`), **instructions** (`configs`/`configs-mcp`),
   **snapshots** (`snapshots-agent`): kept, now explicitly documented as
   deprecated aliases (or, for `snapshots-agent`, as the daemon surface).
4. **uptime/uptimemon**: outside this tree — no member to fix. Flagged for the
   owner to trace (registry check).

## 2. Machine-readable surface: `--json` / `status` presence (src CLI entry)

Measured by scanning the primary CLI entrypoint for `" --json "` option
declarations and `status`/`doctor` subcommands. `json=0` can mean a global
`--json` flag or a `--format json` convention rather than absence.

| App | `--json` | status/doctor | Notes |
|---|---|---|---|
| messages | agents/whoami/threads rejected `--json` | – | **FIXED this PR**: every data command accepts `--json` (output is already JSON) |
| logs | list/get rejected `--json` | status ✓, doctor ✓ | **FIXED this PR**: `logs list --json` and `logs get --json` accepted (aliases of `--format json`) |
| contacts | none (`--json` absent CLI-wide) | no status | **FIXED this PR**: `contacts status` (+`--json`) prints version / API URL / storage / counts without crashing when unconfigured |
| calendar | global `--json` + per-command | no status, no doctor | **FIXED this PR**: `calendar status` (+`--json`); `doctor` deferred — calendar store exposes no integrity surface yet |
| loops | ✓ | status ✓ | **FIXED this PR**: `/v1/health` + `/v1/healthz` are now open foundation probes (were 403 via `route_policy_missing`) |
| bridge/files/instructions/repos/servers/… | ✓ | varies | conformant |
| many others | 0 occurrences | 0 | flagged: adoption of the shared `--json`/`status` kit surface is the follow-up wave (see §4) |

Identity-flag defaults (`messages whoami` etc. currently REQUIRE `--agent`):
not changed in this PR — the station-wrapper env contract for an ambient
agent id is not defined in-tree; needs the wrapper spec (same lane as #1588's
uniform `API:` status line).

## 3. Serve-side route policy: loops `/v1/health` 403

`apps/loops/src/api/index.ts` (createLoopsApiServer) already serves `/health`,
`/healthz`, `/ready`, `/readyz`, `/version`, `/v1/version`, `/openapi.json` as
**open** probes, but `GET /v1/health` fell through to `routePolicy()`, which has
no `/v1/health` row → `fail("route_policy_missing", 403)`. `/v1/loops` is
allowlisted, hence 200. **Root cause is in this repo** (route-policy allowlist
gap), not internal-apps. FIXED this PR: `/v1/health` and `/v1/healthz` join the
open probes (same { status, version, storage, connection } envelope), with
tests asserting no auth call and no tenant storage access.

## 4. Deferred (needs owner / spec / other repo)

- **`uptimemon` package provenance** — not in this repo (see §1).
- **logs 401 body embeds the DEPRECATED env-key notice** — the notice is
  generated by the shared `@hasna/contracts` credential seam
  (apps/contracts/src/client/credentials.ts); the 401 text comes from the
  shared `honoApiKey` auth kit. Cross-cutting change affecting every fleet app;
  already tracked as the DEPRECATED-notice conflict (#1513). Deferred here.
- **identity flags defaulting from station-wrapper env** — needs the wrapper
  env spec; ties into #1588 (uniform `API:` line in status/whoami).
- **Repository-wide `--json`/`status` kit adoption** for apps that still print
  bespoke text (attachments, computers, connectors, contacts subcommands,
  conversations, economy, guardrails, mementos, orgs, skills, snapshots, tai,
  telephony, workflows…) — follow-up wave, filed per-app where no shared kit
  exists yet.
- **monitor `monitor-web` bin** — dashboard dev server; **already resolved on main** by the dashboard-removal wave (#1678 dropped the bin and the Vite tree; this PR rebased onto it).
- **`calendar doctor`** — no store integrity surface to run yet; add with the
  storage work.
- **changelog contract bins understated** (mcp/serve undeclared) — manifest
  lane, tracked in todos; not a consumer-facing defect.