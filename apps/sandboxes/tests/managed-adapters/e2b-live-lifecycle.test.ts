import { describe, expect, test } from "bun:test"
import {
  AdapterContractError,
  E2bOfficialSdkControlBridgeV1,
  OFFICIAL_SDK_CONTRACT_GAPS,
  canonicalSha256,
  type ManagedResourceAttestationPortV1,
  type NetworkPolicyV1,
  type ProviderCreateInertRequestV1,
} from "../../src/adapters/managed/index"
import { digest, makeOperation } from "./fakes"

const OBSERVED_AT = "2026-07-10T10:00:04.000Z"
const INSTALLATION_ID = "installation-1"
const PROVIDER_SCOPE_REF = "provider-scope-1"
const OWNERSHIP_NONCE = "ownership-nonce-1"
const INSTALLATION_SHA256 = canonicalSha256(INSTALLATION_ID)
const PROVIDER_SCOPE_REF_SHA256 = canonicalSha256(PROVIDER_SCOPE_REF)
const OWNERSHIP_NONCE_SHA256 = canonicalSha256(OWNERSHIP_NONCE)
const NETWORK_POLICY: NetworkPolicyV1 = {
  mode: "deny_all",
  policy_sha256: digest("64"),
}
const REVIEWED_TEMPLATE_ID = "base"
const REVIEWED_MAPPING_VERSION = "e2b-2.31.0/base/reviewed-v1"

function reviewedMapping(imageOrSnapshotSha256: ReturnType<typeof digest>) {
  const preimage = {
    schema_version: "sandboxes.e2b-template-mapping/v1" as const,
    image_or_snapshot_sha256: imageOrSnapshotSha256,
    template_id: REVIEWED_TEMPLATE_ID,
    mapping_version: REVIEWED_MAPPING_VERSION,
  }
  return {
    ...preimage,
    mapping_sha256: canonicalSha256(preimage),
  }
}

function createRequest(): ProviderCreateInertRequestV1 {
  const target = makeOperation("create_inert").target
  return {
    target,
    allocation_key_sha256: digest("65"),
    ownership: {
      installation_id: INSTALLATION_ID,
      provider_scope_ref: PROVIDER_SCOPE_REF,
      ownership_nonce: OWNERSHIP_NONCE,
    },
    initial_network_policy: NETWORK_POLICY,
    spec: {
      schema_version: "sandboxes.runtime/v1",
      run_id: "run-1",
      attempt_id: "attempt-1",
      source: {
        repository_ref: "repo-1",
        commit_sha: "0123456789abcdef0123456789abcdef01234567",
        source_bundle_sha256: digest("66"),
      },
      environment: {
        image_or_snapshot_sha256: digest("67"),
        toolchain_manifest_sha256: digest("68"),
      },
      runtime_class: "strong_vm",
      architecture: "amd64",
      workspace_root: "/workspace",
      network_policy: NETWORK_POLICY,
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
      expires_at: "2026-07-10T10:01:04.000Z",
      data_class: "internal_non_sensitive",
      input_bundle_refs: [],
    },
  }
}

function attestation(): ManagedResourceAttestationPortV1 {
  return {
    async attest() {
      return {
        source_free: true,
        credential_free: true,
        strong_vm: true,
        architecture: "amd64",
        evidence_sha256: digest("69"),
      }
    },
  }
}

type FakeInfo = ReturnType<typeof safeInfo>

function safeInfo(request = createRequest()) {
  const mapping = reviewedMapping(request.spec.environment.image_or_snapshot_sha256)
  return {
    sandboxId: "e2b-owned-1",
    templateId: mapping.template_id,
    metadata: {
      "hasna.installation_sha256": INSTALLATION_SHA256,
      "hasna.provider_scope_ref_sha256": PROVIDER_SCOPE_REF_SHA256,
      "hasna.ownership_nonce_sha256": OWNERSHIP_NONCE_SHA256,
      "hasna.creation_token_sha256": request.target.provider_creation_token_sha256,
      "hasna.immutable_fingerprint_sha256": request.target.immutable_fingerprint_sha256,
      "hasna.network_policy_sha256": request.initial_network_policy.policy_sha256,
      "hasna.e2b_template_id": mapping.template_id,
      "hasna.e2b_template_mapping_version": mapping.mapping_version,
      "hasna.e2b_template_mapping_sha256": mapping.mapping_sha256,
    },
    startedAt: new Date("2026-07-10T10:00:04.000Z"),
    endAt: new Date(request.spec.expires_at),
    state: "running" as "running" | "paused",
    cpuCount: 2,
    memoryMB: 4096,
    envdVersion: "pinned",
    allowInternetAccess: false,
    network: {
      allowOut: [] as string[],
      denyOut: ["0.0.0.0/0"],
      rules: {} as Record<string, never[]>,
      allowPublicTraffic: false,
      maskRequestHost: "",
    },
    lifecycle: { onTimeout: "pause" as const, autoResume: false },
    volumeMounts: [] as Array<{ name: string; path: string }>,
  }
}

