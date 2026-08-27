# Computers

`@hasna/computers` is a Bun-first controller for durable lifetime Computers assigned to AI employees. A Computer keeps a stable identity, owner, policy generation, durable-home lease, operation history, and audit chain across stop/start or future substrate replacement. It is not an ephemeral job runner.

The controller runs without AWS or a privileged daemon. It includes a lower-assurance whole-machine adoption adapter and an opt-in stock-Lima/VZ backend for Apple Silicon macOS. Both remain unconfigured unless an operator supplies a private, bounded local-controller configuration.

## Assurance is explicit

- `local_machine` is lower-assurance `dedicated_machine` confinement. The resident shares the host OS (`residentIndependentIsolation=false`). A live controller observer must prove host identity, exclusive dedication, protected controller authority, boot identity, and running state. A current resident heartbeat is additionally required before resident binding authority is recorded; its absence does not make an otherwise authoritative adoption unknown. Request booleans never establish assurance.
- Stock-Lima `local_vm` is always `unverified_vm` in this release. Neither static diagnostics nor an external Boolean helper can promote it. Generic `strict_vm` remains available to future provider implementations such as a package-owned `strict_guest` manager or a fully proven EC2 adapter.
- `dataExfiltrationProtection` is always false in this slice. Broad internet access must never be presented as data-exfiltration prevention.

Guest agents must never receive provider, cloud, host, controller, Sandbox, resident, or signing credentials; Docker/hypervisor sockets; sudo; or lifecycle authority.

## Quick start

```sh
bun install
bun run build
bun run src/bin/computers.ts init --db ./computers.db
bun run src/bin/computers.ts computer create \
  --db ./computers.db \
  --slug primary \
  --provider local_machine \
  --idempotency-key example-create-001
bun run src/bin/computers.ts provider readiness --db ./computers.db
```

The controller's SQLite store path is resolved through the `@hasna/paths` resolver (XDG/macOS home layout). An explicit store path (`--db` or `COMPUTERS_DB`) always wins; otherwise the effective data root is the legacy `~/.hasna/computers` until the store has been migrated to the resolver data home (`~/.local/share/hasna/computers` on Linux) or the operator sets the data-kind override `HASNA_DATA_HOME`. The exact-app overrides `HASNA_COMPUTERS_HOME` / `COMPUTERS_HOME` name an explicit data root. On first run without an explicit path, a cwd-relative `./computers.db` is migrated once into the effective data root.

The local CLI uses the same authorization engine as the API under an explicit local administrator context. The HTTP server fails closed without hashed bearer-principal configuration, except when `COMPUTERS_DEV_MODE=loopback` and the listener is bound to a loopback address:

```sh
COMPUTERS_DEV_MODE=loopback computers-serve
```

Production authentication configuration accepts only SHA-256 credential digests and authorization contexts in `COMPUTERS_AUTH`; plaintext credentials are not stored by Computers. Send controller-issued credentials through the HTTP Authorization header, and keep their values out of command history and configuration files.

`COMPUTERS_AUTH` is parsed with strict bounds, known scopes, exact lowercase token hashes, and duplicate detection. Malformed configuration stops controller startup with a generic error. Install-ticket signing material is generated once inside persistent SQLite controller storage, whose file is forced to owner-only mode; in-memory controllers require an explicit signing-key provider and fail closed otherwise. Signing material is never returned by an API or logged.

Agent-created child Computers reference a controller-created grant. A grant binds tenant, parent owner/principal, parent Computer, allowed child owners, providers, regions, profiles, storage/uptime/budget ceilings, immutable generation, expiry, and active reservation limit. Create requests cannot supply or raise the limit or ceilings.

## Surfaces

Package exports are `.`, `./sdk`, `./contracts`, `./providers`, `./local`, and `./storage`. Binaries are `computers`, `computers-serve`, `computers-mcp`, `computers-worker`, and `computers-migrate`. The resident protocol is a library export only; no `computers-resident` bin is shipped until a privileged daemon exists (see `docs/resident.md`).

The REST API is under `/v1`, with public `/health`, `/ready`, `/version`, and `/openapi.json` probes. Mutating routes do not enable wildcard CORS. The SDK uses a credential-provider abstraction, HTTPS except for exact loopback development hosts, bounded credentials/timeouts, and manual redirect handling. MCP speaks JSON-RPC 2.0 with MCP protocol version `2025-03-26` and intentionally omits delete, reassignment, restore, policy mutation, and Sandbox mutation.

## Local controller mode

