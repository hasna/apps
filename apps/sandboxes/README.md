# `@hasna/sandboxes`

Clean V1 sandbox runtime primitives for local and self-hosted Hasna systems.
The package enforces Infinity-issued effect fences and exact Infinity-owned
pre/post lifecycle generations, requires a signed external `DISPATCHED` journal
anchor immediately before every provider call, separates inert creation from
activation, quarantines ambiguous resources, and permits destruction only with
an exact one-use Infinity cleanup grant.

This first slice includes the reference domain model, in-memory and SQLite
repositories, deterministic fake runner, closed validators, and a fail-closed
CLI. E2B and Daytona Cloud adapters are explicit pending stubs: neither is
admitted for live use yet. There is no local task-compute adapter.

```sh
bun install
bun test
bun run typecheck
bun run build
bun run src/cli.ts doctor --output json
```

The CLI accepts structured operation input only from stdin (`--input -`). It
does not accept secrets, provider IDs, host content paths, provider selection,
or raw capability material. Lifecycle commands require an Infinity integration
and fail closed in the standalone CLI; the SDK reference service is exercised
with explicitly injected hermetic fakes.

Deployment modes are exactly `local` and `self_hosted`. This repository does
not contain tenants, signup, billing, a provider marketplace, or a hosted SaaS
surface.
