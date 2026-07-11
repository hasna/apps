import type { ListSandboxesQuery, Sandbox as DaytonaSandbox } from "@daytona/sdk"
import type { SandboxInfo, SandboxListOpts } from "e2b"
import { canonicalSha256, isDigest } from "./canonical"
import { AdapterContractError, adapterError } from "./errors"
import type {
  AdapterProviderResourceV1,
  Digest,
  FilePageV1,
  FileStatV1,
  FileWriteReceiptV1,
  GuestBrokerAttestationV1,
  GuestBrokerRequestFrameV1,
  ManagedGuestBrokerBootstrapCommandV1,
  ManagedProviderControlPortV1,
  ManagedProviderIdV1,
  NetworkPolicyObservationV1,
  NetworkPolicyV1,
  ProviderActivationOutcomeV1,
  ProviderCapabilitiesV1,
  ProviderCreateInertRequestV1,
  ProviderEffectTargetV1,
  ProviderExecHandleV1,
  ProviderFileReadChunkV1,
  ProviderMutationOutcomeV1,
  ProviderResourcePageV1,
} from "./types"

const PAGE_LIMIT = 100

const DISABLED_MUTATION_CAPABILITIES: ProviderCapabilitiesV1 = Object.freeze({
  exact_creation_token_lookup: true,
  create_stopped: false,
  creation_metadata_labels: true,
  network_policy_readback: false,
  typed_argv_exec: false,
  fixed_bootstrap_broker: false,
  typed_broker_frames: false,
  idempotent_activation_continuation: false,
  native_bounded_files: false,
  atomic_file_write: false,
  whole_guest_cancel: false,
  non_destructive_pause: false,
  stop_preserves_filesystem: false,
  conditional_destroy: false,
  locked_destroy_compensation: false,
  ownership_inventory: true,
})

export interface ManagedResourceAttestationV1 {
  source_free: boolean
  credential_free: boolean
  strong_vm: boolean
  architecture: "arm64" | "amd64"
  evidence_sha256: Digest
}

/** Trusted registry populated from reviewed image/account evidence, never provider labels alone. */
export interface ManagedResourceAttestationPortV1 {
  attest(input: {
    provider: ManagedProviderIdV1
    opaque_resource_id: string
    immutable_fingerprint_sha256: Digest
  }): Promise<ManagedResourceAttestationV1>
}

function label(labels: Record<string, string>, key: string): Digest {
  return (labels[key] ?? "") as Digest
}

function ownership(labels: Record<string, string>): AdapterProviderResourceV1["ownership"] {
  return {
    installation_id_sha256: label(labels, "hasna.installation_sha256"),
    provider_scope_ref_sha256: label(labels, "hasna.provider_scope_ref_sha256"),
    ownership_nonce_sha256: label(labels, "hasna.ownership_nonce_sha256"),
  }
}

function observationTime(observedAt: () => string): string {
  const value = observedAt()
  if (Number.isNaN(Date.parse(value))) throw adapterError("integrity_failed")
  return value
}

function snapshotAttestation(
  value: ManagedResourceAttestationV1,
): ManagedResourceAttestationV1 {
  try {
    const snapshot = {
      source_free: value?.source_free,
      credential_free: value?.credential_free,
      strong_vm: value?.strong_vm,
      architecture: value?.architecture,
      evidence_sha256: value?.evidence_sha256,
    }
    if (
      value === null ||
      typeof value !== "object" ||
      typeof snapshot.source_free !== "boolean" ||
      typeof snapshot.credential_free !== "boolean" ||
      typeof snapshot.strong_vm !== "boolean" ||
      !["arm64", "amd64"].includes(snapshot.architecture) ||
      !isDigest(snapshot.evidence_sha256)
    ) {
      throw adapterError("integrity_failed")
    }
    return Object.freeze(snapshot) as ManagedResourceAttestationV1
  } catch (cause) {
    throw adapterError("integrity_failed", { cause })
  }
}

interface StringRecordSnapshotV1 {
  ownKeyCount: number
  record: Readonly<Record<string, string>>
}

function snapshotStringRecord(value: unknown): StringRecordSnapshotV1 {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw adapterError("integrity_failed")
  }
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) {
    throw adapterError("integrity_failed")
  }
  const keys = Reflect.ownKeys(value)
  const snapshot = Object.create(null) as Record<string, string>
  for (const key of keys) {
    if (typeof key !== "string") throw adapterError("integrity_failed")
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    if (
      descriptor === undefined ||
      !descriptor.enumerable ||
      descriptor.get !== undefined ||
      descriptor.set !== undefined ||
      typeof descriptor.value !== "string"
    ) {
      throw adapterError("integrity_failed")
    }
    Object.defineProperty(snapshot, key, {
      enumerable: true,
      value: descriptor.value,
    })
  }
  return Object.freeze({
    ownKeyCount: keys.length,
    record: Object.freeze(snapshot),
  })
}

const MANAGED_RESOURCE_LABEL_KEYS = Object.freeze([
  "hasna.installation_sha256",
  "hasna.provider_scope_ref_sha256",
  "hasna.ownership_nonce_sha256",
  "hasna.creation_token_sha256",
  "hasna.immutable_fingerprint_sha256",
  "hasna.network_policy_sha256",
] as const)

function snapshotManagedResourceLabels(
  value: unknown,
): StringRecordSnapshotV1 {
  const snapshot = snapshotStringRecord(value)
  for (const key of MANAGED_RESOURCE_LABEL_KEYS) {
    if (!isDigest(snapshot.record[key])) throw adapterError("integrity_failed")
  }
  return snapshot
}

