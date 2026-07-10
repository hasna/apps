import { describe, expect, test } from "bun:test"
import {
  AdapterContractError,
  activationAuthorizationBinding,
  canonicalSha256,
  cleanupAuthorizationBinding,
  createDaytonaCloudAdapter,
  createE2bAdapter,
  validateWorkspacePath,
  type AdapterCallContextV1,
  type ActivationDispatchAuthorizationV1,
  type DestroyContextV1,
  type ManagedProviderAdapterV1,
  type ManagedProviderIdV1,
  type OwnedProviderHandleV1,
} from "../../src/adapters/managed/index"
import {
  BROKER_ONLY_POLICY,
  FakeCredentialPort,
  FakeEffectGuard,
  FakeJournal,
  FakeProviderClient,
  READ_RETRY_POLICY,
  bindAuthorization,
  digest,
  makeContext,
  makeOperation,
} from "./fakes"

const SPEC = {
  schema_version: "sandboxes.runtime/v1" as const,
  spec_sha256: digest("71"),
  environment_image_or_snapshot_sha256: digest("72"),
  architecture: "amd64" as const,
  workspace_root: "/workspace" as const,
  network_policy: BROKER_ONLY_POLICY,
  max_runtime_ms: 60_000,
}

const EXEC_SPEC = {
  executable: "/usr/bin/git",
  argv: ["status", "--porcelain=v1", "literal;not-shell"],
  cwd: validateWorkspacePath("repo"),
  environment_profile_sha256: digest("73"),
  environment: { LANG: "C.UTF-8", PATH: "/usr/bin:/bin" },
  stdin_sha256: digest("74"),
  wall_deadline: "2026-07-10T10:10:00.000Z",
  idle_timeout_ms: 30_000,
  output_limit_bytes: 32,
  process_limit: 8,
  tty: false as const,
}

type Harness = {
  adapter: ManagedProviderAdapterV1
  client: FakeProviderClient
  credentials: FakeCredentialPort
  journal: FakeJournal
  effectGuard: FakeEffectGuard
}

function harness(provider: ManagedProviderIdV1): Harness {
  const client = new FakeProviderClient(provider)
  const credentials = new FakeCredentialPort(client)
  const journal = new FakeJournal()
  const effectGuard = new FakeEffectGuard()
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
    },
    read_retry_policy: READ_RETRY_POLICY,
    effect_guard: effectGuard,
  } as const
  return {
    adapter: provider === "e2b" ? createE2bAdapter(deps) : createDaytonaCloudAdapter(deps),
    client,
    credentials,
    journal,
    effectGuard,
  }
}

async function create(h: Harness): Promise<OwnedProviderHandleV1> {
  const op = makeOperation("create_inert")
  return h.adapter.create_inert(makeContext(op, h.journal), SPEC, op, digest("77"))
}

