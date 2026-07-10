import { describe, expect, test } from "bun:test"
import { createRequire } from "node:module"
import { ManagedProviderAdapter } from "../../src/adapters/managed/adapter"
import {
  AdapterContractError,
  MANAGED_GUEST_BROKER_BOOTSTRAP_COMMAND,
  activationAuthorizationBinding,
  canonicalSha256,
  cleanupAuthorizationBinding,
  createDaytonaCloudAdapter,
  createE2bAdapter,
  decodeGuestBrokerRequestFrame,
  managedProviderRequestSha256,
  providerCreationTokenSha256,
  providerEffectTokenSha256,
  providerTargetFingerprintSha256,
  reconciliationAuthorizationBinding,
  validateWorkspacePath,
  type AdapterCallContextV1,
  type ActivationDispatchAuthorizationV1,
  type DestroyContextV1,
  type ManagedProviderAdapterV1,
  type ManagedProviderIdV1,
  type OwnedProviderHandleV1,
  type ReconcileContextV1,
} from "../../src/adapters/managed/index"
import {
  BROKER_ONLY_POLICY,
  FakeCredentialPort,
  FakeAdmissionVerifier,
  FakeEffectGuard,
  FakeJournal,
  FakeJournalAnchorVerifier,
  FakeOutcomeAnchorVerifier,
  FakePhysicalSafetyGate,
  FakeNetworkPolicyVerifier,
  FakeGuestBrokerAuthenticator,
  FakeLifecycleLock,
  FakeProviderClient,
  READ_RETRY_POLICY,
  bindAuthorization,
  digest,
  makeContext,
  makeOperation as makeRawOperation,
} from "./fakes"

const SPEC = {
  schema_version: "sandboxes.runtime/v1" as const,
  run_id: "run-1",
  attempt_id: "attempt-1",
  source: {
    repository_ref: "repo-1",
    commit_sha: "0123456789abcdef0123456789abcdef01234567",
    source_bundle_sha256: digest("71"),
  },
  environment: {
    image_or_snapshot_sha256: digest("72"),
    toolchain_manifest_sha256: digest("73"),
  },
  runtime_class: "strong_vm" as const,
  architecture: "amd64" as const,
  workspace_root: "/workspace" as const,
  network_policy: BROKER_ONLY_POLICY,
  resources: {
    cpu_millis: 2_000,
    memory_bytes: 4_294_967_296,
    disk_bytes: 21_474_836_480,
    pids: 128,
    open_files: 1_024,
    output_bytes: 1_048_576,
  },
  exec_concurrency: 1,
  max_runtime_ms: 60_000,
  expires_at: "2026-07-10T11:00:00.000Z",
  data_class: "internal_non_sensitive" as const,
  input_bundle_refs: [{ sha256: digest("74"), size_bytes: 128 }],
}

const EXEC_SPEC = {
  schema_version: "sandboxes.exec-spec/v1" as const,
  executable: "/usr/bin/git",
  argv: ["status", "--porcelain=v1", "literal;not-shell"],
  cwd: validateWorkspacePath("repo"),
  workspace_access: "write" as const,
  environment_profile_id: "test-v1" as const,
  environment_profile_sha256: digest("73"),
  wall_deadline: "2026-07-10T10:10:00.000Z",
  idle_timeout_ms: 30_000,
  output_limit_bytes: 32,
  process_limit: 8,
  tty: false as const,
}

type TestOperation = ReturnType<typeof makeRawOperation>

function makeProviderOperation(
  provider: ManagedProviderIdV1,
  ...args: Parameters<typeof makeRawOperation>
): TestOperation {
  const op = makeRawOperation(...args)
  op.target.provider_creation_token_sha256 = providerCreationTokenSha256({
    resource_id: op.target.resource_id,
    resource_lease_id: op.fence.resource_lease_id,
    allocation_key_sha256: digest("77"),
    spec_sha256: canonicalSha256(SPEC),
  })
  op.target.immutable_fingerprint_sha256 = providerTargetFingerprintSha256({
    adapter_id: provider,
    adapter_version: "test-build",
    installation_id: "installation-1",
    provider_scope_ref: "provider-scope-1",
    resource_id: op.target.resource_id,
    resource_lease_id: op.fence.resource_lease_id,
    provider_creation_token_sha256: op.target.provider_creation_token_sha256,
    spec_sha256: canonicalSha256(SPEC),
  })
  op.target.provider_idempotency_token_sha256 = providerEffectTokenSha256(op)
  const request = (() => {
    switch (op.operation) {
      case "create_inert":
        return { operation: "create_inert" as const, spec: SPEC, allocation_key_sha256: digest("77") }
      case "activate":
        return { operation: "activate" as const, authorization: activationAuthorization(op) }
      case "inspect":
        return { operation: "inspect" as const }
      case "exec_start":
        return { operation: "exec_start" as const, spec: EXEC_SPEC }
      case "exec_cancel":
        return { operation: "exec_cancel" as const, exec_fingerprint_sha256: digest("51") }
      case "file_stat":
        return { operation: "file_stat" as const, path: validateWorkspacePath("repo/file.txt") }
      case "file_read":
        return {
          operation: "file_read" as const,
          request: { path: validateWorkspacePath("repo/file.txt"), offset: 0, length: 10 },
        }
      case "file_write":
        return {
          operation: "file_write" as const,
          request: {
            path: validateWorkspacePath("repo/file.txt"),
            bytes: new TextEncoder().encode("safe bytes"),
            if_absent: true,
          },
        }
      case "file_list":
        return {
          operation: "file_list" as const,
          request: { path: validateWorkspacePath("repo"), limit: 100 },
        }
      case "expire":
        return { operation: "expire" as const }
      case "quarantine":
        return { operation: "quarantine" as const }
      case "destroy":
        return {
          operation: "destroy" as const,
          cleanup_grant_sha256: digest("91"),
          cleanup_basis_sha256: digest("92"),
        }
    }
  })()
  op.request_sha256 = managedProviderRequestSha256(request)
  return op
}