function snapshotExactDataObject(
  value: unknown,
  requiredKeys: readonly string[],
  optionalKeys: readonly string[] = [],
): Readonly<Record<string, unknown>> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw adapterError("integrity_failed")
  }
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) {
    throw adapterError("integrity_failed")
  }
  const keys = Reflect.ownKeys(value)
  if (
    keys.length < requiredKeys.length ||
    keys.length > requiredKeys.length + optionalKeys.length
  ) {
    throw adapterError("integrity_failed")
  }
  const snapshot = Object.create(null) as Record<string, unknown>
  for (const key of keys) {
    if (
      typeof key !== "string" ||
      (!requiredKeys.includes(key) && !optionalKeys.includes(key))
    ) {
      throw adapterError("integrity_failed")
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    if (
      descriptor === undefined ||
      !("value" in descriptor) ||
      !descriptor.enumerable
    ) {
      throw adapterError("integrity_failed")
    }
    Object.defineProperty(snapshot, key, {
      enumerable: true,
      value: descriptor.value,
    })
  }
  if (requiredKeys.some((key) => !Object.hasOwn(snapshot, key))) {
    throw adapterError("integrity_failed")
  }
  return Object.freeze(snapshot)
}

function snapshotBoundedDenseArray(value: unknown, maxLength: number): readonly unknown[] {
  if (!Array.isArray(value)) throw adapterError("integrity_failed")
  const lengthDescriptor = Object.getOwnPropertyDescriptor(value, "length")
  if (
    lengthDescriptor === undefined ||
    !("value" in lengthDescriptor) ||
    lengthDescriptor.enumerable ||
    typeof lengthDescriptor.value !== "number" ||
    !Number.isSafeInteger(lengthDescriptor.value) ||
    lengthDescriptor.value < 0 ||
    lengthDescriptor.value > maxLength
  ) {
    throw adapterError("integrity_failed")
  }
  const length = lengthDescriptor.value
  const keys = Reflect.ownKeys(value)
  if (keys.length !== length + 1 || !keys.includes("length")) {
    throw adapterError("integrity_failed")
  }
  const snapshot = new Array<unknown>(length)
  for (let index = 0; index < length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index))
    if (
      descriptor === undefined ||
      !("value" in descriptor) ||
      !descriptor.enumerable
    ) {
      throw adapterError("integrity_failed")
    }
    snapshot[index] = descriptor.value
  }
  return Object.freeze(snapshot)
}

function snapshotBoundedDataRecord(
  value: unknown,
  maxEntries: number,
): Readonly<Record<string, unknown>> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw adapterError("integrity_failed")
  }
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) {
    throw adapterError("integrity_failed")
  }
  const keys = Reflect.ownKeys(value)
  if (keys.length > maxEntries) throw adapterError("integrity_failed")
  const snapshot = Object.create(null) as Record<string, unknown>
  for (const key of keys) {
    if (
      typeof key !== "string" ||
      key.length === 0 ||
      key.length > 4096 ||
      /[\0-\x1f\x7f]/u.test(key)
    ) {
      throw adapterError("integrity_failed")
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    if (
      descriptor === undefined ||
      !("value" in descriptor) ||
      !descriptor.enumerable
    ) {
      throw adapterError("integrity_failed")
    }
    Object.defineProperty(snapshot, key, {
      enumerable: true,
      value: descriptor.value,
    })
  }
  return Object.freeze(snapshot)
}

function snapshotOptionalBoundedStrings(value: unknown): readonly string[] {
  if (value === undefined) return Object.freeze([])
  const values = snapshotBoundedDenseArray(value, PAGE_LIMIT)
  const snapshot: string[] = []
  for (const entry of values) {
    if (
      typeof entry !== "string" ||
      entry.length === 0 ||
      entry.length > 4096 ||
      /[\0-\x1f\x7f]/u.test(entry)
    ) {
      throw adapterError("integrity_failed")
    }
    snapshot.push(entry)
  }
  return Object.freeze(snapshot)
}

interface E2bNetworkRuleSnapshotV1 {
  readonly transformHeaders: Readonly<Record<string, string>> | undefined
}

interface E2bNetworkRulesEntrySnapshotV1 {
  readonly destination: string
  readonly rules: readonly E2bNetworkRuleSnapshotV1[]
}

function snapshotE2bNetworkRules(value: unknown): readonly E2bNetworkRulesEntrySnapshotV1[] {
  if (value === undefined) return Object.freeze([])
  const record = snapshotBoundedDataRecord(value, PAGE_LIMIT)
  const entries: E2bNetworkRulesEntrySnapshotV1[] = []
  for (const destination of Object.keys(record).sort()) {
    const ruleValues = snapshotBoundedDenseArray(record[destination], PAGE_LIMIT)
    const rules: E2bNetworkRuleSnapshotV1[] = []
    for (const ruleValue of ruleValues) {
      const rule = snapshotExactDataObject(ruleValue, [], ["transform"])
      let transformHeaders: Readonly<Record<string, string>> | undefined
      if (rule.transform !== undefined) {
        const transform = snapshotExactDataObject(rule.transform, [], ["headers"])
        if (transform.headers !== undefined) {
          const headerValues = snapshotBoundedDataRecord(transform.headers, PAGE_LIMIT)
          const headers = Object.create(null) as Record<string, string>
          for (const header of Object.keys(headerValues).sort()) {
            const headerValue = headerValues[header]
            if (typeof headerValue !== "string" || headerValue.length > 4096) {
              throw adapterError("integrity_failed")
            }
            Object.defineProperty(headers, header, {
              enumerable: true,
              value: headerValue,
            })
          }
          transformHeaders = Object.freeze(headers)
        }
      }
      rules.push(Object.freeze({ transformHeaders }))
    }
    entries.push(Object.freeze({ destination, rules: Object.freeze(rules) }))
  }
  return Object.freeze(entries)
}

