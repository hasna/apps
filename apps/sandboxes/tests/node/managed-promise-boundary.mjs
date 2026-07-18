import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { createHash, createHmac } from "node:crypto"
import { EventEmitter } from "node:events"
import { fileURLToPath } from "node:url"
import { runInNewContext } from "node:vm"
import { PtyHandle } from "@daytona/sdk"
import {
  AdapterContractError,
  DaytonaOfficialSdkControlBridgeV1,
  E2B_GUEST_BROKER_ARTIFACT_INSTALL_PATH_V1,
  E2B_GUEST_BROKER_ARTIFACT_SHA256_V1,
  E2B_GUEST_BROKER_ARTIFACT_SIZE_V1,
  E2B_GUEST_BROKER_PROTOCOL_SHA256_V1,
  E2bOfficialSdkControlBridgeV1,
  canonicalJson,
  canonicalSha256,
  withAuthenticatedE2bGuestBrokerDuplexSdkSession,
  withDaytonaGuestBrokerSdkSession,
} from "../../dist/index.js"

async function settle(promise) {
  try {
    return { status: "fulfilled", value: await promise }
  } catch (reason) {
    return { status: "rejected", reason }
  }
}

function assertIntegrityFailure(result) {
  assert.equal(result.status, "rejected")
  assert.ok(result.reason instanceof AdapterContractError)
  assert.equal(result.reason?.code, "integrity_failed")
}

function brokerHandle() {
  return {
    async sendStdin() {},
    async closeStdin() {},
  }
}

const BROKER_SESSION_BINDING = `sha256:${"11".repeat(32)}`
const BROKER_MAC_KEY = Uint8Array.from({ length: 32 }, (_, index) => index + 1)
const BROKER_LIMITS = Object.freeze({
  request_timeout_ms: 1_000,
  session_timeout_ms: 5_000,
  receive_timeout_ms: 1_000,
  max_request_frame_bytes: 1024 * 1024,
  max_response_frame_bytes: 1024 * 1024,
  max_response_frames: 4,
  max_response_bytes: 1024 * 1024,
})
const BROKER_ARTIFACT_ATTESTATION = Object.freeze({
  path: E2B_GUEST_BROKER_ARTIFACT_INSTALL_PATH_V1,
  artifact_sha256: E2B_GUEST_BROKER_ARTIFACT_SHA256_V1,
  byte_length: E2B_GUEST_BROKER_ARTIFACT_SIZE_V1,
  mode: 0o500,
  owner: "root",
  group: "root",
})

