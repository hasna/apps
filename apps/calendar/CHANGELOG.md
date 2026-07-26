# Changelog

## 0.3.0

**Security + correctness hotfix. Two defects, both verified live against
`https://calendar.hasna.xyz` before the fix. Contains BREAKING configuration
changes — read "Deploy requirements" before rolling this out.**

### Defect 1 (security): `/mcp` was an anonymous, write-capable data plane

`serve()` mounted `/mcp` **after** `handleV1Request`, and `handleV1Request`
returns `null` for every path that is not `/v1*`. The only auth choke point in the
process therefore never saw `/mcp`, and `src/mcp/http.ts` has no auth of its own.
The file header even claimed "There is no unauthenticated REST surface" — true for
REST, false overall, which is exactly why review missed it.

Note the mechanism differs from the same-class todos defect (`hasna/todos#94`):
todos had a `checkAuth` that **failed open**; calendar had a route **mounted
outside the guard**.

Verified live with **no credential** from an off-box host:
`POST https://calendar.hasna.xyz/mcp {"jsonrpc":"2.0","id":1,"method":"tools/list"}`
returned **HTTP 200, 9,889 bytes, 23 tools** — including `create_org`,
`register_agent` (which supports takeover-by-name via `force`), `create_calendar`,
`create_event`, `update_event`, `delete_event`, `add_attendee`, `set_availability`
and `add_member`. `GET /v1/orgs` correctly returned 401 at the same moment. The
transport is stateless (`sessionIdGenerator: undefined`), so no handshake was
needed.

Honest severity: because of defect 2 the anonymous plane was writing to an
ephemeral on-box SQLite file rather than the fleet Postgres, so this was **not
live customer-data exposure**. It was still: anonymous writes into a production
container, full tool-catalogue disclosure, unbounded disk growth on the task
writable layer, non-deterministic reads at `desiredCount > 1`, and a real data
path the instant anyone pointed the process at the shared store.

**Fix.** A new `src/server/auth-posture.ts` resolves exactly one posture **once at
startup, before the socket is bound** (the `local-plane-disabled` posture follows
`hasna/todos#94`):

| Configuration | Posture | `/mcp` | `/v1` | `/health` `/ready` `/version` `/openapi.json` |
| --- | --- | --- | --- | --- |
| `CALENDAR_SERVE_API_KEY` / `--api-key` | `enforce` | credential required | authenticated | public |
| hosted (DSN, or mode `self_hosted`/`cloud`) and no serve key | `local-plane-disabled` | **404 `LOCAL_PLANE_DISABLED`**, not mounted | authenticated | public |
| loopback bind **and** `--allow-anonymous` | `anonymous-loopback` | anonymous, **loopback peers only** | authenticated | public |
| anything else | — | **refuses to start, exit 1** | — | — |

- Refusing to start beats starting wide open; the error names
  `CALENDAR_SERVE_API_KEY`, the hosted option, and `--allow-anonymous`, and never
  prints a credential.
- `--allow-anonymous` is refused outright for a non-loopback bind, and even when
  active a request is only served anonymously if its **raw transport peer** is
  loopback (read from `server.requestIP`; `x-forwarded-for` is deliberately
  ignored so a proxy header cannot forge loopback).
- The credential is compared in constant time and accepted from either
  `x-api-key` or `Authorization: Bearer`.
- `CALENDAR_SERVE_API_KEY` is deliberately **not** the client-flip
  `CALENDAR_API_KEY`/`HASNA_CALENDAR_API_KEY`: reusing those would make the server
  authenticate callers with the key it uses to call a remote `/v1`, and would flip
  `getStore()` to the API store as a side effect of configuring auth.
- Closing the hole cannot cause a hosted outage: the hosted deployment has a DSN
  and no serve key, so it lands in `local-plane-disabled` — `/v1` and all four
  probes keep working and the ALB target group (which health-checks `/health` with
  a 200 matcher) is unaffected.
- The second HTTP mount, `startMcpHttpServer` (`calendar-mcp --http`), is hardened
  too: it binds loopback only, now rejects any non-loopback transport peer, and
  requires `CALENDAR_SERVE_API_KEY` when one is set.

**Also closed, same class, behind a credential.** A hosted process that *did* set
`CALENDAR_SERVE_API_KEY` would serve `/mcp` through `getStore()` — on-box SQLite
unless the client-flip env is set — while `/v1` used Postgres: defect 2 again,
authenticated instead of anonymous. `resolveAuthPosture` now throws
`SplitStorePlaneError` (`code: SPLIT_STORE_PLANE`) for that combination and names
both fixes (drop the serve key, or set `HASNA_CALENDAR_API_URL` +
`HASNA_CALENDAR_API_KEY` so both planes share one store). This cannot affect
`calendar-prod`, which has no serve key.