function validateProviderNextToken(value: unknown): string | undefined {
  if (value === undefined) return undefined
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > 4096 ||
    /[\0-\x1f\x7f]/u.test(value)
  ) {
    throw adapterError("integrity_failed")
  }
  return value
}

function snapshotDateIso(value: unknown): string {
  if (value === null || typeof value !== "object" || Reflect.ownKeys(value).length !== 0) {
    throw adapterError("integrity_failed")
  }
  return Date.prototype.toISOString.call(value)
}

const E2B_INFO_REQUIRED_KEYS = Object.freeze([
  "sandboxId",
  "templateId",
  "metadata",
  "startedAt",
  "endAt",
  "state",
  "cpuCount",
  "memoryMB",
  "envdVersion",
] as const)

const E2B_INFO_OPTIONAL_KEYS = Object.freeze([
  "name",
  "allowInternetAccess",
  "network",
  "lifecycle",
  "volumeMounts",
  "sandboxDomain",
] as const)

const E2B_NETWORK_KEYS = Object.freeze([
  "allowOut",
  "denyOut",
  "rules",
  "allowPublicTraffic",
  "maskRequestHost",
] as const)

const E2B_LIST_CANDIDATE_REQUIRED_KEYS = Object.freeze([
  "sandboxId",
  "templateId",
  "metadata",
  "startedAt",
  "endAt",
  "state",
  "cpuCount",
  "memoryMB",
  "envdVersion",
  "volumeMounts",
] as const)

const E2B_LIST_CANDIDATE_OPTIONAL_KEYS = Object.freeze(["name"] as const)

interface E2bListCandidateSnapshotV1 {
  metadata: Readonly<Record<string, string>>
  sandboxId: string
  templateId: string
}

function snapshotE2bListCandidate(value: unknown): E2bListCandidateSnapshotV1 {
  const candidate = snapshotExactDataObject(
    value,
    E2B_LIST_CANDIDATE_REQUIRED_KEYS,
    E2B_LIST_CANDIDATE_OPTIONAL_KEYS,
  )
  if (
    typeof candidate.sandboxId !== "string" ||
    candidate.sandboxId.length === 0 ||
    candidate.sandboxId.length > 4096 ||
    /[\0-\x1f\x7f]/u.test(candidate.sandboxId) ||
    typeof candidate.templateId !== "string" ||
    candidate.templateId.length === 0 ||
    candidate.templateId.length > 4096 ||
    /[\0-\x1f\x7f]/u.test(candidate.templateId) ||
    (candidate.name !== undefined &&
      (typeof candidate.name !== "string" ||
        candidate.name.length > 4096 ||
        /[\0-\x1f\x7f]/u.test(candidate.name)))
  ) {
    throw adapterError("integrity_failed")
  }
  return Object.freeze({
    metadata: snapshotManagedResourceLabels(candidate.metadata).record,
    sandboxId: candidate.sandboxId,
    templateId: candidate.templateId,
  })
}

interface E2bSandboxInfoSnapshotV1 {
  allowInternetAccess: boolean | undefined
  lifecycleAutoResume: boolean | undefined
  lifecycleOnTimeout: "pause" | "kill" | undefined
  metadata: Readonly<Record<string, string>>
  networkDenyOut: readonly string[]
  sandboxId: string
  startedAt: string
  state: "running" | "paused"
  templateId: string
  volumeMountCount: number
}

function snapshotE2bSandboxInfo(info: unknown): E2bSandboxInfoSnapshotV1 {
  try {
    const root = snapshotExactDataObject(info, E2B_INFO_REQUIRED_KEYS, E2B_INFO_OPTIONAL_KEYS)
    const sandboxId = root.sandboxId
    const templateId = root.templateId
    const state = root.state
    const allowInternetAccess = root.allowInternetAccess
    const startedAt = snapshotDateIso(root.startedAt)
    snapshotDateIso(root.endAt)
    if (
      typeof sandboxId !== "string" ||
      sandboxId.length === 0 ||
      typeof templateId !== "string" ||
      typeof state !== "string" ||
      !["running", "paused"].includes(state) ||
      (allowInternetAccess !== undefined && typeof allowInternetAccess !== "boolean") ||
      typeof root.cpuCount !== "number" ||
      !Number.isFinite(root.cpuCount) ||
      typeof root.memoryMB !== "number" ||
      !Number.isFinite(root.memoryMB) ||
      typeof root.envdVersion !== "string" ||
      (root.name !== undefined && typeof root.name !== "string") ||
      (root.sandboxDomain !== undefined && typeof root.sandboxDomain !== "string")
    ) {
      throw adapterError("integrity_failed")
    }

    const network = snapshotExactDataObject(root.network, E2B_NETWORK_KEYS)
    const networkAllowOut = snapshotOptionalBoundedStrings(network.allowOut)
    const networkDenyOut = snapshotOptionalBoundedStrings(network.denyOut)
    const networkRules = snapshotE2bNetworkRules(network.rules)
    const networkAllowPublicTraffic = network.allowPublicTraffic
    const networkMaskRequestHost = network.maskRequestHost
    if (
      (networkAllowPublicTraffic !== undefined &&
        typeof networkAllowPublicTraffic !== "boolean") ||
      (networkMaskRequestHost !== undefined &&
        (typeof networkMaskRequestHost !== "string" ||
          networkMaskRequestHost.length > 4096 ||
          /[\0-\x1f\x7f]/u.test(networkMaskRequestHost)))
    ) {
      throw adapterError("integrity_failed")
    }
    if (
      allowInternetAccess !== false ||
      !networkDenyOut.includes("0.0.0.0/0") ||
      networkAllowOut.length !== 0 ||
      networkRules.length !== 0 ||
      networkAllowPublicTraffic !== false ||
      (networkMaskRequestHost !== undefined && networkMaskRequestHost.length !== 0)
    ) {
      throw adapterError("integrity_failed")
    }

    const lifecycle = root.lifecycle === undefined
      ? undefined
      : snapshotExactDataObject(root.lifecycle, ["onTimeout", "autoResume"])
    const lifecycleOnTimeout = lifecycle?.onTimeout
    const lifecycleAutoResume = lifecycle?.autoResume
    if (
      (lifecycleOnTimeout !== undefined &&
        (typeof lifecycleOnTimeout !== "string" ||
          !["pause", "kill"].includes(lifecycleOnTimeout))) ||
      (lifecycleAutoResume !== undefined && typeof lifecycleAutoResume !== "boolean")
    ) {
      throw adapterError("integrity_failed")
    }

    const volumeMountValues = root.volumeMounts === undefined
      ? Object.freeze([])
      : snapshotBoundedDenseArray(root.volumeMounts, PAGE_LIMIT)
    const volumeMounts: Array<Readonly<{ name: string; path: string }>> = []
    for (const value of volumeMountValues) {
      const mount = snapshotExactDataObject(value, ["name", "path"])
      if (typeof mount.name !== "string" || typeof mount.path !== "string") {
        throw adapterError("integrity_failed")
      }
      volumeMounts.push(Object.freeze({ name: mount.name, path: mount.path }))
    }
    return Object.freeze({
      allowInternetAccess,
      lifecycleAutoResume: lifecycleAutoResume as boolean | undefined,
      lifecycleOnTimeout: lifecycleOnTimeout as "pause" | "kill" | undefined,
      metadata: snapshotManagedResourceLabels(root.metadata).record,
      networkDenyOut,
      sandboxId,
      startedAt,
      state: state as "running" | "paused",
      templateId,
      volumeMountCount: volumeMounts.length,
    })
  } catch (cause) {
    throw adapterError("integrity_failed", { cause })
  }
}

