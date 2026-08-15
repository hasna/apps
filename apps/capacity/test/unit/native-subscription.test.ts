import { describe, expect, test } from "bun:test";
import { generateKeyPairSync } from "node:crypto";

import { AccountsError } from "../../src/errors";
import { parseCounter } from "../../src/domain/counter";
import {
  CAPSULE_MAINTENANCE_CONSUME_REQUEST_SCHEMA_VERSION,
  CAPSULE_MAINTENANCE_GRANT_SCHEMA_VERSION,
  CAPSULE_MAINTENANCE_REQUEST_SCHEMA_VERSION,
  NATIVE_SUBSCRIPTION_PROBE_REQUEST_SCHEMA_VERSION,
  CapsuleMaintenanceAuthority,
  InMemoryNativeCapabilityUseStore,
  StaticNativeSubscriptionSnapshotSource,
  evaluateNativeSubscriptionProbe,
  verifyCapsuleMaintenanceGrant,
  type CapsuleMaintenanceRequest,
  type NativeSubscriptionBindingSnapshot,
  type NativeSubscriptionProbeRequest,
} from "../../src/domain/native-subscription";
import type { OnlineGenerationReceiptUseCasRequest } from "../../src/domain/online-generation-receipt";
import { canonicalJson, parseClosedJsonBytes } from "../../src/serialization/json";

const NOW = new Date("2026-07-18T12:00:00.000Z");
const OWNER = "principal:human:hasna:owner-a";
const OTHER_OWNER = "principal:human:hasna:owner-b";
const IDS = {
  provider: "018f0f00-0001-7000-8000-000000000001",
  subscription: "018f0f00-0002-7000-8000-000000000002",
  lane: "018f0f00-0003-7000-8000-000000000003",
  capsule: "018f0f00-0004-7000-8000-000000000004",
  node: "018f0f00-0005-7000-8000-000000000005",
  grant: "018f0f00-0006-7000-8000-000000000006",
  operation: "018f0f00-0007-7000-8000-000000000007",
  receipt: "018f0f00-0008-7000-8000-000000000008",
  capability: "018f0f00-0009-7000-8000-000000000009",
  capacityPool: "018f0f00-000a-7000-8000-00000000000a",
  resourceLease: "018f0f00-000b-7000-8000-00000000000b",
  onlineReceipt: "018f0f00-000c-7000-8000-00000000000c",
  consume1: "018f0f00-000d-7000-8000-00000000000d",
  consume2: "018f0f00-000e-7000-8000-00000000000e",
  consumeReceipt: "018f0f00-000f-7000-8000-00000000000f",
} as const;
const D0 = `sha256:${"0".repeat(64)}`;
const D1 = `sha256:${"1".repeat(64)}`;
const D2 = `sha256:${"2".repeat(64)}`;
const C0 = parseCounter("0");
const C1 = parseCounter("1");
const C2 = parseCounter("2");

function snapshot(
  overrides: Partial<NativeSubscriptionBindingSnapshot> = {},
): NativeSubscriptionBindingSnapshot {
  return {
    ownerRef: OWNER,
    providerAccountId: IDS.provider,
    subscriptionId: IDS.subscription,
    accountLaneId: IDS.lane,
    authCapsuleId: IDS.capsule,
    canonicalNodeId: IDS.node,
    nodeKeyThumbprint: D0,
    nodeGeneration: C1,
    placementGeneration: C1,
    authGeneration: C2,
    authStateRevision: C2,
    accountRevision: C2,
    capsuleRevision: C2,
    accountStatus: "active",
    subscriptionStatus: "active",
    accountLaneStatus: "ready",
    capsuleStatus: "ready",
    liveLeaseCount: C0,
    drainState: "drained",
    zeroLiveEvidenceDigest: D1,
    drainEvidenceDigest: D2,
    evidenceExpiresAt: "2026-07-18T12:05:00.000Z",
    ...overrides,
  };
}

function probeRequest(
  overrides: Partial<NativeSubscriptionProbeRequest> = {},
): NativeSubscriptionProbeRequest {
  return {
    schema_version: NATIVE_SUBSCRIPTION_PROBE_REQUEST_SCHEMA_VERSION,
    command: "PROBE_NATIVE",
    owner_ref: OWNER,
    provider_account_id: IDS.provider,
    subscription_id: IDS.subscription,
    account_lane_id: IDS.lane,
    auth_capsule_id: IDS.capsule,
    canonical_node_id: IDS.node,
    node_key_thumbprint: D0,
    node_generation: C1,
    placement_generation: C1,
    auth_generation: C2,
    auth_state_revision: C2,
    ...overrides,
  };
}

