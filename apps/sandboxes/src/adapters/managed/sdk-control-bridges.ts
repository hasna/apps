import type { ListSandboxesQuery, Sandbox as DaytonaSandbox } from "@daytona/sdk"
import type { SandboxInfo, SandboxListOpts } from "e2b"
import { canonicalSha256, isDigest } from "./canonical"
import { AdapterContractError, adapterError } from "./errors"
import { buildE2bCreateOptions, type SafeE2bCreateOptionsV1 } from "./sdk-pins"
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

const E2B_TEMPLATE_MAPPING_LABEL_KEYS = Object.freeze([
  "hasna.e2b_template_id",
  "hasna.e2b_template_mapping_version",
  "hasna.e2b_template_mapping_sha256",
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
  cpuCount: number
  endAt: string
  lifecycleAutoResume: boolean | undefined
  lifecycleOnTimeout: "pause" | "kill" | undefined
  metadata: Readonly<Record<string, string>>
  networkDenyAll: boolean
  networkDenyOut: readonly string[]
  memoryMB: number
  sandboxId: string
  startedAt: string
  state: "running" | "paused"
  templateId: string
  templateMappingSha256: Digest | undefined
  templateMappingVersion: string | undefined
  volumeMountCount: number
}

function snapshotE2bSandboxInfo(
  info: unknown,
  requireDenyAllReadback = true,
  requireTemplateMappingConsistency = true,
  requirePositiveResourceFacts = true,
): E2bSandboxInfoSnapshotV1 {
  try {
    const root = snapshotExactDataObject(info, E2B_INFO_REQUIRED_KEYS, E2B_INFO_OPTIONAL_KEYS)
    const sandboxId = root.sandboxId
    const templateId = root.templateId
    const state = root.state
    const allowInternetAccess = root.allowInternetAccess
    const startedAt = snapshotDateIso(root.startedAt)
    const endAt = snapshotDateIso(root.endAt)
    const observedCpuMillis =
      typeof root.cpuCount === "number" ? root.cpuCount * 1_000 : Number.NaN
    const observedMemoryBytes =
      typeof root.memoryMB === "number" ? root.memoryMB * 1024 * 1024 : Number.NaN
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
      (requirePositiveResourceFacts &&
        (!Number.isSafeInteger(observedCpuMillis) ||
          observedCpuMillis <= 0 ||
          !Number.isSafeInteger(observedMemoryBytes) ||
          observedMemoryBytes <= 0)) ||
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
    const networkDenyAll =
      allowInternetAccess !== false ||
      !networkDenyOut.includes("0.0.0.0/0") ||
      networkAllowOut.length !== 0 ||
      networkRules.length !== 0 ||
      networkAllowPublicTraffic !== false ||
      (networkMaskRequestHost !== undefined && networkMaskRequestHost.length !== 0)
        ? false
        : true
    if (requireDenyAllReadback && !networkDenyAll) {
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

    const metadata = snapshotManagedResourceLabels(root.metadata).record
    const metadataTemplateId = metadata["hasna.e2b_template_id"]
    const templateMappingVersion = metadata["hasna.e2b_template_mapping_version"]
    const templateMappingSha256 = metadata["hasna.e2b_template_mapping_sha256"]
    const mappingFieldCount = [
      metadataTemplateId,
      templateMappingVersion,
      templateMappingSha256,
    ].filter((value) => value !== undefined).length
    if (requireTemplateMappingConsistency && (
      (mappingFieldCount !== 0 && mappingFieldCount !== 3) ||
      (mappingFieldCount === 3 &&
        (!safeProviderString(metadataTemplateId) ||
          metadataTemplateId !== templateId ||
          !safeProviderString(templateMappingVersion) ||
          !isDigest(templateMappingSha256)))
    )) {
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
      cpuCount: root.cpuCount as number,
      endAt,
      lifecycleAutoResume: lifecycleAutoResume as boolean | undefined,
      lifecycleOnTimeout: lifecycleOnTimeout as "pause" | "kill" | undefined,
      metadata,
      memoryMB: root.memoryMB as number,
      networkDenyAll,
      networkDenyOut,
      sandboxId,
      startedAt,
      state: state as "running" | "paused",
      templateId,
      templateMappingSha256: templateMappingSha256 as Digest | undefined,
      templateMappingVersion,
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
  get capabilities(): ProviderCapabilitiesV1 {
    return DISABLED_MUTATION_CAPABILITIES
  }

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

/**
 * Credential-bound E2B 2.31.0 control surface. Implementations bind credentials in
 * the injected closures; the bridge deliberately has no API-key or ambient-config
 * option on any method.
 */
export interface E2bOfficialLifecycleSdkV1 extends E2bOfficialReadSdkV1 {
  create?(options: SafeE2bCreateOptionsV1): Promise<unknown>
  connect?(opaqueResourceId: string, options: { timeoutMs: number }): Promise<unknown>
  pause?(opaqueResourceId: string, options: { keepMemory: false }): Promise<boolean>
  updateNetwork?(
    opaqueResourceId: string,
    update: { allowInternetAccess: false; denyOut: readonly ["0.0.0.0/0"] },
  ): Promise<void>
  kill?(opaqueResourceId: string): Promise<boolean>
}

export interface E2bTemplateMappingV1 {
  schema_version: "sandboxes.e2b-template-mapping/v1"
  image_or_snapshot_sha256: Digest
  template_id: string
  mapping_version: string
  mapping_sha256: Digest
}

export interface E2bTemplateMappingPortV1 {
  resolve(imageOrSnapshotSha256: Digest): E2bTemplateMappingV1 | "absent"
}

export function e2bTemplateMappingSha256(
  mapping: Omit<E2bTemplateMappingV1, "mapping_sha256">,
): Digest {
  return canonicalSha256({
    schema_version: mapping.schema_version,
    image_or_snapshot_sha256: mapping.image_or_snapshot_sha256,
    template_id: mapping.template_id,
    mapping_version: mapping.mapping_version,
  })
}

function snapshotTemplateMappingResolve(
  port: E2bTemplateMappingPortV1 | undefined,
): E2bTemplateMappingPortV1["resolve"] | undefined {
  if (port === undefined) return undefined
  let descriptor: PropertyDescriptor | undefined
  try {
    descriptor = Object.getOwnPropertyDescriptor(port, "resolve")
  } catch (cause) {
    throw adapterError("validation_failed", { cause })
  }
  if (
    descriptor === undefined ||
    !("value" in descriptor) ||
    descriptor.get !== undefined ||
    descriptor.set !== undefined ||
    typeof descriptor.value !== "function"
  ) {
    throw adapterError("validation_failed")
  }
  return descriptor.value as E2bTemplateMappingPortV1["resolve"]
}

function snapshotE2bTemplateMapping(
  value: unknown,
  expectedImageOrSnapshotSha256: Digest,
): E2bTemplateMappingV1 {
  try {
    const mapping = snapshotExactDataObject(value, [
      "schema_version",
      "image_or_snapshot_sha256",
      "template_id",
      "mapping_version",
      "mapping_sha256",
    ])
    const snapshot = Object.freeze({
      schema_version: mapping.schema_version,
      image_or_snapshot_sha256: mapping.image_or_snapshot_sha256,
      template_id: mapping.template_id,
      mapping_version: mapping.mapping_version,
      mapping_sha256: mapping.mapping_sha256,
    }) as E2bTemplateMappingV1
    if (
      snapshot.schema_version !== "sandboxes.e2b-template-mapping/v1" ||
      snapshot.image_or_snapshot_sha256 !== expectedImageOrSnapshotSha256 ||
      !isDigest(snapshot.image_or_snapshot_sha256) ||
      !safeProviderString(snapshot.template_id) ||
      !safeProviderString(snapshot.mapping_version) ||
      !isDigest(snapshot.mapping_sha256) ||
      snapshot.mapping_sha256 !== e2bTemplateMappingSha256({
        schema_version: snapshot.schema_version,
        image_or_snapshot_sha256: snapshot.image_or_snapshot_sha256,
        template_id: snapshot.template_id,
        mapping_version: snapshot.mapping_version,
      })
    ) {
      throw adapterError("integrity_failed")
    }
    return snapshot
  } catch (cause) {
    if (cause instanceof AdapterContractError && cause.code === "integrity_failed") throw cause
    throw adapterError("integrity_failed", { cause })
  }
}

type E2bSdkMethodNameV1 =
  | "list"
  | "getInfo"
  | "create"
  | "connect"
  | "pause"
  | "updateNetwork"
  | "kill"

function snapshotOptionalOwnSdkMethod<K extends E2bSdkMethodNameV1>(
  sdk: E2bOfficialLifecycleSdkV1,
  key: K,
): E2bOfficialLifecycleSdkV1[K] | undefined {
  let descriptor: PropertyDescriptor | undefined
  try {
    descriptor = Object.getOwnPropertyDescriptor(sdk, key)
  } catch (cause) {
    throw adapterError("validation_failed", { cause })
  }
  if (descriptor === undefined) return undefined
  if (
    !("value" in descriptor) ||
    descriptor.get !== undefined ||
    descriptor.set !== undefined ||
    typeof descriptor.value !== "function"
  ) {
    throw adapterError("validation_failed")
  }
  return descriptor.value as E2bOfficialLifecycleSdkV1[K]
}

function snapshotRequiredOwnSdkMethod<K extends "list" | "getInfo">(
  sdk: E2bOfficialLifecycleSdkV1,
  key: K,
): E2bOfficialLifecycleSdkV1[K] {
  const method = snapshotOptionalOwnSdkMethod(sdk, key)
  if (method === undefined) throw adapterError("validation_failed")
  return method
}

function snapshotE2bCreatedSandboxId(value: unknown): string {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw adapterError("integrity_failed")
  }
  let descriptor: PropertyDescriptor | undefined
  try {
    descriptor = Object.getOwnPropertyDescriptor(value, "sandboxId")
  } catch (cause) {
    throw adapterError("integrity_failed", { cause })
  }
  if (
    descriptor === undefined ||
    !("value" in descriptor) ||
    descriptor.get !== undefined ||
    descriptor.set !== undefined ||
    typeof descriptor.value !== "string" ||
    descriptor.value.length === 0 ||
    descriptor.value.length > 4096 ||
    /[\0-\x1f\x7f]/u.test(descriptor.value)
  ) {
    throw adapterError("integrity_failed")
  }
  return descriptor.value
}

const E2B_TARGET_KEYS = Object.freeze([
  "operation_id",
  "operation_digest",
  "operation_step_id",
  "resource_id",
  "resource_lifecycle_generation",
  "provider_idempotency_token_sha256",
  "provider_creation_token_sha256",
  "immutable_fingerprint_sha256",
  "authorization_consumption_receipt_sha256",
] as const)

const E2B_SPEC_KEYS = Object.freeze([
  "schema_version",
  "run_id",
  "attempt_id",
  "source",
  "environment",
  "runtime_class",
  "architecture",
  "workspace_root",
  "network_policy",
  "resources",
  "exec_concurrency",
  "max_runtime_ms",
  "expires_at",
  "data_class",
  "input_bundle_refs",
] as const)

interface E2bCreateRequestSnapshotV1 {
  readonly cpuMillis: number
  readonly imageOrSnapshotSha256: Digest
  readonly maxRuntimeMs: number
  readonly memoryBytes: number
  readonly metadata: Readonly<{
    installation_sha256: Digest
    provider_scope_ref_sha256: Digest
    ownership_nonce_sha256: Digest
    creation_token_sha256: Digest
    immutable_fingerprint_sha256: Digest
  }>
  readonly networkPolicySha256: Digest
  readonly ownershipNonceSha256: Digest
  readonly target: ProviderEffectTargetV1
}

function safeProviderString(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 4096 &&
    !/[\0-\x1f\x7f]/u.test(value)
  )
}

function snapshotE2bCreateRequest(
  request: ProviderCreateInertRequestV1,
): E2bCreateRequestSnapshotV1 {
  try {
    const root = snapshotExactDataObject(request, [
      "target",
      "spec",
      "allocation_key_sha256",
      "ownership",
      "initial_network_policy",
    ])
    const target = snapshotExactDataObject(root.target, E2B_TARGET_KEYS)
    const spec = snapshotExactDataObject(root.spec, E2B_SPEC_KEYS)
    const source = snapshotExactDataObject(spec.source, [
      "repository_ref",
      "commit_sha",
      "source_bundle_sha256",
    ])
    const environment = snapshotExactDataObject(spec.environment, [
      "image_or_snapshot_sha256",
      "toolchain_manifest_sha256",
    ])
    const resources = snapshotExactDataObject(spec.resources, [
      "cpu_millis",
      "memory_bytes",
      "disk_bytes",
      "pids",
      "open_files",
      "output_bytes",
    ])
    const ownershipValue = snapshotExactDataObject(root.ownership, [
      "installation_id",
      "provider_scope_ref",
      "ownership_nonce",
    ])
    const initialPolicy = snapshotExactDataObject(root.initial_network_policy, [
      "mode",
      "policy_sha256",
    ])
    const requestedPolicy = snapshotExactDataObject(spec.network_policy, [
      "mode",
      "policy_sha256",
    ])
    const inputBundleRefs = snapshotBoundedDenseArray(spec.input_bundle_refs, PAGE_LIMIT)
    for (const input of inputBundleRefs) {
      const snapshot = snapshotExactDataObject(input, ["sha256", "size_bytes"])
      if (
        !isDigest(snapshot.sha256) ||
        typeof snapshot.size_bytes !== "number" ||
        !Number.isSafeInteger(snapshot.size_bytes) ||
        snapshot.size_bytes < 0
      ) {
        throw adapterError("validation_failed")
      }
    }
    const stringTargetKeys = ["operation_id", "operation_step_id", "resource_id"] as const
    const digestTargetKeys = [
      "operation_digest",
      "provider_idempotency_token_sha256",
      "provider_creation_token_sha256",
      "immutable_fingerprint_sha256",
      "authorization_consumption_receipt_sha256",
    ] as const
    if (
      stringTargetKeys.some((key) => !safeProviderString(target[key])) ||
      digestTargetKeys.some((key) => !isDigest(target[key])) ||
      typeof target.resource_lifecycle_generation !== "bigint" ||
      target.resource_lifecycle_generation < 1n ||
      !isDigest(root.allocation_key_sha256) ||
      !safeProviderString(ownershipValue.installation_id) ||
      !safeProviderString(ownershipValue.provider_scope_ref) ||
      !safeProviderString(ownershipValue.ownership_nonce) ||
      initialPolicy.mode !== "deny_all" ||
      !isDigest(initialPolicy.policy_sha256) ||
      !["deny_all", "broker_only"].includes(requestedPolicy.mode as string) ||
      !isDigest(requestedPolicy.policy_sha256) ||
      spec.schema_version !== "sandboxes.runtime/v1" ||
      !safeProviderString(spec.run_id) ||
      !safeProviderString(spec.attempt_id) ||
      !safeProviderString(source.repository_ref) ||
      !safeProviderString(source.commit_sha) ||
      !isDigest(source.source_bundle_sha256) ||
      !isDigest(environment.image_or_snapshot_sha256) ||
      !isDigest(environment.toolchain_manifest_sha256) ||
      spec.runtime_class !== "strong_vm" ||
      !["arm64", "amd64"].includes(spec.architecture as string) ||
      spec.workspace_root !== "/workspace" ||
      spec.exec_concurrency !== 1 ||
      typeof spec.max_runtime_ms !== "number" ||
      !Number.isSafeInteger(spec.max_runtime_ms) ||
      spec.max_runtime_ms <= 0 ||
      spec.max_runtime_ms > 86_400_000 ||
      typeof spec.expires_at !== "string" ||
      Number.isNaN(Date.parse(spec.expires_at)) ||
      !["public", "internal_non_sensitive", "restricted"].includes(spec.data_class as string) ||
      Object.values(resources).some(
        (value) =>
          typeof value !== "number" ||
          !Number.isSafeInteger(value) ||
          value <= 0,
      )
    ) {
      throw adapterError("validation_failed")
    }

    const targetSnapshot = Object.freeze({
      operation_id: target.operation_id,
      operation_digest: target.operation_digest,
      operation_step_id: target.operation_step_id,
      resource_id: target.resource_id,
      resource_lifecycle_generation: target.resource_lifecycle_generation,
      provider_idempotency_token_sha256: target.provider_idempotency_token_sha256,
      provider_creation_token_sha256: target.provider_creation_token_sha256,
      immutable_fingerprint_sha256: target.immutable_fingerprint_sha256,
      authorization_consumption_receipt_sha256:
        target.authorization_consumption_receipt_sha256,
    }) as ProviderEffectTargetV1
    const metadata = Object.freeze({
      installation_sha256: canonicalSha256(ownershipValue.installation_id),
      provider_scope_ref_sha256: canonicalSha256(ownershipValue.provider_scope_ref),
      ownership_nonce_sha256: canonicalSha256(ownershipValue.ownership_nonce),
      creation_token_sha256: targetSnapshot.provider_creation_token_sha256,
      immutable_fingerprint_sha256: targetSnapshot.immutable_fingerprint_sha256,
    })
    return Object.freeze({
      cpuMillis: resources.cpu_millis as number,
      imageOrSnapshotSha256: environment.image_or_snapshot_sha256 as Digest,
      maxRuntimeMs: spec.max_runtime_ms as number,
      memoryBytes: resources.memory_bytes as number,
      metadata,
      networkPolicySha256: initialPolicy.policy_sha256 as Digest,
      ownershipNonceSha256: metadata.ownership_nonce_sha256,
      target: targetSnapshot,
    })
  } catch (cause) {
    if (cause instanceof AdapterContractError && cause.code === "validation_failed") throw cause
    throw adapterError("validation_failed", { cause })
  }
}

export class E2bOfficialSdkControlBridgeV1 extends ReadOnlyOfficialSdkControlBridge {
  readonly provider_id = "e2b" as const
  readonly #sdk: E2bOfficialLifecycleSdkV1
  readonly #list: E2bOfficialLifecycleSdkV1["list"]
  readonly #getInfo: E2bOfficialLifecycleSdkV1["getInfo"]
  readonly #create: E2bOfficialLifecycleSdkV1["create"]
  readonly #connect: E2bOfficialLifecycleSdkV1["connect"]
  readonly #pause: E2bOfficialLifecycleSdkV1["pause"]
  readonly #updateNetwork: E2bOfficialLifecycleSdkV1["updateNetwork"]
  readonly #kill: E2bOfficialLifecycleSdkV1["kill"]
  readonly #templateMappingPort: E2bTemplateMappingPortV1 | undefined
  readonly #resolveTemplate: E2bTemplateMappingPortV1["resolve"] | undefined
  readonly #capabilities: ProviderCapabilitiesV1
  readonly #attestation: ManagedResourceAttestationPortV1
  readonly #installationSha256: Digest
  readonly #providerScopeRefSha256: Digest
  readonly #observedAt: () => string

  constructor(
    sdk: E2bOfficialLifecycleSdkV1,
    attestation: ManagedResourceAttestationPortV1,
    installationSha256: Digest,
    providerScopeRefSha256: Digest,
    observedAt: () => string,
    templateMappingPort?: E2bTemplateMappingPortV1,
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
    this.#list = snapshotRequiredOwnSdkMethod(sdk, "list")
    this.#getInfo = snapshotRequiredOwnSdkMethod(sdk, "getInfo")
    this.#create = snapshotOptionalOwnSdkMethod(sdk, "create")
    this.#connect = snapshotOptionalOwnSdkMethod(sdk, "connect")
    this.#pause = snapshotOptionalOwnSdkMethod(sdk, "pause")
    this.#updateNetwork = snapshotOptionalOwnSdkMethod(sdk, "updateNetwork")
    this.#kill = snapshotOptionalOwnSdkMethod(sdk, "kill")
    this.#templateMappingPort = templateMappingPort
    this.#resolveTemplate = snapshotTemplateMappingResolve(templateMappingPort)
    this.#capabilities = Object.freeze({
      ...DISABLED_MUTATION_CAPABILITIES,
      // This port capability describes the adapter-visible postcondition. E2B
      // has no native create-stopped call; create -> exact readback -> pause is
      // the compensation, while OFFICIAL_SDK_CONTRACT_GAPS keeps that native
      // provider limitation explicit and production admission remains disabled.
      create_stopped:
        this.#create !== undefined &&
        this.#pause !== undefined &&
        this.#kill !== undefined &&
        this.#resolveTemplate !== undefined,
      network_policy_readback: true,
      idempotent_activation_continuation: this.#connect !== undefined,
      stop_preserves_filesystem: this.#pause !== undefined,
      locked_destroy_compensation: this.#kill !== undefined,
    })
    this.#attestation = attestation
    this.#installationSha256 = installationSha256
    this.#providerScopeRefSha256 = providerScopeRefSha256
    this.#observedAt = observedAt
  }

  override get capabilities(): ProviderCapabilitiesV1 {
    return this.#capabilities
  }

  #resourceVersion(snapshot: E2bSandboxInfoSnapshotV1): string {
    const identity = {
      sandbox_id: snapshot.sandboxId,
      template_id: snapshot.templateId,
      started_at: snapshot.startedAt,
      observed_cpu_millis: snapshot.cpuCount * 1_000,
      observed_memory_bytes: snapshot.memoryMB * 1024 * 1024,
    }
    if (
      snapshot.templateMappingSha256 === undefined ||
      snapshot.templateMappingVersion === undefined
    ) {
      return canonicalSha256(identity)
    }
    return canonicalSha256({
      ...identity,
      template_mapping_version: snapshot.templateMappingVersion,
      template_mapping_sha256: snapshot.templateMappingSha256,
    })
  }

  #resolveTemplateMapping(imageOrSnapshotSha256: Digest): E2bTemplateMappingV1 {
    if (this.#resolveTemplate === undefined || this.#templateMappingPort === undefined) {
      throw adapterError("unsupported_runtime_feature")
    }
    let value: unknown
    try {
      value = Reflect.apply(this.#resolveTemplate, this.#templateMappingPort, [
        imageOrSnapshotSha256,
      ])
    } catch (cause) {
      throw adapterError("integrity_failed", { cause })
    }
    if (value === "absent") throw adapterError("validation_failed")
    return snapshotE2bTemplateMapping(value, imageOrSnapshotSha256)
  }

  async #ownedSnapshot(snapshot: E2bSandboxInfoSnapshotV1): Promise<{
    attestation: ManagedResourceAttestationV1
    owned: boolean
  }> {
    const fingerprint = label(snapshot.metadata, "hasna.immutable_fingerprint_sha256")
    const attestation = snapshotAttestation(await this.#attestation.attest({
      provider: this.provider_id,
      opaque_resource_id: snapshot.sandboxId,
      immutable_fingerprint_sha256: fingerprint,
    }))
    return {
      attestation,
      owned:
        attestation.strong_vm &&
        label(snapshot.metadata, "hasna.installation_sha256") === this.#installationSha256 &&
        label(snapshot.metadata, "hasna.provider_scope_ref_sha256") ===
          this.#providerScopeRefSha256,
    }
  }

  async #mapSnapshot(snapshot: E2bSandboxInfoSnapshotV1): Promise<AdapterProviderResourceV1> {
    if (!snapshot.networkDenyAll) throw adapterError("integrity_failed")
    const observedAt = observationTime(this.#observedAt)
    const fingerprint = label(snapshot.metadata, "hasna.immutable_fingerprint_sha256")
    const { attestation, owned } = await this.#ownedSnapshot(snapshot)
    return {
      opaque_resource_id: snapshot.sandboxId,
      provider_creation_token_sha256: label(snapshot.metadata, "hasna.creation_token_sha256"),
      immutable_fingerprint_sha256: fingerprint,
      provider_created_at: snapshot.startedAt,
      provider_resource_version: this.#resourceVersion(snapshot),
      state: snapshot.state === "paused" ? "inert" : "active",
      provider_runtime_state: snapshot.state === "paused" ? "paused" : "active",
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
      owned,
      source_attached: !attestation.source_free || snapshot.volumeMountCount !== 0,
      credential_attached: !attestation.credential_free,
      guest_broker_bootstrapped: false,
      ownership: ownership(snapshot.metadata),
    }
  }

  async #page(options: SandboxListOpts): Promise<ProviderResourcePageV1> {
    let paginator: ReturnType<E2bOfficialReadSdkV1["list"]>
    try {
      paginator = Reflect.apply(this.#list, this.#sdk, [options])
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
        info = await Reflect.apply(this.#getInfo, this.#sdk, [candidate.sandboxId])
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
        [...MANAGED_RESOURCE_LABEL_KEYS, ...E2B_TEMPLATE_MAPPING_LABEL_KEYS].some(
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

  async #getSnapshot(
    opaqueResourceId: string,
    requireDenyAllReadback = true,
    requireTemplateMappingConsistency = true,
    requirePositiveResourceFacts = true,
  ): Promise<E2bSandboxInfoSnapshotV1 | "absent"> {
    let info: Awaited<ReturnType<E2bOfficialReadSdkV1["getInfo"]>>
    try {
      info = await Reflect.apply(this.#getInfo, this.#sdk, [opaqueResourceId])
    } catch (cause) {
      throw providerSdkUnavailable(cause)
    }
    if (info === "absent") return "absent"
    const snapshot = snapshotE2bSandboxInfo(
      info,
      requireDenyAllReadback,
      requireTemplateMappingConsistency,
      requirePositiveResourceFacts,
    )
    if (snapshot.sandboxId !== opaqueResourceId) throw adapterError("integrity_failed")
    return snapshot
  }

  async #assertExactSnapshot(
    snapshot: E2bSandboxInfoSnapshotV1,
    target: ProviderEffectTargetV1,
    expectedVersion?: string,
    expectedOwnershipNonceSha256?: Digest,
  ): Promise<void> {
    const { owned } = await this.#ownedSnapshot(snapshot)
    if (
      !owned ||
      label(snapshot.metadata, "hasna.creation_token_sha256") !==
        target.provider_creation_token_sha256 ||
      label(snapshot.metadata, "hasna.immutable_fingerprint_sha256") !==
        target.immutable_fingerprint_sha256 ||
      (expectedOwnershipNonceSha256 !== undefined &&
        label(snapshot.metadata, "hasna.ownership_nonce_sha256") !==
          expectedOwnershipNonceSha256) ||
      (expectedVersion !== undefined && this.#resourceVersion(snapshot) !== expectedVersion)
    ) {
      throw adapterError("operation_target_mismatch")
    }
  }

  async #creationTokenIsAbsent(token: Digest): Promise<boolean> {
    const page = await this.findByCreationToken(token)
    return page.items.length === 0 && page.next_cursor === undefined
  }

  async #cleanupCreatedCandidate(
    opaqueResourceId: string,
    request: E2bCreateRequestSnapshotV1,
    _mapping: E2bTemplateMappingV1,
  ): Promise<boolean> {
    if (this.#kill === undefined) return false
    try {
      const snapshot = await this.#getSnapshot(opaqueResourceId, false, false, false)
      if (snapshot === "absent") {
        return this.#creationTokenIsAbsent(request.target.provider_creation_token_sha256)
      }
      await this.#assertExactSnapshot(
        snapshot,
        request.target,
        this.#resourceVersion(snapshot),
        request.ownershipNonceSha256,
      )
      await Reflect.apply(this.#kill, this.#sdk, [opaqueResourceId])
      return (
        (await this.#getSnapshot(opaqueResourceId, false, false, false)) === "absent" &&
        (await this.#creationTokenIsAbsent(request.target.provider_creation_token_sha256))
      )
    } catch {
      return false
    }
  }

  async #finishCreateInert(
    opaqueResourceId: string,
    request: E2bCreateRequestSnapshotV1,
    mapping: E2bTemplateMappingV1,
  ): Promise<AdapterProviderResourceV1> {
    let before = await this.#getSnapshot(opaqueResourceId)
    if (before === "absent") {
      throw adapterError("provider_state_unknown", { quarantineRequired: true })
    }
    await this.#assertExactSnapshot(
      before,
      request.target,
      undefined,
      request.ownershipNonceSha256,
    )
    if (
      before.templateId !== mapping.template_id ||
      before.templateMappingVersion !== mapping.mapping_version ||
      before.templateMappingSha256 !== mapping.mapping_sha256 ||
      label(before.metadata, "hasna.network_policy_sha256") !== request.networkPolicySha256 ||
      before.cpuCount * 1_000 > request.cpuMillis ||
      before.memoryMB * 1024 * 1024 > request.memoryBytes
    ) {
      throw adapterError("operation_target_mismatch")
    }
    if (before.state === "running") {
      if (this.#pause === undefined) throw adapterError("unsupported_runtime_feature")
      let pauseFailure: unknown
      try {
        const result: unknown = await Reflect.apply(this.#pause, this.#sdk, [
          opaqueResourceId,
          { keepMemory: false },
        ])
        if (typeof result !== "boolean") throw adapterError("integrity_failed")
      } catch (cause) {
        pauseFailure = cause
      }
      before = await this.#getSnapshot(opaqueResourceId)
      if (before === "absent" || before.state !== "paused") {
        throw adapterError("provider_state_unknown", {
          quarantineRequired: true,
          cause: pauseFailure,
        })
      }
      if (pauseFailure instanceof AdapterContractError && pauseFailure.code === "integrity_failed") {
        throw adapterError("provider_state_unknown", {
          quarantineRequired: true,
          cause: pauseFailure,
        })
      }
    }
    await this.#assertExactSnapshot(
      before,
      request.target,
      undefined,
      request.ownershipNonceSha256,
    )
    if (
      before.state !== "paused" ||
      before.templateId !== mapping.template_id ||
      before.templateMappingVersion !== mapping.mapping_version ||
      before.templateMappingSha256 !== mapping.mapping_sha256 ||
      label(before.metadata, "hasna.network_policy_sha256") !== request.networkPolicySha256 ||
      before.cpuCount * 1_000 > request.cpuMillis ||
      before.memoryMB * 1024 * 1024 > request.memoryBytes
    ) {
      throw adapterError("provider_state_unknown", { quarantineRequired: true })
    }
    return this.#mapSnapshot(before)
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

  override async createInert(
    requestValue: ProviderCreateInertRequestV1,
  ): Promise<AdapterProviderResourceV1> {
    if (!this.#capabilities.create_stopped || this.#create === undefined) {
      throw adapterError("unsupported_runtime_feature")
    }
    const request = snapshotE2bCreateRequest(requestValue)
    const mapping = this.#resolveTemplateMapping(request.imageOrSnapshotSha256)
    const baseCreateOptions = buildE2bCreateOptions({
      template: mapping.template_id,
      metadata: request.metadata,
      network_policy_sha256: request.networkPolicySha256,
      max_runtime_ms: request.maxRuntimeMs,
    })
    const createOptions: SafeE2bCreateOptionsV1 = {
      ...baseCreateOptions,
      metadata: {
        ...baseCreateOptions.metadata,
        "hasna.e2b_template_id": mapping.template_id,
        "hasna.e2b_template_mapping_version": mapping.mapping_version,
        "hasna.e2b_template_mapping_sha256": mapping.mapping_sha256,
      },
    }
    let opaqueResourceId: string | undefined
    try {
      const created = await Reflect.apply(this.#create, this.#sdk, [createOptions])
      opaqueResourceId = snapshotE2bCreatedSandboxId(created)
    } catch (createCause) {
      try {
        const page = await this.findByCreationToken(
          request.target.provider_creation_token_sha256,
        )
        if (page.next_cursor !== undefined || page.items.length !== 1) {
          throw adapterError("provider_state_unknown", { quarantineRequired: true })
        }
        const candidate = page.items[0]
        if (candidate === undefined) throw adapterError("integrity_failed")
        if (
          !candidate.owned ||
          candidate.provider_creation_token_sha256 !==
            request.target.provider_creation_token_sha256 ||
          candidate.immutable_fingerprint_sha256 !==
            request.target.immutable_fingerprint_sha256 ||
          candidate.ownership.ownership_nonce_sha256 !== request.ownershipNonceSha256
        ) {
          throw adapterError("provider_state_unknown", { quarantineRequired: true })
        }
        opaqueResourceId = candidate.opaque_resource_id
      } catch (reconcileCause) {
        throw adapterError("provider_state_unknown", {
          quarantineRequired: true,
          cause: reconcileCause ?? createCause,
        })
      }
    }

    try {
      return await this.#finishCreateInert(opaqueResourceId, request, mapping)
    } catch (cause) {
      await this.#cleanupCreatedCandidate(opaqueResourceId, request, mapping)
      throw adapterError("provider_state_unknown", {
        quarantineRequired: true,
        cause,
      })
    }
  }

  async inspectResource(opaqueResourceId: string): Promise<AdapterProviderResourceV1 | "absent"> {
    const snapshot = await this.#getSnapshot(opaqueResourceId)
    if (snapshot === "absent") return "absent"
    return this.#mapSnapshot(snapshot)
  }

  override async applyNetworkPolicy(
    opaqueResourceId: string,
    policy: NetworkPolicyV1,
    target: ProviderEffectTargetV1,
  ): Promise<NetworkPolicyObservationV1> {
    if (policy.mode !== "deny_all") throw adapterError("unsupported_runtime_feature")
    if (!isDigest(policy.policy_sha256)) throw adapterError("validation_failed")
    const before = await this.#getSnapshot(opaqueResourceId)
    if (before === "absent") {
      throw adapterError("provider_state_unknown", { quarantineRequired: true })
    }
    await this.#assertExactSnapshot(before, target)
    if (label(before.metadata, "hasna.network_policy_sha256") !== policy.policy_sha256) {
      throw adapterError("operation_target_mismatch")
    }
    if (this.#updateNetwork === undefined) throw adapterError("unsupported_runtime_feature")
    try {
      await Reflect.apply(this.#updateNetwork, this.#sdk, [
        opaqueResourceId,
        { allowInternetAccess: false, denyOut: ["0.0.0.0/0"] },
      ])
    } catch {
      // Readback below is authoritative for the desired idempotent state.
    }
    let after: E2bSandboxInfoSnapshotV1 | "absent"
    try {
      after = await this.#getSnapshot(opaqueResourceId)
      if (after === "absent") throw adapterError("integrity_failed")
      await this.#assertExactSnapshot(after, target)
    } catch (cause) {
      throw adapterError("provider_state_unknown", { quarantineRequired: true, cause })
    }
    if (label(after.metadata, "hasna.network_policy_sha256") !== policy.policy_sha256) {
      throw adapterError("provider_state_unknown", { quarantineRequired: true })
    }
    return (await this.#mapSnapshot(after)).network_policy
  }

  override async activateResource(
    opaqueResourceId: string,
    target: ProviderEffectTargetV1,
  ): Promise<AdapterProviderResourceV1> {
    let before = await this.#getSnapshot(opaqueResourceId)
    if (before === "absent") {
      throw adapterError("provider_state_unknown", { quarantineRequired: true })
    }
    await this.#assertExactSnapshot(before, target)
    if (before.state === "running") return this.#mapSnapshot(before)
    if (this.#connect === undefined) throw adapterError("unsupported_runtime_feature")

    const remainingMs = Date.parse(before.endAt) - Date.parse(observationTime(this.#observedAt))
    if (!Number.isSafeInteger(remainingMs) || remainingMs <= 0) {
      throw adapterError("provider_state_unknown", { quarantineRequired: true })
    }
    let connectFailure: unknown
    try {
      const connected = await Reflect.apply(this.#connect, this.#sdk, [
        opaqueResourceId,
        { timeoutMs: remainingMs },
      ])
      if (snapshotE2bCreatedSandboxId(connected) !== opaqueResourceId) {
        throw adapterError("integrity_failed")
      }
    } catch (cause) {
      connectFailure = cause
    }
    try {
      before = await this.#getSnapshot(opaqueResourceId)
      if (before === "absent") throw adapterError("integrity_failed")
      await this.#assertExactSnapshot(before, target)
      if (before.state !== "running" || connectFailure instanceof AdapterContractError) {
        throw adapterError("integrity_failed")
      }
      return await this.#mapSnapshot(before)
    } catch (cause) {
      throw adapterError("provider_state_unknown", {
        quarantineRequired: true,
        cause: connectFailure ?? cause,
      })
    }
  }

  override async pauseOrStopResource(
    opaqueResourceId: string,
    target: ProviderEffectTargetV1,
  ): Promise<AdapterProviderResourceV1> {
    let before = await this.#getSnapshot(opaqueResourceId)
    if (before === "absent") {
      throw adapterError("provider_state_unknown", { quarantineRequired: true })
    }
    await this.#assertExactSnapshot(before, target)
    if (before.state === "paused") return this.#mapSnapshot(before)
    if (this.#pause === undefined) throw adapterError("unsupported_runtime_feature")

    let pauseFailure: unknown
    try {
      const paused: unknown = await Reflect.apply(this.#pause, this.#sdk, [
        opaqueResourceId,
        { keepMemory: false },
      ])
      if (typeof paused !== "boolean") throw adapterError("integrity_failed")
    } catch (cause) {
      pauseFailure = cause
    }
    try {
      before = await this.#getSnapshot(opaqueResourceId)
      if (before === "absent") throw adapterError("integrity_failed")
      await this.#assertExactSnapshot(before, target)
      if (before.state !== "paused" || pauseFailure instanceof AdapterContractError) {
        throw adapterError("integrity_failed")
      }
      return await this.#mapSnapshot(before)
    } catch (cause) {
      throw adapterError("provider_state_unknown", {
        quarantineRequired: true,
        cause: pauseFailure ?? cause,
      })
    }
  }

  override async destroyResource(
    opaqueResourceId: string,
    expectedVersion: string,
    target: ProviderEffectTargetV1,
  ): Promise<void> {
    const before = await this.#getSnapshot(opaqueResourceId)
    if (before === "absent") {
      try {
        if (await this.#creationTokenIsAbsent(target.provider_creation_token_sha256)) return
      } catch (cause) {
        throw adapterError("provider_state_unknown", { quarantineRequired: true, cause })
      }
      throw adapterError("provider_state_unknown", { quarantineRequired: true })
    }
    await this.#assertExactSnapshot(before, target, expectedVersion)
    if (this.#kill === undefined) throw adapterError("unsupported_runtime_feature")

    try {
      const killed: unknown = await Reflect.apply(this.#kill, this.#sdk, [opaqueResourceId])
      if (typeof killed !== "boolean") throw adapterError("integrity_failed")
    } catch {
      // The unconditional SDK result is never trusted as absence proof.
    }
    try {
      const after = await this.#getSnapshot(opaqueResourceId, false)
      if (
        after === "absent" &&
        (await this.#creationTokenIsAbsent(target.provider_creation_token_sha256))
      ) {
        return
      }
      if (after === "absent") {
        throw adapterError("provider_state_unknown", { quarantineRequired: true })
      }
      await this.#assertExactSnapshot(after, target, expectedVersion)
      throw adapterError("provider_state_unknown", { quarantineRequired: true })
    } catch (cause) {
      if (
        cause instanceof AdapterContractError &&
        cause.code === "provider_state_unknown" &&
        cause.quarantine_required
      ) {
        throw cause
      }
      throw adapterError("provider_state_unknown", { quarantineRequired: true, cause })
    }
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
