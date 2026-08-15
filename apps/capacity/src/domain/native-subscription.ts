import {
  createPublicKey,
  KeyObject,
  sign as signBytes,
  verify as verifyBytes,
  type KeyLike,
} from "node:crypto";

import { AccountsError } from "../errors";
import { parseCounter, type Counter } from "./counter";
import { generateUuidV7, isUuidV7 } from "./ids";
import {
  canonicalJson,
  canonicalSha256,
  parseClosedJsonBytes,
} from "../serialization/json";
import type {
  OnlineGenerationReceiptUseCasRequest,
  OnlineGenerationReceiptUseCasResult,
  OnlineGenerationReceiptUseStore,
} from "./online-generation-receipt";

export const NATIVE_SUBSCRIPTION_PROBE_REQUEST_SCHEMA_VERSION =
  "accounts.native-subscription-probe-request/v1" as const;
export const NATIVE_SUBSCRIPTION_PROBE_RESULT_SCHEMA_VERSION =
  "accounts.native-subscription-probe-result/v1" as const;
export const CAPSULE_MAINTENANCE_REQUEST_SCHEMA_VERSION =
  "accounts.capsule-maintenance-request/v1" as const;
export const CAPSULE_MAINTENANCE_GRANT_SCHEMA_VERSION =
  "accounts.capsule-maintenance/v1" as const;
export const CAPSULE_MAINTENANCE_CONSUME_REQUEST_SCHEMA_VERSION =
  "accounts.capsule-maintenance-consume-request/v1" as const;
export const CAPSULE_MAINTENANCE_CONSUME_RECEIPT_SCHEMA_VERSION =
  "accounts.capsule-maintenance-consume-receipt/v1" as const;

const PRINCIPAL =
  /^principal:(?:human|service):hasna:[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const REFERENCE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,254}$/;
const DIGEST = /^sha256:[0-9a-f]{64}$/;
const BASE64URL = /^[A-Za-z0-9_-]+$/;
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

const PROBE_KEYS = Object.freeze([
  "schema_version",
  "command",
  "owner_ref",
  "provider_account_id",
  "subscription_id",
  "account_lane_id",
  "auth_capsule_id",
  "canonical_node_id",
  "node_key_thumbprint",
  "node_generation",
  "placement_generation",
  "auth_generation",
  "auth_state_revision",
] as const);

const MAINTENANCE_REQUEST_KEYS = Object.freeze([
  ...PROBE_KEYS.filter((key) => key !== "schema_version" && key !== "command"),
  "schema_version",
  "target_kind",
  "command",
  "expected_target_revision",
  "zero_live_evidence_digest",
  "drain_evidence_digest",
  "idempotency_key_digest",
] as const);

const GRANT_KEYS = Object.freeze([
  "schema_version",
  "grant_id",
  "issuer",
  "issuer_incarnation",
  "key_id",
  "audience",
  "target_kind",
  "command",
  "owner_ref",
  "provider_account_id",
  "subscription_id",
  "account_lane_id",
  "auth_capsule_id",
  "canonical_node_id",
  "node_key_thumbprint",
  "node_generation",
  "placement_generation",
  "auth_generation",
  "auth_state_revision",
  "expected_target_revision",
  "zero_live_evidence_digest",
  "drain_evidence_digest",
  "idempotency_key_digest",
  "request_digest",
  "issued_at",
  "expires_at",
  "signature",
] as const);

const CONSUME_REQUEST_KEYS = Object.freeze([
  "schema_version",
  "grant_id",
  "operation_id",
  "request_digest",
  "idempotency_key_digest",
] as const);

const CONSUME_RECEIPT_KEYS = Object.freeze([
  "schema_version",
  "grant_id",
  "operation_id",
  "issuer",
  "issuer_incarnation",
  "key_id",
  "audience",
  "target_kind",
  "command",
  "owner_ref",
  "provider_account_id",
  "subscription_id",
  "account_lane_id",
  "auth_capsule_id",
  "canonical_node_id",
  "node_key_thumbprint",
  "auth_generation",
  "auth_state_revision",
  "grant_request_digest",
  "consume_request_digest",
  "consumed_at",
  "signature",
] as const);

const CAPABILITY_USE_REQUEST_KEYS = Object.freeze([
  "schema_version",
  "schema_digest",
  "consume_request_id",
  "capability_id",
  "capability_digest",
  "nonce",
  "subject",
  "actor_principal",
  "account_lane_id",
  "capacity_pool_id",
  "capacity_domain_ref",
  "credential_family_id",
  "resource_lease_id",
  "resource_id",
  "resource_lifecycle_generation",
  "operation_id",
  "operation_digest",
  "operation_execution_epoch",
  "sender_key_thumbprint",
  "channel_binding_digest",
  "canonical_request_digest",
  "provider_destination_policy_digest",
  "online_receipt_id",
  "online_receipt_digest",
  "model_call_anchor_digest",
  "expected_use_count",
  "max_uses",
  "not_after",
  "idempotency_key_digest",
] as const);

export type CapsuleMaintenanceTargetKind = "account_record" | "native_capsule";
export type CapsuleMaintenanceCommand =
  | "SUSPEND_ACCOUNT"
  | "RESUME_ACCOUNT"
  | "REVOKE_ACCOUNT"
  | "REFRESH_CAPSULE"
  | "BEGIN_REAUTH"
  | "ROTATE_CAPSULE"
  | "REVOKE_CAPSULE";

export interface NativeSubscriptionProbeRequest {
  readonly schema_version: typeof NATIVE_SUBSCRIPTION_PROBE_REQUEST_SCHEMA_VERSION;
  readonly command: "PROBE_NATIVE";
  readonly owner_ref: string;
  readonly provider_account_id: string;
  readonly subscription_id: string;
  readonly account_lane_id: string;
  readonly auth_capsule_id: string;
  readonly canonical_node_id: string;
  readonly node_key_thumbprint: string;
  readonly node_generation: Counter;
  readonly placement_generation: Counter;
  readonly auth_generation: Counter;
  readonly auth_state_revision: Counter;
}