Set `COMPUTERS_LOCAL_CONFIG` (or worker/CLI `--local-config`) to an absolute owner-only JSON file. The file names controller-owned runtime paths and inventory IDs; API requests never supply executable or home paths. The package validates and probes stock Lima directly. The built-in resident is protocol-only and cannot complete live guest enrollment, so every stock-Lima lifecycle result remains `unverified_vm` with `residentBindingVerified:false`. The local VM configuration accepts no verifier or bootstrap executable. See [the local provider contract](docs/providers.md).

The supported Lima subset is pinned to Lima 2.1.1 and requires explicit VZ/native architecture, exact authoritative instance-YAML validation, no per-Computer global default/override/base YAML, no mounts/static forwards/provisioning/socket_vmnet/containerd/Rosetta/SSH-agent or user public-key loading, `hostResolver=false`, and no proxy propagation. Unknown and unsupported fields fail closed. Those are safety diagnostics, not strict-confinement proof. A future package-owned `strict_guest` manager must own guest identity, mount provenance, resident enrollment, privilege removal, and external network enforcement before any local strict claim exists.

Every `limactl` subprocess receives only a controller-owned `LIMA_HOME` (per-Computer for lifecycle and inspection, provider-root for readiness) and the bounded macOS system `PATH=/usr/bin:/bin:/usr/sbin:/sbin`; this retains Lima's required `ssh`/`ssh-keygen` lookup while excluding common third-party QEMU locations. Mutating Lima and adoption-helper commands use a private pre-spawn supervision journal under the resource lock. Adoption serializes every configuration sharing a state root on one physical-resource lock and binds its versioned claim and manifest to the exact adoption, host, tenant, owner, Computer, profile revision/digests, generation, and random fence before any helper call. Legacy adoption state lacking those fields fails closed and requires operator-controlled retirement/re-adoption. On Darwin, package recovery files use fail-closed Apple `F_FULLFSYNC` before publication; namespace changes retain parent-directory `fsync` after rename, link, unlink, and directory creation because Apple does not document an equivalent general `F_FULLFSYNC` guarantee for directory descriptors. Reclaimed local operations never repeat create, start, or restore: adopted and Lima restrictive operations observe first, perform only the needed fenced/idempotent stop, quarantine, delete, or exact-claim release, and post-observe before success. A synchronous spawn rejection identity-checks and removes its still-prepared journal; a crash during the ambiguous prepare/publish boundary remains fail-closed. Live orphan process groups keep the outcome unknown, and a fully published dead process can be cleared only into reconciliation. Cancellation while the worker is alive is bounded and process-group-based, but parent crashes are fenced rather than claimed immediately cancelled. Nonzero mutator exits do not release quota or establish a lifecycle result without authoritative post-observation. The exact durability boundary, directory limitation, and ambiguous-journal recovery procedure are in [the provider contract](docs/providers.md).

The later operator-run live harness is:

```sh
bun run canary:local-mac -- --local-config /absolute/private/local-controller.json --db /absolute/canary.db --confirm LIVE_LOCAL_VM_CANARY
```

Run `computers local config validate|probe --local-config ...` first. The live command proves only the fail-closed `unverified_vm` lifecycle: durable audited create reaches stopped, start remains unverified without resident binding, durable audited stop and delete succeed, the provider binding is released, the instance is absent, and the raw disk is confirmed retained. It never promotes assurance. Do not run it on this Linux development worker.

## Deliberately unavailable

- No AWS provisioner, snapshot implementation, built-in privileged resident daemon, certificate authority, or mTLS transport is included.
- The adoption observer/controller is deployment-owned and fails closed when absent. The stock-Lima path has no external assurance helper. Computers does not install Lima or mutate host policy.
- Sandboxes integration is disabled with deterministic `sandbox_disabled`; there is no executable Sandbox mutation.
- Install policy covers brokered privileged/system mutation. It does not claim to control every unprivileged file or program an agent can download or compile.
- PostgreSQL is an explicit schema/RLS port target, but this package does not include a PostgreSQL driver or runtime adapter and does not claim runtime parity.
- The local audit hash chain is not independently anchored unless an operator supplies a durable external checkpoint/WORM sink.

See [the threat model](docs/threat-model.md), [provider contract](docs/providers.md), [PostgreSQL contract](docs/postgresql.md), [resident protocol](docs/resident.md), and [security policy](SECURITY.md).

## Development

```sh
bun install
bun run typecheck
bun test
bun run lint
bun run check:schemas
bun run check:surfaces
bun run build
bun pm pack --dry-run
```

Runtime dependencies: none. Development dependencies are pinned `typescript` and `@types/bun`; Bun supplies SQLite, HTTP, Web Crypto, process, and stdio support.

## License

Apache-2.0.
