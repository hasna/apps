import type { ListSandboxesQuery, Sandbox as DaytonaSandbox } from "@daytona/sdk"
import type { SandboxInfo, SandboxListOpts } from "e2b"
import { canonicalSha256 } from "./canonical"
import { adapterError } from "./errors"
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

  constructor(
    private readonly sdk: E2bOfficialReadSdkV1,
    private readonly attestation: ManagedResourceAttestationPortV1,
    private readonly installationSha256: Digest,
    private readonly providerScopeRefSha256: Digest,
    private readonly observedAt: () => string,
  ) {
    super()
  }

  async #map(info: SandboxInfo): Promise<AdapterProviderResourceV1> {
    const observedAt = observationTime(this.observedAt)
    const fingerprint = label(info.metadata, "hasna.immutable_fingerprint_sha256")
    const attestation = await this.attestation.attest({
      provider: this.provider_id,
      opaque_resource_id: info.sandboxId,
      immutable_fingerprint_sha256: fingerprint,
    })
    const denyAll =
      info.allowInternetAccess === false &&
      info.network?.denyOut?.includes("0.0.0.0/0") === true &&
      info.network.allowPublicTraffic === false
    return {
      opaque_resource_id: info.sandboxId,
      provider_creation_token_sha256: label(info.metadata, "hasna.creation_token_sha256"),
      immutable_fingerprint_sha256: fingerprint,
      provider_created_at: info.startedAt.toISOString(),
      provider_resource_version: canonicalSha256({
        sandbox_id: info.sandboxId,
        template_id: info.templateId,
        started_at: info.startedAt.toISOString(),
      }),
      state: info.state === "paused" ? "inert" : "unknown",
      provider_runtime_state: info.state === "paused" ? "paused" : "unknown",
      network_policy: denyAll
        ? {
            mode: "deny_all",
            policy_sha256: label(info.metadata, "hasna.network_policy_sha256"),
            enforced_outside_guest: true,
            public_ingress: false,
            dns_denied: true,
            observed_at: observedAt,
          }
        : unknownNetworkObservation(observedAt),
      auto_delete_disabled: info.lifecycle?.onTimeout === "pause" && !info.lifecycle.autoResume,
      ephemeral: false,
      owned:
        attestation.strong_vm &&
        label(info.metadata, "hasna.installation_sha256") === this.installationSha256 &&
        label(info.metadata, "hasna.provider_scope_ref_sha256") === this.providerScopeRefSha256,
      source_attached: !attestation.source_free || (info.volumeMounts?.length ?? 0) !== 0,
      credential_attached: !attestation.credential_free,
      guest_broker_bootstrapped: false,
      ownership: ownership(info.metadata),
    }
  }

  async #page(options: SandboxListOpts): Promise<ProviderResourcePageV1> {
    const paginator = this.sdk.list(options)
    if (!paginator.hasNext) return { items: [] }
    const items = await Promise.all((await paginator.nextItems()).map((info) => this.#map(info)))
    return { items, ...(paginator.nextToken === undefined ? {} : { next_cursor: paginator.nextToken }) }
  }

  findByCreationToken(token: Digest, cursor?: string): Promise<ProviderResourcePageV1> {
    return this.#page({
      query: {
        metadata: {
          "hasna.installation_sha256": this.installationSha256,
          "hasna.provider_scope_ref_sha256": this.providerScopeRefSha256,
          "hasna.creation_token_sha256": token,
        },
      },
      limit: PAGE_LIMIT,
      ...(cursor === undefined ? {} : { nextToken: cursor }),
    })
  }

  async inspectResource(opaqueResourceId: string): Promise<AdapterProviderResourceV1 | "absent"> {
    const info = await this.sdk.getInfo(opaqueResourceId)
    return info === "absent" ? "absent" : this.#map(info)
  }

  listOwnedResources(cursor?: string): Promise<ProviderResourcePageV1> {
    return this.#page({
      query: {
        metadata: {
          "hasna.installation_sha256": this.installationSha256,
          "hasna.provider_scope_ref_sha256": this.providerScopeRefSha256,
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

  constructor(
    private readonly sdk: DaytonaOfficialReadSdkV1,
    private readonly attestation: ManagedResourceAttestationPortV1,
    private readonly installationSha256: Digest,
    private readonly providerScopeRefSha256: Digest,
    private readonly observedAt: () => string,
  ) {
    super()
  }

  async #map(sandbox: DaytonaSandbox): Promise<AdapterProviderResourceV1> {
    await sandbox.refreshData()
    const observedAt = observationTime(this.observedAt)
    const fingerprint = label(sandbox.labels, "hasna.immutable_fingerprint_sha256")
    const attestation = await this.attestation.attest({
      provider: this.provider_id,
      opaque_resource_id: sandbox.id,
      immutable_fingerprint_sha256: fingerprint,
    })
    const stopped = sandbox.state === "stopped" || sandbox.state === "paused"
    const denyAll = sandbox.networkBlockAll === true && sandbox.public === false
    return {
      opaque_resource_id: sandbox.id,
      provider_creation_token_sha256: label(sandbox.labels, "hasna.creation_token_sha256"),
      immutable_fingerprint_sha256: fingerprint,
      provider_created_at: sandbox.createdAt ?? "",
      provider_resource_version: canonicalSha256({
        sandbox_id: sandbox.id,
        created_at: sandbox.createdAt ?? "",
        organization_id: sandbox.organizationId,
      }),
      state: stopped ? "inert" : "unknown",
      provider_runtime_state: stopped ? (sandbox.state === "paused" ? "paused" : "stopped") : "unknown",
      network_policy: denyAll
        ? {
            mode: "deny_all",
            policy_sha256: label(sandbox.labels, "hasna.network_policy_sha256"),
            enforced_outside_guest: true,
            public_ingress: false,
            dns_denied: true,
            observed_at: observedAt,
          }
        : unknownNetworkObservation(observedAt),
      auto_delete_disabled: (sandbox.autoDeleteInterval ?? 0) < 0,
      ephemeral: sandbox.autoDeleteInterval === 0,
      owned:
        attestation.strong_vm &&
        label(sandbox.labels, "hasna.installation_sha256") === this.installationSha256 &&
        label(sandbox.labels, "hasna.provider_scope_ref_sha256") === this.providerScopeRefSha256,
      source_attached: !attestation.source_free || (sandbox.volumes?.length ?? 0) !== 0,
      credential_attached: !attestation.credential_free || Object.keys(sandbox.env ?? {}).length !== 0,
      guest_broker_bootstrapped: false,
      ownership: ownership(sandbox.labels),
    }
  }

  async #list(query: ListSandboxesQuery, cursor?: string): Promise<ProviderResourcePageV1> {
    if (cursor !== undefined) throw adapterError("unsupported_runtime_feature")
    const items: AdapterProviderResourceV1[] = []
    for await (const sandbox of this.sdk.list(query)) {
      if (items.length >= PAGE_LIMIT) {
        throw adapterError("provider_state_unknown", { quarantineRequired: true })
      }
      items.push(await this.#map(sandbox))
    }
    return { items }
  }

  findByCreationToken(token: Digest, cursor?: string): Promise<ProviderResourcePageV1> {
    return this.#list(
      {
        labels: {
          "hasna.installation_sha256": this.installationSha256,
          "hasna.provider_scope_ref_sha256": this.providerScopeRefSha256,
          "hasna.creation_token_sha256": token,
        },
        limit: PAGE_LIMIT,
      },
      cursor,
    )
  }

  async inspectResource(opaqueResourceId: string): Promise<AdapterProviderResourceV1 | "absent"> {
    const sandbox = await this.sdk.get(opaqueResourceId)
    return sandbox === "absent" ? "absent" : this.#map(sandbox)
  }

  listOwnedResources(cursor?: string): Promise<ProviderResourcePageV1> {
    return this.#list(
      {
        labels: {
          "hasna.installation_sha256": this.installationSha256,
          "hasna.provider_scope_ref_sha256": this.providerScopeRefSha256,
        },
        limit: PAGE_LIMIT,
      },
      cursor,
    )
  }
}