export interface NativeSubscriptionBindingSnapshot {
  readonly ownerRef: string;
  readonly providerAccountId: string;
  readonly subscriptionId: string;
  readonly accountLaneId: string;
  readonly authCapsuleId: string;
  readonly canonicalNodeId: string;
  readonly nodeKeyThumbprint: string;
  readonly nodeGeneration: Counter;
  readonly placementGeneration: Counter;
  readonly authGeneration: Counter;
  readonly authStateRevision: Counter;
  readonly accountRevision: Counter;
  readonly capsuleRevision: Counter;
  readonly accountStatus: "active" | "suspended" | "revoked";
  readonly subscriptionStatus: "active" | "paused" | "expired" | "revoked";
  readonly accountLaneStatus: "ready" | "draining" | "disabled" | "retired";
  readonly capsuleStatus: "ready" | "degraded" | "maintenance" | "quiescing" | "revoked";
  readonly liveLeaseCount: Counter;
  readonly drainState: "not_started" | "draining" | "drained";
  readonly zeroLiveEvidenceDigest: string;
  readonly drainEvidenceDigest: string;
  readonly evidenceExpiresAt: string;
}

export interface NativeSubscriptionSnapshotSource {
  read(accountLaneId: string):
    | NativeSubscriptionBindingSnapshot
    | undefined
    | Promise<NativeSubscriptionBindingSnapshot | undefined>;
}

export interface NativeSubscriptionProbeResult {
  readonly schema_version: typeof NATIVE_SUBSCRIPTION_PROBE_RESULT_SCHEMA_VERSION;
  readonly capability_eligible: boolean;
  readonly maintenance_ready: boolean;
  readonly reason_codes: readonly string[];
  readonly owner_ref: string;
  readonly provider_account_id: string;
  readonly subscription_id: string;
  readonly account_lane_id: string;
  readonly auth_capsule_id: string;
  readonly canonical_node_id: string;
  readonly node_key_thumbprint: string;
  readonly node_generation: Counter;
  readonly placement_generation: Counter;
  readonly auth_generation: Counter;
  readonly auth_state_revision: Counter;
  readonly account_revision: Counter;
  readonly capsule_revision: Counter;
  readonly account_status: NativeSubscriptionBindingSnapshot["accountStatus"];
  readonly subscription_status: NativeSubscriptionBindingSnapshot["subscriptionStatus"];
  readonly account_lane_status: NativeSubscriptionBindingSnapshot["accountLaneStatus"];
  readonly capsule_status: NativeSubscriptionBindingSnapshot["capsuleStatus"];
  readonly live_lease_count: Counter;
  readonly drain_state: NativeSubscriptionBindingSnapshot["drainState"];
  readonly zero_live_evidence_digest: string;
  readonly drain_evidence_digest: string;
  readonly evidence_expires_at: string;
  readonly binding_digest: string;
}

export interface CapsuleMaintenanceRequest
  extends Omit<NativeSubscriptionProbeRequest, "schema_version" | "command"> {
  readonly schema_version: typeof CAPSULE_MAINTENANCE_REQUEST_SCHEMA_VERSION;
  readonly target_kind: CapsuleMaintenanceTargetKind;
  readonly command: CapsuleMaintenanceCommand;
  readonly expected_target_revision: Counter;
  readonly zero_live_evidence_digest: string;
  readonly drain_evidence_digest: string;
  readonly idempotency_key_digest: string;
}

export interface CapsuleMaintenanceGrant
  extends Omit<CapsuleMaintenanceRequest, "schema_version"> {
  readonly schema_version: typeof CAPSULE_MAINTENANCE_GRANT_SCHEMA_VERSION;
  readonly grant_id: string;
  readonly issuer: string;
  readonly issuer_incarnation: string;
  readonly key_id: string;
  readonly audience: string;
  readonly request_digest: string;
  readonly issued_at: string;
  readonly expires_at: string;
  readonly signature: string;
}

export interface CapsuleMaintenanceConsumeRequest {
  readonly schema_version: typeof CAPSULE_MAINTENANCE_CONSUME_REQUEST_SCHEMA_VERSION;
  readonly grant_id: string;
  readonly operation_id: string;
  readonly request_digest: string;
  readonly idempotency_key_digest: string;
}

export interface CapsuleMaintenanceConsumeReceipt {
  readonly schema_version: typeof CAPSULE_MAINTENANCE_CONSUME_RECEIPT_SCHEMA_VERSION;
  readonly grant_id: string;
  readonly operation_id: string;
  readonly issuer: string;
  readonly issuer_incarnation: string;
  readonly key_id: string;
  readonly audience: string;
  readonly target_kind: CapsuleMaintenanceTargetKind;
  readonly command: CapsuleMaintenanceCommand;
  readonly owner_ref: string;
  readonly provider_account_id: string;
  readonly subscription_id: string;
  readonly account_lane_id: string;
  readonly auth_capsule_id: string;
  readonly canonical_node_id: string;
  readonly node_key_thumbprint: string;
  readonly auth_generation: Counter;
  readonly auth_state_revision: Counter;
  readonly grant_request_digest: string;
  readonly consume_request_digest: string;
  readonly consumed_at: string;
  readonly signature: string;
}

export interface CapsuleMaintenanceTrust {
  readonly issuer: string;
  readonly issuerIncarnation: string;
  readonly keyId: string;
  readonly audience: string;
  readonly publicKey: KeyObject | string | Buffer;
}

export interface CapsuleMaintenanceAuthorityOptions extends CapsuleMaintenanceTrust {
  readonly privateKey: KeyLike;
  readonly snapshots: NativeSubscriptionSnapshotSource;
  readonly clock?: () => Date;
  readonly idFactory?: (nowMs: number) => string;
  readonly grantLifetimeMs?: number;
}

export interface CapsuleMaintenanceTransport {
  readonly authenticatedOwnerRef: string;
  readonly authenticatedNodeKeyThumbprint: string;
}

type JsonObject = Record<string, unknown>;

