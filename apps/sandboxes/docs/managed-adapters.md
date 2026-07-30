# Managed adapters

The package root, `@hasna/sandboxes/adapters`, and
`@hasna/sandboxes/managed` expose the same managed-adapter build. This is a
different contract from the provider-neutral CLI/MCP runtime: it implements
fail-closed provider effects, one-use authorization, broker framing, durable
outcomes, reconciliation, and disposable-task execution for trusted
orchestrators.

## Production status

Native disposable-task production dispatch is intentionally disabled in this
release:

- `DISPOSABLE_SANDBOX_TASK_PRODUCTION_ADMISSION_V1 === false`
- `DISPOSABLE_SANDBOX_TASK_PRODUCTION_ADMISSION_V2 === false`
- `DAYTONA_DISPOSABLE_TASK_PRODUCTION_ADMISSION_V1 === false`
- `E2B_GUEST_BROKER_PRODUCTION_ADMISSION_V1 === false`

The public contracts, cryptographic helpers, preparation/authorization flow,
durable stores, provider bridges, and candidate runner constructors are
available for integration and conformance work. Public production dispatch
fails closed until a future release deliberately changes the admission gates.
Do not describe the current candidate runners as production-admitted.

## Provider adapters

`createE2bAdapter(dependencies)` and
`createDaytonaCloudAdapter(dependencies)` return a
`ManagedProviderAdapterV1`. The dependency object is fully caller supplied and
includes:

- A credential port and provider identity/scope configuration.
- Admission and read-retry policy.
- Effect guard and lifecycle lock ports.
- Journal and outcome-anchor verification ports.
- Admission, physical-safety, network-policy, and guest-broker verifiers.

The adapter exposes descriptor, inert creation, activation, inspection, exec,
file, expiry, quarantine, destroy, operation lookup, and owned-resource listing
operations. Every effect-bearing call is bound to canonical operation,
resource, authorization, and journal data. Workspace paths must pass
`validateWorkspacePath` and remain under `/workspace`.

The package exports official SDK control and broker bridges for the exactly
pinned versions:

- `e2b@2.31.0`
- `@daytona/sdk@0.193.0`

`OFFICIAL_SDK_CONTRACT_GAPS` records provider gaps and the compensations applied
by the adapters. Mapping ports bind content-addressed E2B templates and Daytona
images to the requested image/snapshot digest.

## Trust boundary

Official SDK modules, same-realm broker handles, and package callbacks are
control-plane trusted computing base. Production ports must return genuine
same-realm intrinsic `Promise` values with unmodified `constructor` and `then`
lookup behavior. The bridge fails closed with `integrity_failed` when that
contract is violated and can be checked safely.

Sandbox bytes and provider DTOs remain hostile input. The implementation
authenticates, bounds, validates, snapshots, and copies those values before
use. Credentials belong behind `ManagedProviderCredentialPortV1`; the managed
request and receipt contracts do not carry credentials.

## Disposable task V2 flow

The V2 API separates provider-free preparation from provider contact:

1. `prepareDisposableSandboxTaskIntentV2` validates and canonically stores an
   idempotent intent in `DisposableTaskJournalPortV2`, then binds its witness
   anchor.
2. `authorizePreparedDisposableSandboxTaskV2` asks the caller-owned
   `DisposableSandboxTaskAuthorityPortV2` to consume that exact intent once and
   binds the opaque authority envelope and signed consumption receipt by
   digest.
3. `createDisposableSandboxTaskExecutionContextV2` materializes an execution
   context under the journal lease and effect claim.
4. `dispatchPreparedDisposableSandboxTaskV2` delegates to a
   provider-specific runner only after all bindings and the production gate
   pass. In this release the production gate prevents this final dispatch.

The authority port—not Sandboxes—validates the upstream authority signature,
tenant, principal, and run semantics. Sandboxes does not decode those opaque
authority bytes.

The earlier `runDisposableSandboxTask` V1 surface remains exported but is also
production-gated off. New integrations should target the explicitly split V2
preparation and authorization contracts.

## Checkpoint handoff

`createEncryptedLocalCheckpointHandoffPortV1` provides an encrypted local
checkpoint handoff implementation. It requires a root directory, encryption
key, receipt signer, and matching verifier. The optional durability probe
receives only phase names and exists for crash-consistency certification.

Checkpoint handoff is not a substitute for the durable task journal or its
independent witness. Each component binds a separate part of the execution and
recovery contract.

## Errors and canonical data

Contract failures use `AdapterContractError` and stable `AdapterErrorCodeV1`
codes. `DefinitiveProviderEffectError` represents a provider effect whose
failure outcome is definitive. Use exported canonical JSON/digest and request
binding helpers rather than recreating serialization rules in callers.

The exported TypeScript declarations are the authoritative field-level API
reference for request, receipt, port, and observation shapes.