interface DaytonaSandboxSnapshotV1 {
  autoDeleteInterval: number | undefined
  createdAt: string
  env: Readonly<Record<string, string>>
  envEntryCount: number
  id: string
  labels: Readonly<Record<string, string>>
  networkBlockAll: boolean | undefined
  organizationId: string
  public: boolean
  state: string | undefined
  volumeCount: number
}

const DAYTONA_SNAPSHOT_OWN_FIELDS = Object.freeze([
  "id",
  "organizationId",
  "state",
  "public",
  "networkBlockAll",
  "autoDeleteInterval",
  "createdAt",
  "volumes",
  "env",
  "labels",
] as const)

function snapshotDaytonaOwnDataValue(
  sandbox: DaytonaSandbox,
  key: typeof DAYTONA_SNAPSHOT_OWN_FIELDS[number],
): unknown {
  let descriptor: PropertyDescriptor | undefined
  try {
    descriptor = Object.getOwnPropertyDescriptor(sandbox, key)
  } catch (cause) {
    throw adapterError("integrity_failed", { cause })
  }
  if (descriptor === undefined) return undefined
  if (!("value" in descriptor) || descriptor.get !== undefined || descriptor.set !== undefined) {
    throw adapterError("integrity_failed")
  }
  return descriptor.value
}

function snapshotDaytonaSandbox(
  sandbox: DaytonaSandbox,
  expectedId?: string,
): DaytonaSandboxSnapshotV1 {
  try {
    const id = snapshotDaytonaOwnDataValue(sandbox, "id")
    const organizationId = snapshotDaytonaOwnDataValue(sandbox, "organizationId")
    const state = snapshotDaytonaOwnDataValue(sandbox, "state")
    const isPublic = snapshotDaytonaOwnDataValue(sandbox, "public")
    const networkBlockAll = snapshotDaytonaOwnDataValue(sandbox, "networkBlockAll")
    const autoDeleteInterval = snapshotDaytonaOwnDataValue(sandbox, "autoDeleteInterval")
    const createdAt = snapshotDaytonaOwnDataValue(sandbox, "createdAt")
    const volumes = snapshotDaytonaOwnDataValue(sandbox, "volumes")
    if (
      typeof id !== "string" ||
      id.length === 0 ||
      (expectedId !== undefined && id !== expectedId) ||
      typeof organizationId !== "string" ||
      organizationId.length === 0 ||
      (state !== undefined && typeof state !== "string") ||
      typeof isPublic !== "boolean" ||
      (networkBlockAll !== undefined && typeof networkBlockAll !== "boolean") ||
      (autoDeleteInterval !== undefined &&
        (typeof autoDeleteInterval !== "number" || !Number.isFinite(autoDeleteInterval))) ||
      typeof createdAt !== "string" ||
      Number.isNaN(Date.parse(createdAt)) ||
      (volumes !== undefined && !Array.isArray(volumes))
    ) {
      throw adapterError("integrity_failed")
    }
    const env = snapshotStringRecord(snapshotDaytonaOwnDataValue(sandbox, "env") ?? {})
    const labels = snapshotManagedResourceLabels(
      snapshotDaytonaOwnDataValue(sandbox, "labels"),
    )
    return Object.freeze({
      autoDeleteInterval,
      createdAt,
      env: env.record,
      envEntryCount: env.ownKeyCount,
      id,
      labels: labels.record,
      networkBlockAll,
      organizationId,
      public: isPublic,
      state,
      volumeCount: volumes?.length ?? 0,
    })
  } catch (cause) {
    throw adapterError("integrity_failed", { cause })
  }
}

interface DaytonaSandboxCandidateSnapshotV1 {
  expectedId: string
  expectedLabels: Readonly<Record<string, string>>
  refreshData: DaytonaSandbox["refreshData"]
  sandbox: DaytonaSandbox
}

