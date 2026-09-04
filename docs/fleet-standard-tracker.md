# Fleet-standard tracker — the 20 unhosted @hasna packages

Source of truth for the wave that brings every unhosted `@hasna/*` package to the
fleet standard (tracking issue
[#1667](https://github.com/hasna/apps/issues/1667)). Each row is the contract
between this tracker and its per-package lane (issues #1653–#1666); the
prerequisite issues below must land first where marked. Per-package lanes update
their own issue; this table is updated once per lane by the coordinator on merge.

## The fleet standard (what "hosted" means)

Every `@hasna` app is behind an API and offers **both** placements — hosted
(cloud) or local — chosen by the user; the internal harness always chooses
hosted. The 25 compliant apps today run as: ECS service on `oss-fleet-prod` +
gateway route (`https://api.hasna.com/<app>/v1/...`) + client key pair
(Secrets Manager `hasna/oss/<app>/api-key` and `api-key-signing-secret`).

A package is fleet-standard when it has:

- **API surfaces** — served API behind the gateway route with client-key auth,
  verified server-side via `@hasna/contracts` (`verifyApiKey` /
  `API_KEY_SIGNING`; **0 of the 18 real packages use it today**).
- **Placement contract** — reads canonical `HASNA_<APP>_API_URL` /
  `HASNA_<APP>_API_KEY` (#1599), explicit hosted/local mode switch, no local
  database/mirror in hosted mode (#1613), no path-prefixed-base rejection
  (#1601).
- **Server readiness** — migrations, Dockerfile, `hasna.contract.json`,
  `deploy-<app>.yml` lane, and an `infra/apps/<app>/prod` root. **None of the 18
  has a deploy lane or an infra root today.**
- **Paths** — the shared resolver in `@hasna/contracts` (#1668) instead of the
  per-app copies; no hard-coded `~/.hasna` refs.
- **Packaging** — one `@hasna/<name>` package per app (four surfaces: CLI bin,
  MCP bin, `<name>-serve` bin, self-contained `./sdk`), per the publishing rule
  in `AGENTS.md`.

## The 20 packages

14 real app packages with source on main (table 1 of #1667, each with a lane in
#1653–#1666) + 6 packages needing an owner ruling (table 2 of #1667:
guardrails/statusline/events/orgs — source on main but local-only by design;
clip/uptime — **no source on main**, published packages only).

| package | status | surfaces needed | prerequisite | effort | slot |
|---|---|---|---|---|---|
| `@hasna/computers` (#1656) | cli/mcp/serve/migrate/worker present; no env read, no mode switch; migrations+Dockerfile+contract ✓, deploy lane + infra ✗; 5 hard-coded `~/.hasna` refs | gateway route + client key; env contract; hosted/local mode switch; `deploy-computers.yml` + `infra/apps/computers/prod`; resolver swap; snapshot bucket (#1644 D) | #1668 paths, #1599 env, #1644 buckets | S | 1 |
| `@hasna/workflows` (#1666) | cli/mcp/serve present; no env read, no mode switch; migrations+Dockerfile+contract ✓, deploy lane + infra ✗; 9 hard-coded refs | route + key; env contract; mode switch; `deploy-workflows.yml` + infra root; resolver swap | #1668, #1599 | S | 1 |
| `@hasna/changelog` (#1655) | cli/mcp/serve present; no env read, no mode switch; **no store yet** (no migrations/Dockerfile); contract ✓; resolver copy ✗; 1 ref | route + key; env contract; mode switch; store (migrations + Postgres); Dockerfile; deploy lane + infra root; resolver | #1668, #1599 | S | 1 |
| `@hasna/prompts` (#1661) | cli/mcp/serve; env reads ✓ (18), mode switch ✓ (16, partial); no store, **20 hard-coded refs** (+12 bytea/S3 refs) | finish mode removal (#1600); store + Dockerfile; deploy lane + infra; render-artefact bucket (#1644 D); resolver | #1600/#1570, #1668, #1644 | M | 2 |
| `@hasna/automations` (#1653) | cli + daemon, server dir but **no serve bin**; SQLite-only store; no env read, no mode switch; 5 refs | serve bin; Postgres store (no local SQLite in hosted, #1613); route + key; env contract; mode switch; deploy lane + infra; resolver | #1613, #1668 | M | 2 |
| `@hasna/feedback` (#1659) | cli/mcp/serve present; no env read, no mode switch; no store; 8 refs (2 hard-coded) | store + Dockerfile; route + key; env contract; mode switch; deploy lane + infra; resolver | #1668 | M | 2 |
| `@hasna/servers` (#1664) | cli/mcp present; server code exists but **no serve bin**; no env read, no mode switch; 12 refs | serve bin; route + key; env contract; mode switch; Dockerfile; deploy lane + infra; resolver | #1668 | M | 2 |
| `@hasna/snapshots` (#1665) | cli/agent/mcp/serve present; **nothing** server-ready (no migrations/Dockerfile/contract/deploy/infra); 11 refs | store; contract; Dockerfile; deploy lane + infra; route + key; env contract; mode switch; resolver | #1668, #1599 | M | 2 |
| `@hasna/releases` (#1662) | cli/mcp only; **no server at all**; 6 refs | serve bin; store; contract; Dockerfile; deploy lane + infra; route + key; env contract; mode switch; resolver | #1668 | M | 2 |
| `@hasna/connectors` (#1657) | cli/mcp/serve present; no env read, no mode switch; **nothing** server-ready; 30 hard-coded refs, **182 bytea/bytes refs** (bytea ×24, #1644 D) | store + migrations; Dockerfile; contract; deploy lane + infra; route + key; env contract; mode switch; media bucket via #1631 kit; resolver | #1668, #1631, #1644 | L | 3 |
| `@hasna/monitor` (#1660) | cli/daemon/mcp/server/web+sdk present; no env read, no mode switch; contract ✓ only; **16 hard-coded refs, 47 bytea/bytes refs** | serve bin alignment; store; Dockerfile; deploy lane + infra; route + key; env contract; mode switch; snapshots bucket (#1644 D); resolver | #1668, #1644 | L | 3 |
| `@hasna/repos` (#1663) | cli/mcp/serve/verify-release present; mode switch ✓ (7, partial); **no server at all**; **62 hard-coded refs** (worst), 5 bytea refs (×22, #1644 D) | store; contract; Dockerfile; deploy lane + infra; route + key; env contract; complete mode switch; artefact bucket (#1644 D); resolver | #1668, #1644 | L | 3 |
| `@hasna/bridge` (#1654) | cli/mcp only; **no server**; 7 refs | serve bin; store; Dockerfile; deploy lane + infra; route + key; env contract; mode switch; resolver | #1668 | L | 3 |
| `@hasna/dispatch` (#1658) | cli/daemon/mcp+sdk; env ✓ (38), mode ✓ (11) but **rejects path-prefixed base** (#1601); **server does not exist** (client expects one); 12 refs (2 hard-coded) | build + deploy the server; fix path-prefixed base (#1601); route + key; complete mode switch; deploy lane + infra; resolver | #1601, #1668 | L | 3 |
| `@hasna/guardrails` | library (one bin, no store, no server); local-first policy decisions belong in the caller's process | **none** — retire or keep local-only by design; owner ruling recorded in #1667 | ruling (→ #1667) | S | 4 |
| `@hasna/statusline` | pure client (statusline + statusline-mcp, no store); nothing to host | **none** — owner ruling recorded in #1667 | ruling (→ #1667) | S | 4 |
| `@hasna/events` | shared event envelopes + local channels/replay (15 SQLite refs); hosted transport is the apps themselves | **none** — owner ruling recorded in #1667 | ruling (→ #1667) | S | 4 |
| `@hasna/orgs` | org graph/delegation layer, no store, no server; either becomes a hosted service or stays a library | if hosted → **full app lane** (store, serve, deploy, infra); else none | ruling (→ #1667) | M (if hosted) | 4 |
| `@hasna/clip` | published on npm, **no source on main** (`apps/clip` absent) | restore the source and treat as an app → full lane; **or** unpublish/deprecate on npm | ruling (→ #1667) | M (if restored) | 4 |
| `@hasna/uptime` | published on npm, **no source on main** (`apps/uptime` absent) | restore the source and treat as an app → full lane; **or** unpublish/deprecate on npm | ruling (→ #1667) | M (if restored) | 4 |

Count: 14 app lanes + 4 local-by-design rulings + 2 no-source rulings = **20**.

## Sequencing

| slot | content | notes |
|---|---|---|
| 0 — foundation (prerequisites) | #1631 contracts kit, #1668 paths resolver, #1599 env contract, #1613 no-local-storage, #1601 path-prefixed base | shared infra the lanes consume; land before slot 1 where marked |
| 1 — S wave | computers #1656, workflows #1666, changelog #1655 | smallest surface gaps (serve + Dockerfile + contract already present for computers/workflows) — pilot the pattern |
| 2 — M wave | prompts #1661, automations #1653, feedback #1659, servers #1664, snapshots #1665, releases #1662 | one new store/bin each; orgs joins here if the ruling says hosted |
| 3 — L wave | connectors #1657, monitor #1660, repos #1663, bridge #1654, dispatch #1658 | biggest refactoring (bytes/bytea, 30–62 hard-coded refs, missing servers) |
| 4 — rulings | guardrails, statusline, events, orgs, clip, uptime | owner rulings recorded in #1667; clip/uptime need a deprecation or a restore |

Lanes in a wave run in parallel; slots gate on the previous slot's merges only
where the prerequisite column says so.

## Acceptance (from #1667)

- Every package in the 14-lane table has `<app>-prod` on `oss-fleet-prod`, a
  gateway route, a client key, and passes the same station sweep as the 25
  (real read through a wrapper, no local file created).
- Every package in the ruling table has an owner ruling recorded in #1667 and
  either an issue in the first table or a deprecation on npm.

## Sources

- Issue [#1667](https://github.com/hasna/apps/issues/1667) — classification,
  per-package measurements (surfaces, env reads, mode switch, server readiness,
  resolver copies, hard-coded refs, bytes), acceptance set.
- Issue [#1644](https://github.com/hasna/apps/issues/1644) — bucket
  classification; unhosted packages needing buckets (D class): connectors,
  repos, computers, prompts, monitor, clip.
- Issue [#1668](https://github.com/hasna/apps/issues/1668) — paths resolver in
  `@hasna/contracts` (32 copies + 33 hard-coded sites to migrate).
- Issue [#1631](https://github.com/hasna/apps/issues/1631) — shared
  artifact-remote kit (prerequisite for bytea/media apps).