async function activate(h: Harness, handle: OwnedProviderHandleV1): Promise<void> {
  const op = makeOperation("activate")
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

function activationAuthorization(op: ReturnType<typeof makeOperation>): ActivationDispatchAuthorizationV1 {
  return {
    activation_grant_sha256: digest("81"),
    authorization_consumption_receipt_sha256: op.target.authorization_consumption_receipt_sha256,
    network_policy: BROKER_ONLY_POLICY,
  }
}

function activationContext(
  h: Harness,
  op: ReturnType<typeof makeOperation>,
  authorization: ActivationDispatchAuthorizationV1,
): AdapterCallContextV1 {
  return bindAuthorization(
    makeContext(op, h.journal),
    op,
    activationAuthorizationBinding(op.target, authorization),
  )
}

function destroyContext(h: Harness, op: ReturnType<typeof makeOperation>): DestroyContextV1 {
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
    test("adopts one exact creation token without dispatching a duplicate create", async () => {
      const h = harness(provider)
      const op = makeOperation("create_inert")
      h.client.seed(h.client.makeResource(op.target))

      const handle = await h.adapter.create_inert(makeContext(op, h.journal), SPEC, op, digest("77"))

      expect(h.client.createCalls).toBe(0)
      expect(handle.provider_creation_token_sha256).toBe(op.target.provider_idempotency_token_sha256)
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

    test("quarantines an ambiguous create with no exact match and never retries mutation", async () => {
      const h = harness(provider)
      h.client.createError = new Error("provider timeout with internal provider id")
      const op = makeOperation("create_inert")

      await expect(h.adapter.create_inert(makeContext(op, h.journal), SPEC, op, digest("77"))).rejects.toMatchObject({
        code: "provider_state_unknown",
        quarantine_required: true,
      })
      expect(h.client.createCalls).toBe(1)
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

    test("an exact duplicate dispatch record never repeats the provider mutation", async () => {
      const h = harness(provider)
      const op = makeOperation("create_inert")
      const initial = makeContext(op, h.journal)
      const duplicate = {
        ...initial,
        invocation_anchor: { ...initial.invocation_anchor, duplicate: true },
        dispatch_attempt: {
          kind: "exact_duplicate" as const,
          operation_execution_epoch: initial.fence.operation_execution_epoch,
          prior_record_sha256: initial.invocation_anchor.record_sha256,
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

    test("fails closed on inert deny-all network readback mismatch", async () => {
      const h = harness(provider)
      h.client.networkMismatch = true
      const op = makeOperation("create_inert")

      await expect(h.adapter.create_inert(makeContext(op, h.journal), SPEC, op, digest("77"))).rejects.toMatchObject({
        code: "provider_state_unknown",
        quarantine_required: true,
      })
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

    test("forwards typed argv without building a command string and streams bounded frames", async () => {
      const h = harness(provider)
      const handle = await create(h)
      await activate(h, handle)
      const start = makeOperation("exec_start", { generation_transition: undefined })
      const exec = await h.adapter.start_exec(makeContext(start, h.journal), handle, EXEC_SPEC, start)

      expect(h.client.startExecCalls).toEqual([EXEC_SPEC])
      expect(h.client.startExecCalls[0]?.argv[2]).toBe("literal;not-shell")

      const streamOp = makeOperation("exec_stream", {
        external_anchor_kind: "READ_PROBE",
        generation_transition: undefined,
      })
      const frames = []
      for await (const frame of h.adapter.stream_exec(makeContext(streamOp, h.journal), handle, exec, streamOp, 32)) {
        frames.push(frame)
      }
      expect(frames.map((frame) => frame.stream)).toEqual(["stdout", "stderr", "terminal"])
    })

    test("requires whole-guest cancellation proof", async () => {
      const h = harness(provider)
      const handle = await create(h)
      await activate(h, handle)
      const start = makeOperation("exec_start", { generation_transition: undefined })
      const exec = await h.adapter.start_exec(makeContext(start, h.journal), handle, EXEC_SPEC, start)
      h.client.cancelProof = false
      const cancel = makeOperation("exec_cancel", { generation_transition: undefined })

      await expect(h.adapter.cancel_exec(makeContext(cancel, h.journal), handle, exec, cancel)).rejects.toMatchObject({
        code: "provider_state_unknown",
        quarantine_required: true,
      })
      expect(h.client.cancelCalls).toBe(1)
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

      const readOp = makeOperation("file_read", {
        external_anchor_kind: "READ_PROBE",
        generation_transition: undefined,
      })
      const chunks = []
      for await (const chunk of h.adapter.read_file(
        makeContext(readOp, h.journal),
        handle,
        { path: validateWorkspacePath("repo/file.txt"), offset: 0, length: 10 },
        readOp,
      )) {
        chunks.push(...chunk.bytes)
      }
      expect(new TextDecoder().decode(new Uint8Array(chunks))).toBe("safe bytes")
    })

    test("provider checkpoint is explicitly non-canonical and cannot authorize cleanup", async () => {
      const h = harness(provider)
      const handle = await create(h)
      const op = makeOperation("checkpoint_hint", {
        external_anchor_kind: "DISPATCHED",
        generation_transition: undefined,
      })
      const observation = await h.adapter.checkpoint_hint(makeContext(op, h.journal), handle, op)

      expect(observation.canonical_checkpoint).toBe(false)
      expect(observation.cleanup_authority).toBe(false)
      expect(JSON.stringify(observation)).not.toContain("provider-snapshot-secret-id")
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

    test("inventory marks unknown owned resources for quarantine and never adopts them", async () => {
      const h = harness(provider)
      const createOp = makeOperation("create_inert")
      const known = h.client.makeResource(createOp.target, "known")
      const orphan = h.client.makeResource(
        { ...createOp.target, immutable_fingerprint_sha256: digest("orphan") },
        "orphan",
      )
      h.client.seed(known)
      h.client.seed(orphan)
      const reconcile = makeOperation("inspect", {
        external_anchor_kind: "READ_PROBE",
        generation_transition: undefined,
      })

      const result = await h.adapter.reconcile_inventory(
        makeContext(reconcile, h.journal),
        new Map([[known.immutable_fingerprint_sha256, "resource-1"]]),
      )
      expect(result.findings.map((finding) => finding.disposition).sort()).toEqual([
        "known",
        "quarantine_required",
      ])
      expect(result.findings).not.toContainEqual(expect.objectContaining({ disposition: "adopt" }))
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
  })
}

test("ambient Hasna/provider configuration is absent and cannot route tests to a live service", () => {
  for (const name of Object.keys(process.env)) {
    expect(name).not.toMatch(/^(?:E2B_|DAYTONA_|SANDBOXES_|HASNA_.*(?:API|SANDBOX|ENDPOINT|BASE_URL|URL))/i)
  }
})