function maintenanceRequest(
  overrides: Partial<CapsuleMaintenanceRequest> = {},
): CapsuleMaintenanceRequest {
  const { schema_version: _schema, command: _command, ...binding } = probeRequest();
  return {
    ...binding,
    schema_version: CAPSULE_MAINTENANCE_REQUEST_SCHEMA_VERSION,
    target_kind: "native_capsule",
    command: "BEGIN_REAUTH",
    expected_target_revision: C2,
    zero_live_evidence_digest: D1,
    drain_evidence_digest: D2,
    idempotency_key_digest: D0,
    ...overrides,
  };
}

function authority(
  current: () => NativeSubscriptionBindingSnapshot,
  ids: string[] = [IDS.grant, IDS.receipt],
) {
  const keys = generateKeyPairSync("ed25519");
  return {
    keys,
    value: new CapsuleMaintenanceAuthority({
      issuer: "accounts-self-hosted",
      issuerIncarnation: "accounts-incarnation-1",
      keyId: "accounts-maintenance-1",
      audience: "authcapsule-self-hosted",
      privateKey: keys.privateKey,
      publicKey: keys.publicKey,
      snapshots: { read: () => current() },
      clock: () => new Date(NOW),
      idFactory: () => ids.shift() ?? IDS.receipt,
    }),
  };
}

function canonicalBytes(value: unknown): Uint8Array {
  return Uint8Array.from(Buffer.from(canonicalJson(value), "utf8"));
}