export async function evaluateNativeSubscriptionProbe(
  source: unknown,
  snapshotSource: NativeSubscriptionSnapshotSource,
  authenticatedOwnerRef: string,
  now: Date = new Date(),
): Promise<NativeSubscriptionProbeResult> {
  const request = parseProbeRequest(source);
  principal(authenticatedOwnerRef);
  validDate(now);
  const found = await snapshotSource.read(request.account_lane_id);
  if (found === undefined) throw new AccountsError("NOT_FOUND", "Native subscription was not found");
  const snapshot = validateSnapshot(found);
  const bindingReasons: string[] = [];
  if (request.owner_ref !== authenticatedOwnerRef || snapshot.ownerRef !== authenticatedOwnerRef) {
    bindingReasons.push("OWNER_MISMATCH");
  }
  if (
    request.provider_account_id !== snapshot.providerAccountId ||
    request.subscription_id !== snapshot.subscriptionId ||
    request.account_lane_id !== snapshot.accountLaneId ||
    request.auth_capsule_id !== snapshot.authCapsuleId
  ) {
    bindingReasons.push("SUBSCRIPTION_BINDING_MISMATCH");
  }
  if (
    request.canonical_node_id !== snapshot.canonicalNodeId ||
    request.node_key_thumbprint !== snapshot.nodeKeyThumbprint
  ) {
    bindingReasons.push("NODE_BINDING_MISMATCH");
  }
  if (
    request.node_generation !== snapshot.nodeGeneration ||
    request.placement_generation !== snapshot.placementGeneration ||
    request.auth_generation !== snapshot.authGeneration ||
    request.auth_state_revision !== snapshot.authStateRevision
  ) {
    bindingReasons.push("GENERATION_MISMATCH");
  }
  const capabilityReasons = [...bindingReasons];
  if (snapshot.accountStatus !== "active") capabilityReasons.push("ACCOUNT_NOT_ACTIVE");
  if (snapshot.subscriptionStatus !== "active") capabilityReasons.push("SUBSCRIPTION_NOT_ACTIVE");
  if (snapshot.accountLaneStatus !== "ready") capabilityReasons.push("ACCOUNT_LANE_NOT_READY");
  if (snapshot.capsuleStatus !== "ready") capabilityReasons.push("CAPSULE_NOT_READY");
  const maintenanceReasons = [...bindingReasons];
  if (snapshot.accountStatus === "revoked") maintenanceReasons.push("ACCOUNT_REVOKED");
  if (snapshot.subscriptionStatus === "expired" || snapshot.subscriptionStatus === "revoked") {
    maintenanceReasons.push("SUBSCRIPTION_TERMINAL");
  }
  if (snapshot.accountLaneStatus === "disabled" || snapshot.accountLaneStatus === "retired") {
    maintenanceReasons.push("ACCOUNT_LANE_TERMINAL");
  }
  if (snapshot.capsuleStatus === "revoked") maintenanceReasons.push("CAPSULE_REVOKED");
  if (snapshot.liveLeaseCount !== "0") maintenanceReasons.push("LIVE_LEASES_PRESENT");
  if (snapshot.drainState !== "drained") maintenanceReasons.push("DRAIN_NOT_COMPLETE");
  if (Date.parse(snapshot.evidenceExpiresAt) <= now.getTime()) {
    maintenanceReasons.push("DRAIN_EVIDENCE_STALE");
  }
  const uniqueReasons = [...new Set([...capabilityReasons, ...maintenanceReasons])].sort();
  const projection = {
    schema_version: NATIVE_SUBSCRIPTION_PROBE_RESULT_SCHEMA_VERSION,
    capability_eligible: capabilityReasons.length === 0,
    maintenance_ready: maintenanceReasons.length === 0,
    reason_codes: Object.freeze(uniqueReasons),
    owner_ref: snapshot.ownerRef,
    provider_account_id: snapshot.providerAccountId,
    subscription_id: snapshot.subscriptionId,
    account_lane_id: snapshot.accountLaneId,
    auth_capsule_id: snapshot.authCapsuleId,
    canonical_node_id: snapshot.canonicalNodeId,
    node_key_thumbprint: snapshot.nodeKeyThumbprint,
    node_generation: snapshot.nodeGeneration,
    placement_generation: snapshot.placementGeneration,
    auth_generation: snapshot.authGeneration,
    auth_state_revision: snapshot.authStateRevision,
    account_revision: snapshot.accountRevision,
    capsule_revision: snapshot.capsuleRevision,
    account_status: snapshot.accountStatus,
    subscription_status: snapshot.subscriptionStatus,
    account_lane_status: snapshot.accountLaneStatus,
    capsule_status: snapshot.capsuleStatus,
    live_lease_count: snapshot.liveLeaseCount,
    drain_state: snapshot.drainState,
    zero_live_evidence_digest: snapshot.zeroLiveEvidenceDigest,
    drain_evidence_digest: snapshot.drainEvidenceDigest,
    evidence_expires_at: snapshot.evidenceExpiresAt,
    binding_digest: canonicalSha256({
      auth_capsule_id: snapshot.authCapsuleId,
      auth_generation: snapshot.authGeneration,
      auth_state_revision: snapshot.authStateRevision,
      canonical_node_id: snapshot.canonicalNodeId,
      node_generation: snapshot.nodeGeneration,
      node_key_thumbprint: snapshot.nodeKeyThumbprint,
      owner_ref: snapshot.ownerRef,
      placement_generation: snapshot.placementGeneration,
      provider_account_id: snapshot.providerAccountId,
      schema_version: "accounts.native-subscription-binding/v1",
      subscription_id: snapshot.subscriptionId,
    }),
  } satisfies NativeSubscriptionProbeResult;
  return Object.freeze(projection);
}

/**
 * Process-local POC authority. Production adapters must persist issuance,
 * consumption, and idempotency records in one durable atomic authority.
 */