function snapshotDaytonaRefreshData(
  sandbox: DaytonaSandbox,
): DaytonaSandbox["refreshData"] {
  let current: object | null = sandbox
  for (let depth = 0; depth < 8 && current !== null; depth += 1) {
    let descriptor: PropertyDescriptor | undefined
    try {
      descriptor = Object.getOwnPropertyDescriptor(current, "refreshData")
    } catch (cause) {
      throw adapterError("integrity_failed", { cause })
    }
    if (descriptor !== undefined) {
      if (
        !("value" in descriptor) ||
        descriptor.get !== undefined ||
        descriptor.set !== undefined ||
        typeof descriptor.value !== "function"
      ) {
        throw adapterError("integrity_failed")
      }
      return descriptor.value as DaytonaSandbox["refreshData"]
    }
    try {
      current = Object.getPrototypeOf(current)
    } catch (cause) {
      throw adapterError("integrity_failed", { cause })
    }
  }
  throw adapterError("integrity_failed")
}

function snapshotDaytonaSandboxCandidate(
  sandbox: DaytonaSandbox,
  expectedId?: string,
): DaytonaSandboxCandidateSnapshotV1 {
  try {
    const id = snapshotDaytonaOwnDataValue(sandbox, "id")
    if (
      typeof id !== "string" ||
      id.length === 0 ||
      (expectedId !== undefined && id !== expectedId)
    ) {
      throw adapterError("integrity_failed")
    }
    const expectedLabels = snapshotManagedResourceLabels(
      snapshotDaytonaOwnDataValue(sandbox, "labels"),
    ).record
    for (const key of DAYTONA_SNAPSHOT_OWN_FIELDS) {
      snapshotDaytonaOwnDataValue(sandbox, key)
    }
    return Object.freeze({
      expectedId: id,
      expectedLabels,
      refreshData: snapshotDaytonaRefreshData(sandbox),
      sandbox,
    })
  } catch (cause) {
    throw adapterError("integrity_failed", { cause })
  }
}

function providerSdkUnavailable(cause: unknown): AdapterContractError {
  return adapterError("provider_unavailable", { retryable: true, cause })
}

function unknownNetworkObservation(observedAt: string): NetworkPolicyObservationV1 {
  return {
    mode: "deny_all",
    policy_sha256: canonicalSha256({ observation: "unverified_provider_network" }),
    enforced_outside_guest: false,
    public_ingress: true,
    dns_denied: false,
    observed_at: observedAt,
  }
}

abstract class ReadOnlyOfficialSdkControlBridge implements ManagedProviderControlPortV1 {
  abstract readonly provider_id: ManagedProviderIdV1
  readonly capabilities: ProviderCapabilitiesV1 = DISABLED_MUTATION_CAPABILITIES

  abstract findByCreationToken(token: Digest, cursor?: string): Promise<ProviderResourcePageV1>
  abstract inspectResource(opaqueResourceId: string): Promise<AdapterProviderResourceV1 | "absent">
  abstract listOwnedResources(cursor?: string): Promise<ProviderResourcePageV1>

  createInert(_request: ProviderCreateInertRequestV1): Promise<AdapterProviderResourceV1> {
    return Promise.reject(adapterError("unsupported_runtime_feature"))
  }

  applyNetworkPolicy(
    _opaqueResourceId: string,
    _policy: NetworkPolicyV1,
    _target: ProviderEffectTargetV1,
  ): Promise<NetworkPolicyObservationV1> {
    return Promise.reject(adapterError("unsupported_runtime_feature"))
  }

  activateResource(_opaqueResourceId: string, _target: ProviderEffectTargetV1): Promise<AdapterProviderResourceV1> {
    return Promise.reject(adapterError("unsupported_runtime_feature"))
  }

  pauseOrStopResource(_opaqueResourceId: string, _target: ProviderEffectTargetV1): Promise<AdapterProviderResourceV1> {
    return Promise.reject(adapterError("unsupported_runtime_feature"))
  }

  destroyResource(
    _opaqueResourceId: string,
    _expectedVersion: string,
    _target: ProviderEffectTargetV1,
  ): Promise<void> {
    return Promise.reject(adapterError("unsupported_runtime_feature"))
  }

  bootstrapGuestBroker(
    _opaqueResourceId: string,
    _command: ManagedGuestBrokerBootstrapCommandV1,
    _expectedFingerprint: Digest,
    _target: ProviderEffectTargetV1,
  ): Promise<GuestBrokerAttestationV1> {
    return Promise.reject(adapterError("unsupported_runtime_feature"))
  }

  inspectGuestBroker(_opaqueResourceId: string): Promise<GuestBrokerAttestationV1 | "absent"> {
    return Promise.resolve("absent")
  }

  activateCompensated(
    _opaqueResourceId: string,
    _policy: NetworkPolicyV1,
    _command: ManagedGuestBrokerBootstrapCommandV1,
    _expectedFingerprint: Digest,
    _target: ProviderEffectTargetV1,
  ): Promise<ProviderActivationOutcomeV1> {
    return Promise.reject(adapterError("unsupported_runtime_feature"))
  }

  startExec(
    _opaqueResourceId: string,
    _broker: GuestBrokerAttestationV1,
    _frame: GuestBrokerRequestFrameV1,
    _target: ProviderEffectTargetV1,
  ): Promise<ProviderExecHandleV1> {
    return Promise.reject(adapterError("unsupported_runtime_feature"))
  }

  cancelExec(
    _opaqueResourceId: string,
    _broker: GuestBrokerAttestationV1,
    _frame: GuestBrokerRequestFrameV1,
    _target: ProviderEffectTargetV1,
  ): Promise<{ whole_guest_scope_terminated: boolean }> {
    return Promise.reject(adapterError("unsupported_runtime_feature"))
  }