function listCandidate(info: FakeInfo) {
  return {
    sandboxId: info.sandboxId,
    templateId: info.templateId,
    metadata: { ...info.metadata },
    startedAt: new Date(info.startedAt),
    endAt: new Date(info.endAt),
    state: info.state,
    cpuCount: info.cpuCount,
    memoryMB: info.memoryMB,
    envdVersion: info.envdVersion,
    volumeMounts: [...info.volumeMounts],
  }
}

interface FakeLifecycleState {
  info: FakeInfo | "absent"
  createOptions: unknown
  connectOptions: unknown
  pauseOptions: unknown
  updateNetwork: unknown
  killCalls: number
}

function lifecycleHarness(
  request = createRequest(),
  overrides: Partial<Record<"list" | "create" | "connect" | "pause" | "kill" | "updateNetwork", (...args: never[]) => unknown>> = {},
  resolveTemplate: (imageOrSnapshotSha256: ReturnType<typeof digest>) => unknown =
    (imageOrSnapshotSha256) => reviewedMapping(imageOrSnapshotSha256),
) {
  const state: FakeLifecycleState = {
    info: "absent",
    createOptions: undefined,
    connectOptions: undefined,
    pauseOptions: undefined,
    updateNetwork: undefined,
    killCalls: 0,
  }
  const sdk = {
    list() {
      if (overrides.list !== undefined) return overrides.list() as never
      const present = state.info !== "absent"
      return {
        hasNext: present,
        nextToken: undefined,
        async nextItems() {
          return state.info === "absent" ? [] : [listCandidate(state.info)]
        },
      }
    },
    async getInfo(opaqueResourceId: string) {
      if (state.info === "absent") return "absent" as const
      expect(opaqueResourceId).toBe(state.info.sandboxId)
      return state.info
    },
    async create(options: unknown) {
      if (overrides.create !== undefined) {
        return overrides.create(options as never) as never
      }
      state.createOptions = options
      state.info = safeInfo(request)
      return { sandboxId: state.info.sandboxId }
    },
    async connect(opaqueResourceId: string, options: unknown) {
      if (overrides.connect !== undefined) {
        return overrides.connect(opaqueResourceId as never, options as never) as never
      }
      state.connectOptions = options
      if (state.info === "absent") throw new Error("missing")
      state.info.state = "running"
      return { sandboxId: opaqueResourceId }
    },
    async pause(opaqueResourceId: string, options: unknown) {
      if (overrides.pause !== undefined) {
        return overrides.pause(opaqueResourceId as never, options as never) as never
      }
      state.pauseOptions = options
      if (state.info === "absent") return false
      state.info.state = "paused"
      return true
    },
    async updateNetwork(opaqueResourceId: string, update: unknown) {
      if (overrides.updateNetwork !== undefined) {
        return overrides.updateNetwork(opaqueResourceId as never, update as never) as never
      }
      state.updateNetwork = update
    },
    async kill(opaqueResourceId: string) {
      if (overrides.kill !== undefined) {
        return overrides.kill(opaqueResourceId as never) as never
      }
      state.killCalls += 1
      if (state.info === "absent") return false
      state.info = "absent"
      return true
    },
  }
  const bridge = new E2bOfficialSdkControlBridgeV1(
    sdk as never,
    attestation(),
    INSTALLATION_SHA256,
    PROVIDER_SCOPE_REF_SHA256,
    () => OBSERVED_AT,
    { resolve: resolveTemplate } as never,
  )
  return { bridge, sdk, state }
}

