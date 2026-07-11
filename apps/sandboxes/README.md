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
use separate signed `READ_PROBE` anchors plus an independently verified signed
read-only/no-effect receipt. TTL and ambiguous-provider signals
produce a typed physical safety-fence observation without autonomously changing
canonical state or generation; only a later signed Infinity transition may
canonicalize quarantine. Destruction still requires an exact one-use Infinity
cleanup grant.

Signed journal envelopes are closed and read back in full before use. Their
record digest, contiguous frontier, trusted signer/key, Ed25519 signature, and
stored-frontier membership are verified by the injected Infinity verifier.
Crash recovery additionally requires the verifier to bind the range to the
current linearizable journal head; the journal then atomically performs
non-inclusion-plus-append and distinguishes `inserted` from
`already_present`. A replayed or already-present dispatch never authorizes a
new provider mutation. An adapter exception can produce `failed_no_effect`
only when it carries a closed request/target/token/epoch-bound provider
non-acceptance proof accepted by the trusted verifier. Otherwise the operation
remains unresolved and reconciliation-only.
`failed_no_effect` retry authorization is never inferred from a local digest
row. Creation and per-effect provider tokens are separate deterministic
bindings over the actual allocation/spec/request bytes; returned handles and
live provider inspection/enumeration must match the exact installation, scope,
ownership nonce, opaque ID, token, fingerprint, and spec digest.
Core code recomputes the descriptor digest over every closed identity and
behavior fact and persists those exact bytes. Sealed handles use
domain-separated authenticated encryption bound to adapter, installation,
scope, resource, lease, generation, creation token, fingerprint, provider
identity, and spec. Canonical lifecycle transitions share the same stable gate
as provider mutation, so they cannot commit between the final barrier and the
provider call.

Bounded exec, file, stream, and checkpoint calls use a full signed capability:
sender proof, exact target and constraints, one-use mode/max-use bound, and a
signed authorization-consumption receipt set with the operation step, fence,
consumer, transaction, commit sequence, and ordinal. The receipt set and exact
request are committed before provider reachability. A durable bounded-operation
journal stores the exact parsed result, so restart replay returns the prior
result and a crash after an accepted provider effect uses the adapter's exact
reconciliation read instead of issuing the mutation again. Runner results are
closed documents: core recomputes receipt, byte, frame, cursor/resume, no-gap,
stream-root, file-revision, and checkpoint roots before committing them. Exec
start persists the initial cursor, opaque resume token, stream root, and next
sequence; every page reserves and advances that state atomically with its
durable outcome, so restart, replay, fork, reset, and alternate-chain attempts
fail before runner reachability. The final online authorization check follows
all awaited phase/state transactions with no await before runner invocation.

Checkpoint capture additionally requires a signed capture grant, signed and
authority-verified quiescence
receipt, final authorization barrier, content-addressed manifest/blob, and a
signed durable sink-commit receipt. Core recomputes the canonical manifest,
workspace root, bundle facts, and checkpoint root; the sink receipt binds all
of those facts together with the grant, final authorization, and quiescence.
Ambiguity after upload remains
reconciliation-only until that exact sink receipt is recovered. The exact
consumer boundary for the Infinity/checkpoint-broker owner is exported as
`schemas/provider-boundary-v1.schema.json`.

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
local task-compute adapter. Exec, file-channel, and checkpoint-export reference
surfaces are implemented and adversarially exercised against the hermetic fake;
managed provider implementations remain unreachable pending live admission.

## Checkpoint status: NO-GO outside the lifecycle slice

This branch is a preservation checkpoint, not a V1 release candidate. The
following gates are intentionally unresolved and remain **NO-GO**:

- E2B and Daytona Cloud contain no production provider implementation or live
  admission evidence.
- Restore and live checkpoint-broker integration are not implemented; the
  producer-side quiescent export and exact broker boundary are present.
- The internal object-store prototype is not exported and is not accepted as a
  checkpoint durability or cleanup-authority basis. Its create-only ambiguity
  recovery, exact-version streamed full readback, bounded I/O, local no-follow
  file-descriptor discipline, concurrency law, and scope/KMS/fence bindings
  still require the follow-on files/checkpoint implementation and review.
- The successor exec/files/checkpoint wire contracts and shared durable
  non-lifecycle effect coordinator still require exact-SHA adversarial
  acceptance and live-provider reproduction before integration.

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
