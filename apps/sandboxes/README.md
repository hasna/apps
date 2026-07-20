# `@hasna/sandboxes`

Managed E2B / Daytona sandbox adapters plus a `sandboxes` CLI and a
`sandboxes-mcp` MCP server for driving disposable cloud sandboxes.

> ### ⚠️ 1.0.0 — from-scratch rebuild (BREAKING)
>
> `1.0.0` is a ground-up rebuild. The old storage/SDK/server sandbox-manager
> API (`@hasna/sandboxes/storage`, `@hasna/sandboxes/sdk`, the `sandboxes-serve`
> HTTP server, and the Postgres-backed store) has been **removed and replaced**
> by the new E2B/Daytona **managed adapters** with a rebuilt **CLI** and **MCP**
> server. The `.` export now surfaces the managed adapters (not the old SDK).
> The `sandboxes` and `sandboxes-mcp` bin names are preserved so existing
> `mcp__sandboxes__*` client configs and CLI call sites keep working, but the
> programmatic library surface changed. See `CHANGELOG.md`.

## Packages, bins, and exports

- `import { createE2bAdapter, createDaytonaCloudAdapter } from "@hasna/sandboxes"`
  — the managed adapters (also available as `@hasna/sandboxes/adapters`).
- `sandboxes` — CLI: `create`, `list`, `get`, `exec`, `logs`, `write-file`,
  `read-file`, `list-files`, `expose-port`, `list-ports`, `snapshot`, `stop`,
  `keep-alive`, `destroy`. Choose a backend with `--provider local|e2b|daytona`.
- `sandboxes-mcp` — MCP (stdio) server exposing `create_sandbox`,
  `list_sandboxes`, `get_sandbox`, `delete_sandbox`, `stop_sandbox`,
  `keep_alive`, `exec_command`, `read_file`, `write_file`, `list_files`,
  `get_logs`, `expose_port`, `list_exposed_ports`, `snapshot_sandbox`,
  `upload_dir`, `run_agent`, `version`, `health`.

### Providers & credentials

| provider  | credentials (env or `secrets` vault)        |
| --------- | ------------------------------------------- |
| `local`   | none — persistent in-process simulator (default; used by the hermetic tests) |
| `e2b`     | `E2B_API_KEY`                               |
| `daytona` | `DAYTONA_API_KEY` (+ optional `DAYTONA_API_URL`) |

Credentials are read from the environment first, then from the `secrets` CLI
vault. They are held only in memory and passed straight to the provider SDK —
never logged, printed, or persisted by this package. The `local` provider is a
deterministic simulator (no host processes, no network) intended for offline
development and testing; `e2b`/`daytona` require live credentials and network.

```sh
# local simulator (no credentials)
sandboxes --provider local create
sandboxes --provider local exec <id> echo hello

# live E2B
E2B_API_KEY=... sandboxes --provider e2b create
```

## V1 trust boundary

The exact pinned official SDK modules (`e2b@2.31.0` and `@daytona/sdk@0.193.0`),
their broker handles, and the in-package callbacks passed to these bridges are control-plane
trusted computing base (TCB). Production ports must execute in the adapter's Node realm and
return genuine same-realm intrinsic `Promise` instances with unmodified `constructor` and
`then` lookup behavior. The bridge enforces that contract and fails closed with
`integrity_failed` when it can do so safely.

Sandbox-controlled bytes and provider DTO values are **not** trusted by that exception. They
remain hostile input and are authenticated, bounded, validated, and copied before use.
Daytona inbound chunks are limited to the 16 MiB broker-frame ceiling, eight concurrent
deliveries, and 16 MiB total in-flight bytes before allocation/copy. The SDK-facing callback
always fulfills so the pinned SDK cannot rethrow an ignored listener rejection; the session
drain preserves and throws the first original failure after sealing/finalization. Read-only SDK
DTOs are copied into validated owned primitives before attestation, and both attestation input
and returned ownership are derived from that one snapshot.

JavaScript has no public operation that can mark every rejected native Promise handled without
consulting either its `constructor` or `then`. Consequently, a TCB port that returns an already
rejected cross-realm Promise or a Promise with a hostile non-configurable `constructor` accessor
has already violated the V1 boundary: the bridge rejects it without executing the accessor, but
the host may still report the original rejection. Provider-SDK Worker/subprocess isolation is a
future hardening capability, not a V1 containment claim. Such untrusted SDK ports must not be
admitted to production.
