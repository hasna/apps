import { createHash, randomBytes } from "node:crypto"
import { readFileSync } from "node:fs"
import { Daytona, type Sandbox } from "@daytona/sdk"
import {
  DaytonaOfficialSdkControlBridgeV1,
  DaytonaOfficialResourceAccessBridgeV1,
  canonicalSha256,
  type Digest,
  type ProviderEffectTargetV1,
} from "../src/adapters/managed/index"
import {
  DAYTONA_GUEST_WORKSPACE_PROVISION_COMMAND_V1,
  daytonaGuestWorkspaceWriteProbeCommandV1,
  daytonaGuestWorkspaceWriteProbeReceiptV1,
  installExactDaytonaGuestBrokerArtifactV1,
  parseE2bGuestWorkspaceProvisionReceiptV1,
} from "../src/adapters/managed/e2b-broker-artifact-control"
import {
  exchangeE2bGuestBrokerRequestV1,
  loadE2bGuestBrokerArtifactV1,
} from "../src/adapters/managed/e2b-guest-broker"
import { withAuthenticatedE2bGuestBrokerDuplexSdkSession } from "../src/adapters/managed/sdk-broker-bridges"

const API_URL = "https://app.daytona.io/api"
const d = (value: string | Uint8Array): Digest =>
  `sha256:${createHash("sha256").update(value).digest("hex")}`

function isNotFound(reason: unknown): boolean {
  if (reason === null || typeof reason !== "object") return false
  if (Object.getOwnPropertyDescriptor(reason, "statusCode")?.value === 404) return true
  const response = Object.getOwnPropertyDescriptor(reason, "response")?.value
  if (response === null || typeof response !== "object") return false
  return Object.getOwnPropertyDescriptor(response, "status")?.value === 404
}

