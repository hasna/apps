# Cooperative worker supervisor: next implementation

`daemon restart` is not complete until a real worker owner stops its old loop, drains in-flight work and starts a new generation. The runtime log endpoint is useful evidence but is not a supervisor, heartbeat or restart receipt. This document specifies the next implementation; none of these controls is currently shipped.

Prefer a foreground `emails daemon start` supervisor process that uses ordinary authenticated API worker operations. It may run on the operator's machine or a separately provisioned worker host. It does not restart the API service or mutate ECS. Starting a new worker is explicit; restarting only addresses an existing registered worker.

## Durable records and ownership

Add tenant-scoped worker registrations, ownership leases and restart requests in PostgreSQL. A worker registration has an opaque UUID, fixed supported component, validated configuration references (source/provider IDs, never secrets), generation, owner lease, heartbeat deadline, desired state and observed state. The owner token is a credential and must not be exposed in status/logs. The server stores a hash; operations authenticate the current owner independently of human operator permissions.

Registration and lifecycle writes require tenant operator authority. A data-only writer cannot register a privileged worker or supply an execution identity. The supervisor calls existing API operations using the operator credentials already resolved for that process; it cannot execute arbitrary commands or request cross-tenant sources. Each restart request has a caller-provided reusable UUID and immutable worker target/configuration hash. Replays return the same durable request state.

## Restart transition

1. An operator requests restart for an existing worker UUID. The server commits `requested` and the expected old generation atomically; concurrent requests coalesce or conflict explicitly.
2. The owner polls control with its lease token. It observes `draining`, stops accepting new work, and waits for current API operations to return durable receipts. Abort alone is not proof that an API operation stopped: some server work can continue after transport cancellation.
3. The old owner acknowledges the drained generation only after every tracked in-flight request is settled or reconciled through its durable job identity. Unknown send outcomes leave the restart pending; never clear existing job leases to manufacture progress.
4. The supervisor terminates the old loop and atomically acquires a new generation/lease using a compare-and-swap transition. It initializes the replacement loop and reports a fresh heartbeat. Only then may the durable restart receipt become `complete`, including old and new generations.
5. Lost ownership or expired heartbeats stop new work immediately. An expired lease is `unreachable`, not `stopped` or `restarted`. A new owner must fence or reconcile old in-flight execution before takeover. Worker requests should carry a generation token which the API verifies before each new batch claim. Existing per-job leases and send idempotency remain in force.

Graceful process shutdown follows the same draining protocol. SIGINT/SIGTERM stops scheduling new operations, reconciles in-flight work, marks the owner stopped if confirmed, and releases the ownership lease. A forced termination leaves an expired/unknown owner and pending receipt for later reconciliation.

## CLI and evidence

`daemon status` reports real observed generation, lease freshness, desired/observed state and pending restart IDs. `daemon restart --worker <id> --idempotency-key <uuid>` polls a bounded deadline and exits successfully only for a completed receipt. Pending, expired or uncertain requests retain their request ID and exit unsuccessfully. An omitted worker selector is allowed only when exactly one tenant worker is eligible; it must never choose arbitrarily.

Log fixed lifecycle events through the append-only runtime sink: registration, drain requested, generation stopped, generation started and lease lost. Add their operation/event enums in a separately reviewed migration. Log neither owner tokens nor credential material.

Tests must cover concurrent owners, stale generation tokens, repeated restart IDs, SIGINT/drain, transport cancellation with continuing server work, lost heartbeat, startup failure, ambiguous targets, and inability of read/write principals to acquire operator execution authority. Integration uses synthetic jobs and disposable PostgreSQL; it must not launch production workers or send email.

The provisioning orchestration follow-up exposes `POST /v1/provision/tick`, which performs one durable step. Integrate that operation as a bounded worker iteration alongside scheduler and inbox watch. The supervisor owns those loops; it must not create a competing provisioning executor.
