# Infra Service Entrypoint Matrix

Date: 2026-07-06

Source tasks:

- `0c8caca6-c564-4ad3-a878-23a8405ca2bc` - Add infra service binaries and deployment contracts.
- `reports/task-proposals/adversarial-12/reviewer-02-open-infra.md` proposal 4.
- `reports/task-proposals/adversarial-12/reviewer-09-service-baseline.md` SVC-01 through SVC-03.
- `reports/task-proposals/adversarial-12/reviewer-12-final-dedupe.md` task 17.

This matrix is intentionally conservative. A `*-serve` package bin is only
`supported` when the repo already exposes a service boundary that can declare
health/version routes, auth behavior, data backends, and readiness gates in
`hasna.contract.json`. Repos with raw secret values, undefined hosted auth, or
missing state ownership must use `deferred` instead of publishing a broad server
bin.

| Repo | Package | Current bins | Service decision | Required next contract evidence |
| --- | --- | --- | --- | --- |
| `backup` | `@hasna/backup@0.1.2` | `backup`, `backup-mcp` | `deferred` | Define hosted state owner, backup target credential refs, `/health`, `/ready`, redacted inventory output, and restore-smoke evidence before `backup-serve`. |
| `bridge` | `@hasna/bridge@0.2.1` | `bridge`, `bridge-mcp` | `deferred` | Define bridge auth scopes, connector secret refs, event replay boundaries, and no-secret output gates before `bridge-serve`. |
| `domains` | `@hasna/domains@0.0.27` | `domains`, `domains-mcp`, `domains-serve` | `supported` | Add/refresh `hasna.contract.json` service surface with `/health`, `/ready`, `/version`, `/v1`, provider-credential readiness gates, dry-run DNS mutation gates, and redaction tests. Keep concrete secret refs in private deployment config. |
| `hooks` | `@hasna/hooks@0.2.20` | `hooks` | `deferred` | Decide whether hooks is CLI-only, MCP-capable, or service-capable; service mode needs webhook signature/replay gates and operator-visible DLQ before `hooks-serve`. |
| `machines` | `@hasna/machines@0.0.63` | `machines`, `machines-mcp`, `machines-agent`, `machines-serve` | `supported` | Add/refresh service surface with lease/claim auth scopes, private metadata redaction, `/v1` ownership boundaries, and fleet dry-run fixture gates. |
| `releases` | `@hasna/releases@0.1.0` | `releases`, `releases-mcp` | `deferred` | Promote release evidence schema and append-only ledger first; then add `releases-serve` with package/version/gate/evidence APIs and unauthorized mutation denial. |
| `secrets` | `@hasna/secrets@0.1.33` | `secrets`, `secrets-mcp`, `secrets-serve` | `deferred` for hosted raw-value access | Hosted service surfaces must declare secret-reference and lease semantics, local-only reveal exclusions, audit gates, and tests proving HTTP/MCP never returns raw secret values. |
| `servers` | `@hasna/servers@0.1.21` | `servers`, `servers-mcp` | `deferred` | Define lifecycle locks, operation ids, job-scoped auth, command/env redaction, and registered-server boundaries before `servers-serve`. |
| `uptime` | `@hasna/uptime@0.1.69` | `uptime`, `uptime-mcp` | `deferred` pending standard bin | Existing `serve` command should either publish `uptime-serve` or declare `serve: unsupported`; contract needs probe storage readiness and redacted status gates. |
| `gateway` | retired 2026-09-03 (public `@hasna/gateway@0.1.3` deleted by owner; edge API gateway runs as Cloudflare Worker `hasna-api-gateway` at `api.hasna.com`, source in hasna-internal/internal-apps `apps/gateway`, `@hasna-internal/gateway`) | none (no npm bins) | `not-applicable` (no npm service surface) | The npm package is deleted and not republished; the api.hasna.com edge is a Cloudflare Worker fronting fleet-app origins (`https://<app>.hasna.xyz`), with no `*-serve` bin to declare. |
| `monitor` | `@hasna/monitor@0.1.24` | `monitor`, `monitor-mcp`, `monitor-server`, `monitor-web` | `supported with alias decision` | Either add `monitor-serve` as an alias or declare `monitor-server` as the canonical exception; service surface must include health/readiness/version and redacted machine metadata. |

## Contract fields to use

Use `hasna.service_contract.v1` with:

- `hosting`: `user-hosted` and, only when a managed control plane exists,
  `hasna-saas`.
- `storage.backend`: the server's data backend, `sqlite` or `postgresql`. The
  removed placement vocabulary fails validation in any spelling. Do not use
  `remote` as a backend.
- `serviceSurfaces[]`: typed API, SDK, MCP, and CLI records.
- `serviceSurfaces[].kind`: `api`, `sdk`, `mcp`, or `cli`.
- `serviceSurfaces[].status`: `supported`, `deferred`, or `unsupported`.
- `serviceSurfaces[].deferReason`: required for `deferred` and `unsupported`.
- `serviceSurfaces[kind=sdk].exportSubpath`: a real `package.json` export key.
- `storage.engines`: `postgresql` for services; `sqlite` or `json` is additional
  capability metadata only when explicit legacy import/migration tooling exists.
- `storage.pgTestGate`: the disposable live-Postgres test env var and command;
  conformance records this command but never executes it.
- `serviceSurfaces[].readinessGates[]`: auth, storage, secret-ref, migration,
  health, readiness, redaction, smoke, and operator gates with command/evidence
  status when available.

## First implementation tasks

1. Apply this contract to `domains`, `machines`, and `monitor`
   first because they already expose service/server bins.
2. The `gateway` row is retired (2026-09-03): the public package was deleted
   and the api.hasna.com edge is a Cloudflare Worker in hasna-internal — no
   `gateway-serve` will be declared.
3. Keep `secrets` hosted service deferred until raw-value reveal is
   strictly local-only and network surfaces return refs/leases only.
4. Create app-specific tasks for `releases`, `servers`, and
   `uptime` once the service boundary and readiness owner are agreed.