export class CapsuleMaintenanceAuthority {
  private readonly publicKey: KeyObject;
  private readonly clock: () => Date;
  private readonly idFactory: (nowMs: number) => string;
  private readonly grantLifetimeMs: number;
  private readonly issued = new Map<string, { readonly hash: string; readonly grant: CapsuleMaintenanceGrant }>();
  private readonly consumed = new Map<string, { readonly hash: string; readonly receipt: CapsuleMaintenanceConsumeReceipt }>();
  private tail: Promise<void> = Promise.resolve();

  constructor(private readonly options: CapsuleMaintenanceAuthorityOptions) {
    reference(options.issuer);
    reference(options.issuerIncarnation);
    reference(options.keyId);
    reference(options.audience);
    this.publicKey = toPublicKey(options.publicKey);
    this.clock = options.clock ?? (() => new Date());
    this.idFactory = options.idFactory ?? generateUuidV7;
    this.grantLifetimeMs = options.grantLifetimeMs ?? 30_000;
    if (!Number.isInteger(this.grantLifetimeMs) || this.grantLifetimeMs < 1 || this.grantLifetimeMs > 60_000) {
      throw invalid("grantLifetimeMs");
    }
    const challenge = Buffer.from("accounts.capsule-maintenance-key-check/v1", "utf8");
    const signature = signBytes(null, challenge, options.privateKey);
    if (!verifyBytes(null, challenge, this.publicKey, signature)) throw invalid("privateKey");
  }

  probe(source: unknown, authenticatedOwnerRef: string): Promise<NativeSubscriptionProbeResult> {
    return evaluateNativeSubscriptionProbe(source, this.options.snapshots, authenticatedOwnerRef, this.now());
  }

  async issueMaintenanceGrant(
    source: unknown,
    authenticatedOwnerRef: string,
  ): Promise<CapsuleMaintenanceGrant> {
    const request = parseMaintenanceRequest(source);
    const requestHash = canonicalSha256(request);
    return this.serialize(async () => {
      const prior = this.issued.get(request.idempotency_key_digest);
      if (prior !== undefined) {
        if (prior.hash !== requestHash) throw new AccountsError("IDEMPOTENCY_CONFLICT", "Maintenance request conflicts");
        return prior.grant;
      }
      const probe = await this.probe(toProbeRequest(request), authenticatedOwnerRef);
      if (!probe.maintenance_ready) throw new AccountsError("POLICY_DENIED", "Maintenance is not safe");
      if (
        request.zero_live_evidence_digest !== probe.zero_live_evidence_digest ||
        request.drain_evidence_digest !== probe.drain_evidence_digest ||
        request.expected_target_revision !==
          (request.target_kind === "account_record" ? probe.account_revision : probe.capsule_revision)
      ) {
        throw new AccountsError("STALE_REVISION", "Maintenance evidence is stale");
      }
      assertCommandTarget(request.target_kind, request.command);
      assertCommandState(request.command, probe);
      const now = this.now();
      const unsigned = {
        ...request,
        schema_version: CAPSULE_MAINTENANCE_GRANT_SCHEMA_VERSION,
        grant_id: this.newId(now.getTime()),
        issuer: this.options.issuer,
        issuer_incarnation: this.options.issuerIncarnation,
        key_id: this.options.keyId,
        audience: this.options.audience,
        request_digest: requestHash,
        issued_at: now.toISOString(),
        expires_at: new Date(now.getTime() + this.grantLifetimeMs).toISOString(),
      } as const;
      const grant = Object.freeze({
        ...unsigned,
        signature: signCanonical(unsigned, this.options.privateKey),
      }) satisfies CapsuleMaintenanceGrant;
      this.issued.set(request.idempotency_key_digest, { hash: requestHash, grant });
      return grant;
    });
  }

  async consumeMaintenanceGrant(
    grantSource: Uint8Array,
    consumeSource: unknown,
    transport: CapsuleMaintenanceTransport,
  ): Promise<CapsuleMaintenanceConsumeReceipt> {
    const grant = verifyCapsuleMaintenanceGrant(grantSource, this.options, this.now());
    const request = parseConsumeRequest(consumeSource);
    principal(transport.authenticatedOwnerRef);
    digest(transport.authenticatedNodeKeyThumbprint);
    if (
      request.grant_id !== grant.grant_id ||
      grant.owner_ref !== transport.authenticatedOwnerRef ||
      grant.node_key_thumbprint !== transport.authenticatedNodeKeyThumbprint
    ) {
      throw new AccountsError("FORBIDDEN", "Maintenance transport binding is invalid");
    }
    if (request.request_digest !== grant.request_digest) {
      throw new AccountsError("FORBIDDEN", "Maintenance request binding is invalid");
    }
    const consumeHash = canonicalSha256(request);
    const prior = this.consumed.get(grant.grant_id);
    if (prior !== undefined) {
      if (prior.hash !== consumeHash) throw new AccountsError("IDEMPOTENCY_CONFLICT", "Maintenance grant already consumed");
      return prior.receipt;
    }
    return this.serialize(async () => {
      const concurrent = this.consumed.get(grant.grant_id);
      if (concurrent !== undefined) {
        if (concurrent.hash !== consumeHash) throw new AccountsError("IDEMPOTENCY_CONFLICT", "Maintenance grant already consumed");
        return concurrent.receipt;
      }
      const probe = await this.probe(toProbeRequest(grant), transport.authenticatedOwnerRef);
      if (
        !probe.maintenance_ready ||
        grant.zero_live_evidence_digest !== probe.zero_live_evidence_digest ||
        grant.drain_evidence_digest !== probe.drain_evidence_digest ||
        grant.expected_target_revision !==
          (grant.target_kind === "account_record" ? probe.account_revision : probe.capsule_revision)
      ) {
        throw new AccountsError("POLICY_DENIED", "Maintenance grant is no longer current");
      }
      const now = this.now();
      if (now.getTime() >= Date.parse(grant.expires_at)) throw new AccountsError("STALE_ATTESTATION", "Maintenance grant expired");
      const unsigned = {
        schema_version: CAPSULE_MAINTENANCE_CONSUME_RECEIPT_SCHEMA_VERSION,
        grant_id: grant.grant_id,
        operation_id: request.operation_id,
        issuer: this.options.issuer,
        issuer_incarnation: this.options.issuerIncarnation,
        key_id: this.options.keyId,
        audience: this.options.audience,
        target_kind: grant.target_kind,
        command: grant.command,
        owner_ref: grant.owner_ref,
        provider_account_id: grant.provider_account_id,
        subscription_id: grant.subscription_id,
        account_lane_id: grant.account_lane_id,
        auth_capsule_id: grant.auth_capsule_id,
        canonical_node_id: grant.canonical_node_id,
        node_key_thumbprint: grant.node_key_thumbprint,
        auth_generation: grant.auth_generation,
        auth_state_revision: grant.auth_state_revision,
        grant_request_digest: grant.request_digest,
        consume_request_digest: consumeHash,
        consumed_at: now.toISOString(),
      } as const;
      const receipt = Object.freeze({
        ...unsigned,
        signature: signCanonical(unsigned, this.options.privateKey),
      }) satisfies CapsuleMaintenanceConsumeReceipt;
      this.consumed.set(grant.grant_id, { hash: consumeHash, receipt });
      return receipt;
    });
  }