function makeReconcileContext(
  op: TestOperation,
  journal: FakeJournal,
): ReconcileContextV1 {
  const continuationGrantSha256 = digest("a4")
  const authorizationConsumptionReceiptSha256 = digest("a5")
  const initial = makeContext(op, journal)
  const binding = reconciliationAuthorizationBinding(
    initial.target,
    initial.fence,
    continuationGrantSha256,
    authorizationConsumptionReceiptSha256,
  )
  const bound = bindAuthorization(initial, op, binding)
  return {
    ...bound,
    continuation_grant_sha256: continuationGrantSha256,
    authorization_consumption_receipt_sha256: authorizationConsumptionReceiptSha256,
    ...(op.generation_transition === undefined
      ? {}
      : { generation_transition: op.generation_transition }),
  }
}

type Harness = {
  adapter: ManagedProviderAdapterV1
  client: FakeProviderClient
  credentials: FakeCredentialPort
  journal: FakeJournal
  effectGuard: FakeEffectGuard
  lifecycleLock: FakeLifecycleLock
  anchorVerifier: FakeJournalAnchorVerifier
  outcomeAnchorVerifier: FakeOutcomeAnchorVerifier
  admissionVerifier: FakeAdmissionVerifier
  physicalSafetyGate: FakePhysicalSafetyGate
  networkPolicyVerifier: FakeNetworkPolicyVerifier
  guestBrokerAuthenticator: FakeGuestBrokerAuthenticator
}

function harness(
  provider: ManagedProviderIdV1,
  hermeticConformanceOnly = true,
  evidenceKind: "hermetic_conformance" | "live_conformance" = "hermetic_conformance",
): Harness {
  const client = new FakeProviderClient(provider)
  const credentials = new FakeCredentialPort(client)
  const journal = new FakeJournal()
  const effectGuard = new FakeEffectGuard()
  const lifecycleLock = new FakeLifecycleLock()
  const anchorVerifier = new FakeJournalAnchorVerifier()
  const outcomeAnchorVerifier = new FakeOutcomeAnchorVerifier()
  const admissionVerifier = new FakeAdmissionVerifier()
  const physicalSafetyGate = new FakePhysicalSafetyGate()
  const networkPolicyVerifier = new FakeNetworkPolicyVerifier()
  const guestBrokerAuthenticator = new FakeGuestBrokerAuthenticator()
  const deps = {
    credential_port: credentials,
    installation_id: "installation-1",
    provider_scope_ref: "provider-scope-1",
    adapter_version: "test-build",
    adapter_build_sha256: digest("75"),
    admission: {
      admitted: true,
      evidence_sha256: digest("76"),
      exact_sdk_version: provider === "e2b" ? "2.31.0" : "0.193.0",
      evidence_kind: evidenceKind,
    },
    read_retry_policy: READ_RETRY_POLICY,
    effect_guard: effectGuard,
    lifecycle_lock: lifecycleLock,
    journal_anchor_verifier: anchorVerifier,
    outcome_journal: journal,
    outcome_anchor_verifier: outcomeAnchorVerifier,
    admission_verifier: admissionVerifier,
    physical_safety_gate: physicalSafetyGate,
    network_policy_verifier: networkPolicyVerifier,
    guest_broker_authenticator: guestBrokerAuthenticator,
  } as const
  const adapter = hermeticConformanceOnly
    ? new ManagedProviderAdapter(
        {
          provider,
          sdkPackage: provider === "e2b" ? "e2b" : "@daytona/sdk",
          sdkVersion: provider === "e2b" ? "2.31.0" : "0.193.0",
        },
        deps,
        true,
      )
    : provider === "e2b"
      ? createE2bAdapter(deps)
      : createDaytonaCloudAdapter(deps)
  return {
    adapter,
    client,
    credentials,
    journal,
    effectGuard,
    lifecycleLock,
    anchorVerifier,
    outcomeAnchorVerifier,
    admissionVerifier,
    physicalSafetyGate,
    networkPolicyVerifier,
    guestBrokerAuthenticator,
  }
}

async function create(h: Harness): Promise<OwnedProviderHandleV1> {
  const op = makeProviderOperation(h.client.provider_id, "create_inert")
  return h.adapter.create_inert(makeContext(op, h.journal), SPEC, op, digest("77"))
}

async function activate(h: Harness, handle: OwnedProviderHandleV1): Promise<void> {
  const op = makeProviderOperation(h.client.provider_id, "activate")
  const authorization = activationAuthorization(op)
  await h.adapter.activate(
    bindAuthorization(
      makeContext(op, h.journal),
      op,
      activationAuthorizationBinding(op.target, authorization),
    ),
    handle,
    authorization,
    op,
  )
}

function activationAuthorization(op: TestOperation): ActivationDispatchAuthorizationV1 {
  return {
    activation_grant_sha256: digest("81"),
    authorization_consumption_receipt_sha256: op.target.authorization_consumption_receipt_sha256,
    network_policy: BROKER_ONLY_POLICY,
  }
}

function activationContext(
  h: Harness,
  op: TestOperation,
  authorization: ActivationDispatchAuthorizationV1,
): AdapterCallContextV1 {
  return bindAuthorization(
    makeContext(op, h.journal),
    op,
    activationAuthorizationBinding(op.target, authorization),
  )
}

function destroyContext(h: Harness, op: TestOperation): DestroyContextV1 {
  const cleanupGrant = digest("91")
  const cleanupBasis = digest("92")
  return {
    ...bindAuthorization(
      makeContext(op, h.journal),
      op,
      cleanupAuthorizationBinding(op.target, cleanupGrant, cleanupBasis),
    ),
    cleanup_grant_sha256: cleanupGrant,
    cleanup_basis_sha256: cleanupBasis,
  }
}

