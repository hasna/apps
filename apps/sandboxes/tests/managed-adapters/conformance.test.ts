import { describe, expect, test } from "bun:test"
import {
  AdapterContractError,
  canonicalSha256,
  createDaytonaCloudAdapter,
  createE2bAdapter,
  type AdapterCallContextV1,
  type AdapterProviderResourceV1,
  type ManagedProviderAdapterV1,
  type ManagedProviderIdV1,
  type OwnedProviderHandleV1,
  type ProviderOperationNameV1,
} from "../../src/adapters/managed/index"
import {
  BROKER_ONLY_POLICY,
  DENY_ALL_POLICY,
  FakeCredentialPort,
  FakeJournal,
  FakeProviderClient,
  READ_RETRY_POLICY,
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
  cwd: "repo" as const,
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
}

function harness(provider: ManagedProviderIdV1): Harness {
  const client = new FakeProviderClient(provider)
  const credentials = new FakeCredentialPort(client)
  const journal = new FakeJournal()
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
  } as const
  return {
    adapter: provider === "e2b" ? createE2bAdapter(deps) : createDaytonaCloudAdapter(deps),
    client,
    credentials,
    journal,
  }
}

async function create(h: Harness): Promise<OwnedProviderHandleV1> {
  const op = makeOperation("create_inert")
  return h.adapter.create_inert(makeContext(op, h.journal), SPEC, op, digest("77"))
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
      const receipt = await h.adapter.activate(
        makeContext(op, h.journal),
        handle,
        {
          activation_grant_sha256: digest("81"),
          authorization_consumption_receipt_sha256: op.target.authorization_consumption_receipt_sha256,
          network_policy: BROKER_ONLY_POLICY,
        },
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

      await expect(
        h.adapter.activate(
          makeContext(op, h.journal),
          handle,
          {
            activation_grant_sha256: digest("81"),
            authorization_consumption_receipt_sha256: op.target.authorization_consumption_receipt_sha256,
            network_policy: BROKER_ONLY_POLICY,
          },
          op,
        ),
      ).rejects.toMatchObject({ code: "provider_state_unknown" })
      expect(h.client.activateCalls).toBe(0)
    })

    test("forwards typed argv without building a command string and streams bounded frames", async () => {
      const h = harness(provider)
      const handle = await create(h)
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
      const bytes = new TextEncoder().encode("safe bytes")
      const writeOp = makeOperation("file_write", {
        external_anchor_kind: "DISPATCHED",
        generation_transition: undefined,
      })
      const receipt = await h.adapter.write_file(
        makeContext(writeOp, h.journal),
        handle,
        { path: "repo/file.txt", bytes, if_absent: true },
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
        { path: "repo/file.txt", offset: 0, length: 10 },
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
      const observation = await h.adapter.destroy(
        {
          ...makeContext(op, h.journal),
          cleanup_grant_sha256: digest("91"),
          cleanup_basis_sha256: digest("92"),
        },
        handle,
        op,
      )

      expect(observation.terminal_condition).toBe("verified_absent")
      expect(h.client.destroyCalls).toBe(1)
    })

    test("never reports destroyed while provider absence remains unproven", async () => {
      const h = harness(provider)
      const handle = await create(h)
      h.client.keepPresentAfterDestroy = true
      const op = makeOperation("destroy")

      await expect(
        h.adapter.destroy(
          {
            ...makeContext(op, h.journal),
            cleanup_grant_sha256: digest("91"),
            cleanup_basis_sha256: digest("92"),
          },
          handle,
          op,
        ),
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
    })
  })
}

test("ambient Hasna/provider configuration is absent and cannot route tests to a live service", () => {
  for (const name of Object.keys(process.env)) {
    expect(name).not.toMatch(/^(?:E2B_|DAYTONA_|SANDBOXES_|HASNA_.*(?:API|SANDBOX|ENDPOINT|BASE_URL|URL))/i)
  }
})