  private now(): Date {
    let value: Date;
    try {
      value = this.clock();
    } catch {
      throw new AccountsError("DEPENDENCY_UNAVAILABLE", "Trusted clock unavailable");
    }
    return validDate(value);
  }

  private newId(nowMs: number): string {
    const value = this.idFactory(nowMs);
    if (!isUuidV7(value)) throw new AccountsError("DEPENDENCY_UNAVAILABLE", "Identifier source failed");
    return value;
  }

  private async serialize<T>(operation: () => Promise<T>): Promise<T> {
    let release!: () => void;
    const previous = this.tail;
    this.tail = new Promise<void>((resolve) => { release = resolve; });
    await previous;
    try {
      return await operation();
    } finally {
      release();
    }
  }
}

export function verifyCapsuleMaintenanceGrant(
  source: Uint8Array,
  trust: CapsuleMaintenanceTrust,
  now: Date,
): CapsuleMaintenanceGrant {
  const parsed = parseClosedJsonBytes(source);
  const supplied = Buffer.from(source.buffer, source.byteOffset, source.byteLength);
  if (!supplied.equals(Buffer.from(canonicalJson(parsed), "utf8"))) {
    throw invalid("grant");
  }
  const value = plainObject(parsed);
  exactKeys(value, GRANT_KEYS);
  if (value.schema_version !== CAPSULE_MAINTENANCE_GRANT_SCHEMA_VERSION) throw invalid("schema_version");
  uuid(value.grant_id);
  reference(value.issuer);
  reference(value.issuer_incarnation);
  reference(value.key_id);
  reference(value.audience);
  const request = parseMaintenanceRequest({
    schema_version: CAPSULE_MAINTENANCE_REQUEST_SCHEMA_VERSION,
    owner_ref: value.owner_ref,
    provider_account_id: value.provider_account_id,
    subscription_id: value.subscription_id,
    account_lane_id: value.account_lane_id,
    auth_capsule_id: value.auth_capsule_id,
    canonical_node_id: value.canonical_node_id,
    node_key_thumbprint: value.node_key_thumbprint,
    node_generation: value.node_generation,
    placement_generation: value.placement_generation,
    auth_generation: value.auth_generation,
    auth_state_revision: value.auth_state_revision,
    target_kind: value.target_kind,
    command: value.command,
    expected_target_revision: value.expected_target_revision,
    zero_live_evidence_digest: value.zero_live_evidence_digest,
    drain_evidence_digest: value.drain_evidence_digest,
    idempotency_key_digest: value.idempotency_key_digest,
  });
  digest(value.request_digest);
  const issuedAt = timestamp(value.issued_at);
  const expiresAt = timestamp(value.expires_at);
  signature(value.signature);
  validDate(now);
  const publicKey = toPublicKey(trust.publicKey);
  const grant = value as unknown as CapsuleMaintenanceGrant;
  const { signature: _signature, ...unsigned } = grant;
  if (
    grant.issuer !== trust.issuer ||
    grant.issuer_incarnation !== trust.issuerIncarnation ||
    grant.key_id !== trust.keyId ||
    grant.audience !== trust.audience ||
    grant.request_digest !== canonicalSha256(request) ||
    Date.parse(issuedAt) > now.getTime() ||
    Date.parse(expiresAt) <= now.getTime() ||
    Date.parse(expiresAt) - Date.parse(issuedAt) > 60_000 ||
    !verifyBytes(
      null,
      Buffer.from(canonicalJson(unsigned), "utf8"),
      publicKey,
      Buffer.from(grant.signature, "base64url"),
    )
  ) {
    throw new AccountsError("FORBIDDEN", "Maintenance grant is not trusted");
  }
  return Object.freeze({ ...grant });
}

export interface NativeCapabilityUseCurrentState {
  readonly catalogIncarnation: string;
  readonly recoveryFrontierSequence: Counter;
  readonly recoveryFrontierHash: string;
}

export interface InMemoryNativeCapabilityUseStoreOptions {
  readonly issuer: string;
  readonly issuerIncarnation: string;
  readonly keyId: string;
  readonly audience: string;
  readonly privateKey: KeyLike;
  readonly clock?: () => Date;
  readonly idFactory?: (nowMs: number) => string;
  readonly validateCurrent: (
    request: OnlineGenerationReceiptUseCasRequest,
  ) => NativeCapabilityUseCurrentState | Promise<NativeCapabilityUseCurrentState>;
}

/**
 * Process-local conformance adapter only. It proves CAS/replay semantics but is
 * deliberately not a production substitute for the durable Accounts store.
 */
export class InMemoryNativeCapabilityUseStore implements OnlineGenerationReceiptUseStore {
  private readonly clock: () => Date;
  private readonly idFactory: (nowMs: number) => string;
  private readonly requests = new Map<string, { readonly hash: string; readonly bytes: Uint8Array }>();
  private readonly capabilities = new Set<string>();
  private tail: Promise<void> = Promise.resolve();