describe("E2B 2.31.0 credential-bound lifecycle mapping", () => {
  test("creates with only supported strict controls and returns a verified paused resource", async () => {
    const request = createRequest()
    const { bridge, state } = lifecycleHarness(request)

    const resource = await bridge.createInert(request)

    expect(state.createOptions).toEqual({
      template: REVIEWED_TEMPLATE_ID,
      metadata: {
        "hasna.installation_sha256": INSTALLATION_SHA256,
        "hasna.provider_scope_ref_sha256": PROVIDER_SCOPE_REF_SHA256,
        "hasna.ownership_nonce_sha256": OWNERSHIP_NONCE_SHA256,
        "hasna.creation_token_sha256": request.target.provider_creation_token_sha256,
        "hasna.immutable_fingerprint_sha256": request.target.immutable_fingerprint_sha256,
        "hasna.network_policy_sha256": request.initial_network_policy.policy_sha256,
        "hasna.e2b_template_id": REVIEWED_TEMPLATE_ID,
        "hasna.e2b_template_mapping_version": REVIEWED_MAPPING_VERSION,
        "hasna.e2b_template_mapping_sha256": reviewedMapping(
          request.spec.environment.image_or_snapshot_sha256,
        ).mapping_sha256,
      },
      envs: {},
      timeoutMs: 60_000,
      secure: true,
      allowInternetAccess: false,
      network: { denyOut: ["0.0.0.0/0"], allowPublicTraffic: false },
      lifecycle: {
        onTimeout: { action: "pause", keepMemory: false },
        autoResume: false,
      },
    })
    expect(state.pauseOptions).toEqual({ keepMemory: false })
    expect(resource).toMatchObject({
      opaque_resource_id: "e2b-owned-1",
      provider_creation_token_sha256: request.target.provider_creation_token_sha256,
      immutable_fingerprint_sha256: request.target.immutable_fingerprint_sha256,
      state: "inert",
      provider_runtime_state: "paused",
      owned: true,
      source_attached: false,
      credential_attached: false,
      network_policy: {
        mode: "deny_all",
        policy_sha256: request.initial_network_policy.policy_sha256,
        enforced_outside_guest: true,
        public_ingress: false,
        dns_denied: true,
      },
    })
    expect(resource.provider_resource_version).toBe(canonicalSha256({
      sandbox_id: "e2b-owned-1",
      template_id: REVIEWED_TEMPLATE_ID,
      started_at: "2026-07-10T10:00:04.000Z",
      template_mapping_version: REVIEWED_MAPPING_VERSION,
      template_mapping_sha256: reviewedMapping(
        request.spec.environment.image_or_snapshot_sha256,
      ).mapping_sha256,
    }))
    expect(bridge.capabilities).toMatchObject({
      create_stopped: true,
      creation_metadata_labels: true,
      network_policy_readback: true,
      idempotent_activation_continuation: true,
      stop_preserves_filesystem: true,
      conditional_destroy: false,
      locked_destroy_compensation: true,
    })
    expect(OFFICIAL_SDK_CONTRACT_GAPS.e2b.admission).toBe("disabled")
    expect(JSON.stringify(state.createOptions)).not.toMatch(/api.?key|credential/i)
    expect(JSON.stringify(state.createOptions)).not.toContain(request.spec.source.repository_ref)
    expect(JSON.stringify(state.createOptions)).not.toContain(
      request.spec.source.source_bundle_sha256,
    )
    for (const unsupported of [
      "cpu",
      "cpuCount",
      "memoryMB",
      "disk",
      "pids",
      "outputBytes",
    ]) {
      expect(state.createOptions).not.toHaveProperty(unsupported)
    }
  })

  test("fails closed before create when the declared image digest is not reviewed", async () => {
    const request = createRequest()
    const harness = lifecycleHarness(request, {}, () => "absent")

    await expect(harness.bridge.createInert(request)).rejects.toMatchObject({
      code: "validation_failed",
      quarantine_required: false,
    })
    expect(harness.state.createOptions).toBeUndefined()
    expect(harness.state.info).toBe("absent")
  })

  test("rejects a tampered mapping before provider reachability", async () => {
    const request = createRequest()
    const mapping = reviewedMapping(request.spec.environment.image_or_snapshot_sha256)
    const harness = lifecycleHarness(request, {}, () => ({
      ...mapping,
      mapping_version: "tampered-version",
    }))

    await expect(harness.bridge.createInert(request)).rejects.toMatchObject({
      code: "integrity_failed",
      quarantine_required: false,
    })
    expect(harness.state.createOptions).toBeUndefined()
    expect(harness.state.info).toBe("absent")
  })

  test("requires exact reviewed template and mapping labels in provider readback", async () => {
    const request = createRequest()
    const mutations = [
      (info: FakeInfo) => {
        info.templateId = "unreviewed-template"
      },
      (info: FakeInfo) => {
        info.metadata["hasna.e2b_template_mapping_sha256"] = digest("ff")
      },
      (info: FakeInfo) => {
        info.metadata["hasna.e2b_template_mapping_version"] = "changed-version"
      },
    ]

    for (const mutate of mutations) {
      const harness = lifecycleHarness(request, {
        create(options) {
          harness.state.createOptions = options
          const info = safeInfo(request)
          mutate(info)
          harness.state.info = info
          return { sandboxId: info.sandboxId }
        },
      })

      await expect(harness.bridge.createInert(request)).rejects.toMatchObject({
        code: "provider_state_unknown",
        quarantine_required: true,
      })
      expect(harness.state.killCalls).toBe(1)
      expect(harness.state.info).toBe("absent")
    }
  })

  test("reconciles a create response loss by exact creation token before pausing", async () => {
    const request = createRequest()
    let stateRef: FakeLifecycleState
    const harness = lifecycleHarness(request, {
      create() {
        stateRef.info = safeInfo(request)
        throw new Error("response lost after create")
      },
    })
    stateRef = harness.state

    await expect(harness.bridge.createInert(request)).resolves.toMatchObject({
      state: "inert",
      provider_runtime_state: "paused",
      opaque_resource_id: "e2b-owned-1",
    })
    expect(harness.state.pauseOptions).toEqual({ keepMemory: false })
    expect(harness.state.killCalls).toBe(0)
  })

  test("cleans up a proven owned candidate when inert creation cannot be verified", async () => {
    const request = createRequest()
    let stateRef: FakeLifecycleState
    const harness = lifecycleHarness(request, {
      pause() {
        throw new Error("provider-secret-pause-diagnostic")
      },
      kill() {
        stateRef.killCalls += 1
        stateRef.info = "absent"
        return true
      },
    })
    stateRef = harness.state

    let failure: unknown
    try {
      await harness.bridge.createInert(request)
    } catch (cause) {
      failure = cause
    }
    expect(failure).toBeInstanceOf(AdapterContractError)
    expect(failure).toMatchObject({
      code: "provider_state_unknown",
      quarantine_required: true,
    })
    expect(String(failure)).not.toContain("provider-secret")
    expect(harness.state.killCalls).toBe(1)
    expect(harness.state.info).toBe("absent")
  })

  test("rejects and cleans up when template CPU or memory readback misses the strict request", async () => {
    const request = createRequest()
    const harness = lifecycleHarness(request, {
      create(options) {
        harness.state.createOptions = options
        harness.state.info = {
          ...safeInfo(request),
          cpuCount: 4,
          memoryMB: 8192,
        }
        return { sandboxId: "e2b-owned-1" }
      },
    })

    await expect(harness.bridge.createInert(request)).rejects.toMatchObject({
      code: "provider_state_unknown",
      quarantine_required: true,
    })
    expect(harness.state.killCalls).toBe(1)
    expect(harness.state.info).toBe("absent")
  })

  test("resumes with only the observed remaining TTL and pauses without preserving processes", async () => {
    const request = createRequest()
    const { bridge, state } = lifecycleHarness(request)
    const created = await bridge.createInert(request)

    const active = await bridge.activateResource(created.opaque_resource_id, request.target)
    expect(state.connectOptions).toEqual({ timeoutMs: 60_000 })
    expect(active).toMatchObject({ state: "active", provider_runtime_state: "active" })

    const paused = await bridge.pauseOrStopResource(created.opaque_resource_id, request.target)
    expect(state.pauseOptions).toEqual({ keepMemory: false })
    expect(paused).toMatchObject({ state: "inert", provider_runtime_state: "paused" })
  })

  test("applies only a deny-all policy whose private readback can be proven", async () => {
    const request = createRequest()
    const { bridge, state } = lifecycleHarness(request)
    const created = await bridge.createInert(request)

    await expect(
      bridge.applyNetworkPolicy(created.opaque_resource_id, NETWORK_POLICY, request.target),
    ).resolves.toMatchObject({
      mode: "deny_all",
      policy_sha256: NETWORK_POLICY.policy_sha256,
      enforced_outside_guest: true,
      public_ingress: false,
      dns_denied: true,
    })
    expect(state.updateNetwork).toEqual({
      allowInternetAccess: false,
      denyOut: ["0.0.0.0/0"],
    })

    await expect(
      bridge.applyNetworkPolicy(
        created.opaque_resource_id,
        { mode: "broker_only", policy_sha256: digest("70") },
        request.target,
      ),
    ).rejects.toMatchObject({ code: "unsupported_runtime_feature" })
  })

  test("gates unconditional kill on exact ownership, target, and version then verifies absence", async () => {
    const request = createRequest()
    const { bridge, state } = lifecycleHarness(request)
    const created = await bridge.createInert(request)

    await expect(
      bridge.destroyResource(created.opaque_resource_id, "wrong-version", request.target),
    ).rejects.toMatchObject({ code: "operation_target_mismatch" })
    expect(state.killCalls).toBe(0)

    await expect(
      bridge.destroyResource(
        created.opaque_resource_id,
        created.provider_resource_version,
        request.target,
      ),
    ).resolves.toBeUndefined()
    expect(state.killCalls).toBe(1)
    expect(state.info).toBe("absent")
  })

  test("quarantines when kill succeeds but post-delete absence is not proven", async () => {
    const request = createRequest()
    let stateRef: FakeLifecycleState
    const harness = lifecycleHarness(request, {
      kill() {
        stateRef.killCalls += 1
        return true
      },
    })
    stateRef = harness.state
    const created = await harness.bridge.createInert(request)

    await expect(
      harness.bridge.destroyResource(
        created.opaque_resource_id,
        created.provider_resource_version,
        request.target,
      ),
    ).rejects.toMatchObject({
      code: "provider_state_unknown",
      quarantine_required: true,
    })
    expect(harness.state.killCalls).toBe(1)
  })

  test("captures the credential-bound read methods once before provider reachability", async () => {
    const request = createRequest()
    const { bridge, sdk } = lifecycleHarness(request)
    let replacementCalls = 0
    sdk.getInfo = async () => {
      replacementCalls += 1
      throw new Error("post-construction method replacement")
    }
    sdk.list = () => {
      replacementCalls += 1
      throw new Error("post-construction method replacement")
    }

    await expect(bridge.createInert(request)).resolves.toMatchObject({
      state: "inert",
      provider_runtime_state: "paused",
    })
    await expect(
      bridge.findByCreationToken(request.target.provider_creation_token_sha256),
    ).resolves.toMatchObject({ items: [{ opaque_resource_id: "e2b-owned-1" }] })
    expect(replacementCalls).toBe(0)
  })

  test("does not accept native-ID absence when creation-token absence cannot be proven", async () => {
    const request = createRequest()
    let inventoryUnavailable = false
    const harness = lifecycleHarness(request, {
      list() {
        if (inventoryUnavailable) throw new Error("inventory unavailable after delete")
        const present = harness.state.info !== "absent"
        return {
          hasNext: present,
          nextToken: undefined,
          async nextItems() {
            return harness.state.info === "absent"
              ? []
              : [listCandidate(harness.state.info)]
          },
        }
      },
      kill() {
        harness.state.killCalls += 1
        harness.state.info = "absent"
        inventoryUnavailable = true
        return true
      },
    })
    const created = await harness.bridge.createInert(request)

    await expect(
      harness.bridge.destroyResource(
        created.opaque_resource_id,
        created.provider_resource_version,
        request.target,
      ),
    ).rejects.toMatchObject({
      code: "provider_state_unknown",
      quarantine_required: true,
    })
    expect(harness.state.killCalls).toBe(1)
  })
})