`/ready` now decides whether to round-trip the database from whether the hosted
plane is configured (`isCloudModeEnabled()`), not from the reported mode label, so a
contradictory `STORAGE_MODE=local` + DSN combination cannot turn `/ready` into an
unconditional "ready".

The full route census — every route the server mounts, its methods, its guard, the
store it reaches and whether it carries data or only metadata — is in the README
and in the header comment of `src/server/serve.ts`.

### Defect 2 (correctness): an unrecognised storage mode silently changed data stores

The running `calendar-prod` task definition (revision 4) set
`HASNA_CALENDAR_STORAGE_MODE=remote`. `normalizeMode` in
`src/store/http-storage.ts` accepts only `local | self_hosted | cloud`, so it
warned and **fell back to the SQLite `LocalStore`** — while `src/server/cloud.ts`
keyed hosted mode off the literal string `"remote"` and kept `/v1` on RDS. Two
planes of one production process, on two different data stores, at the same time.
Reproduced exactly, before the fix:

```
resolveClientTransport -> {"transport":"local","warning":"Unknown storage mode 'remote' ...; using local."}
isCloudModeEnabled     -> true
```

**Fix.** New `src/store/storage-mode.ts` is the single source of truth for the mode
vocabulary. An unrecognised value now throws `UnknownStorageModeError`
(`code: UNKNOWN_STORAGE_MODE`) from the client resolver, from `isCloudModeEnabled`,
and from `calendar-serve` startup (exit 1 with an actionable, credential-free
message).

`remote` is **rejected, not aliased.** Mode vocabulary carries no
backwards-compatibility guarantee, and keeping the alias would preserve exactly the
drift that caused this. The error names the replacement:
`set HASNA_CALENDAR_STORAGE_MODE=self_hosted instead`. The same applies to the other
retired spellings (`hosted`, `server`, `saas`, `prod`, `sqlite`, `offline`).

`self_hosted` and `cloud` are both canonical here and behave **identically** on the
server. **Prefer `cloud`**: `@hasna/contracts` `CONTRACT.md` Amendment A1 declares the
runtime storage enum to be `local | cloud` and lists `self_hosted` as a deprecated
alias, and every other Terraform-managed Hasna app already sets `cloud`. The error
hint above still names `self_hosted` (also valid); it is the one place left that
should eventually say `cloud`.

`/health`, `/ready` and `/version` now report the canonical mode
(`local`/`self_hosted`/`cloud`) instead of the invented `"remote"` label.

### Deploy requirements (BREAKING — these must land together)

1. **`calendar-prod`:** change `HASNA_CALENDAR_STORAGE_MODE` from `remote` to
   **`cloud`**. A task definition still carrying `remote` will **not start** on this
   version. `calendar-prod` is Terraform-managed
   (`hasna-xyz-infra apps/calendar/prod/main.tf`, `module "app"` -> `env`), so the
   change must be made **there**, not by hand-registering a task-definition revision:
   a hand-registered revision is drift that the next `terraform apply` would revert
   back to `remote`, which on this version is a delayed self-inflicted outage.
2. The image already carries the corrected default (`Dockerfile` `ENV` changed
   `remote` -> `cloud`), so a redeploy that drops the container override also works.
3. Nothing else changes: no new secret, no new IAM permission, no ALB/target-group
   change. `HASNA_CALENDAR_DATABASE_URL` and `HASNA_CALENDAR_API_SIGNING_KEY` keep
   coming from Secrets Manager under the same item names.
4. Any operator running `calendar-serve` locally must now pass
   `--allow-anonymous` (loopback) or set `CALENDAR_SERVE_API_KEY`.

### Tests

- `src/server/serve-auth.test.ts` — boots the real `serve()` and asserts, per
  posture: anonymous `POST`/`GET`/`DELETE`/`PUT`/`PATCH` `/mcp` denied with no tool
  name in the body; all 10 `/v1` reads and 10 `/v1` writes 401 for an anonymous
  caller; `/health` `/version` `/openapi.json` (and `/ready`, where the DSN is
  live) stay 200 and never echo a credential, signing secret or DSN; `serve()`
  refuses to bind `0.0.0.0` with only `--allow-anonymous`, and refuses to start
  with nothing configured; a correct credential still reaches the transport.
- `src/server/auth-posture.test.ts` — the whole posture matrix, including an
  exhaustive assertion that **no combination of inputs yields an anonymous plane on
  an off-box bind**, loopback-address parsing (`::ffff:127.0.0.1`, `127.0.0.53`,
  and negatives such as `127.0.0.1.evil.com`, `::ffff:10.0.0.1`, `1270.0.0.1`), and
  that `x-forwarded-for` cannot forge a loopback peer, plus the `SplitStorePlaneError`
  matrix (hosted + credential + local store refuses; hosted + credential +
  cloud-http store is fine; non-hosted is unaffected; hosted with no credential is
  still `local-plane-disabled`).