  statFile(
    _opaqueResourceId: string,
    _broker: GuestBrokerAttestationV1,
    _frame: GuestBrokerRequestFrameV1,
  ): Promise<FileStatV1> {
    return Promise.reject(adapterError("unsupported_runtime_feature"))
  }

  async *readFile(
    _opaqueResourceId: string,
    _broker: GuestBrokerAttestationV1,
    _frame: GuestBrokerRequestFrameV1,
  ): AsyncIterable<ProviderFileReadChunkV1> {
    throw adapterError("unsupported_runtime_feature")
  }

  writeFileAtomic(
    _opaqueResourceId: string,
    _broker: GuestBrokerAttestationV1,
    _frame: GuestBrokerRequestFrameV1,
    _target: ProviderEffectTargetV1,
  ): Promise<FileWriteReceiptV1> {
    return Promise.reject(adapterError("unsupported_runtime_feature"))
  }

  listFiles(
    _opaqueResourceId: string,
    _broker: GuestBrokerAttestationV1,
    _frame: GuestBrokerRequestFrameV1,
  ): Promise<FilePageV1> {
    return Promise.reject(adapterError("unsupported_runtime_feature"))
  }

  lookupOperation(_target: ProviderEffectTargetV1): Promise<ProviderMutationOutcomeV1> {
    return Promise.resolve("unknown")
  }
}

export interface E2bOfficialReadSdkV1 {
  list(options: SandboxListOpts): {
    readonly hasNext: boolean
    readonly nextToken: string | undefined
    nextItems(): Promise<SandboxInfo[]>
  }
  getInfo(opaqueResourceId: string): Promise<SandboxInfo | "absent">
}

export class E2bOfficialSdkControlBridgeV1 extends ReadOnlyOfficialSdkControlBridge {
  readonly provider_id = "e2b" as const
  readonly #sdk: E2bOfficialReadSdkV1
  readonly #attestation: ManagedResourceAttestationPortV1
  readonly #installationSha256: Digest
  readonly #providerScopeRefSha256: Digest
  readonly #observedAt: () => string

  constructor(
    sdk: E2bOfficialReadSdkV1,
    attestation: ManagedResourceAttestationPortV1,
    installationSha256: Digest,
    providerScopeRefSha256: Digest,
    observedAt: () => string,
  ) {
    super()
    if (
      !isDigest(installationSha256) ||
      !isDigest(providerScopeRefSha256) ||
      typeof observedAt !== "function"
    ) {
      throw adapterError("validation_failed")
    }
    this.#sdk = sdk
    this.#attestation = attestation
    this.#installationSha256 = installationSha256
    this.#providerScopeRefSha256 = providerScopeRefSha256
    this.#observedAt = observedAt
  }

