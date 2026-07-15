# Computers

`@hasna/computers` is a Bun-first controller for durable lifetime Computers assigned to AI employees. A Computer keeps a stable identity, owner, policy generation, durable-home lease, operation history, and audit chain across stop/start or future substrate replacement. It is not an ephemeral job runner.

This first core slice runs locally without AWS, a hypervisor, or a privileged daemon. It includes the domain model, a SQLite controller, PostgreSQL schema and RLS migration, one authorization engine, authenticated REST API, TypeScript SDK, CLI, safe MCP server, resident protocol validation, install-policy evaluation, and deterministic tests. Provider ports are present but deliberately unconfigured.

## Assurance is explicit

- `local_machine` is lower-assurance `dedicated_machine` confinement. The entire physical host must belong to exactly one Computer. It never claims strict VM isolation.
- `local_vm` and `aws_ec2` start as `unverified_vm`. They may become `strict_vm` only after provider-specific isolation, escape, resource, metadata/credential, and external-egress controls pass.
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

The local CLI uses the same authorization engine as the API under an explicit local administrator context. The HTTP server fails closed without hashed bearer-principal configuration, except when `COMPUTERS_DEV_MODE=loopback` and the listener is bound to a loopback address:

```sh
COMPUTERS_DEV_MODE=loopback computers-serve
```

Production authentication configuration accepts only SHA-256 credential digests and authorization contexts in `COMPUTERS_AUTH`; plaintext credentials are not stored by Computers. Send controller-issued credentials through the HTTP Authorization header, and keep their values out of command history and configuration files.

`COMPUTERS_AUTH` is parsed with strict bounds, known scopes, exact lowercase token hashes, and duplicate detection. Malformed configuration stops controller startup with a generic error. Install-ticket signing material is generated once inside persistent SQLite controller storage, whose file is forced to owner-only mode; in-memory controllers require an explicit signing-key provider and fail closed otherwise. Signing material is never returned by an API or logged.

Agent-created child Computers reference a controller-created grant. A grant binds tenant, parent owner/principal, parent Computer, allowed child owners, providers, regions, profiles, storage/uptime/budget ceilings, immutable generation, expiry, and active reservation limit. Create requests cannot supply or raise the limit or ceilings.

## Surfaces

Package exports are `.`, `./sdk`, `./contracts`, `./providers`, and `./storage`. Binaries are `computers`, `computers-serve`, `computers-mcp`, `computers-worker`, `computers-resident`, and `computers-migrate`.

The REST API is under `/v1`, with public `/health`, `/ready`, `/version`, and `/openapi.json` probes. Mutating routes do not enable wildcard CORS. The SDK uses a credential-provider abstraction, HTTPS except for exact loopback development hosts, bounded credentials/timeouts, and manual redirect handling. MCP speaks JSON-RPC 2.0 with MCP protocol version `2025-03-26` and intentionally omits delete, reassignment, restore, policy mutation, and Sandbox mutation.

## Deliberately unavailable

- No local-machine adopter, VM manager, AWS provisioner, snapshot implementation, privileged resident daemon, certificate authority, or mTLS transport is included.
- Provider work is stored as durable operations and workers report `provider_not_configured` instead of pretending execution succeeded.
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