async function main(): Promise<void> {
  let stage = "credential"
  let failedStage: string | undefined
  let cleanupProven = false
  let client: Daytona | undefined
  let created: Sandbox | undefined
  const fdText = process.env.DAYTONA_API_KEY_FD
  if (fdText === undefined || !/^[0-9]{1,4}$/u.test(fdText)) throw new Error(stage)
  const keyBytes = readFileSync(`/proc/self/fd/${fdText}`)
  const apiKey = keyBytes.toString("utf8").trim()
  keyBytes.fill(0)
  delete process.env.DAYTONA_API_KEY_FD
  if (apiKey.length < 16 || /[\r\n\0]/u.test(apiKey)) throw new Error(stage)

  const suffix = randomBytes(16).toString("hex")
  const installationId = "sandboxes-daytona-live-smoke-v1"
  const providerScopeRef = "daytona-cloud-live-smoke-v1"
  const ownershipBinding = `daytona-ownership-${suffix}`
  const creationToken = d(`creation-${suffix}`)
  const immutableFingerprint = d(`immutable-${suffix}`)
  const policySha256 = d(`deny-all-${suffix}`)
  const scopeLabels = {
    "hasna.installation_sha256": canonicalSha256(installationId),
    "hasna.provider_scope_ref_sha256": canonicalSha256(providerScopeRef),
  }
  const exactLabels = {
    ...scopeLabels,
    "hasna.ownership_nonce_sha256": canonicalSha256(ownershipBinding),
    "hasna.creation_token_sha256": creationToken,
    "hasna.immutable_fingerprint_sha256": immutableFingerprint,
  }

  const exactInventory = async (): Promise<Sandbox[]> => {
    if (client === undefined) return []
    const items: Sandbox[] = []
    for await (const sandbox of client.list({ labels: exactLabels, limit: 100 })) {
      if (Object.entries(exactLabels).every(([key, value]) => sandbox.labels[key] === value)) {
        items.push(sandbox)
      }
    }
    return items
  }

  const scopeInventory = async (): Promise<Sandbox[]> => {
    if (client === undefined) return []
    const items: Sandbox[] = []
    for await (const sandbox of client.list({ labels: scopeLabels, limit: 100 })) {
      if (Object.entries(scopeLabels).every(([key, value]) => sandbox.labels[key] === value)) items.push(sandbox)
    }
    return items
  }

  try {
    client = new Daytona({ apiKey, apiUrl: API_URL, otelEnabled: false })
    stage = "pre-cleanup"
    for (const sandbox of await scopeInventory()) {
      try { await client.delete(sandbox, 120) } catch (reason) {
        if (!isNotFound(reason)) throw reason
      }
    }
    const sdk = {
      create: (params: Parameters<Daytona["create"]>[0]) => client!.create(params, { timeout: 300 }),
      start: (sandbox: Sandbox) => client!.start(sandbox, 120),
      stop: (sandbox: Sandbox) => client!.stop(sandbox),
      delete: async (sandbox: Sandbox) => { await client!.delete(sandbox, 120) },
      get: async (id: string): Promise<Sandbox | "absent"> => {
        try {
          return await client!.get(id)
        } catch (reason) {
          if (isNotFound(reason)) return "absent"
          throw reason
        }
      },
      list: (query: Parameters<Daytona["list"]>[0]) => client!.list(query),
    }
    const bridge = new DaytonaOfficialSdkControlBridgeV1(
      sdk,
      { async attest() {
        return {
          source_free: true,
          credential_free: true,
          strong_vm: true,
          architecture: "arm64" as const,
          evidence_sha256: d("daytona-live-smoke-attestation-v1"),
        }
      } },
      exactLabels["hasna.installation_sha256"],
      exactLabels["hasna.provider_scope_ref_sha256"],
      () => new Date().toISOString(),
    )
    const target: ProviderEffectTargetV1 = {
      operation_id: `smoke-${suffix}`,
      operation_digest: d(`operation-${suffix}`),
      operation_step_id: `smoke-${suffix}-create`,
      resource_id: `smoke-${suffix}`,
      resource_lifecycle_generation: 1n,
      provider_idempotency_token_sha256: d(`idempotency-${suffix}`),
      provider_creation_token_sha256: creationToken,
      immutable_fingerprint_sha256: immutableFingerprint,
      authorization_consumption_receipt_sha256: d(`authorization-${suffix}`),
    }
    stage = "create"
    created = await client.create({
      language: "python",
      user: "daytona",
      labels: { ...exactLabels, "hasna.network_policy_sha256": policySha256 },
      envVars: {},
      public: false,
      autoStopInterval: 0,
      autoDeleteInterval: -1,
      ephemeral: false,
      networkBlockAll: true,
    }, { timeout: 300 })
    await client.stop(created)
    await created.refreshData()
    stage = "inspect-inert"
    const inert = await bridge.inspectResource(created.id)
    if (inert === "absent") throw new Error(stage)
    if (inert.state !== "inert" || !inert.owned || inert.network_policy.enforced_outside_guest !== true ||
      inert.network_policy.public_ingress !== false || inert.network_policy.dns_denied !== true) throw new Error(stage)
    stage = "activate"
    const active = await bridge.activateResource(
      inert.opaque_resource_id,
      target,
      exactLabels["hasna.ownership_nonce_sha256"],
    )
    if (active.state !== "active") throw new Error(stage)
    stage = "resource-access"
    const resourceAccess = new DaytonaOfficialResourceAccessBridgeV1(sdk)
    await resourceAccess.withResource(active.opaque_resource_id, async (surface) => {
      let contained = false
      const destruction = Object.freeze({
        async destroyAndProveAbsent() {
          if (contained) return
          await bridge.destroyResource(
            active.opaque_resource_id,
            active.provider_resource_version,
            target,
            exactLabels["hasna.ownership_nonce_sha256"],
          )
          if (await bridge.inspectResource(active.opaque_resource_id) !== "absent" ||
            (await bridge.findByCreationToken(creationToken)).items.length !== 0) {
            throw new Error("containment")
          }
          contained = true
          cleanupProven = true
          created = undefined
        },
      })
      const artifact = await loadE2bGuestBrokerArtifactV1()
      let attestation
      try {
        stage = "preflight-provision"
        const provision = await surface.commands.run(DAYTONA_GUEST_WORKSPACE_PROVISION_COMMAND_V1, {
          background: false, cwd: "/", envs: {}, requestTimeoutMs: 20_000,
          timeoutMs: 20_000, user: "root",
        })
        if (provision.exitCode !== 0 || provision.stderr !== "") throw new Error(stage)
        const workspaceIdentity = parseE2bGuestWorkspaceProvisionReceiptV1(provision.stdout)
        stage = "preflight-write-probe"
        const capability = await surface.commands.run(
          "/usr/bin/python3 -I -c 'import os;d=os.open(\"/workspace\",os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW|os.O_CLOEXEC);ok=False;t=-1;\ntry:\n t=os.open(\".\",os.O_WRONLY|os.O_TMPFILE|os.O_CLOEXEC,0o600,dir_fd=d);ok=os.write(t,b\"v1\")==2;os.fsync(t)\nexcept OSError:\n pass\nfinally:\n t>=0 and os.close(t);os.close(d)\nprint(\"tmpfile=true\" if ok else \"tmpfile=false\")'",
          {
            background: false, cwd: "/workspace", envs: {}, requestTimeoutMs: 20_000,
            timeoutMs: 20_000, user: "user",
          },
        )
        if (capability.exitCode !== 0 || capability.stderr !== "" ||
          !["tmpfile=true\n", "tmpfile=false\n"].includes(capability.stdout)) {
          throw new Error("write-capability-unknown")
        }
        process.stdout.write(`DAYTONA_WRITE_CAPABILITY ${capability.stdout}`)
        const writeProbe = await surface.commands.run(
          daytonaGuestWorkspaceWriteProbeCommandV1(workspaceIdentity),
          {
            background: false, cwd: "/workspace", envs: {}, requestTimeoutMs: 20_000,
            timeoutMs: 20_000, user: "user",
          },
        )
        if (writeProbe.exitCode !== 0) throw new Error("write-probe-exit")
        if (writeProbe.stdout !== daytonaGuestWorkspaceWriteProbeReceiptV1(workspaceIdentity) ||
          writeProbe.stderr !== "") throw new Error("write-probe-receipt")
        stage = "resource-access"
        try {
          attestation = await installExactDaytonaGuestBrokerArtifactV1(
            { ...surface, destruction },
            artifact,
            20_000,
          )
        } catch (reason) {
          const phase = reason !== null && typeof reason === "object"
            ? Reflect.get(reason, "phase")
            : undefined
          if ([
            "workspace_provision", "workspace_readback", "workspace_write_probe", "workspace_destroy",
            "artifact_write", "artifact_permissions", "artifact_readback", "artifact_stat",
            "launcher_install",
          ].includes(String(phase))) {
            stage = String(phase).replaceAll("_", "-")
          }
          throw reason
        }
      } finally {
        artifact.fill(0)
      }
      stage = "broker"
      const sessionBindingSha256 = d(`session-${suffix}`)
      const macKey = randomBytes(32)
      let sequence = 0
      const exchange = (
        session: Parameters<typeof exchangeE2bGuestBrokerRequestV1>[0],
        operation: Parameters<typeof exchangeE2bGuestBrokerRequestV1>[1]["operation"],
        payload: Record<string, unknown>,
      ) => exchangeE2bGuestBrokerRequestV1(session, {
        session_binding_sha256: sessionBindingSha256,
        request_id: `smoke-${sequence}`,
        sequence,
        nonce_sha256: d(`nonce-${suffix}-${sequence++}`),
        operation,
        payload,
      }, macKey)
      try {
        try {
          await withAuthenticatedE2bGuestBrokerDuplexSdkSession(
            surface.commands,
            destruction,
            attestation,
            {
            request_timeout_ms: 20_000,
            session_timeout_ms: 90_000,
            receive_timeout_ms: 20_000,
            max_request_frame_bytes: 1024 * 1024,
            max_response_frame_bytes: 1024 * 1024,
            max_response_frames: 64,
            max_response_bytes: 1024 * 1024,
          },
          sessionBindingSha256,
          macKey,
            async (session, startup) => {
            stage = "broker-startup"
            if (startup.ok !== true || startup.result?.uid !== 0 || startup.result?.gid !== 0) {
              throw new Error(stage)
            }
            const content = Buffer.from("daytona-bound-smoke\n")
            stage = "broker-file-write"
            const write = await exchange(session, "file_write", {
              path: "probe.txt",
              content_base64: content.toString("base64"),
              max_bytes: content.byteLength,
              mode: 0o600,
              if_absent: true,
            })
            if (write.ok !== true) { stage = "broker-file-write-rejected"; throw new Error(stage) }
            if (write.result?.sha256 !== d(content)) {
              stage = "broker-file-write-receipt"
              throw new Error(stage)
            }
            stage = "broker-file-read"
            const read = await exchange(session, "file_read", {
              path: "probe.txt", offset: 0, length: content.byteLength, max_bytes: content.byteLength,
            })
            if (read.ok !== true || read.result?.content_base64 !== content.toString("base64")) {
              throw new Error(stage)
            }
            stage = "broker-exec"
            const exec = await exchange(session, "exec", {
              argv: ["/usr/bin/python3", "-I", "-c", "from pathlib import Path; Path('result.txt').write_text('checkpoint-smoke\\n')"],
              cwd: ".",
              exec_id: `smoke-${suffix}`,
              wall_timeout_ms: 20_000,
              idle_timeout_ms: 20_000,
              output_limit_bytes: 4096,
              pids_limit: 4,
            })
            if (exec.ok !== true || exec.result?.status !== "exited" || exec.result?.exit_code !== 0 ||
              exec.result.checkpoint_eligible !== true) throw new Error(stage)
            stage = "broker-checkpoint"
            const checkpoint = await exchange(session, "checkpoint", {
              max_depth: 4,
              max_duration_ms: 10_000,
              max_file_bytes: 65_536,
              max_files: 8,
              max_total_bytes: 131_072,
            })
            if (checkpoint.ok !== true || checkpoint.result?.file_count !== 2 ||
              checkpoint.result?.provider_snapshot_is_canonical !== false) throw new Error(stage)
            stage = "broker-termination"
            },
          )
        } catch (reason) {
          const phase = reason !== null && typeof reason === "object"
            ? Object.getOwnPropertyDescriptor(reason, "phase")?.value
            : undefined
          if ([
            "mailbox_session_start", "mailbox_ready", "mailbox_upload", "mailbox_exchange",
            "mailbox_close", "mailbox_wait", "mailbox_disconnect",
            "mailbox_response_stat", "mailbox_response_download", "mailbox_response_delete",
            "mailbox_response_absence",
            "mailbox_supervisor_start", "mailbox_supervisor_request", "mailbox_supervisor_broker",
            "mailbox_supervisor_response", "mailbox_supervisor_close",
          ].includes(String(phase))) {
            stage = String(phase).replaceAll("_", "-")
          }
          const code = reason !== null && typeof reason === "object"
            ? Object.getOwnPropertyDescriptor(reason, "code")?.value
            : undefined
          if (stage === "broker" &&
            ["provider_unavailable", "integrity_failed", "output_limit_exceeded"].includes(String(code))) {
            stage = `broker-${String(code).replaceAll("_", "-")}`
          }
          throw reason
        }
      } finally {
        macKey.fill(0)
      }
    })
    stage = "destroy"
    await bridge.destroyResource(
      active.opaque_resource_id,
      active.provider_resource_version,
      target,
      exactLabels["hasna.ownership_nonce_sha256"],
    )
    stage = "absence"
    if (await bridge.inspectResource(active.opaque_resource_id) !== "absent") throw new Error(stage)
    if ((await bridge.findByCreationToken(creationToken)).items.length !== 0) throw new Error(stage)
    cleanupProven = true
    created = undefined
  } catch {
    failedStage = stage
  } finally {
    stage = "cleanup"
    try {
      if (client !== undefined && !cleanupProven) {
        const candidates = await exactInventory()
        for (const sandbox of candidates) {
          try { await client.delete(sandbox, 120) } catch { /* absence verification below is authoritative */ }
        }
        for (let attempt = 0; attempt < 10; attempt += 1) {
          let getAbsent = created === undefined
          if (created !== undefined) {
            try {
              const current = await client.get(created.id)
              getAbsent = current.state === "destroyed"
            } catch (reason) {
              getAbsent = isNotFound(reason)
            }
          }
          if (getAbsent && (await exactInventory()).length === 0) { cleanupProven = true; break }
          await new Promise((resolve) => setTimeout(resolve, 1_000))
        }
        created = undefined
      }
    } catch {
      failedStage ??= "cleanup"
    } finally {
      try { await client?.[Symbol.asyncDispose]() } catch { /* no live tracing is enabled */ }
    }
  }
  if (!cleanupProven) throw new Error("cleanup")
  if (failedStage !== undefined) throw new Error(failedStage)
  process.stdout.write("DAYTONA_SMOKE_OK allocation=1 get_absent=true list_absent=true cleanup=true\n")
}

try {
  await main()
} catch (reason) {
  const stage = reason instanceof Error && /^[a-z-]+$/u.test(reason.message) ? reason.message : "provider"
  process.stderr.write(`DAYTONA_SMOKE_FAIL stage=${stage}\n`)
  process.exitCode = 1
}
