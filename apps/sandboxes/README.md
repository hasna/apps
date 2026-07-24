# `@hasna/sandboxes`

Managed E2B / Daytona sandbox adapters plus a `sandboxes` CLI and a
`sandboxes-mcp` MCP server for driving disposable cloud sandboxes.

> ### ⚠️ 1.0.0 — from-scratch rebuild (BREAKING)
>
> `1.0.0` is a ground-up rebuild. The old storage/SDK/server sandbox-manager
> API (`@hasna/sandboxes/storage`, `@hasna/sandboxes/sdk`, the `sandboxes-serve`
> HTTP server, and its broad Postgres-backed sandbox store) has been **removed and replaced**
> by the new E2B/Daytona **managed adapters** with a rebuilt **CLI** and **MCP**
> server. The `.` export now surfaces the managed adapters (not the old SDK).
> The `sandboxes` and `sandboxes-mcp` bin names are preserved so existing
> `mcp__sandboxes__*` client configs and CLI call sites keep working, but the
> programmatic library surface changed. See `CHANGELOG.md`.

## Packages, bins, and exports

- `import { createE2bAdapter, createDaytonaCloudAdapter } from "@hasna/sandboxes"`
  — the managed adapters (also available as `@hasna/sandboxes/adapters`).
- `@hasna/sandboxes/managed` — the native disposable-task preparation,
  one-use authorization, provider execution, checkpoint, result, and cleanup
  contract used by Infinity. The caller-supplied authority port is the trusted
  verifier for tenant, principal, and run authority. It carries the opaque
  tenant/principal binding in its canonical signed consumption receipt;
  Sandboxes binds the exact authority-envelope and receipt bytes by digest but
  does not validate the upstream signature or interpret those authority
  semantics. Sandboxes never accepts or stores credentials.
- `@hasna/sandboxes/postgres` — the optional Bun/PostgreSQL durable task journal
  and independent witness, with checked, atomic, roll-forward-only migrations
  and a narrow
  `PostgresClientV1` port. It restores self-hosted durability without restoring
  the removed sandbox-manager repository.
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

## Durable native execution

The native managed contract is split deliberately:

1. `prepareDisposableSandboxTaskIntentV2` stores a canonical, idempotent
   provider-free intent and returns its witnessed prepare anchor.
2. The caller-owned authority consumes that exact intent once and returns
   canonical authority-envelope bytes and signed receipt bytes. Sandboxes binds
   their digests before any provider contact. The authority port, not the
   journal, verifies the upstream authority signature and tenant/principal
   semantics.
3. The managed runner records provider allocation, result bundle, encrypted
   checkpoint handoff, absence proof, and cleanup receipt under the same
   dispatch and lease fences.
4. Replays return the existing durable state or fail closed; they cannot create
   a second provider allocation.

The journal and independent witness cryptographically verify only their own
journal/witness receipts and anchors. They do not extend that verification to
the caller-owned authority contract.

Local CLI/MCP development continues to use the deterministic, network-free
`local` backend. Self-hosted native execution uses `@hasna/sandboxes/postgres`;
its journal and witness must use distinct least-privilege PostgreSQL roles and,
for the witness, a distinct cluster. Run `bun run test:postgres` to exercise the
full disposable journal and independent-witness migrations against disposable
local PostgreSQL clusters.

PostgreSQL 16 is the current supported and verified database contract for both
the journal and witness. Session identity enforcement reads the PostgreSQL
16 `pg_auth_members.set_option` catalog column, and the live integration
harnesses intentionally run PostgreSQL 16 binaries. Other major versions are
outside the compatibility contract until their catalog behavior and live
harness runs are explicitly verified.

Every migration, runtime, reader, and acknowledgement connection must
authenticate directly as its configured least-privilege role: both
`session_user` and `current_user` must equal that role. A member login using
`SET ROLE` is rejected even when its effective privileges otherwise match.
PostgreSQL permits a cluster superuser to replace both identities with
`SET SESSION AUTHORIZATION`; cluster superusers are physical database
authority and therefore remain outside this least-privilege application
boundary.

PostgreSQL migrations have no down-migration path. Applying a target checks that
the ledger is an exact stable prefix, then applies the remaining prefix in one
transaction. A failure leaves the prior stable prefix unchanged; recovery
reruns the same target.