  async #mapSnapshot(snapshot: E2bSandboxInfoSnapshotV1): Promise<AdapterProviderResourceV1> {
    const observedAt = observationTime(this.#observedAt)
    const fingerprint = label(snapshot.metadata, "hasna.immutable_fingerprint_sha256")
    const attestation = snapshotAttestation(await this.#attestation.attest({
      provider: this.provider_id,
      opaque_resource_id: snapshot.sandboxId,
      immutable_fingerprint_sha256: fingerprint,
    }))
    return {
      opaque_resource_id: snapshot.sandboxId,
      provider_creation_token_sha256: label(snapshot.metadata, "hasna.creation_token_sha256"),
      immutable_fingerprint_sha256: fingerprint,
      provider_created_at: snapshot.startedAt,
      provider_resource_version: canonicalSha256({
        sandbox_id: snapshot.sandboxId,
        template_id: snapshot.templateId,
        started_at: snapshot.startedAt,
      }),
      state: snapshot.state === "paused" ? "inert" : "unknown",
      provider_runtime_state: snapshot.state === "paused" ? "paused" : "unknown",
      network_policy: {
        mode: "deny_all",
        policy_sha256: label(snapshot.metadata, "hasna.network_policy_sha256"),
        enforced_outside_guest: true,
        public_ingress: false,
        dns_denied: true,
        observed_at: observedAt,
      },
      auto_delete_disabled:
        snapshot.lifecycleOnTimeout === "pause" && !snapshot.lifecycleAutoResume,
      ephemeral: false,
      owned:
        attestation.strong_vm &&
        label(snapshot.metadata, "hasna.installation_sha256") === this.#installationSha256 &&
        label(snapshot.metadata, "hasna.provider_scope_ref_sha256") ===
          this.#providerScopeRefSha256,
      source_attached: !attestation.source_free || snapshot.volumeMountCount !== 0,
      credential_attached: !attestation.credential_free,
      guest_broker_bootstrapped: false,
      ownership: ownership(snapshot.metadata),
    }
  }

  async #page(options: SandboxListOpts): Promise<ProviderResourcePageV1> {
    let paginator: ReturnType<E2bOfficialReadSdkV1["list"]>
    try {
      paginator = this.#sdk.list(options)
    } catch (cause) {
      throw providerSdkUnavailable(cause)
    }
    let hasNext: unknown
    let nextItems: unknown
    try {
      hasNext = paginator?.hasNext
      nextItems = paginator?.nextItems
    } catch (cause) {
      throw adapterError("provider_state_unknown", { quarantineRequired: true, cause })
    }
    if (typeof hasNext !== "boolean" || typeof nextItems !== "function") {
      throw adapterError("provider_state_unknown", { quarantineRequired: true })
    }
    if (!hasNext) {
      try {
        validateProviderNextToken(paginator.nextToken)
      } catch (cause) {
        throw adapterError("provider_state_unknown", { quarantineRequired: true, cause })
      }
      return { items: [] }
    }

    let providerResult: unknown
    try {
      providerResult = await Reflect.apply(nextItems, paginator, [])
    } catch (cause) {
      throw providerSdkUnavailable(cause)
    }
    let providerItems: readonly unknown[]
    let nextToken: string | undefined
    try {
      providerItems = snapshotBoundedDenseArray(providerResult, PAGE_LIMIT)
      nextToken = validateProviderNextToken(paginator.nextToken)
    } catch (cause) {
      throw adapterError("provider_state_unknown", { quarantineRequired: true, cause })
    }
    const candidates: E2bListCandidateSnapshotV1[] = []
    const seenIds = new Set<string>()
    try {
      for (const info of providerItems) {
        const candidate = snapshotE2bListCandidate(info)
        if (seenIds.has(candidate.sandboxId)) {
          throw adapterError("integrity_failed")
        }
        seenIds.add(candidate.sandboxId)
        candidates.push(candidate)
      }
    } catch (cause) {
      throw adapterError("provider_state_unknown", { quarantineRequired: true, cause })
    }

    const hydrated: E2bSandboxInfoSnapshotV1[] = []
    for (const candidate of candidates) {
      let info: Awaited<ReturnType<E2bOfficialReadSdkV1["getInfo"]>>
      try {
        info = await this.#sdk.getInfo(candidate.sandboxId)
      } catch (cause) {
        throw providerSdkUnavailable(cause)
      }
      if (info === "absent") {
        throw adapterError("provider_state_unknown", { quarantineRequired: true })
      }
      let snapshot: E2bSandboxInfoSnapshotV1
      try {
        snapshot = snapshotE2bSandboxInfo(info)
      } catch (cause) {
        throw adapterError("provider_state_unknown", { quarantineRequired: true, cause })
      }
      if (
        snapshot.sandboxId !== candidate.sandboxId ||
        snapshot.templateId !== candidate.templateId ||
        MANAGED_RESOURCE_LABEL_KEYS.some(
          (key) => snapshot.metadata[key] !== candidate.metadata[key],
        )
      ) {
        throw adapterError("provider_state_unknown", { quarantineRequired: true })
      }
      hydrated.push(snapshot)
    }

    const items: AdapterProviderResourceV1[] = []
    for (const snapshot of hydrated) {
      items.push(await this.#mapSnapshot(snapshot))
    }
    return { items, ...(nextToken === undefined ? {} : { next_cursor: nextToken }) }
  }

  findByCreationToken(token: Digest, cursor?: string): Promise<ProviderResourcePageV1> {
    return this.#page({
      query: {
        metadata: {
          "hasna.installation_sha256": this.#installationSha256,
          "hasna.provider_scope_ref_sha256": this.#providerScopeRefSha256,
          "hasna.creation_token_sha256": token,
        },
      },
      limit: PAGE_LIMIT,
      ...(cursor === undefined ? {} : { nextToken: cursor }),
    })
  }

  async inspectResource(opaqueResourceId: string): Promise<AdapterProviderResourceV1 | "absent"> {
    let info: Awaited<ReturnType<E2bOfficialReadSdkV1["getInfo"]>>
    try {
      info = await this.#sdk.getInfo(opaqueResourceId)
    } catch (cause) {
      throw providerSdkUnavailable(cause)
    }
    if (info === "absent") return "absent"
    const snapshot = snapshotE2bSandboxInfo(info)
    if (snapshot.sandboxId !== opaqueResourceId) throw adapterError("integrity_failed")
    return this.#mapSnapshot(snapshot)
  }

  listOwnedResources(cursor?: string): Promise<ProviderResourcePageV1> {
    return this.#page({
      query: {
        metadata: {
          "hasna.installation_sha256": this.#installationSha256,
          "hasna.provider_scope_ref_sha256": this.#providerScopeRefSha256,
        },
      },
      limit: PAGE_LIMIT,
      ...(cursor === undefined ? {} : { nextToken: cursor }),
    })
  }
}

export interface DaytonaOfficialReadSdkV1 {
  list(query: ListSandboxesQuery): AsyncIterable<DaytonaSandbox>
  get(opaqueResourceId: string): Promise<DaytonaSandbox | "absent">
}

export class DaytonaOfficialSdkControlBridgeV1 extends ReadOnlyOfficialSdkControlBridge {
  readonly provider_id = "daytona_cloud" as const
  readonly #sdk: DaytonaOfficialReadSdkV1
  readonly #attestation: ManagedResourceAttestationPortV1
  readonly #installationSha256: Digest
  readonly #providerScopeRefSha256: Digest
  readonly #observedAt: () => string

  constructor(
    sdk: DaytonaOfficialReadSdkV1,
    attestation: ManagedResourceAttestationPortV1,
    installationSha256: Digest,
    providerScopeRefSha256: Digest,
    observedAt: () => string,
  ) {
    super()
    if (
      !isDigest(installationSha256) ||
      !isDigest(providerScopeRefSha256) ||
      typeof observedAt !== "function"
    ) {
      throw adapterError("validation_failed")
    }
    this.#sdk = sdk
    this.#attestation = attestation
    this.#installationSha256 = installationSha256
    this.#providerScopeRefSha256 = providerScopeRefSha256
    this.#observedAt = observedAt
  }