  constructor(private readonly options: InMemoryNativeCapabilityUseStoreOptions) {
    reference(options.issuer);
    reference(options.issuerIncarnation);
    reference(options.keyId);
    reference(options.audience);
    this.clock = options.clock ?? (() => new Date());
    this.idFactory = options.idFactory ?? generateUuidV7;
  }

  async compareAndConsume(
    source: OnlineGenerationReceiptUseCasRequest,
  ): Promise<OnlineGenerationReceiptUseCasResult> {
    const request = parseCapabilityUseRequest(source);
    const requestHash = canonicalSha256(request);
    return this.serialize(async () => {
      const prior = this.requests.get(request.consume_request_id);
      if (prior !== undefined) {
        return prior.hash === requestHash
          ? { status: "replayed", signedReceipt: Uint8Array.from(prior.bytes) }
          : { status: "idempotency_conflict" };
      }
      if (this.capabilities.has(request.capability_id)) return { status: "exhausted" };
      const now = validDate(this.clock());
      if (Date.parse(request.not_after) <= now.getTime()) return { status: "conflict" };
      const current = validateCapabilityUseCurrentState(
        await this.options.validateCurrent(Object.freeze({ ...request })),
      );
      const consumeReceiptId = this.idFactory(now.getTime());
      if (!isUuidV7(consumeReceiptId)) throw new AccountsError("DEPENDENCY_UNAVAILABLE", "Identifier source failed");
      const useId = canonicalSha256({
        capability_id: request.capability_id,
        channel_binding_digest: request.channel_binding_digest,
        model_call_anchor_digest: request.model_call_anchor_digest,
        nonce: request.nonce,
        operation_id: request.operation_id,
        resource_lease_id: request.resource_lease_id,
        schema_version: "accounts.capability-use.v1",
        sender_key_thumbprint: request.sender_key_thumbprint,
        use_ordinal: "1",
      });
      const unsigned = {
        schema_version: "accounts.capability-use-consume-receipt.v1",
        schema_digest: "sha256:a0999ffabc197f46f6fdeb8a6b78521364b0f2153d52a0e6e63ee360bb408bce",
        consume_request_id: request.consume_request_id,
        consume_receipt_id: consumeReceiptId,
        issuer: this.options.issuer,
        issuer_incarnation: this.options.issuerIncarnation,
        key_id: this.options.keyId,
        audience: this.options.audience,
        capability_id: request.capability_id,
        capability_digest: request.capability_digest,
        nonce: request.nonce,
        subject: request.subject,
        actor_principal: request.actor_principal,
        account_lane_id: request.account_lane_id,
        capacity_pool_id: request.capacity_pool_id,
        resource_lease_id: request.resource_lease_id,
        operation_id: request.operation_id,
        operation_execution_epoch: request.operation_execution_epoch,
        sender_key_thumbprint: request.sender_key_thumbprint,
        channel_binding_digest: request.channel_binding_digest,
        canonical_request_digest: request.canonical_request_digest,
        online_receipt_digest: request.online_receipt_digest,
        model_call_anchor_digest: request.model_call_anchor_digest,
        max_uses: "1",
        prior_use_count: "0",
        next_use_count: "1",
        use_ordinal: "1",
        use_id: useId,
        committed_at: now.toISOString(),
        expires_at: request.not_after,
        catalog_incarnation: current.catalogIncarnation,
        recovery_frontier_sequence: current.recoveryFrontierSequence,
        recovery_frontier_hash: current.recoveryFrontierHash,
      } as const;
      const receipt = { ...unsigned, signature: signCanonical(unsigned, this.options.privateKey) };
      const bytes = Uint8Array.from(Buffer.from(canonicalJson(receipt), "utf8"));
      this.requests.set(request.consume_request_id, { hash: requestHash, bytes });
      this.capabilities.add(request.capability_id);
      return { status: "consumed", signedReceipt: Uint8Array.from(bytes) };
    });
  }

  private async serialize<T>(operation: () => Promise<T>): Promise<T> {
    let release!: () => void;
    const previous = this.tail;
    this.tail = new Promise<void>((resolve) => { release = resolve; });
    await previous;
    try {
      return await operation();
    } finally {
      release();
    }
  }
}

export class StaticNativeSubscriptionSnapshotSource implements NativeSubscriptionSnapshotSource {
  private readonly records = new Map<string, NativeSubscriptionBindingSnapshot>();

  constructor(records: readonly NativeSubscriptionBindingSnapshot[]) {
    for (const record of records) {
      const snapshot = validateSnapshot(record);
      if (this.records.has(snapshot.accountLaneId)) throw new AccountsError("CONFLICT", "Duplicate native subscription");
      this.records.set(snapshot.accountLaneId, snapshot);
    }
  }

  read(accountLaneId: string): NativeSubscriptionBindingSnapshot | undefined {
    const value = this.records.get(accountLaneId);
    return value === undefined ? undefined : Object.freeze({ ...value });
  }
}

export function parseNativeSubscriptionProbeRequest(source: unknown): NativeSubscriptionProbeRequest {
  return parseProbeRequest(source);
}

function parseProbeRequest(source: unknown): NativeSubscriptionProbeRequest {
  const value = plainObject(source);
  exactKeys(value, PROBE_KEYS);
  if (value.schema_version !== NATIVE_SUBSCRIPTION_PROBE_REQUEST_SCHEMA_VERSION) throw invalid("schema_version");
  if (value.command !== "PROBE_NATIVE") throw invalid("command");
  principal(value.owner_ref);
  for (const key of ["provider_account_id", "subscription_id", "account_lane_id", "auth_capsule_id", "canonical_node_id"] as const) uuid(value[key]);
  digest(value.node_key_thumbprint);
  for (const key of ["node_generation", "placement_generation", "auth_generation", "auth_state_revision"] as const) parseCounter(value[key]);
  return Object.freeze({ ...value }) as unknown as NativeSubscriptionProbeRequest;
}