describe("native subscription contract", () => {
  test("PROBE_NATIVE is closed, owner/node bound, and credential-free", async () => {
    const source = new StaticNativeSubscriptionSnapshotSource([snapshot()]);
    const result = await evaluateNativeSubscriptionProbe(probeRequest(), source, OWNER, NOW);
    expect(result.capability_eligible).toBe(true);
    expect(result.maintenance_ready).toBe(true);
    expect(Object.keys(result).some((key) => /credential|token|secret|password/i.test(key))).toBe(false);

    await expect(
      evaluateNativeSubscriptionProbe({ ...probeRequest(), command: "PROBE" }, source, OWNER, NOW),
    ).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
    await expect(
      evaluateNativeSubscriptionProbe({ ...probeRequest(), unexpected: true }, source, OWNER, NOW),
    ).rejects.toMatchObject({ code: "VALIDATION_FAILED" });

    const mismatch = await evaluateNativeSubscriptionProbe(
      probeRequest({ owner_ref: OTHER_OWNER }),
      source,
      OTHER_OWNER,
      NOW,
    );
    expect(mismatch.capability_eligible).toBe(false);
    expect(mismatch.maintenance_ready).toBe(false);
    expect(mismatch.reason_codes).toContain("OWNER_MISMATCH");
  });

  test("maintenance and quiescing are ineligible but remain Accounts-maintainable", async () => {
    for (const capsuleStatus of ["maintenance", "quiescing"] as const) {
      const source = new StaticNativeSubscriptionSnapshotSource([snapshot({ capsuleStatus })]);
      const result = await evaluateNativeSubscriptionProbe(probeRequest(), source, OWNER, NOW);
      expect(result.capability_eligible).toBe(false);
      expect(result.maintenance_ready).toBe(true);
      expect(result.reason_codes).toContain("CAPSULE_NOT_READY");
    }
  });

  test("Accounts alone issues exact target-split maintenance grants", async () => {
    let current = snapshot();
    const { value, keys } = authority(() => current, [IDS.grant]);
    const request = maintenanceRequest();
    const grant = await value.issueMaintenanceGrant(request, OWNER);
    expect(grant.schema_version).toBe(CAPSULE_MAINTENANCE_GRANT_SCHEMA_VERSION);
    expect(grant.command).toBe("BEGIN_REAUTH");
    expect(await value.issueMaintenanceGrant(request, OWNER)).toEqual(grant);
    expect(
      verifyCapsuleMaintenanceGrant(canonicalBytes(grant), {
        issuer: "accounts-self-hosted",
        issuerIncarnation: "accounts-incarnation-1",
        keyId: "accounts-maintenance-1",
        audience: "authcapsule-self-hosted",
        publicKey: keys.publicKey,
      }, NOW),
    ).toEqual(grant);
    expect(canonicalJson(grant)).not.toMatch(/credential|provider_effect|token|secret|password/i);

    await expect(
      value.issueMaintenanceGrant({ ...request, unexpected: true }, OWNER),
    ).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
    await expect(
      value.issueMaintenanceGrant({ ...request, command: "REVOKE_ACCOUNT" }, OWNER),
    ).rejects.toMatchObject({ code: "INVALID_TRANSITION" });
    await expect(
      value.issueMaintenanceGrant({ ...request, expected_target_revision: C1 }, OWNER),
    ).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });

    current = snapshot({ liveLeaseCount: C1 });
    const { value: blocked } = authority(() => current, [IDS.grant]);
    await expect(blocked.issueMaintenanceGrant(request, OWNER)).rejects.toMatchObject({
      code: "POLICY_DENIED",
    });
  });

  test("account-record commands enforce their exact lifecycle states", async () => {
    const resume = maintenanceRequest({
      target_kind: "account_record",
      command: "RESUME_ACCOUNT",
      expected_target_revision: C2,
      idempotency_key_digest: D1,
    });
    const { value: wrongState } = authority(() => snapshot(), [IDS.grant]);
    await expect(wrongState.issueMaintenanceGrant(resume, OWNER)).rejects.toMatchObject({
      code: "INVALID_TRANSITION",
    });
    const { value: suspended } = authority(
      () => snapshot({ accountStatus: "suspended" }),
      [IDS.grant],
    );
    await expect(suspended.issueMaintenanceGrant(resume, OWNER)).resolves.toMatchObject({
      target_kind: "account_record",
      command: "RESUME_ACCOUNT",
    });
  });

  test("grant consume is node-bound, one-use, replay-safe, and permits quiescing", async () => {
    let current = snapshot();
    const { value } = authority(() => current, [IDS.grant, IDS.receipt]);
    const grant = await value.issueMaintenanceGrant(maintenanceRequest(), OWNER);
    current = snapshot({ accountLaneStatus: "draining", capsuleStatus: "quiescing" });
    const consume = {
      schema_version: CAPSULE_MAINTENANCE_CONSUME_REQUEST_SCHEMA_VERSION,
      grant_id: grant.grant_id,
      operation_id: IDS.operation,
      request_digest: grant.request_digest,
      idempotency_key_digest: D1,
    } as const;
    const receipt = await value.consumeMaintenanceGrant(canonicalBytes(grant), consume, {
      authenticatedOwnerRef: OWNER,
      authenticatedNodeKeyThumbprint: D0,
    });
    expect(receipt.command).toBe("BEGIN_REAUTH");
    expect(await value.consumeMaintenanceGrant(canonicalBytes(grant), consume, {
      authenticatedOwnerRef: OWNER,
      authenticatedNodeKeyThumbprint: D0,
    })).toEqual(receipt);
    await expect(value.consumeMaintenanceGrant(canonicalBytes(grant), {
      ...consume,
      operation_id: IDS.receipt,
    }, {
      authenticatedOwnerRef: OWNER,
      authenticatedNodeKeyThumbprint: D0,
    })).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
    await expect(value.consumeMaintenanceGrant(canonicalBytes(grant), consume, {
      authenticatedOwnerRef: OTHER_OWNER,
      authenticatedNodeKeyThumbprint: D0,
    })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  test("concurrent consume produces exactly one operation receipt", async () => {
    const { value } = authority(() => snapshot(), [IDS.grant, IDS.receipt]);
    const grant = await value.issueMaintenanceGrant(maintenanceRequest(), OWNER);
    const first = {
      schema_version: CAPSULE_MAINTENANCE_CONSUME_REQUEST_SCHEMA_VERSION,
      grant_id: grant.grant_id,
      operation_id: IDS.operation,
      request_digest: grant.request_digest,
      idempotency_key_digest: D1,
    } as const;
    const transport = { authenticatedOwnerRef: OWNER, authenticatedNodeKeyThumbprint: D0 };
    const settled = await Promise.allSettled([
      value.consumeMaintenanceGrant(canonicalBytes(grant), first, transport),
      value.consumeMaintenanceGrant(canonicalBytes(grant), { ...first, operation_id: IDS.receipt }, transport),
    ]);
    expect(settled.filter((item) => item.status === "fulfilled")).toHaveLength(1);
    expect(settled.filter((item) => item.status === "rejected")).toHaveLength(1);
  });

  test("capability-use CAS atomically consumes ordinal one and preserves replay bytes", async () => {
    const keys = generateKeyPairSync("ed25519");
    const store = new InMemoryNativeCapabilityUseStore({
      issuer: "accounts-self-hosted",
      issuerIncarnation: "accounts-incarnation-1",
      keyId: "accounts-capability-use-1",
      audience: "infinity-self-hosted",
      privateKey: keys.privateKey,
      clock: () => new Date(NOW),
      idFactory: () => IDS.consumeReceipt,
      validateCurrent: () => ({
        catalogIncarnation: "accounts-catalog-1",
        recoveryFrontierSequence: C2,
        recoveryFrontierHash: D2,
      }),
    });
    const request = capabilityRequest();
    const consumed = await store.compareAndConsume(request);
    expect(consumed.status).toBe("consumed");
    if (consumed.status !== "consumed") throw new Error("expected consumed");
    const replay = await store.compareAndConsume(request);
    expect(replay.status).toBe("replayed");
    if (replay.status !== "replayed") throw new Error("expected replayed");
    expect(replay.signedReceipt).toEqual(consumed.signedReceipt);
    const receipt = parseClosedJsonBytes(consumed.signedReceipt) as Record<string, unknown>;
    expect(receipt.use_ordinal).toBe("1");
    expect(receipt.catalog_incarnation).toBe("accounts-catalog-1");

    const conflict = await store.compareAndConsume({ ...request, nonce: "nonce-conflict" });
    expect(conflict.status).toBe("idempotency_conflict");
    const exhausted = await store.compareAndConsume({
      ...request,
      consume_request_id: IDS.consume2,
      idempotency_key_digest: D2,
    });
    expect(exhausted.status).toBe("exhausted");

    const racing = new InMemoryNativeCapabilityUseStore({
      issuer: "accounts-self-hosted",
      issuerIncarnation: "accounts-incarnation-1",
      keyId: "accounts-capability-use-1",
      audience: "infinity-self-hosted",
      privateKey: keys.privateKey,
      clock: () => new Date(NOW),
      idFactory: () => IDS.consumeReceipt,
      validateCurrent: () => ({
        catalogIncarnation: "accounts-catalog-1",
        recoveryFrontierSequence: C2,
        recoveryFrontierHash: D2,
      }),
    });
    const results = await Promise.all([
      racing.compareAndConsume(request),
      racing.compareAndConsume({
        ...request,
        consume_request_id: IDS.consume2,
        idempotency_key_digest: D2,
      }),
    ]);
    expect(results.map((result) => result.status).sort()).toEqual(["consumed", "exhausted"]);
  });
});

function capabilityRequest(): OnlineGenerationReceiptUseCasRequest {
  return {
    schema_version: "accounts.capability-use-consume-request.v1",
    schema_digest: "sha256:a7cdc1dfbebeaea3bad6a5014cfb5189be40fb010f57161b46437458492cd1bc",
    consume_request_id: IDS.consume1,
    capability_id: IDS.capability,
    capability_digest: D0,
    nonce: "nonce-native-1",
    subject: "principal:service:hasna:infinity",
    actor_principal: OWNER,
    account_lane_id: IDS.lane,
    capacity_pool_id: IDS.capacityPool,
    capacity_domain_ref: "provider-openai-subscription-a",
    credential_family_id: "native-subscription-family-a",
    resource_lease_id: IDS.resourceLease,
    resource_id: "resource-native-lane-a",
    resource_lifecycle_generation: C1,
    operation_id: IDS.operation,
    operation_digest: D1,
    operation_execution_epoch: C1,
    sender_key_thumbprint: D0,
    channel_binding_digest: D1,
    canonical_request_digest: D2,
    provider_destination_policy_digest: D0,
    online_receipt_id: IDS.onlineReceipt,
    online_receipt_digest: D1,
    model_call_anchor_digest: D2,
    expected_use_count: C0,
    max_uses: C1,
    not_after: "2026-07-18T12:05:00.000Z",
    idempotency_key_digest: D1,
  };
}