  async #refreshSnapshot(
    candidate: DaytonaSandboxCandidateSnapshotV1,
  ): Promise<DaytonaSandboxSnapshotV1> {
    try {
      await Reflect.apply(candidate.refreshData, candidate.sandbox, [])
    } catch (cause) {
      throw providerSdkUnavailable(cause)
    }
    const snapshot = snapshotDaytonaSandbox(candidate.sandbox, candidate.expectedId)
    if (
      MANAGED_RESOURCE_LABEL_KEYS.some(
        (key) => snapshot.labels[key] !== candidate.expectedLabels[key],
      )
    ) {
      throw adapterError("integrity_failed")
    }
    return snapshot
  }

  async #mapSnapshot(snapshot: DaytonaSandboxSnapshotV1): Promise<AdapterProviderResourceV1> {
    const observedAt = observationTime(this.#observedAt)
    const fingerprint = label(snapshot.labels, "hasna.immutable_fingerprint_sha256")
    const attestation = snapshotAttestation(await this.#attestation.attest({
      provider: this.provider_id,
      opaque_resource_id: snapshot.id,
      immutable_fingerprint_sha256: fingerprint,
    }))
    const stopped = snapshot.state === "stopped" || snapshot.state === "paused"
    const denyAll = snapshot.networkBlockAll === true && snapshot.public === false
    return {
      opaque_resource_id: snapshot.id,
      provider_creation_token_sha256: label(snapshot.labels, "hasna.creation_token_sha256"),
      immutable_fingerprint_sha256: fingerprint,
      provider_created_at: snapshot.createdAt,
      provider_resource_version: canonicalSha256({
        sandbox_id: snapshot.id,
        created_at: snapshot.createdAt,
        organization_id: snapshot.organizationId,
      }),
      state: stopped ? "inert" : "unknown",
      provider_runtime_state:
        stopped ? (snapshot.state === "paused" ? "paused" : "stopped") : "unknown",
      network_policy: denyAll
        ? {
            mode: "deny_all",
            policy_sha256: label(snapshot.labels, "hasna.network_policy_sha256"),
            enforced_outside_guest: true,
            public_ingress: false,
            dns_denied: true,
            observed_at: observedAt,
          }
        : unknownNetworkObservation(observedAt),
      auto_delete_disabled: (snapshot.autoDeleteInterval ?? 0) < 0,
      ephemeral: snapshot.autoDeleteInterval === 0,
      owned:
        attestation.strong_vm &&
        label(snapshot.labels, "hasna.installation_sha256") === this.#installationSha256 &&
        label(snapshot.labels, "hasna.provider_scope_ref_sha256") ===
          this.#providerScopeRefSha256,
      source_attached: !attestation.source_free || snapshot.volumeCount !== 0,
      credential_attached:
        !attestation.credential_free || snapshot.envEntryCount !== 0,
      guest_broker_bootstrapped: false,
      ownership: ownership(snapshot.labels),
    }
  }

  async #list(query: ListSandboxesQuery, cursor?: string): Promise<ProviderResourcePageV1> {
    if (cursor !== undefined) throw adapterError("unsupported_runtime_feature")
    let providerIterable: AsyncIterable<DaytonaSandbox>
    try {
      providerIterable = this.#sdk.list(query)
    } catch (cause) {
      throw providerSdkUnavailable(cause)
    }
    const providerItems: DaytonaSandbox[] = []
    let pageLimitExceeded = false
    try {
      for await (const sandbox of providerIterable) {
        if (providerItems.length >= PAGE_LIMIT) {
          pageLimitExceeded = true
          break
        }
        providerItems.push(sandbox)
      }
    } catch (cause) {
      throw providerSdkUnavailable(cause)
    }
    if (pageLimitExceeded) {
      throw adapterError("provider_state_unknown", { quarantineRequired: true })
    }

    const candidates: DaytonaSandboxCandidateSnapshotV1[] = []
    const seenIds = new Set<string>()
    try {
      for (const sandbox of providerItems) {
        const candidate = snapshotDaytonaSandboxCandidate(sandbox)
        if (seenIds.has(candidate.expectedId)) throw adapterError("integrity_failed")
        seenIds.add(candidate.expectedId)
        candidates.push(candidate)
      }
    } catch (cause) {
      throw adapterError("provider_state_unknown", { quarantineRequired: true, cause })
    }

    const refreshedSnapshots: DaytonaSandboxSnapshotV1[] = []
    for (const candidate of candidates) {
      try {
        refreshedSnapshots.push(await this.#refreshSnapshot(candidate))
      } catch (cause) {
        if (
          cause instanceof AdapterContractError &&
          cause.code === "provider_unavailable"
        ) {
          throw cause
        }
        throw adapterError("provider_state_unknown", { quarantineRequired: true, cause })
      }
    }
    const items: AdapterProviderResourceV1[] = []
    for (const snapshot of refreshedSnapshots) {
      items.push(await this.#mapSnapshot(snapshot))
    }
    return { items }
  }

  findByCreationToken(token: Digest, cursor?: string): Promise<ProviderResourcePageV1> {
    return this.#list(
      {
        labels: {
          "hasna.installation_sha256": this.#installationSha256,
          "hasna.provider_scope_ref_sha256": this.#providerScopeRefSha256,
          "hasna.creation_token_sha256": token,
        },
        limit: PAGE_LIMIT,
      },
      cursor,
    )
  }

  async inspectResource(opaqueResourceId: string): Promise<AdapterProviderResourceV1 | "absent"> {
    let sandbox: Awaited<ReturnType<DaytonaOfficialReadSdkV1["get"]>>
    try {
      sandbox = await this.#sdk.get(opaqueResourceId)
    } catch (cause) {
      throw providerSdkUnavailable(cause)
    }
    if (sandbox === "absent") return "absent"
    const candidate = snapshotDaytonaSandboxCandidate(sandbox, opaqueResourceId)
    return this.#mapSnapshot(await this.#refreshSnapshot(candidate))
  }

  listOwnedResources(cursor?: string): Promise<ProviderResourcePageV1> {
    return this.#list(
      {
        labels: {
          "hasna.installation_sha256": this.#installationSha256,
          "hasna.provider_scope_ref_sha256": this.#providerScopeRefSha256,
        },
        limit: PAGE_LIMIT,
      },
      cursor,
    )
  }
}
