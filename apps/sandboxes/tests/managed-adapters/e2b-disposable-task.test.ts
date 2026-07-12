import { describe, expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { canonicalSha256, parseCanonicalJson } from "../../src/adapters/managed/canonical"
import {
  E2B_GUEST_BROKER_ARTIFACT_SHA256_V1,
  E2B_GUEST_BROKER_PROTOCOL_SHA256_V1,
} from "../../src/adapters/managed/e2b-guest-broker"
import {
  __testOnlyCreateE2bDisposableSandboxTaskRunnerV1,
  type E2bDisposableBrokerPortV1,
  type E2bDisposableControlPortV1,
} from "../../src/adapters/managed/e2b-disposable-task"
import {
  disposableTaskBundleSha256,
  disposableTaskInputManifestSha256,
  disposableTaskOperationDigest,
  type CheckpointHandoffInputV1,
  type CheckpointHandoffPortV1,
  type DisposableSandboxTaskExecutionContextV1,
  type DisposableSandboxTaskRequestV1,
} from "../../src/adapters/managed/disposable-task"
import type { AdapterProviderResourceV1, ProviderEffectTargetV1 } from "../../src/adapters/managed/types"

const d = (value: string | Uint8Array) => `sha256:${createHash("sha256").update(value).digest("hex")}` as const

function request(checkpointOverrides: Partial<DisposableSandboxTaskRequestV1["checkpoint"]> = {}): DisposableSandboxTaskRequestV1 {
  const content = Buffer.from("bounded-live-proof\n", "utf8")
  const files = [{ path: "proof.txt", content_base64: content.toString("base64"), content_sha256: d(content), mode: 0o600 as const }]
  const exec = { argv: ["/usr/bin/true"], cwd: "." as const, wall_timeout_ms: 5_000, idle_timeout_ms: 5_000, output_limit_bytes: 4_096, pids_limit: 4 }
  const checkpoint = {
    allowed_path_prefixes: ["."], allow_file_addition: true, allow_file_modification: true,
    allow_file_deletion: true, max_changed_files: 32, forbidden_content_markers_base64: [],
    max_depth: 4, max_duration_ms: 10_000, max_file_bytes: 64 * 1024, max_files: 32, max_total_bytes: 128 * 1024,
    ...checkpointOverrides,
  }
  const value = {
    schema_version: "sandboxes.disposable-task-request/v1" as const,
    provider: "e2b" as const,
    idempotency_key_sha256: d("idem"),
    operation_digest: d("placeholder"),
    authority_envelope_sha256: d("opaque-authority-envelope"),
    source_manifest_sha256: d("descendant-package-and-source-manifest"),
    input_manifest_sha256: disposableTaskInputManifestSha256(files),
    environment_image_sha256: d("base-template-mapping"),
    task_bundle_sha256: d("placeholder"),
    network_policy: "deny_all" as const,
    maximum_allocations: 1 as const,
    max_runtime_ms: 120_000,
    files, exec, checkpoint,
  }
  value.task_bundle_sha256 = disposableTaskBundleSha256(value)
  value.operation_digest = disposableTaskOperationDigest(value)
  return value
}

function context(events: string[]): DisposableSandboxTaskExecutionContextV1 {
  return {
    dispatch_id: "dispatch-1",
    journal_dispatch_id_sha256: canonicalSha256("dispatch-1"),
    journal_dispatch_anchor_sha256: d("dispatch-anchor"),
    journal_claim_fence_sha256: d("claim-fence"),
    journal_lease_epoch: 1n,
    journal_lease_expires_at: "2099-01-01T00:10:00.000Z",
    provider_metadata_scope_sha256: d("metadata-scope"),
    provider_creation_token_sha256: d("creation-token"),
    immutable_fingerprint_sha256: d("immutable-fingerprint"),
    ownership_nonce_sha256: d("ownership-nonce"),
    recovery_expected_result_bundle_sha256: null,
    recovery_expected_checkpoint_handoff_sha256: null,
    recovery_expected_provider_fingerprint_sha256: null,
    authorization_consumption_receipt_sha256: d("authorization-consumption"),
    effect_claim_sha256: d("effect-claim"),
    dispatch_intent_anchor_sha256: d("dispatch-intent"),
    async markDispatched() { events.push("mark-dispatched"); return d("dispatched") },
    async markResultPersisted() { events.push("mark-result"); return d("result-persisted") },
  }
}

class FakeControl implements E2bDisposableControlPortV1 {
  readonly events: string[]
  alive = false
  createCalls = 0
  destroyCalls = 0
  target: ProviderEffectTargetV1 | undefined
  resource: AdapterProviderResourceV1 | undefined
  collision: AdapterProviderResourceV1 | undefined
  collisionAlive = false
  addCollision = false
  substituteOwnershipOnActivate = false
  constructor(events: string[]) { this.events = events }

  async createInert(input: Parameters<E2bDisposableControlPortV1["createInert"]>[0]) {
    this.events.push("create")
    this.createCalls += 1
    this.alive = true
    this.target = input.target
    this.resource = {
      opaque_resource_id: "raw-provider-id-must-not-escape",
      provider_creation_token_sha256: input.target.provider_creation_token_sha256,
      immutable_fingerprint_sha256: input.target.immutable_fingerprint_sha256,
      provider_created_at: "2026-07-11T00:00:00.000Z",
      provider_resource_version: d("resource-version"),
      state: "inert",
      provider_runtime_state: "paused",
      network_policy: { mode: "deny_all", policy_sha256: input.initial_network_policy.policy_sha256, enforced_outside_guest: true, public_ingress: false, dns_denied: true, observed_at: "2026-07-11T00:00:00.000Z" },
      auto_delete_disabled: true,
      ephemeral: false,
      owned: true,
      source_attached: false,
      credential_attached: false,
      guest_broker_bootstrapped: false,
      ownership: {
        installation_id_sha256: d("installation"),
        provider_scope_ref_sha256: d("scope"),
        ownership_nonce_sha256: canonicalSha256(input.ownership.ownership_nonce),
      },
    }
    if (this.addCollision) {
      this.collision = {
        ...this.resource,
        opaque_resource_id: "wrong-nonce-collision-must-survive",
        ownership: { ...this.resource.ownership, ownership_nonce_sha256: d("wrong-ownership") },
      }
      this.collisionAlive = true
    }
    return this.resource
  }
  async activateResource() {
    this.events.push("activate")
    const activated = { ...this.resource!, state: "active" as const, provider_runtime_state: "active" as const }
    if (this.substituteOwnershipOnActivate) {
      activated.ownership = { ...activated.ownership, ownership_nonce_sha256: d("substituted-ownership") }
      this.resource = activated
    }
    return activated
  }
  async destroyResource(id: string, _version: string, _target: ProviderEffectTargetV1, expectedOwnershipNonceSha256: `sha256:${string}`) {
    this.events.push("destroy")
    if (id === this.resource?.opaque_resource_id) {
      if (this.resource.ownership.ownership_nonce_sha256 !== expectedOwnershipNonceSha256) throw new Error("ownership CAS failed")
      this.alive = false
    }
    if (id === this.collision?.opaque_resource_id) this.collisionAlive = false
    this.destroyCalls += 1
  }
  async inspectResource(id: string) {
    this.events.push("get")
    if (this.alive && id === this.resource?.opaque_resource_id) return this.resource
    if (this.collisionAlive && id === this.collision?.opaque_resource_id) return this.collision
    return "absent" as const
  }
  async findByCreationToken() {
    this.events.push("list")
    return { items: [...(this.alive ? [this.resource!] : []), ...(this.collisionAlive ? [this.collision!] : [])] }
  }
}

class FakeHandoff implements CheckpointHandoffPortV1 {
  readonly events: string[]
  fail = false
  calls = 0
  stored: Awaited<ReturnType<CheckpointHandoffPortV1["putAndReadback"]>> | undefined
  checkpointBytes: Uint8Array | undefined
  constructor(events: string[]) { this.events = events }
  describe() { return { durability: "durable" as const, encrypted_at_rest: true, readback_verified: true, store_identity_sha256: d("store") } }
  async putAndReadback(input: CheckpointHandoffInputV1) {
    this.events.push("handoff")
    this.calls += 1
    if (this.fail) throw new Error("provider text")
    this.checkpointBytes = input.checkpoint_bytes.slice()
    const receipt = {
      schema_version: "sandboxes.checkpoint-handoff-receipt/v1" as const,
      dispatch_id: input.dispatch_id,
      request_sha256: input.request_sha256,
      input_manifest_sha256: input.input_manifest_sha256,
      effect_claim_sha256: input.effect_claim_sha256,
      dispatch_intent_anchor_sha256: input.dispatch_intent_anchor_sha256,
      authorization_consumption_receipt_sha256: input.authorization_consumption_receipt_sha256,
      journal_claim_fence_sha256: input.journal_claim_fence_sha256,
      journal_lease_epoch: input.journal_lease_epoch.toString(10),
      provider_effect_ownership_nonce_sha256: input.provider_effect_ownership_nonce_sha256,
      provider_ownership_binding_sha256: input.provider_ownership_binding_sha256,
      checkpoint_sha256: input.checkpoint_sha256,
      checkpoint_readback_sha256: input.checkpoint_sha256,
      checkpoint_manifest_sha256: input.checkpoint_manifest_sha256,
      file_count: input.file_count,
      total_bytes: input.total_bytes,
      handoff_receipt_sha256: d("handoff"),
      result_bundle_sha256: d("result-bundle"),
      result_signature_sha256: d("result-signature"),
      provider_fingerprint_sha256: input.provider_fingerprint_sha256,
      broker_artifact_sha256: input.broker_artifact_sha256,
      broker_protocol_sha256: input.broker_protocol_sha256,
      authenticated_session_sha256: input.authenticated_session_sha256,
      execution_receipt_sha256: input.execution_receipt_sha256,
      workspace_readback_sha256: input.workspace_readback_sha256,
      output_manifest_sha256: input.output_manifest_sha256,
      output_diff_sha256: input.output_diff_sha256,
    }
    this.stored = receipt
    return receipt
  }
  async lookupVerified(input: Parameters<CheckpointHandoffPortV1["lookupVerified"]>[0]) {
    if (this.stored === undefined) return "absent" as const
    if (input.expected_result_bundle_sha256 !== null && input.expected_result_bundle_sha256 !== this.stored.result_bundle_sha256) return "absent" as const
    if (input.expected_checkpoint_handoff_sha256 !== null && input.expected_checkpoint_handoff_sha256 !== this.stored.handoff_receipt_sha256) return "absent" as const
    return this.stored
  }
}

type WorkspaceMutation = "none" | "modify-add" | "chmod" | "delete" | "deep" | "escape" | "oversize" | "canary"

function broker(events: string[], mutation: WorkspaceMutation): E2bDisposableBrokerPortV1 {
  const files = new Map<string, Buffer>()
  let exactDestructionPort: object | undefined
  const assertExactDestructionPort = (value: object): void => {
    const descriptor = Object.getOwnPropertyDescriptor(value, "destroyAndProveAbsent")
    if (Reflect.ownKeys(value).length !== 1 || descriptor?.get !== undefined ||
      descriptor?.set !== undefined || typeof descriptor?.value !== "function") {
      throw new Error("broker received an ambient destruction object")
    }
  }
  return {
    async loadArtifact() { events.push("artifact-load"); return new Uint8Array([1, 2, 3]) },
    async install(control, artifact) {
      assertExactDestructionPort(control.destruction)
      exactDestructionPort = control.destruction
      events.push("destruction-port-exact")
      events.push("artifact-install"); artifact.fill(0)
      return { path: "/opt/hasna/bin/sandboxes-broker-v1", artifact_sha256: E2B_GUEST_BROKER_ARTIFACT_SHA256_V1, byte_length: 65_714, mode: 0o500, owner: "root", group: "root" }
    },
    async withSession(_commands, destruction, _attestation, _binding, _key, use) {
      assertExactDestructionPort(destruction)
      if (destruction !== exactDestructionPort) throw new Error("broker destruction capability changed")
      events.push("session")
      return use({ exchangeAuthenticatedLine: async () => new Uint8Array() }, { schema_version: "sandboxes.e2b-guest-broker-response/v1", protocol_sha256: E2B_GUEST_BROKER_PROTOCOL_SHA256_V1, session_binding_sha256: d("session"), request_id: "startup", sequence: 0, nonce_sha256: d("nonce"), operation: "startup", ok: true, result: { uid: 0, gid: 0, verified_fd: true, artifact_sha256: E2B_GUEST_BROKER_ARTIFACT_SHA256_V1, production_admission: false }, mac_sha256: d("mac") })
    },
    async exchange(_session, input) {
      events.push(input.operation)
      if (input.operation === "file_write") {
        const content = Buffer.from(String(input.payload.content_base64), "base64"); files.set(String(input.payload.path), content)
        return response(input, { path: input.payload.path, size: content.length, mode: input.payload.mode, sha256: d(content) })
      }
      if (input.operation === "file_read") {
        const content = files.get(String(input.payload.path))!
        return response(input, { path: input.payload.path, offset: 0, size: content.length, total_size: content.length, sha256: d(content), content_base64: content.toString("base64") })
      }
      if (input.operation === "exec") {
        if (mutation === "modify-add") {
          files.set("proof.txt", Buffer.from("modified\n"))
          files.set("generated.txt", Buffer.from("generated\n"))
        } else if (mutation === "delete") files.delete("proof.txt")
        else if (mutation === "deep") files.set("one/two/deep.txt", Buffer.from("deep"))
        else if (mutation === "escape") files.set("../escape.txt", Buffer.from("escape"))
        else if (mutation === "oversize") files.set("large.bin", Buffer.alloc(70 * 1024, 7))
        else if (mutation === "canary") files.set("leak.txt", Buffer.from("prefix-CANARY-LEAK-suffix"))
        return response(input, { status: "exited", exit_code: 0, stdout_base64: "", stderr_base64: "", output_truncated: false, destroy_required: false, checkpoint_eligible: true, process_quiescence_sha256: d("process") })
      }
      const checkpointFiles = [...files]
        .sort(([left], [right]) => Buffer.compare(Buffer.from(left), Buffer.from(right)))
        .map(([path, content]) => ({ path, size: content.length, sha256: d(content), content_base64: content.toString("base64") }))
      const manifest = checkpointFiles.map(({ path, size, sha256 }) => ({
        path, size, sha256,
        mode: mutation === "chmod" && path === "proof.txt" ? 0o644 : 0o600,
      }))
      const manifestSha256 = canonicalSha256(manifest)
      return response(input, { checkpoint_sha256: canonicalSha256({ files: checkpointFiles.map(({ path, size, sha256 }) => ({ path, size, sha256 })), manifest_sha256: manifestSha256 }), manifest_sha256: manifestSha256, files: checkpointFiles, manifest, file_count: checkpointFiles.length, total_bytes: checkpointFiles.reduce((n, f) => n + f.size, 0), provider_snapshot_is_canonical: false })
    },
  }
}

function response(input: Parameters<E2bDisposableBrokerPortV1["exchange"]>[1], result: Record<string, unknown>) {
  return { schema_version: "sandboxes.e2b-guest-broker-response/v1" as const, protocol_sha256: E2B_GUEST_BROKER_PROTOCOL_SHA256_V1, session_binding_sha256: input.session_binding_sha256, request_id: input.request_id, sequence: input.sequence, nonce_sha256: input.nonce_sha256, operation: input.operation, ok: true, result, mac_sha256: d("mac") }
}

function make(mutation: WorkspaceMutation = "none") {
  const events: string[] = []
  const control = new FakeControl(events)
  const handoff = new FakeHandoff(events)
  const runner = __testOnlyCreateE2bDisposableSandboxTaskRunnerV1({
    control, checkpoint_handoff: handoff, broker: broker(events, mutation),
    resource_access: { async withResource(_id, use) { events.push("with-resource"); return use({ files: {} as never, commands: {} as never }) } },
    template_mapping_attested: true,
    installation_id: "installation-v1", provider_scope_ref: "scope-v1", implementation_sha256: d("descendant-package"),
    architecture: "amd64", resources: { cpu_millis: 1_000, memory_bytes: 512 * 1024 * 1024, disk_bytes: 1024 * 1024 * 1024, pids: 64, open_files: 256, output_bytes: 128 * 1024 },
    random_bytes: (length) => new Uint8Array(length).fill(7),
  })
  return { events, control, handoff, runner }
}

describe("E2B disposable task candidate", () => {
  test("uses reviewed lifecycle, persists result before exact-once dual absence, and sanitizes receipt", async () => {
    const { events, control, handoff, runner } = make()
    const result = await runner.run(request(), context(events))
    expect(control.createCalls).toBe(1)
    expect(control.destroyCalls).toBe(1)
    expect(handoff.calls).toBe(1)
    expect(events.indexOf("file_read")).toBeLessThan(events.indexOf("exec"))
    expect(events.indexOf("handoff")).toBeLessThan(events.indexOf("destroy"))
    expect(events).toContain("mark-dispatched")
    expect(events).toContain("mark-result")
    expect(events).toContain("destruction-port-exact")
    expect(result).toMatchObject({ allocation_count: 1, network_policy: "deny_all", broker_artifact_sha256: E2B_GUEST_BROKER_ARTIFACT_SHA256_V1, checkpoint_readback_sha256: result.checkpoint_sha256, destroy_execution_count: 1, get_absent: true, list_absent: true, deletion_proven: true })
    const text = JSON.stringify(result)
    for (const forbidden of ["raw-provider-id", "stdout", "stderr", "apiKey", "provider_resource_id"]) expect(text).not.toContain(forbidden)
  })

  test("contains and proves absence when durable handoff fails", async () => {
    const { control, handoff, runner } = make(); handoff.fail = true
    await expect(runner.run(request(), context([]))).rejects.toMatchObject({ code: "provider_state_unknown", quarantine_required: true })
    expect(control.destroyCalls).toBe(1)
    expect(control.alive).toBe(false)
  })

  test("recovery never executes and reconstructs only from durable result", async () => {
    const { events, control, handoff, runner } = make()
    const ctx = context(events)
    const original = await runner.run(request(), ctx)
    const execCount = events.filter((event) => event === "exec").length
    const recovered = await runner.reconcile(request(), {
      ...ctx,
      prior_state: "RESULT_PERSISTED",
      recovery_expected_result_bundle_sha256: handoff.stored?.result_bundle_sha256 ?? null,
      recovery_expected_checkpoint_handoff_sha256: handoff.stored?.handoff_receipt_sha256 ?? null,
      recovery_expected_provider_fingerprint_sha256: handoff.stored?.provider_fingerprint_sha256 ?? null,
    })
    expect(recovered).not.toBe("quarantined")
    expect(events.filter((event) => event === "exec")).toHaveLength(execCount)
    expect(handoff.stored?.checkpoint_sha256).toBe(original.checkpoint_sha256)
    expect(control.alive).toBe(false)
  })

  test("recovery with no handoff still contains the exact leaked resource before quarantine", async () => {
    const { events, control, handoff, runner } = make()
    const ctx = context(events)
    const original = await runner.run(request(), ctx)
    const execCount = events.filter((event) => event === "exec").length
    control.alive = true
    handoff.stored = undefined
    handoff.checkpointBytes = undefined
    const recovered = await runner.reconcile(request(), {
      ...ctx,
      prior_state: "DISPATCHED",
      recovery_expected_provider_fingerprint_sha256: original.provider_fingerprint_sha256,
    })
    expect(recovered).toBe("quarantined")
    expect(events.filter((event) => event === "exec")).toHaveLength(execCount)
    expect(control.alive).toBe(false)
  })

  test("never destroys a same-token resource with the wrong ownership nonce", async () => {
    const { control, runner } = make()
    control.addCollision = true
    await expect(runner.run(request(), context([]))).rejects.toMatchObject({
      code: "provider_state_unknown",
      quarantine_required: true,
    })
    expect(control.collisionAlive).toBe(true)
    expect(control.destroyCalls).toBe(1)
  })

  test("ownership substitution during activation fails before guest access", async () => {
    const { events, control, runner } = make()
    control.substituteOwnershipOnActivate = true
    await expect(runner.run(request(), context([]))).rejects.toMatchObject({
      code: "provider_state_unknown",
      quarantine_required: true,
    })
    expect(events).not.toContain("with-resource")
    expect(control.alive).toBe(true)
    expect(control.destroyCalls).toBe(0)
  })

  test("persists modified and added coding output and recovers it after sandbox deletion", async () => {
    const { events, control, handoff, runner } = make("modify-add")
    const ctx = context(events)
    const result = await runner.run(request(), ctx)
    expect(result.checkpoint_file_count).toBe(2)
    expect(result.output_diff_sha256).toMatch(/^sha256:[0-9a-f]{64}$/)
    const checkpoint = new TextDecoder().decode(handoff.checkpointBytes)
    expect(checkpoint).toContain("generated.txt")
    expect(checkpoint).toContain(Buffer.from("modified\n").toString("base64"))
    const bundle = parseCanonicalJson(checkpoint) as Record<string, unknown>
    expect(bundle.output_mode).toBe("delta_from_input")
    expect(bundle.input_manifest_sha256).toBe(request().input_manifest_sha256)
    expect(bundle.input_manifest).toEqual([{
      path: "proof.txt",
      content_sha256: request().files[0]!.content_sha256,
      size_bytes: Buffer.from(request().files[0]!.content_base64, "base64").byteLength,
      mode: 0o600,
    }])
    expect(control.alive).toBe(false)
    const recovered = await runner.reconcile(request(), {
      ...ctx,
      prior_state: "RESULT_PERSISTED",
      recovery_expected_result_bundle_sha256: handoff.stored?.result_bundle_sha256 ?? null,
      recovery_expected_checkpoint_handoff_sha256: handoff.stored?.handoff_receipt_sha256 ?? null,
      recovery_expected_provider_fingerprint_sha256: handoff.stored?.provider_fingerprint_sha256 ?? null,
    })
    expect(recovered).not.toBe("quarantined")
    if (recovered !== "quarantined") expect(recovered.output_manifest_sha256).toBe(result.output_manifest_sha256)
  })

  test("records a mode-only output modification against the embedded input baseline", async () => {
    const { handoff, runner } = make("chmod")
    await runner.run(request(), context([]))
    const bundle = parseCanonicalJson(new TextDecoder().decode(handoff.checkpointBytes)) as {
      output_diff: Array<Record<string, unknown>>
    }
    expect(bundle.output_diff).toEqual([{
      kind: "modified",
      path: "proof.txt",
      before_sha256: request().files[0]!.content_sha256,
      after_sha256: request().files[0]!.content_sha256,
      before_mode: 0o600,
      after_mode: 0o644,
    }])
  })

  test("permits a policy-authorized deletion and checkpoints an empty workspace", async () => {
    const { handoff, runner } = make("delete")
    const requestValue = request()
    const result = await runner.run(requestValue, context([]))
    expect(result.checkpoint_file_count).toBe(0)
    expect(result.checkpoint_total_bytes).toBe(0)
    const expectedDiff = [{
      kind: "deleted",
      path: "proof.txt",
      before_sha256: requestValue.files[0]!.content_sha256,
      after_sha256: null,
      before_mode: 0o600,
      after_mode: null,
    }]
    const expectedDiffSha256 = canonicalSha256({
      schema_version: "sandboxes.disposable-task-output-diff/v1",
      changes: expectedDiff,
    })
    const bundle = parseCanonicalJson(new TextDecoder().decode(handoff.checkpointBytes)) as {
      output_diff: Array<Record<string, unknown>>
      output_diff_sha256: string
    }
    expect(bundle.output_diff).toEqual(expectedDiff)
    expect(bundle.output_diff_sha256).toBe(expectedDiffSha256)
    expect(handoff.stored?.output_diff_sha256).toBe(expectedDiffSha256)
    expect(result.output_diff_sha256).toBe(expectedDiffSha256)
  })

  test("rejects additions, escapes, oversize output, and forbidden canary content outside policy", async () => {
    const cases: Array<[WorkspaceMutation, Partial<DisposableSandboxTaskRequestV1["checkpoint"]>]> = [
      ["modify-add", { allow_file_addition: false }],
      ["deep", { max_depth: 1 }],
      ["escape", {}],
      ["oversize", {}],
      ["canary", { forbidden_content_markers_base64: [Buffer.from("CANARY-LEAK").toString("base64")] }],
    ]
    for (const [mutation, policy] of cases) {
      const { control, runner } = make(mutation)
      await expect(runner.run(request(policy), context([]))).rejects.toMatchObject({
        code: "provider_state_unknown",
        quarantine_required: true,
      })
      expect(control.alive).toBe(false)
    }
  })
})
