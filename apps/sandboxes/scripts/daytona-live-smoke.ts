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
      user: "root",
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
      const result = await surface.commands.run("/usr/bin/true", {
        background: false,
        cwd: "/",
        envs: {},
        requestTimeoutMs: 20_000,
        timeoutMs: 20_000,
        user: "root",
      })
      if (result.exitCode !== 0) throw new Error(stage)
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
