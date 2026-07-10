# `@hasna/sandboxes`

Clean V1 sandbox runtime primitives for local and self-hosted Hasna systems.
The package enforces Infinity-issued effect fences and exact adjacent
Infinity-owned expected/successor lifecycle generations. It CASes and reseals
the successor before dispatch, atomically CASes the durable operation phase to
`dispatched`, appends a signed external `DISPATCHED` frontier, and only then
makes the provider call under one stable installation/scope/resource lifecycle
lock. The final barrier rechecks database time, cancellation,
the exact current resource revision/state/fence, durable capability and grant
consumption, and the physical safety gate. Mutation journal identity is
`(operation_id, operation_step_id, operation_execution_epoch, record_kind)`;
records are exactly `DISPATCHED` or one closed `OUTCOME`. A new execution epoch
is allowed only after an authoritative `failed_no_effect` outcome and must keep
the semantic step, provider target, token, request, and lifecycle generation
unchanged. Provider outcomes stay non-canonical until a separate
Infinity `record_*` command commits the next exact generation. Provider reads
use separate signed `READ_PROBE` anchors. TTL and ambiguous-provider signals
produce a typed physical safety-fence observation without autonomously changing
canonical state or generation; only a later signed Infinity transition may
canonicalize quarantine. Destruction still requires an exact one-use Infinity
cleanup grant.

Signed journal envelopes are closed and read back in full before use. Their
record digest, contiguous frontier, trusted signer/key, Ed25519 signature, and
stored-frontier membership are verified by the injected Infinity verifier.
`failed_no_effect` retry authorization is never inferred from a local digest
row. Creation and per-effect provider tokens are separate deterministic
bindings over the actual allocation/spec/request bytes; returned handles and
live provider inspection/enumeration must match the exact installation, scope,
ownership nonce, opaque ID, token, fingerprint, and spec digest.

The external outcomes are schema-bound to
`infinity.effect-journal-outcome/v1` at digest
`sha256:7ab380a0475ebf79d2ed925e20bcbb9303d78a56c358d09adbdce796e740bf20`.
There is no external `unknown` or `quarantined` alias: a dispatch without an
outcome remains unresolved, and authenticated `reconciliation_blocked` is
mapped by Infinity to its internal quarantined state.

This lifecycle/persistence slice includes the reference domain model, in-memory,
SQLite, and TLS Postgres repositories, encrypted local and narrow versioned
self-hosted object stores, immutable safety/checkpoint/promotion/tombstone
evidence, closed validators/schemas, and a fail-closed CLI. E2B and Daytona
Cloud adapters are explicit pending stubs: neither is admitted for live use
until a signed zero-skip conformance manifest is authenticated. There is no
local task-compute adapter. Exec, file-channel, and checkpoint-export execution
surfaces are not implemented in this slice and therefore cannot be invoked.

## Checkpoint status: NO-GO outside the lifecycle slice

This branch is a preservation checkpoint, not a V1 release candidate. The
following gates are intentionally unresolved and remain **NO-GO**:

- E2B and Daytona Cloud contain no production provider implementation or live
  admission evidence.
- Exec, bounded files, quiescent export, restore, and checkpoint-broker handoff
  are not implemented.
- The internal object-store prototype is not exported and is not accepted as a
  checkpoint durability or cleanup-authority basis. Its create-only ambiguity
  recovery, exact-version streamed full readback, bounded I/O, local no-follow
  file-descriptor discipline, concurrency law, and scope/KMS/fence bindings
  still require the follow-on files/checkpoint implementation and review.
- The successor exec/files/checkpoint wire contracts and their shared
  non-lifecycle resource-effect coordinator still require exact-SHA adversarial
  acceptance before integration.

Do not merge this checkpoint to `main`, publish it, deploy it, enable live
providers, or use it to authorize cleanup.

```sh
bun install
bun test
bun run test:hermetic
bun run typecheck
bun run build
./scripts/postgres-integration.sh
bun run src/cli.ts doctor --output json
```

The CLI accepts structured operation input only from stdin (`--input -`). It
does not accept secrets, provider IDs, host content paths, provider selection,
raw capability material, or a caller-selected database path. Lifecycle and
record reads require an Infinity integration and fail closed in the standalone
CLI; only health/migration diagnostics open the fixed local state root. The SDK
reference service is exercised with explicitly injected hermetic fakes.
The hermetic suite runs inside a read-only bubblewrap filesystem with a cleared
environment and an isolated network namespace; fetch, sockets, DNS, and
subprocess APIs are denied by a preload guard.

Deployment modes are exactly `local` and `self_hosted`. This repository does
not contain tenants, signup, billing, a provider marketplace, or a hosted SaaS
surface.