for (const provider of ["e2b", "daytona_cloud"] as const) {
  describe(`${provider} managed adapter conformance`, () => {
    const makeOperation = (...args: Parameters<typeof makeRawOperation>): TestOperation =>
      makeProviderOperation(provider, ...args)

    test("adopts one exact creation token without dispatching a duplicate create", async () => {
      const h = harness(provider)
      const op = makeOperation("create_inert")
      h.client.seed(h.client.makeResource(op.target))

      const handle = await h.adapter.create_inert(makeContext(op, h.journal), SPEC, op, digest("77"))

      expect(h.client.createCalls).toBe(0)
      expect(handle.provider_creation_token_sha256).toBe(op.target.provider_creation_token_sha256)
      expect(handle.immutable_fingerprint_sha256).toBe(op.target.immutable_fingerprint_sha256)
      expect(h.journal.outcomes).toHaveLength(1)
    })

    test("makes at most one create call and exact-adopts after ambiguous response loss", async () => {
      const h = harness(provider)
      h.client.createThenThrow = true
      const op = makeOperation("create_inert")

      const handle = await h.adapter.create_inert(makeContext(op, h.journal), SPEC, op, digest("77"))

      expect(handle.opaque_resource_id).toContain("native-1")
      expect(h.client.createCalls).toBe(1)
      expect(h.client.lookupCalls).toBeLessThanOrEqual(READ_RETRY_POLICY.max_attempts + 1)
    })

    test("serializes concurrent exact-token create attempts under one lifecycle lock", async () => {
      const h = harness(provider)
      const first = makeOperation("create_inert")
      const second = makeOperation("create_inert")

      const [left, right] = await Promise.all([
        h.adapter.create_inert(makeContext(first, h.journal), SPEC, first, digest("77")),
        h.adapter.create_inert(makeContext(second, h.journal), SPEC, second, digest("77")),
      ])

      expect(h.client.createCalls).toBe(1)
      expect(left.opaque_resource_id).toBe(right.opaque_resource_id)
      expect(new Set(h.lifecycleLock.keys).size).toBe(1)
    })

    test("keeps a stopped, deny-all, source-free resource Infinity-inert", async () => {
      const h = harness(provider)
      const handle = await create(h)
      const resource = h.client.resources.get(handle.opaque_resource_id)

      expect(resource).toMatchObject({
        state: "inert",
        provider_runtime_state: "stopped",
        source_attached: false,
        credential_attached: false,
        guest_broker_bootstrapped: false,
      })
      expect(h.client.activateCalls).toBe(0)
      expect(h.client.providerCommandStrings).toEqual([])
    })

    test("quarantines an adopted resource that has source or credentials attached", async () => {
      const h = harness(provider)
      const op = makeOperation("create_inert")
      const resource = h.client.makeResource(op.target)
      resource.source_attached = true
      h.client.seed(resource)

      await expect(h.adapter.create_inert(makeContext(op, h.journal), SPEC, op, digest("77"))).rejects.toMatchObject({
        code: "provider_state_unknown",
        quarantine_required: true,
      })
      expect(h.client.createCalls).toBe(0)
    })

    test("rejects exact-token resources owned by another installation or nonce", async () => {
      const h = harness(provider)
      const op = makeOperation("create_inert")
      const resource = h.client.makeResource(op.target)
      resource.ownership = { ...resource.ownership, installation_id_sha256: digest("aa") }
      h.client.seed(resource)

      await expect(h.adapter.create_inert(makeContext(op, h.journal), SPEC, op, digest("77"))).rejects.toMatchObject({
        code: "provider_state_unknown",
        quarantine_required: true,
      })
      expect(h.client.createCalls).toBe(0)
      expect(h.journal.outcomes).toHaveLength(0)
    })

    test("quarantines an ambiguous create with no exact match and never retries mutation", async () => {
      const h = harness(provider)
      h.client.createError = new Error("provider timeout with internal provider id")
      const op = makeOperation("create_inert")

      await expect(h.adapter.create_inert(makeContext(op, h.journal), SPEC, op, digest("77"))).rejects.toMatchObject({
        code: "provider_state_unknown",
        quarantine_required: true,
      })
      expect(h.client.createCalls).toBe(1)
      expect(h.journal.outcomes).toHaveLength(0)
    })

    test("maps malformed provider responses to safe ambiguity", async () => {
      const h = harness(provider)
      Object.defineProperty(h.client, "createInert", {
        configurable: true,
        value: async () => null,
      })
      const op = makeOperation("create_inert")

      await expect(
        h.adapter.create_inert(makeContext(op, h.journal), SPEC, op, digest("77")),
      ).rejects.toMatchObject({ code: "provider_state_unknown", quarantine_required: true })
      expect(h.physicalSafetyGate.containReasons).toContain("provider_effect_ambiguous")
    })

    test("rejects duplicate or conflicting token inventory instead of choosing a resource", async () => {
      const h = harness(provider)
      const op = makeOperation("create_inert")
      h.client.seed(h.client.makeResource(op.target, "1"))
      h.client.seed(h.client.makeResource(op.target, "2"))

      await expect(h.adapter.create_inert(makeContext(op, h.journal), SPEC, op, digest("77"))).rejects.toMatchObject({
        code: "provider_state_unknown",
        quarantine_required: true,
      })
      expect(h.client.createCalls).toBe(0)
    })

    test("re-enumerates and quarantines multiplicity before sealing a create response", async () => {
      const h = harness(provider)
      h.client.duplicateAfterCreate = true
      const op = makeOperation("create_inert")

      await expect(h.adapter.create_inert(makeContext(op, h.journal), SPEC, op, digest("77"))).rejects.toMatchObject({
        code: "provider_state_unknown",
        quarantine_required: true,
      })
      expect(h.client.createCalls).toBe(1)
      expect(h.journal.outcomes).toHaveLength(0)
    })

    test("requires exact intent and dispatched anchors before credential or SDK reachability", async () => {
      const h = harness(provider)
      const op = makeOperation("create_inert")
      const ctx = makeContext(op, h.journal)
      const bad: AdapterCallContextV1 = {
        ...ctx,
        invocation_anchor: {
          ...ctx.invocation_anchor,
          record: { ...ctx.invocation_anchor.record, request_sha256: digest("dead") },
        },
      }

      await expect(h.adapter.create_inert(bad, SPEC, op, digest("77"))).rejects.toMatchObject({
        code: "dispatch_anchor_mismatch",
      })
      expect(h.credentials.acquisitions).toBe(0)
      expect(h.client.createCalls).toBe(0)
    })

    test("recomputes actual effect arguments against the anchored request digest", async () => {
      const h = harness(provider)
      const op = makeOperation("create_inert")
      const changedSpec = { ...SPEC, max_runtime_ms: SPEC.max_runtime_ms + 1 }

      await expect(
        h.adapter.create_inert(makeContext(op, h.journal), changedSpec, op, digest("77")),
      ).rejects.toMatchObject({ code: "request_digest_mismatch" })
      expect(h.credentials.acquisitions).toBe(0)
      expect(h.client.createCalls).toBe(0)
    })

    test("recomputes the provider target fingerprint before credentials", async () => {
      const h = harness(provider)
      const op = makeOperation("create_inert")
      op.target.immutable_fingerprint_sha256 = digest("de")

      await expect(
        h.adapter.create_inert(makeContext(op, h.journal), SPEC, op, digest("77")),
      ).rejects.toMatchObject({ code: "operation_target_mismatch" })
      expect(h.credentials.acquisitions).toBe(0)
      expect(h.client.createCalls).toBe(0)
    })

    test("requires trusted signature/frontier verification before credential or SDK reachability", async () => {
      const h = harness(provider)
      h.anchorVerifier.reject = true
      const op = makeOperation("create_inert")

      await expect(h.adapter.create_inert(makeContext(op, h.journal), SPEC, op, digest("77"))).rejects.toMatchObject({
        code: "dispatch_anchor_mismatch",
      })
      expect(h.anchorVerifier.calls).toBe(1)
      expect(h.credentials.acquisitions).toBe(0)
      expect(h.client.createCalls).toBe(0)
    })

    test("requires trusted admission verification and never enables hermetic evidence", async () => {
      const h = harness(provider)
      expect((await h.adapter.descriptor()).admission).toBe("disabled")
      h.admissionVerifier.reject = true
      const op = makeOperation("create_inert")

      await expect(h.adapter.create_inert(makeContext(op, h.journal), SPEC, op, digest("77"))).rejects.toMatchObject({
        code: "unsupported_runtime_feature",
      })
      expect(h.credentials.acquisitions).toBe(0)
    })

    test("production factories never let hermetic evidence reach provider credentials", async () => {
      const h = harness(provider, false)
      const op = makeOperation("create_inert")

      await expect(
        h.adapter.create_inert(makeContext(op, h.journal), SPEC, op, digest("77")),
      ).rejects.toMatchObject({ code: "unsupported_runtime_feature" })
      expect(h.credentials.acquisitions).toBe(0)
    })

    test("production factories remain statically disabled even with claimed live evidence", async () => {
      const h = harness(provider, false, "live_conformance")
      const op = makeOperation("create_inert")

      expect((await h.adapter.descriptor()).admission).toBe("disabled")
      await expect(
        h.adapter.create_inert(makeContext(op, h.journal), SPEC, op, digest("77")),
      ).rejects.toMatchObject({ code: "unsupported_runtime_feature" })
      expect(h.admissionVerifier.calls).toBe(0)
      expect(h.credentials.acquisitions).toBe(0)
    })

    test("an exact duplicate dispatch record never repeats the provider mutation", async () => {
      const h = harness(provider)
      const op = makeOperation("create_inert")
      const initial = makeContext(op, h.journal)
      const duplicate = {
        ...initial,
        dispatch_attempt: {
          kind: "exact_duplicate" as const,
          operation_execution_epoch: initial.fence.operation_execution_epoch,
          prior_record_sha256: canonicalSha256(initial.invocation_anchor),
        },
      }

      await expect(h.adapter.create_inert(duplicate, SPEC, op, digest("77"))).rejects.toMatchObject({
        code: "dispatch_anchor_mismatch",
      })
      expect(h.client.createCalls).toBe(0)
    })

    test("rechecks current effect authority after anchoring and immediately before provider mutation", async () => {
      const h = harness(provider)
      h.effectGuard.rejectPhase = "before_provider_mutation"
      const op = makeOperation("create_inert")

      await expect(h.adapter.create_inert(makeContext(op, h.journal), SPEC, op, digest("77"))).rejects.toMatchObject({
        code: "stale_operation_execution_epoch",
      })
      expect(h.effectGuard.calls).toContain("after_anchor")
      expect(h.effectGuard.calls).toContain("before_provider_mutation")
      expect(h.client.createCalls).toBe(0)
    })

    test("requires an independent physical safety gate immediately before mutation", async () => {
      const h = harness(provider)
      h.physicalSafetyGate.rejectOpen = true
      const op = makeOperation("create_inert")

      await expect(h.adapter.create_inert(makeContext(op, h.journal), SPEC, op, digest("77"))).rejects.toMatchObject({
        code: "stale_operation_execution_epoch",
      })
      expect(h.physicalSafetyGate.assertOpenCalls).toBe(1)
      expect(h.client.createCalls).toBe(0)
    })

    test("fails closed on inert deny-all network readback mismatch", async () => {
      const h = harness(provider)
      h.client.networkMismatch = true
      const op = makeOperation("create_inert")

      await expect(h.adapter.create_inert(makeContext(op, h.journal), SPEC, op, digest("77"))).rejects.toMatchObject({
        code: "provider_state_unknown",
        quarantine_required: true,
      })
    })

    test("rejects a provider-started resource even when it is deny-all", async () => {
      const h = harness(provider)
      const op = makeOperation("create_inert")
      const resource = h.client.makeResource(op.target)
      resource.provider_runtime_state = "started_locked" as never
      h.client.seed(resource)

      await expect(
        h.adapter.create_inert(makeContext(op, h.journal), SPEC, op, digest("77")),
      ).rejects.toMatchObject({ code: "provider_state_unknown", quarantine_required: true })
      expect(h.client.createCalls).toBe(0)
    })

    test("activation proves policy readback before starting and returns observation only", async () => {
      const h = harness(provider)
      const handle = await create(h)
      const op = makeOperation("activate")
      const authorization = activationAuthorization(op)
      const receipt = await h.adapter.activate(
        activationContext(h, op, authorization),
        handle,
        authorization,
        op,
      )

      expect(receipt.observation).toBe("active")
      expect(receipt.network_policy.policy_sha256).toBe(BROKER_ONLY_POLICY.policy_sha256)
      expect(receipt).not.toHaveProperty("state_transition")
      expect(h.client.activateCalls).toBe(1)
      expect(handle.provider_creation_token_sha256).not.toBe(op.target.provider_idempotency_token_sha256)
      expect(new Set(h.lifecycleLock.keys).size).toBe(1)
      expect(h.client.mutationTokens).toContain(op.target.provider_idempotency_token_sha256)
    })

    test("does not activate when policy readback differs", async () => {
      const h = harness(provider)
      const handle = await create(h)
      h.client.networkMismatch = true
      const op = makeOperation("activate")
      const authorization = activationAuthorization(op)

      await expect(
        h.adapter.activate(
          activationContext(h, op, authorization),
          handle,
          authorization,
          op,
        ),
      ).rejects.toMatchObject({ code: "provider_state_unknown" })
      expect(h.client.activateCalls).toBe(0)
    })

    test("activation grant bytes cannot change after the external dispatch anchor", async () => {
      const h = harness(provider)
      const handle = await create(h)
      const op = makeOperation("activate")
      const anchoredAuthorization = {
        activation_grant_sha256: digest("81"),
        authorization_consumption_receipt_sha256: op.target.authorization_consumption_receipt_sha256,
        network_policy: BROKER_ONLY_POLICY,
      }
      const binding = canonicalSha256({
        kind: "activation",
        target_sha256: canonicalSha256(op.target),
        ...anchoredAuthorization,
      })
      const ctx = bindAuthorization(makeContext(op, h.journal), op, binding)

      await expect(
        h.adapter.activate(
          ctx,
          handle,
          { ...anchoredAuthorization, activation_grant_sha256: digest("82") },
          op,
        ),
      ).rejects.toMatchObject({ code: "dispatch_anchor_mismatch" })
      expect(h.client.activateCalls).toBe(0)
    })

    test("uses one fixed bootstrap command and sends argv only in an authenticated typed broker frame", async () => {
      const h = harness(provider)
      const handle = await create(h)
      await activate(h, handle)
      const start = makeOperation("exec_start", { generation_transition: undefined })
      await h.adapter.start_exec(makeContext(start, h.journal), handle, EXEC_SPEC, start)

      expect(h.client.providerCommandStrings).toEqual([MANAGED_GUEST_BROKER_BOOTSTRAP_COMMAND])
      const request = decodeGuestBrokerRequestFrame(h.client.brokerFrames[0]!)
      expect(request).toMatchObject({ operation: "exec_start", spec: EXEC_SPEC })
      expect(JSON.stringify(h.client.providerCommandStrings)).not.toContain("literal;not-shell")

    })

    test("rejects expanded environment fields before provider credentials", async () => {
      const h = harness(provider)
      const handle = await create(h)
      await activate(h, handle)
      const injected = {
        ...EXEC_SPEC,
        environment: { PATH: "/attacker-controlled" },
      }
      const start = makeOperation("exec_start", { generation_transition: undefined })
      start.request_sha256 = managedProviderRequestSha256({
        operation: "exec_start",
        spec: injected as never,
      })
      const before = h.credentials.acquisitions

      await expect(
        h.adapter.start_exec(makeContext(start, h.journal), handle, injected as never, start),
      ).rejects.toMatchObject({ code: "validation_failed" })
      expect(h.credentials.acquisitions).toBe(before)
      expect(h.client.brokerFrames).toEqual([])
    })

    test("fails closed when the guest-broker attestation changes after activation", async () => {
      const h = harness(provider)
      const handle = await create(h)
      await activate(h, handle)
      const attestation = h.client.brokerAttestations.get(handle.opaque_resource_id)
      if (attestation === undefined) throw new Error("fixture broker attestation missing")
      h.client.brokerAttestations.set(handle.opaque_resource_id, {
        ...attestation,
        protocol_sha256: digest("ff"),
      })
      const start = makeOperation("exec_start", { generation_transition: undefined })

      await expect(
        h.adapter.start_exec(makeContext(start, h.journal), handle, EXEC_SPEC, start),
      ).rejects.toMatchObject({ code: "provider_state_unknown", quarantine_required: true })
      expect(h.client.brokerFrames).toEqual([])
    })

    test("blocks exec when outside-guest network policy drifts after activation", async () => {
      const h = harness(provider)
      const handle = await create(h)
      await activate(h, handle)
      h.networkPolicyVerifier.expected = BROKER_ONLY_POLICY
      const resource = h.client.resources.get(handle.opaque_resource_id)
      if (resource === undefined) throw new Error("fixture resource missing")
      resource.network_policy = { ...resource.network_policy, policy_sha256: digest("fe") }
      const start = makeOperation("exec_start", { generation_transition: undefined })

      await expect(
        h.adapter.start_exec(makeContext(start, h.journal), handle, EXEC_SPEC, start),
      ).rejects.toMatchObject({ code: "provider_state_unknown", quarantine_required: true })
      expect(h.client.brokerFrames).toEqual([])
    })

    test("requires whole-guest cancellation proof", async () => {
      const h = harness(provider)
      const handle = await create(h)
      await activate(h, handle)
      const start = makeOperation("exec_start", { generation_transition: undefined })
      const exec = await h.adapter.start_exec(makeContext(start, h.journal), handle, EXEC_SPEC, start)
      h.client.cancelProof = false
      const cancel = makeOperation("exec_cancel", { generation_transition: undefined })
      cancel.request_sha256 = managedProviderRequestSha256({
        operation: "exec_cancel",
        exec_fingerprint_sha256: exec.immutable_exec_fingerprint_sha256,
      })

      await expect(h.adapter.cancel_exec(makeContext(cancel, h.journal), handle, exec, cancel)).rejects.toMatchObject({
        code: "provider_state_unknown",
        quarantine_required: true,
      })
      expect(h.client.cancelCalls).toBe(1)
      expect(h.physicalSafetyGate.containReasons).toContain("whole_guest_cancel_unproven")
    })

    test("binds the opaque native exec id into the immutable exec handle", async () => {
      const h = harness(provider)
      const handle = await create(h)
      await activate(h, handle)
      const start = makeOperation("exec_start", { generation_transition: undefined })
      const exec = await h.adapter.start_exec(makeContext(start, h.journal), handle, EXEC_SPEC, start)
      const substituted = { ...exec, opaque_exec_id: "provider-exec-substituted" }
      const cancel = makeOperation("exec_cancel", { generation_transition: undefined })
      cancel.request_sha256 = managedProviderRequestSha256({
        operation: "exec_cancel",
        exec_fingerprint_sha256: exec.immutable_exec_fingerprint_sha256,
      })

      await expect(
        h.adapter.cancel_exec(makeContext(cancel, h.journal), handle, substituted, cancel),
      ).rejects.toMatchObject({ code: "operation_target_mismatch" })
      expect(h.client.cancelCalls).toBe(0)
    })

    test("rejects workspace escapes before the credential port", async () => {
      const h = harness(provider)
      const handle = await create(h)
      const before = h.credentials.acquisitions
      const op = makeOperation("file_stat", {
        external_anchor_kind: "READ_PROBE",
        generation_transition: undefined,
      })

      await expect(h.adapter.stat_file(makeContext(op, h.journal), handle, "../secret" as never, op)).rejects.toMatchObject({
        code: "path_outside_workspace",
      })
      expect(h.credentials.acquisitions).toBe(before)
    })

    test("uses native byte file operations with atomic preconditions", async () => {
      const h = harness(provider)
      const handle = await create(h)
      await activate(h, handle)
      const bytes = new TextEncoder().encode("safe bytes")
      const writeOp = makeOperation("file_write", {
        external_anchor_kind: "DISPATCHED",
        generation_transition: undefined,
      })
      const receipt = await h.adapter.write_file(
        makeContext(writeOp, h.journal),
        handle,
        { path: validateWorkspacePath("repo/file.txt"), bytes, if_absent: true },
        writeOp,
      )
      expect(receipt.sha256).toBe(canonicalSha256(bytes))
      expect(decodeGuestBrokerRequestFrame(h.client.brokerFrames.at(-1)!)).toMatchObject({
        operation: "file_write",
        request: { path: "repo/file.txt", if_absent: true },
      })

      const conflictingWrite = makeOperation("file_write", {
        external_anchor_kind: "DISPATCHED",
        generation_transition: undefined,
      })
      await expect(
        h.adapter.write_file(
          makeContext(conflictingWrite, h.journal),
          handle,
          { path: validateWorkspacePath("repo/file.txt"), bytes, if_absent: true },
          conflictingWrite,
        ),
      ).rejects.toMatchObject({ code: "provider_state_unknown", quarantine_required: true })

      const readOp = makeOperation("file_read", {
        external_anchor_kind: "READ_PROBE",
        generation_transition: undefined,
      })
      const chunks = []
      let totalFileSha256
      let fileRevision
      for await (const chunk of h.adapter.read_file(
        makeContext(readOp, h.journal),
        handle,
        { path: validateWorkspacePath("repo/file.txt"), offset: 0, length: 10 },
        readOp,
      )) {
        chunks.push(...chunk.bytes)
        totalFileSha256 = chunk.total_file_sha256
        fileRevision = chunk.file_revision
      }
      expect(new TextDecoder().decode(new Uint8Array(chunks))).toBe("safe bytes")
      expect(totalFileSha256).toBe(canonicalSha256(bytes))
      expect(fileRevision).toBe(1n)
      const readFrame = h.client.brokerFrames.at(-1)
      expect(readFrame).toBeDefined()

      const oversizedBytes = new Uint8Array(64 * 1024 + 1)
      const oversizedRequest = {
        path: validateWorkspacePath("repo/oversized.bin"),
        bytes: oversizedBytes,
        if_absent: true as const,
      }
      const oversizedWrite = makeOperation("file_write", {
        external_anchor_kind: "DISPATCHED",
        generation_transition: undefined,
      })
      oversizedWrite.request_sha256 = managedProviderRequestSha256({
        operation: "file_write",
        request: oversizedRequest,
      })
      const before = h.credentials.acquisitions
      await expect(
        h.adapter.write_file(
          makeContext(oversizedWrite, h.journal),
          handle,
          oversizedRequest,
          oversizedWrite,
        ),
      ).rejects.toMatchObject({ code: "validation_failed" })
      expect(h.credentials.acquisitions).toBe(before)
    })

    test("expire pauses or stops without destroying and refuses unsafe auto-delete", async () => {
      const h = harness(provider)
      const handle = await create(h)
      const op = makeOperation("expire")
      const observation = await h.adapter.expire(makeContext(op, h.journal), handle, op)

      expect(observation.observation).toBe("safety_stopped")
      expect(h.client.pauseCalls).toBe(1)
      expect(h.client.destroyCalls).toBe(0)
    })

    test("destroy rechecks exact incarnation and proves terminal absence", async () => {
      const h = harness(provider)
      const handle = await create(h)
      const op = makeOperation("destroy")
      const observation = await h.adapter.destroy(destroyContext(h, op), handle, op)

      expect(observation.terminal_condition).toBe("verified_absent")
      expect(h.client.destroyCalls).toBe(1)
      expect(h.client.providerEvents.slice(-3)).toEqual(["inspect", "destroy", "inspect"])
      expect(new Set(h.lifecycleLock.keys).size).toBe(1)
    })

    test("requires an atomic provider conditional before destroy reachability", async () => {
      const h = harness(provider)
      const handle = await create(h)
      h.client.capabilities.conditional_destroy = false
      const op = makeOperation("destroy")

      await expect(h.adapter.destroy(destroyContext(h, op), handle, op)).rejects.toMatchObject({
        code: "unsupported_runtime_feature",
      })
      expect(h.client.destroyCalls).toBe(0)
    })

    test("snapshots the destroy target before any asynchronous safety check", async () => {
      const h = harness(provider)
      const handle = await create(h)
      const originalId = handle.opaque_resource_id
      const foreign = {
        ...h.client.makeResource(
          {
            ...makeOperation("create_inert").target,
            provider_idempotency_token_sha256: digest("ee"),
            provider_creation_token_sha256: digest("ef"),
          },
          "foreign",
        ),
        provider_resource_version: handle.provider_resource_version,
      }
      h.client.seed(foreign)
      h.physicalSafetyGate.onAssertOpen = () => {
        handle.opaque_resource_id = foreign.opaque_resource_id
      }
      const op = makeOperation("destroy")

      const result = await h.adapter.destroy(destroyContext(h, op), handle, op)
      expect(result.terminal_condition).toBe("verified_absent")
      expect(h.client.destroyedResourceIds).toEqual([originalId])
      expect(h.client.resources.has(foreign.opaque_resource_id)).toBe(true)
    })

    test("contains a successful provider effect when its outcome anchor cannot commit", async () => {
      const h = harness(provider)
      h.journal.failAppend = true
      const op = makeOperation("create_inert")

      await expect(
        h.adapter.create_inert(makeContext(op, h.journal), SPEC, op, digest("77")),
      ).rejects.toMatchObject({ code: "provider_state_unknown" })
      expect(h.client.createCalls).toBe(1)
      expect(h.physicalSafetyGate.containReasons).toContain("provider_effect_ambiguous")
    })

    test("anchors only bridge-proven definitive provider failures", async () => {
      const noEffect = harness(provider)
      noEffect.client.createDefinitiveFailure = "failed_no_effect"
      const noEffectOp = makeOperation("create_inert")
      await expect(
        noEffect.adapter.create_inert(
          makeContext(noEffectOp, noEffect.journal),
          SPEC,
          noEffectOp,
          digest("77"),
        ),
      ).rejects.toMatchObject({ code: "provider_state_unknown", quarantine_required: false })
      expect(noEffect.journal.outcomes.at(-1)?.outcome_kind).toBe("failed_no_effect")
      expect(noEffect.physicalSafetyGate.containReasons).toEqual([])

      const failedEffect = harness(provider)
      const handle = await create(failedEffect)
      failedEffect.client.activationDefinitiveFailure = "failed_effect"
      const failedEffectOp = makeOperation("activate")
      const authorization = activationAuthorization(failedEffectOp)
      await expect(
        failedEffect.adapter.activate(
          activationContext(failedEffect, failedEffectOp, authorization),
          handle,
          authorization,
          failedEffectOp,
        ),
      ).rejects.toMatchObject({ code: "provider_state_unknown", quarantine_required: true })
      expect(failedEffect.journal.outcomes.at(-1)?.outcome_kind).toBe("failed_effect")
      expect(failedEffect.physicalSafetyGate.containReasons).toContain("provider_effect_ambiguous")
    })

    test("fails closed on post-delete incarnation mismatch instead of accepting later absence", async () => {
      const h = harness(provider)
      const handle = await create(h)
      h.client.postDestroyMismatchThenAbsent = true
      const op = makeOperation("destroy")

      await expect(h.adapter.destroy(destroyContext(h, op), handle, op)).rejects.toMatchObject({
        code: "provider_state_unknown",
        quarantine_required: true,
      })
      expect(h.client.postDestroyMismatchServed).toBe(true)
      expect(h.journal.outcomes).toHaveLength(1)
    })

    test("does not treat native-ID absence as cleanup when the creation token was reused", async () => {
      const h = harness(provider)
      const handle = await create(h)
      h.client.replacementAfterDestroy = true
      const op = makeOperation("destroy")

      await expect(h.adapter.destroy(destroyContext(h, op), handle, op)).rejects.toMatchObject({
        code: "provider_state_unknown",
        quarantine_required: true,
      })
      expect(h.client.destroyCalls).toBe(1)
      expect(h.journal.outcomes).toHaveLength(1)
    })

    test("native creation-time reuse blocks destroy before the provider mutation", async () => {
      const h = harness(provider)
      const handle = await create(h)
      const resource = h.client.resources.get(handle.opaque_resource_id)
      if (resource === undefined) throw new Error("fixture resource missing")
      resource.provider_created_at = "2026-07-10T10:00:09.000Z"
      const op = makeOperation("destroy")

      await expect(
        h.adapter.destroy(destroyContext(h, op), handle, op),
      ).rejects.toMatchObject({ code: "provider_state_unknown", quarantine_required: true })
      expect(h.client.destroyCalls).toBe(0)
    })

    test("cleanup grant and basis digests cannot change after dispatch anchoring", async () => {
      const h = harness(provider)
      const handle = await create(h)
      const op = makeOperation("destroy")
      const ctx = destroyContext(h, op)

      await expect(
        h.adapter.destroy({ ...ctx, cleanup_basis_sha256: digest("93") }, handle, op),
      ).rejects.toMatchObject({ code: "dispatch_anchor_mismatch" })
      expect(h.client.destroyCalls).toBe(0)
    })

    test("never reports destroyed while provider absence remains unproven", async () => {
      const h = harness(provider)
      const handle = await create(h)
      h.client.keepPresentAfterDestroy = true
      const op = makeOperation("destroy")

      await expect(
        h.adapter.destroy(destroyContext(h, op), handle, op),
      ).rejects.toMatchObject({ code: "provider_state_unknown" })
      expect(h.client.destroyCalls).toBe(1)
    })

    test("a READ_PROBE never appends a mutation OUTCOME", async () => {
      const h = harness(provider)
      const handle = await create(h)
      const before = h.journal.outcomes.length
      const inspect = makeOperation("inspect", {
        external_anchor_kind: "READ_PROBE",
        generation_transition: undefined,
      })

      await h.adapter.inspect(makeContext(inspect, h.journal), handle, inspect)
      expect(h.journal.outcomes).toHaveLength(before)
    })

    test("external anchors bind idempotency key and deadline", async () => {
      const h = harness(provider)
      const op = makeOperation("create_inert")
      const ctx = makeContext(op, h.journal)
      op.idempotency_key_sha256 = digest("fa")

      await expect(
        h.adapter.create_inert(ctx, SPEC, op, digest("77")),
      ).rejects.toMatchObject({ code: "dispatch_anchor_mismatch" })
      expect(h.credentials.acquisitions).toBe(0)

      const deadlineOp = makeOperation("create_inert")
      const deadlineCtx = makeContext(deadlineOp, h.journal)
      deadlineOp.deadline = "2026-07-10T10:21:00.000Z"
      deadlineCtx.deadline = deadlineOp.deadline
      await expect(
        h.adapter.create_inert(deadlineCtx, SPEC, deadlineOp, digest("77")),
      ).rejects.toMatchObject({ code: "dispatch_anchor_mismatch" })
      expect(h.credentials.acquisitions).toBe(0)
    })

    test("lookup_operation uses a separately bound read-only continuation grant", async () => {
      const h = harness(provider)
      const handle = await create(h)
      const probe = makeOperation("create_inert", { external_anchor_kind: "READ_PROBE" })
      const ctx = makeReconcileContext(probe, h.journal)

      const observation = await h.adapter.lookup_operation(ctx, probe.target, handle)

      expect(observation).toMatchObject({
        observation: "accepted",
        target_sha256: canonicalSha256(probe.target),
        provider_idempotency_token_sha256: probe.target.provider_idempotency_token_sha256,
        immutable_fingerprint_sha256: probe.target.immutable_fingerprint_sha256,
      })
      const before = h.credentials.acquisitions
      await expect(
        h.adapter.lookup_operation(
          { ...ctx, continuation_grant_sha256: digest("a6") },
          probe.target,
          handle,
        ),
      ).rejects.toMatchObject({ code: "dispatch_anchor_mismatch" })
      expect(h.credentials.acquisitions).toBe(before)
    })

    test("list_owned_resources is anchored, bounded, provider-ID opaque, and preserves duplicates", async () => {
      const h = harness(provider)
      await create(h)
      const probe = makeOperation("inspect", {
        external_anchor_kind: "READ_PROBE",
        generation_transition: undefined,
      })
      h.client.seed(h.client.makeResource(probe.target, "duplicate"))
      const ctx = makeReconcileContext(probe, h.journal)

      const page = await h.adapter.list_owned_resources(ctx)

      expect(page.items).toHaveLength(2)
      expect(page.items[0]).toMatchObject({
        immutable_fingerprint_sha256: probe.target.immutable_fingerprint_sha256,
        state: "inert",
      })
      expect(JSON.stringify(page)).not.toContain(`${provider}-native-`)
      const before = h.credentials.acquisitions
      await expect(h.adapter.list_owned_resources(ctx, "bad\0cursor")).rejects.toMatchObject({
        code: "validation_failed",
      })
      expect(h.credentials.acquisitions).toBe(before)
    })

    test("safe errors never serialize raw provider messages or IDs", async () => {
      const h = harness(provider)
      h.client.createError = new Error("raw-native-id raw-secret-provider-body")
      const op = makeOperation("create_inert")
      let error: unknown
      try {
        await h.adapter.create_inert(makeContext(op, h.journal), SPEC, op, digest("77"))
      } catch (caught) {
        error = caught
      }
      expect(error).toBeInstanceOf(AdapterContractError)
      expect(JSON.stringify(error)).not.toContain("raw-native-id")
      expect(JSON.stringify(error)).not.toContain("raw-secret-provider-body")
      expect((error as Error).cause).toBeUndefined()
    })

    test("malformed JavaScript shapes fail safely before credentials", async () => {
      const h = harness(provider)
      const createOp = makeOperation("create_inert")

      await expect(
        h.adapter.create_inert(
          makeContext(createOp, h.journal),
          null as never,
          createOp,
          digest("77"),
        ),
      ).rejects.toMatchObject({ code: "validation_failed" })

      const inspect = makeOperation("inspect", {
        external_anchor_kind: "READ_PROBE",
        generation_transition: undefined,
      })
      await expect(
        h.adapter.inspect(makeContext(inspect, h.journal), null as never, inspect),
      ).rejects.toMatchObject({ code: "operation_target_mismatch" })
      expect(h.credentials.acquisitions).toBe(0)
    })
  })
}

test("ambient Hasna/provider configuration is absent and cannot route tests to a live service", () => {
  for (const name of Object.keys(process.env)) {
    expect(name).not.toMatch(/^(?:E2B_|DAYTONA_|SANDBOXES_|HASNA_.*(?:API|SANDBOX|ENDPOINT|BASE_URL|URL))/i)
  }
})

test("hermetic preload blocks Node network and host-process transports", () => {
  const require = createRequire(import.meta.url)
  const http = require("node:http") as { request: { name: string } }
  const net = require("node:net") as { connect: { name: string } }
  const childProcess = require("node:child_process") as { spawn: { name: string } }

  expect(http.request.name).toBe("forbidHermeticIO")
  expect(net.connect.name).toBe("forbidHermeticIO")
  expect(childProcess.spawn.name).toBe("forbidHermeticIO")
})