- `src/store/storage-mode.test.ts` — `remote` and other non-canonical values are
  rejected by `parseStorageMode`, `resolveClientTransport`, `resolveStorageClient`
  and `isCloudModeEnabled`; canonical values still resolve exactly as before; the
  reported service mode is never `"remote"`.

**Both directions were checked.** Against `origin/main` (8d9503c) in a separate
pristine worktree, with only the two new *source* modules copied in and none of the
fixes: **13 fail / 40 pass**, plus 2 file-level import errors for symbols that do
not exist on main. The failures are the real ones — anonymous `/mcp` answers 200
with `create_org` in every posture, `serve()` happily binds `0.0.0.0` with
`--allow-anonymous`, `serve()` starts with nothing configured, and `serve()` starts
with `STORAGE_MODE=remote`. On this branch the same three files are **76 pass / 0
fail**, and the whole suite is **203 pass / 0 fail**.

### Test isolation (why the suite was 11-red before)

`bun test` inherited the operator's exported client-flip env, so `getStore()`
resolved to the `ApiStore` and eleven "local" tests were silently reading and
writing the **live deployment**. A `[test] preload`
(`src/test/env-isolation.preload.ts`) now scrubs the client-flip, hosted and
auth-posture env vars, so the CLI tests — which spawn subprocesses with
`{ ...process.env }` — inherit a clean env too. Those 11 pre-existing failures are
now green.

### Bundle hygiene

`src/mcp/index.ts` imports `./http.js`, so anything `src/mcp/http.ts` imports lands in
the local-first CLI/MCP bundle. `src/server/auth-posture.ts` is therefore written with
**zero imports** — its first draft imported `./cloud.js` for a default `hosted` value
and pulled `@hasna/contracts/auth`, the Postgres store and the cloud query client into
`dist/mcp`. `hosted` and `localPlaneTransport` are passed in by the caller instead.

### Other

- `README.md`: the "HTTP API Server" section documented an `/api/*` surface that
  was removed by the earlier `Store` refactor and no longer exists. Replaced with
  the real route census, the auth-posture matrix and the storage-mode table.
- `hasna.contract.json`: description no longer advertises the rejected
  `STORAGE_MODE=remote`.

## 0.2.5

Reconcile `main` with the published npm line (`@hasna/calendar@0.2.4`).

`main` had diverged into a true three-way split from the published registry line:

- **Published-only (7 commits, npm `latest` 0.2.4):** the self_hosted unified-`Store`
  refactor (`getStore()` → `LocalStore` + `ApiStore`), cloud `/v1` route fixes
  (agents/attendees/availability/members), FTS5 search sanitize, removal of the
  sqlite/db re-exports + mode-alias shim, and release bumps for 0.2.1/0.2.3/0.2.4.
- **main-only (2 commits):** `#1` report the MCP server version from `package.json`,
  and `#2` compact CLI + MCP list output (paged, `--verbose`/`limit`/`cursor`).

This release merges the published tag into `main` with a `--no-ff` merge (both
histories preserved — no commits dropped) and re-applies the two main-only features
on top of the published `Store` architecture rather than text-merging them:

- **`#1` MCP version** is preserved as-is (the MCP server already reads
  `packageJson.version`).
- **`#2` compact output** now sources its data through `getStore()` (async, transport
  -routed) while keeping the compact/paged presentation (`outputList` in the CLI,
  `compactPage`/`pageArgsSchema` in the MCP server). The `compact*` helper type
  annotations were repointed from the removed direct DB functions to the shared entity
  types (`Org`, `Agent`, `Calendar`, `Event`, `EventAttendee`, `Availability`,
  `OrgMembership`).
- **`#1` release-bin health test** now polls the published server's canonical
  service-contract endpoint `/health` (the legacy `/api/health` alias was removed by
  the `Store` refactor).

Version bumped to `0.2.5` (above the published `0.2.4`) so the next publish supersedes
the registry.

### Verification

`bun install` / `bun run typecheck` / `bun run build` all pass; `bun test` passes
`123/123` in local mode. The 11 remaining failures seen when the station's
`HASNA_CALENDAR_STORAGE_MODE=cloud` env is present are pre-existing test-isolation
gaps (the CLI/MCP subprocess harness inherits the live cloud config instead of
forcing local mode) — they pass once the `HASNA_CALENDAR_*` env is unset, and are
not introduced by this reconciliation.