function parseMaintenanceRequest(source: unknown): CapsuleMaintenanceRequest {
  const value = plainObject(source);
  exactKeys(value, MAINTENANCE_REQUEST_KEYS);
  if (value.schema_version !== CAPSULE_MAINTENANCE_REQUEST_SCHEMA_VERSION) throw invalid("schema_version");
  const probe = parseProbeRequest({
    schema_version: NATIVE_SUBSCRIPTION_PROBE_REQUEST_SCHEMA_VERSION,
    command: "PROBE_NATIVE",
    owner_ref: value.owner_ref,
    provider_account_id: value.provider_account_id,
    subscription_id: value.subscription_id,
    account_lane_id: value.account_lane_id,
    auth_capsule_id: value.auth_capsule_id,
    canonical_node_id: value.canonical_node_id,
    node_key_thumbprint: value.node_key_thumbprint,
    node_generation: value.node_generation,
    placement_generation: value.placement_generation,
    auth_generation: value.auth_generation,
    auth_state_revision: value.auth_state_revision,
  });
  if (value.target_kind !== "account_record" && value.target_kind !== "native_capsule") throw invalid("target_kind");
  if (!["SUSPEND_ACCOUNT", "RESUME_ACCOUNT", "REVOKE_ACCOUNT", "REFRESH_CAPSULE", "BEGIN_REAUTH", "ROTATE_CAPSULE", "REVOKE_CAPSULE"].includes(String(value.command))) throw invalid("command");
  parseCounter(value.expected_target_revision);
  digest(value.zero_live_evidence_digest);
  digest(value.drain_evidence_digest);
  digest(value.idempotency_key_digest);
  const result = {
    ...probe,
    schema_version: CAPSULE_MAINTENANCE_REQUEST_SCHEMA_VERSION,
    target_kind: value.target_kind,
    command: value.command,
    expected_target_revision: value.expected_target_revision,
    zero_live_evidence_digest: value.zero_live_evidence_digest,
    drain_evidence_digest: value.drain_evidence_digest,
    idempotency_key_digest: value.idempotency_key_digest,
  } as CapsuleMaintenanceRequest;
  assertCommandTarget(result.target_kind, result.command);
  return Object.freeze(result);
}

function parseConsumeRequest(source: unknown): CapsuleMaintenanceConsumeRequest {
  const value = plainObject(source);
  exactKeys(value, CONSUME_REQUEST_KEYS);
  if (value.schema_version !== CAPSULE_MAINTENANCE_CONSUME_REQUEST_SCHEMA_VERSION) throw invalid("schema_version");
  uuid(value.grant_id);
  uuid(value.operation_id);
  digest(value.request_digest);
  digest(value.idempotency_key_digest);
  return Object.freeze({ ...value }) as unknown as CapsuleMaintenanceConsumeRequest;
}

function parseCapabilityUseRequest(source: unknown): OnlineGenerationReceiptUseCasRequest {
  const value = plainObject(source);
  exactKeys(value, CAPABILITY_USE_REQUEST_KEYS);
  if (
    value.schema_version !== "accounts.capability-use-consume-request.v1" ||
    value.schema_digest !== "sha256:a7cdc1dfbebeaea3bad6a5014cfb5189be40fb010f57161b46437458492cd1bc"
  ) throw invalid("schema_version");
  for (const key of ["consume_request_id", "capability_id", "account_lane_id", "capacity_pool_id", "resource_lease_id", "operation_id", "online_receipt_id"] as const) uuid(value[key]);
  for (const key of ["capability_digest", "operation_digest", "sender_key_thumbprint", "channel_binding_digest", "canonical_request_digest", "provider_destination_policy_digest", "online_receipt_digest", "model_call_anchor_digest", "idempotency_key_digest"] as const) digest(value[key]);
  for (const key of ["nonce", "capacity_domain_ref", "credential_family_id", "resource_id"] as const) reference(value[key]);
  principal(value.subject);
  principal(value.actor_principal);
  for (const key of ["resource_lifecycle_generation", "operation_execution_epoch", "expected_use_count", "max_uses"] as const) parseCounter(value[key]);
  if (value.expected_use_count !== "0" || value.max_uses !== "1") throw invalid("max_uses");
  timestamp(value.not_after);
  return Object.freeze({ ...value }) as unknown as OnlineGenerationReceiptUseCasRequest;
}

function validateCapabilityUseCurrentState(source: unknown): NativeCapabilityUseCurrentState {
  const value = plainObject(source);
  exactKeys(value, ["catalogIncarnation", "recoveryFrontierSequence", "recoveryFrontierHash"]);
  reference(value.catalogIncarnation);
  parseCounter(value.recoveryFrontierSequence);
  digest(value.recoveryFrontierHash);
  return Object.freeze({ ...value }) as unknown as NativeCapabilityUseCurrentState;
}

function validateSnapshot(source: unknown): NativeSubscriptionBindingSnapshot {
  const value = plainObject(source);
  exactKeys(value, [
    "ownerRef", "providerAccountId", "subscriptionId", "accountLaneId", "authCapsuleId",
    "canonicalNodeId", "nodeKeyThumbprint", "nodeGeneration", "placementGeneration",
    "authGeneration", "authStateRevision", "accountRevision", "capsuleRevision",
    "accountStatus", "subscriptionStatus", "accountLaneStatus", "capsuleStatus",
    "liveLeaseCount", "drainState", "zeroLiveEvidenceDigest", "drainEvidenceDigest",
    "evidenceExpiresAt",
  ]);
  principal(value.ownerRef);
  for (const key of ["providerAccountId", "subscriptionId", "accountLaneId", "authCapsuleId", "canonicalNodeId"] as const) uuid(value[key]);
  digest(value.nodeKeyThumbprint);
  for (const key of ["nodeGeneration", "placementGeneration", "authGeneration", "authStateRevision", "accountRevision", "capsuleRevision", "liveLeaseCount"] as const) parseCounter(value[key]);
  if (!["active", "suspended", "revoked"].includes(String(value.accountStatus))) throw invalid("accountStatus");
  if (!["active", "paused", "expired", "revoked"].includes(String(value.subscriptionStatus))) throw invalid("subscriptionStatus");
  if (!["ready", "draining", "disabled", "retired"].includes(String(value.accountLaneStatus))) throw invalid("accountLaneStatus");
  if (!["ready", "degraded", "maintenance", "quiescing", "revoked"].includes(String(value.capsuleStatus))) throw invalid("capsuleStatus");
  if (!["not_started", "draining", "drained"].includes(String(value.drainState))) throw invalid("drainState");
  digest(value.zeroLiveEvidenceDigest);
  digest(value.drainEvidenceDigest);
  timestamp(value.evidenceExpiresAt);
  return Object.freeze({ ...value }) as unknown as NativeSubscriptionBindingSnapshot;
}

