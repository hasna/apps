# Local runtime

`@hasna/servers` manages development and app processes only when a server's runtime mode is `local`. It records operations, traces, status, PID, command, working directory, readiness endpoints, environment, and logs in the SQLite registry.

Production infrastructure remains externally owned. A `production-cloud` record can carry health, readiness, and public URL metadata, but local start, stop, and restart calls fail before mutating the process or infrastructure.

## Initialize a server

```bash
servers servers:init --path . --port 3000
servers servers:init --path . --command "bun run dev" --port 3000
```

`servers:init` chooses the nearest git root as its default path, falling back to cwd. It creates a project for that path when one does not exist, derives a server slug from the name, and registers the server as `offline`. An existing slug is rejected unless `--force` is supplied, in which case the existing record is updated.

Without `--command`, detection checks the selected directory in this order:

1. `package.json` with a `dev` script.
2. `package.json` with a `start` script.
3. `manage.py` → `python manage.py runserver 0.0.0.0:<port>` (default port `8000`).
4. `pyproject.toml` or `requirements.txt` → `python -m uvicorn main:app --host 0.0.0.0 --port <port>` (default port `8000`).
5. `Cargo.toml` → `cargo run`.
6. `go.mod` → `go run .`.
7. `docker-compose.yml`, `compose.yaml`, or `compose.yml` → `docker compose up`.

JavaScript script execution follows the lockfile: Bun, pnpm, Yarn, then npm. With no recognized lockfile it defaults to Bun. Detection does not search child directories or validate that a generic Python project actually exports `main:app`; pass `--command` when the default is unsuitable.

## Runtime convention

Explicit input takes precedence over metadata, which takes precedence over environment variables, then defaults.

| Meaning | Metadata | Environment | Default |
| --- | --- | --- | --- |
| Runtime mode | `runtime_mode` | `SERVERS_RUNTIME_MODE` | `local` |
| Process owner | `process_owner` | Derived | `hasna-servers` locally; `external-platform` in production cloud |
| Port | `port` (then `tailscale_port`) | `PORT` | None |
| Bind host | `bind_host` | `HOST` | `127.0.0.1` locally; `0.0.0.0` in production cloud |
| Probe host | `probe_host` | `SERVERS_PROBE_HOST` | `127.0.0.1` |
| Health path | `health_path` | `SERVERS_HEALTH_PATH` | `/health` |
| Readiness path | `readiness_path` | `SERVERS_READINESS_PATH` | `/ready` |
| Health URL | `health_url` | `SERVERS_HEALTH_URL` | Built from probe host, port, and health path |
| Readiness URL | `readiness_url` | `SERVERS_READINESS_URL` | Built from probe host, port, and readiness path |
| Public URL | `public_url` | `SERVERS_PUBLIC_URL` | None |

Mode aliases `dev` and `development` normalize to `local`; `production` and `prod` normalize to `production-cloud`. Other values are rejected. Ports must be integers from 1 through 65535.

Lifecycle-specific metadata also includes:

- `start_command` (or legacy `command`) and `cwd`.
- `env`, containing valid environment names with string, number, or boolean values.
- `log_file`, defaulting to `<cwd>/.servers/<slug>.log`.
- `ready_timeout_ms`, defaulting to 30 seconds.
- `stop_timeout_ms`, defaulting to 15 seconds.
- `pid`, timestamps, actor, and reason fields written by lifecycle operations.

Secrets stored in metadata or operation details are redacted from CLI and MCP display output, but the database itself is not an encrypted secret store.

## Readiness

Lifecycle snapshots determine readiness in this order:

1. Probe `readiness_url` when configured.
2. Probe `health_url` when no distinct readiness URL exists.
3. Connect to the configured TCP port.
4. Treat the recorded process as ready when no endpoint or port is available.

HTTP probes require a successful response. `servers:start` and `servers:restart` wait up to 30 seconds by default, polling every 250 ms. `--no-wait` returns after spawning and leaves status as `starting` until a later status refresh observes readiness. If a spawned process exits or misses readiness, the lifecycle operation fails, the spawned process tree is cleaned up, and the server is returned to `offline`.

`servers:status --refresh` persists observed status. A ready server becomes `online` and receives a heartbeat; a process that is not running becomes `offline`.

## Locking

Start, stop, and restart acquire an exclusive `server-runtime` resource lock. The lock has a 30-minute TTL. By default a conflict fails immediately; `--wait-lock` polls for the lock for up to five minutes, or the supplied `--lock-timeout`.

The lifecycle lock is always released in a `finally` path. It is independent of the server row lock manipulated by `servers:lock` and `servers:unlock`.

## Process safety

Processes start detached in a new process group with stdout and stderr appended to the managed log file.

Verified stop discovers targets from the recorded PID, process-group descendants, configured port listeners, and matching command/cwd processes. It sends SIGTERM, waits for the stop timeout, escalates survivors to SIGKILL, and confirms the process tree and port are gone before marking the server offline.

`servers:stop --no-wait` is intentionally different: it sends SIGTERM, records `stopping`, and returns without verifying exit. The `--force` option is accepted for CLI parity but verified stop already escalates when required.

Restart normally refuses to replace a process tree that survives SIGTERM. Pass `--force` to permit SIGKILL escalation during restart. Only after the old target is confirmed stopped does restart spawn the replacement.

Process discovery uses Linux `/proc`, `lsof`, `fuser`, `ps`, and `pgrep` where available, with fallbacks. Command matching removes common package-manager wrappers and options to find escaped child processes without relying only on the originally recorded PID.

## SDK

```typescript
import {
  detectProjectServerConfig,
  getLocalServerSnapshot,
  resolveServerRuntimeConvention,
  restartLocalServer,
  runtimeMetadataFromConvention,
  startLocalServer,
  stopLocalServer,
} from "@hasna/servers";
```

The SDK functions use the same database records, locking, readiness, and process-tree behavior as the CLI and MCP tools.
