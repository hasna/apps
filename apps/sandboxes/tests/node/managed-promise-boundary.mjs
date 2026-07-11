import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { EventEmitter } from "node:events"
import { fileURLToPath } from "node:url"
import { runInNewContext } from "node:vm"
import { PtyHandle } from "@daytona/sdk"
import {
  AdapterContractError,
  DaytonaOfficialSdkControlBridgeV1,
  E2bOfficialSdkControlBridgeV1,
  canonicalJson,
  canonicalSha256,
  withDaytonaGuestBrokerSdkSession,
  withE2bGuestBrokerSdkSession,
} from "../../dist/adapters/managed/index.js"

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
    withE2bGuestBrokerSdkSession({ run: () => rawSetup }, async () => {}),
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
    withE2bGuestBrokerSdkSession({ run: () => rawSetup }, async () => {}),
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
      withE2bGuestBrokerSdkSession({ run: () => rawSetup }, async () => {}),
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
    withE2bGuestBrokerSdkSession({ run: () => rawSetup }, async () => {}),
  )
  assertIntegrityFailure(result)
  assert.equal(constructorGetterCalls, 0)
}

{
  const handle = brokerHandle()
  const rawSetup = Object.freeze(Promise.resolve(handle))
  const beforeKeys = Reflect.ownKeys(rawSetup)
  const wrapper = withE2bGuestBrokerSdkSession({ run: () => rawSetup }, async () => {})

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