function canonicalWireJson(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonicalWireJson).join(",")}]`
  return `{${Object.entries(value)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => `${JSON.stringify(key)}:${canonicalWireJson(item)}`)
    .join(",")}}`
}

function brokerStartupResponse() {
  const nonce = `sha256:${createHash("sha256")
    .update(`startup:${BROKER_SESSION_BINDING}`)
    .digest("hex")}`
  const basis = {
    nonce_sha256: nonce,
    ok: true,
    operation: "startup",
    protocol_sha256: E2B_GUEST_BROKER_PROTOCOL_SHA256_V1,
    request_id: "startup",
    result: {
      artifact_sha256: E2B_GUEST_BROKER_ARTIFACT_SHA256_V1,
      checkpoint_eligible: false,
      device: 1,
      exec_cancel: false,
      exec_limit: 1,
      gid: 0,
      inode: 1,
      mode: 0o500,
      path: E2B_GUEST_BROKER_ARTIFACT_INSTALL_PATH_V1,
      process_baseline_sha256: digest("b1"),
      production_admission: false,
      resume: false,
      destroy_required: false,
      size: E2B_GUEST_BROKER_ARTIFACT_SIZE_V1,
      uid: 0,
      unexpected_process_count: 0,
      verified_fd: true,
    },
    schema_version: "sandboxes.e2b-guest-broker-response/v1",
    sequence: 0,
    session_binding_sha256: BROKER_SESSION_BINDING,
  }
  const mac = `sha256:${createHmac("sha256", BROKER_MAC_KEY)
    .update(canonicalWireJson(basis))
    .digest("hex")}`
  return `${canonicalWireJson({ ...basis, mac_sha256: mac })}\n`
}

function authenticatedBrokerHandle(options) {
  let finish
  const wait = new Promise((resolve) => { finish = resolve })
  let initialized = false
  return {
    async sendStdin() {
      assert.equal(initialized, false)
      initialized = true
      await options.onStdout?.(brokerStartupResponse())
    },
    async closeStdin() {
      finish({ exitCode: 0, stdout: "", stderr: "" })
    },
    wait: () => wait,
    async kill() {
      throw new Error("process kill must remain unreachable")
    },
    async disconnect() {},
  }
}

function runAuthenticatedPromiseBoundary(commands, use = async () => {}) {
  return withAuthenticatedE2bGuestBrokerDuplexSdkSession(
    commands,
    { async destroyAndProveAbsent() {} },
    BROKER_ARTIFACT_ATTESTATION,
    BROKER_LIMITS,
    BROKER_SESSION_BINDING,
    BROKER_MAC_KEY,
    use,
  )
}

function digest(suffix) {
  return `sha256:${suffix.padStart(64, "0")}`
}

{
  const handle = brokerHandle()
  const rawSetup = runInNewContext("Promise.resolve(value)", { value: handle })
  let thenGetterCalls = 0
  let thenCalls = 0
  Object.defineProperty(rawSetup, "then", {
    configurable: false,
    get() {
      thenGetterCalls += 1
      return (resolve) => {
        thenCalls += 1
        resolve(handle)
      }
    },
  })

  const result = await settle(
    runAuthenticatedPromiseBoundary({ run: () => rawSetup }),
  )
  assertIntegrityFailure(result)
  assert.equal(thenGetterCalls, 0)
  assert.equal(thenCalls, 0)
}

{
  const handle = brokerHandle()
  const rawSetup = Promise.resolve(handle)
  let thenGetterCalls = 0
  Object.defineProperty(rawSetup, "then", {
    configurable: false,
    get() {
      thenGetterCalls += 1
      return () => {
        throw new Error("hostile own then must remain unreachable")
      }
    },
  })

  const result = await settle(
    runAuthenticatedPromiseBoundary({ run: () => rawSetup }),
  )
  assertIntegrityFailure(result)
  assert.equal(thenGetterCalls, 0)
}

{
  const rawFailure = new Error("hostile own then rejection")
  const rawSetup = Promise.reject(rawFailure)
  let thenGetterCalls = 0
  const unhandled = []
  const onUnhandled = (reason) => {
    unhandled.push(reason)
  }
  process.on("unhandledRejection", onUnhandled)
  try {
    Object.defineProperty(rawSetup, "then", {
      configurable: false,
      get() {
        thenGetterCalls += 1
        return () => {
          throw new Error("hostile rejected own then must remain unreachable")
        }
      },
    })

    const result = await settle(
      runAuthenticatedPromiseBoundary({ run: () => rawSetup }),
    )
    await new Promise((resolve) => setImmediate(resolve))

    assertIntegrityFailure(result)
    assert.equal(thenGetterCalls, 0)
    assert.deepEqual(unhandled, [])
  } finally {
    process.off("unhandledRejection", onUnhandled)
  }
}

{
  const handle = brokerHandle()
  const rawSetup = Promise.resolve(handle)
  let constructorGetterCalls = 0
  Object.defineProperty(rawSetup, "constructor", {
    configurable: false,
    get() {
      constructorGetterCalls += 1
      return Promise
    },
  })

  const result = await settle(
    runAuthenticatedPromiseBoundary({ run: () => rawSetup }),
  )
  assertIntegrityFailure(result)
  assert.equal(constructorGetterCalls, 0)
}

{
  let rawSetup
  let beforeKeys
  const wrapper = runAuthenticatedPromiseBoundary({
    run(_command, options) {
      const handle = authenticatedBrokerHandle(options)
      rawSetup = Object.freeze(Promise.resolve(handle))
      beforeKeys = Reflect.ownKeys(rawSetup)
      return rawSetup
    },
  })

  assert.equal(wrapper.constructor, Promise)
  assert.equal(Promise.resolve(wrapper), wrapper)
  await wrapper
  assert.deepEqual(Reflect.ownKeys(rawSetup), beforeKeys)
  assert.equal(Object.isFrozen(rawSetup), true)
}

{
  const evidencePath = fileURLToPath(
    new URL("./promise-tcb-breach-child.mjs", import.meta.url),
  )
  const evidence = spawnSync(process.execPath, [evidencePath], {
    encoding: "utf8",
  })
  assert.equal(evidence.status, 0, evidence.stderr)
  assert.deepEqual(JSON.parse(evidence.stdout), {
    cross_realm: {
      error_code: "integrity_failed",
      unhandled_rejections: 1,
    },
    own_constructor_getter: {
      error_code: "integrity_failed",
      getter_calls: 0,
      unhandled_rejections: 1,
    },
  })
}

{
  class FakeDaytonaWebSocket extends EventEmitter {
    readyState = 1
  }

  let socket
  const providerProcess = {
    async createPty(options) {
      socket = new FakeDaytonaWebSocket()
      const handle = new PtyHandle(
        socket,
        async () => ({}),
        async () => {},
        options.onData,
        "offline-pinned-sdk-session",
      )
      Object.defineProperties(handle, {
        disconnect: { value: async () => {} },
        sendInput: { value: async () => {} },
        waitForConnection: { value: async () => {} },
      })
      return handle
    },
  }
  const unhandled = []
  const onUnhandled = (reason) => {
    unhandled.push(reason)
  }
  process.on("unhandledRejection", onUnhandled)
  try {
    const result = await settle(
      withDaytonaGuestBrokerSdkSession(
        providerProcess,
        () => {},
        async () => {
          socket.emit("message", new Uint8Array(new SharedArrayBuffer(1)))
        },
      ),
    )
    await new Promise((resolve) => setImmediate(resolve))

    assertIntegrityFailure(result)
    assert.deepEqual(unhandled, [])
  } finally {
    process.off("unhandledRejection", onUnhandled)
  }
}

{
  const installation = digest("a1")
  const scope = digest("a2")
  const labelsJson = `{
    "__proto__":"metadata-entry",
    "constructor":"constructor-entry",
    "prototype":"prototype-entry",
    "hasna.installation_sha256":"${installation}",
    "hasna.provider_scope_ref_sha256":"${scope}",
    "hasna.ownership_nonce_sha256":"${digest("a3")}",
    "hasna.creation_token_sha256":"${digest("a4")}",
    "hasna.immutable_fingerprint_sha256":"${digest("a5")}",
    "hasna.network_policy_sha256":"${digest("a6")}"
  }`
  const e2bMetadata = JSON.parse(labelsJson)
  const daytonaLabels = JSON.parse(labelsJson)
  const daytonaEnv = JSON.parse(
    '{"__proto__":"credential-entry","constructor":"credential-entry","prototype":"credential-entry"}',
  )
  const objectPrototypeKeys = Reflect.ownKeys(Object.prototype)
  const attestation = {
    async attest() {
      return {
        source_free: true,
        credential_free: true,
        strong_vm: true,
        architecture: "amd64",
        evidence_sha256: digest("a7"),
      }
    },
  }
  const e2bInfo = {
    sandboxId: "special-key-e2b",
    templateId: "template-a",
    metadata: e2bMetadata,
    startedAt: new Date("2026-07-10T09:00:00.000Z"),
    endAt: new Date("2026-07-10T10:00:00.000Z"),
    state: "paused",
    cpuCount: 2,
    memoryMB: 1024,
    envdVersion: "pinned",
    allowInternetAccess: false,
    network: {
      allowOut: undefined,
      denyOut: ["0.0.0.0/0"],
      rules: undefined,
      allowPublicTraffic: false,
      maskRequestHost: undefined,
    },
    lifecycle: { onTimeout: "pause", autoResume: false },
    volumeMounts: [],
  }
  const e2b = new E2bOfficialSdkControlBridgeV1(
    {
      list() {
        throw new Error("list must remain unreachable")
      },
      async getInfo() {
        return e2bInfo
      },
    },
    attestation,
    installation,
    scope,
    () => "2026-07-10T10:00:00.000Z",
  )
  const daytonaSandbox = {
    id: "special-key-daytona",
    organizationId: "organization-a",
    user: "daytona",
    labels: daytonaLabels,
    state: "stopped",
    public: false,
    networkBlockAll: true,
    autoDeleteInterval: -1,
    volumes: [],
    env: daytonaEnv,
    createdAt: "2026-07-10T09:00:00.000Z",
    async refreshData() {},
  }
  const daytona = new DaytonaOfficialSdkControlBridgeV1(
    {
      list() {
        throw new Error("list must remain unreachable")
      },
      async get() {
        return daytonaSandbox
      },
    },
    attestation,
    installation,
    scope,
    () => "2026-07-10T10:00:00.000Z",
  )

  const e2bResource = await e2b.inspectResource("special-key-e2b")
  const daytonaResource = await daytona.inspectResource("special-key-daytona")

  assert.notEqual(e2bResource, "absent")
  assert.equal(e2bResource.owned, true)
  assert.match(canonicalJson(e2bMetadata), /"__proto__",\["string","metadata-entry"\]/)
  assert.equal(Object.hasOwn(e2bMetadata, "__proto__"), true)
  assert.equal(Object.getPrototypeOf(e2bMetadata), Object.prototype)
  assert.notEqual(daytonaResource, "absent")
  assert.equal(daytonaResource.credential_attached, true)
  assert.equal(Object.hasOwn(daytonaEnv, "__proto__"), true)
  assert.equal(Object.getPrototypeOf(daytonaEnv), Object.prototype)
  assert.deepEqual(Reflect.ownKeys(Object.prototype), objectPrototypeKeys)

  const e2bListCandidate = {
    sandboxId: e2bInfo.sandboxId,
    templateId: e2bInfo.templateId,
    metadata: e2bInfo.metadata,
    startedAt: e2bInfo.startedAt,
    endAt: e2bInfo.endAt,
    state: e2bInfo.state,
    cpuCount: e2bInfo.cpuCount,
    memoryMB: e2bInfo.memoryMB,
    envdVersion: e2bInfo.envdVersion,
    volumeMounts: e2bInfo.volumeMounts,
  }
  let listGetInfoCalls = 0
  const listE2b = new E2bOfficialSdkControlBridgeV1(
    {
      list() {
        return {
          hasNext: true,
          nextToken: undefined,
          async nextItems() {
            return [e2bListCandidate]
          },
        }
      },
      async getInfo(id) {
        listGetInfoCalls += 1
        assert.equal(id, e2bListCandidate.sandboxId)
        return e2bInfo
      },
    },
    attestation,
    installation,
    scope,
    () => "2026-07-10T10:00:00.000Z",
  )
  const listPage = await listE2b.listOwnedResources()
  assert.equal(listGetInfoCalls, 1)
  assert.equal(listPage.items.length, 1)
  assert.equal(listPage.items[0]?.opaque_resource_id, e2bInfo.sandboxId)

  let hydrationAttestationCalls = 0
  let oversizedGetInfoCalls = 0
  const hydrationAttestation = {
    async attest() {
      hydrationAttestationCalls += 1
      return {
        source_free: true,
        credential_free: true,
        strong_vm: true,
        architecture: "amd64",
        evidence_sha256: digest("98"),
      }
    },
  }
  const mismatchE2b = new E2bOfficialSdkControlBridgeV1(
    {
      list() {
        return {
          hasNext: true,
          nextToken: undefined,
          async nextItems() {
            return [e2bListCandidate]
          },
        }
      },
      async getInfo() {
        return {
          ...e2bInfo,
          metadata: {
            ...e2bInfo.metadata,
            "hasna.creation_token_sha256": digest("99"),
          },
        }
      },
    },
    hydrationAttestation,
    installation,
    scope,
    () => "2026-07-10T10:00:00.000Z",
  )
  await assert.rejects(
    mismatchE2b.listOwnedResources(),
    (error) => error instanceof AdapterContractError && error.code === "provider_state_unknown",
  )

  const oversizedE2b = new E2bOfficialSdkControlBridgeV1(
    {
      list() {
        return {
          hasNext: true,
          nextToken: undefined,
          async nextItems() {
            return Array.from({ length: 101 }, () => e2bListCandidate)
          },
        }
      },
      async getInfo() {
        oversizedGetInfoCalls += 1
        return e2bInfo
      },
    },
    hydrationAttestation,
    installation,
    scope,
    () => "2026-07-10T10:00:00.000Z",
  )
  await assert.rejects(
    oversizedE2b.listOwnedResources(),
    (error) => error instanceof AdapterContractError && error.code === "provider_state_unknown",
  )
  assert.equal(oversizedGetInfoCalls, 0)
  assert.equal(hydrationAttestationCalls, 0)

  let unsafeAttestationCalls = 0
  const unsafeNetworks = [
    { ...e2bInfo.network, allowOut: ["198.51.100.0/24"] },
    {
      ...e2bInfo.network,
      rules: {
        "api.example.test": [{ transform: { headers: { "x-test": "unsafe" } } }],
      },
    },
    { ...e2bInfo.network, allowPublicTraffic: true },
    { ...e2bInfo.network, maskRequestHost: "masked.example.test" },
  ]
  for (const network of unsafeNetworks) {
    const unsafeE2b = new E2bOfficialSdkControlBridgeV1(
      {
        list() {
          throw new Error("list must remain unreachable")
        },
        async getInfo() {
          return { ...e2bInfo, network }
        },
      },
      {
        async attest() {
          unsafeAttestationCalls += 1
          throw new Error("attestation must remain unreachable")
        },
      },
      installation,
      scope,
      () => "2026-07-10T10:00:00.000Z",
    )
    await assert.rejects(
      unsafeE2b.inspectResource("special-key-e2b"),
      (error) => error instanceof AdapterContractError && error.code === "integrity_failed",
    )
  }
  assert.equal(unsafeAttestationCalls, 0)
}

{
  assert.notEqual(canonicalSha256(1n), canonicalSha256({ $bigint: "1" }))
  assert.notEqual(canonicalSha256(new Uint8Array([1])), canonicalSha256({ $bytes_hex: "01" }))
  assert.notEqual(
    canonicalSha256(new TextEncoder().encode(canonicalJson({ value: 1 }))),
    canonicalSha256({ value: 1 }),
  )

  let getterCalls = 0
  const hostileArray = []
  Object.defineProperty(hostileArray, "0", {
    enumerable: true,
    get() {
      getterCalls += 1
      return "hostile"
    },
  })
  assert.throws(() => canonicalJson(hostileArray), /non_canonical_value/)
  assert.equal(getterCalls, 0)
}