function toProbeRequest(value: Pick<CapsuleMaintenanceRequest | CapsuleMaintenanceGrant,
  "owner_ref" | "provider_account_id" | "subscription_id" | "account_lane_id" |
  "auth_capsule_id" | "canonical_node_id" | "node_key_thumbprint" | "node_generation" |
  "placement_generation" | "auth_generation" | "auth_state_revision">): NativeSubscriptionProbeRequest {
  return Object.freeze({
    schema_version: NATIVE_SUBSCRIPTION_PROBE_REQUEST_SCHEMA_VERSION,
    command: "PROBE_NATIVE",
    owner_ref: value.owner_ref,
    provider_account_id: value.provider_account_id,
    subscription_id: value.subscription_id,
    account_lane_id: value.account_lane_id,
    auth_capsule_id: value.auth_capsule_id,
    canonical_node_id: value.canonical_node_id,
    node_key_thumbprint: value.node_key_thumbprint,
    node_generation: value.node_generation,
    placement_generation: value.placement_generation,
    auth_generation: value.auth_generation,
    auth_state_revision: value.auth_state_revision,
  });
}

function assertCommandTarget(target: CapsuleMaintenanceTargetKind, command: CapsuleMaintenanceCommand): void {
  const allowed = target === "account_record"
    ? new Set<CapsuleMaintenanceCommand>(["SUSPEND_ACCOUNT", "RESUME_ACCOUNT", "REVOKE_ACCOUNT"])
    : new Set<CapsuleMaintenanceCommand>(["REFRESH_CAPSULE", "BEGIN_REAUTH", "ROTATE_CAPSULE", "REVOKE_CAPSULE"]);
  if (!allowed.has(command)) throw new AccountsError("INVALID_TRANSITION", "Maintenance command does not match target");
}

function assertCommandState(
  command: CapsuleMaintenanceCommand,
  probe: NativeSubscriptionProbeResult,
): void {
  const accepted = (() => {
    switch (command) {
      case "SUSPEND_ACCOUNT":
        return probe.account_status === "active";
      case "RESUME_ACCOUNT":
        return probe.account_status === "suspended";
      case "REVOKE_ACCOUNT":
        return probe.account_status === "active" || probe.account_status === "suspended";
      case "REFRESH_CAPSULE":
      case "ROTATE_CAPSULE":
        return probe.capsule_status === "ready";
      case "BEGIN_REAUTH":
        return probe.capsule_status === "ready" || probe.capsule_status === "degraded";
      case "REVOKE_CAPSULE":
        return probe.capsule_status !== "revoked";
    }
  })();
  if (!accepted) throw new AccountsError("INVALID_TRANSITION", "Maintenance command is invalid for current state");
}

function plainObject(value: unknown): JsonObject {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw invalid("body");
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) throw invalid("body");
  if (Object.getOwnPropertySymbols(value).length !== 0) throw invalid("body");
  for (const key of Object.keys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor === undefined || !("value" in descriptor) || descriptor.get !== undefined || descriptor.set !== undefined) throw invalid("body");
  }
  return value as JsonObject;
}

function exactKeys(value: JsonObject, expected: readonly string[]): void {
  if (Object.keys(value).length !== expected.length) throw invalid("body");
  const allowed = new Set(expected);
  for (const key of Object.keys(value)) if (!allowed.has(key)) throw invalid("body");
  for (const key of expected) if (!Object.hasOwn(value, key)) throw invalid("body");
}

function reference(value: unknown): string {
  if (typeof value !== "string" || !REFERENCE.test(value)) throw invalid("reference");
  return value;
}

function principal(value: unknown): string {
  if (typeof value !== "string" || !PRINCIPAL.test(value)) throw invalid("ownerRef");
  return value;
}

function digest(value: unknown): string {
  if (typeof value !== "string" || !DIGEST.test(value)) throw invalid("digest");
  return value;
}

function uuid(value: unknown): string {
  if (typeof value !== "string" || !isUuidV7(value)) throw invalid("id");
  return value;
}

function timestamp(value: unknown): string {
  if (typeof value !== "string" || !TIMESTAMP.test(value)) throw invalid("timestamp");
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds) || new Date(milliseconds).toISOString() !== value) throw invalid("timestamp");
  return value;
}

function signature(value: unknown): string {
  if (typeof value !== "string" || !BASE64URL.test(value) || Buffer.from(value, "base64url").byteLength !== 64) throw invalid("signature");
  return value;
}

function validDate(value: unknown): Date {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) throw invalid("clock");
  return new Date(value);
}

function toPublicKey(value: KeyObject | string | Buffer): KeyObject {
  let key: KeyObject;
  try {
    key = value instanceof KeyObject ? value : createPublicKey(value);
  } catch {
    throw invalid("publicKey");
  }
  if (key.type !== "public" || key.asymmetricKeyType !== "ed25519") throw invalid("publicKey");
  return key;
}

function signCanonical(value: unknown, key: KeyLike): string {
  return signBytes(null, Buffer.from(canonicalJson(value), "utf8"), key).toString("base64url");
}

function invalid(field: string): AccountsError {
  return new AccountsError("VALIDATION_FAILED", "Native subscription input is invalid", {
    details: { field },
  });
}
