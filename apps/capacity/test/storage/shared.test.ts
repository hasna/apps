import { describe, expect, test } from "bun:test";
import { newOutboxId } from "../../src/domain/ids";
import { canonicalSha256 } from "../../src/serialization/json";
import type {
  AccountsRepository,
  VerifiedAuthorityEvidenceRecord,
} from "../../src/storage/repository";
import {
  assertReplacement,
  authorityEvidenceInsertHash,
  authorityPromotionHash,
  buildCredentialHandleExpectedClaims,
  cloneEntity,
  credentialBindingInsertHash,
  idempotencyScope,
  isAuthorityPromotion,
  mutationHash,
  validateCredentialHandleEnvelope,
  validateMutationContext,
  validateOutboxAcknowledgeRequest,
  validateOutboxClaimRequest,
  validateVerifiedAuthorityEvidence,
} from "../../src/storage/shared";
import { C0, CREATED_AT, makeFixtureGraph, mutationContext, NOW } from "../fixtures";

function evidenceRecord(source: Uint8Array): VerifiedAuthorityEvidenceRecord {
  const envelopeJson = new TextDecoder().decode(source);
  const envelope = JSON.parse(envelopeJson) as Record<string, string>;
  return {
    evidenceType: envelope.evidence_type,
    evidenceRef: envelope.evidence_ref,
    subjectRef: envelope.subject_ref,
    aggregateKind: envelope.aggregate_kind,
    aggregateId: envelope.aggregate_id,
    aggregateRevision: envelope.aggregate_revision,
    identityRealm: envelope.identity_realm,
    issuerRef: envelope.issuer_ref,
    issuerClass: envelope.issuer_class,
    issuerIncarnation: envelope.issuer_incarnation,
    audience: envelope.audience,
    keyId: envelope.key_id,
    issuedAt: envelope.issued_at,
    expiresAt: envelope.expires_at,
    nonce: envelope.nonce,
    evidenceGeneration: envelope.evidence_generation,
    payloadDigest: envelope.payload_digest,
    envelopeDigest: canonicalSha256(envelope),
    envelopeJson,
  } as VerifiedAuthorityEvidenceRecord;
}

describe("shared storage validation", () => {
  test("accepts valid mutation and outbox requests at their boundaries", () => {
    const now = NOW.toISOString();
    const claimExpiresAt = new Date(NOW.getTime() + 5 * 60_000).toISOString();

    expect(() => validateMutationContext(mutationContext("shared:valid"))).not.toThrow();
    expect(() =>
      validateOutboxClaimRequest({
        workerRef: "principal:service:hasna:outbox-worker",
        limit: 100,
        now,
        claimExpiresAt,
      }),
    ).not.toThrow();
    expect(() =>
      validateOutboxAcknowledgeRequest({
        outboxId: newOutboxId(NOW.getTime()),
        workerRef: "principal:service:hasna:outbox-worker",
        expectedAttemptCount: C0,
        outcome: "delivered",
        now,
      }),
    ).not.toThrow();
  });

  test("rejects malformed mutation and outbox requests", () => {
    expect(() =>
      validateMutationContext({
        ...mutationContext("shared:invalid-actor"),
        actorRef: "principal:external:attacker",
      }),
    ).toThrow(expect.objectContaining({ code: "VALIDATION_FAILED" }));
    expect(() =>
      validateOutboxClaimRequest({
        workerRef: "principal:human:hasna:owner",
        limit: 0,
        now: NOW.toISOString(),
        claimExpiresAt: NOW.toISOString(),
      }),
    ).toThrow(expect.objectContaining({ code: "VALIDATION_FAILED" }));
    expect(() =>
      validateOutboxAcknowledgeRequest({
        outboxId: newOutboxId(NOW.getTime()),
        workerRef: "principal:service:hasna:worker",
        expectedAttemptCount: "-1" as typeof C0,
        outcome: "retry",
        now: NOW.toISOString(),
      }),
    ).toThrow(expect.objectContaining({ code: "VALIDATION_FAILED" }));
  });

  test("validates credential envelopes and resolves their expected lineage", async () => {
    const graph = makeFixtureGraph("api_key", 321);
    expect(() => validateCredentialHandleEnvelope(graph.binding, graph.handle)).not.toThrow();
    expect(() =>
      validateCredentialHandleEnvelope(graph.binding, {
        ...graph.handle,
        backendClass: "workload_identity_broker",
      }),
    ).toThrow(expect.objectContaining({ code: "INVALID_ACCESS_TARGET" }));

    const records = {
      account: graph.account,
      capacity_pool: graph.pool,
      access_method: graph.method,
    } as const;
    const repository = {
      get: async (kind: keyof typeof records, id: string) => {
        const record = records[kind];
        return record.id === id ? record : undefined;
      },
    } as unknown as Pick<AccountsRepository, "get">;
    const claims = await buildCredentialHandleExpectedClaims(repository, graph.binding, {
      audience: graph.handle.audience,
      catalogIncarnation: graph.handle.catalogIncarnation,
      backendClass: graph.handle.backendClass,
    });

    expect(claims).toMatchObject({
      ownerRef: graph.account.ownerRef,
      providerAccountId: graph.account.id,
      capacityPoolId: graph.pool.id,
      accessMethodId: graph.method.id,
      credentialFamilyId: graph.binding.credentialFamilyId,
    });
    await expect(
      buildCredentialHandleExpectedClaims(
        { get: async () => undefined } as Pick<AccountsRepository, "get">,
        graph.binding,
        {
          audience: graph.handle.audience,
          catalogIncarnation: graph.handle.catalogIncarnation,
          backendClass: graph.handle.backendClass,
        },
      ),
    ).rejects.toMatchObject({ code: "INVALID_ACCESS_TARGET" });
  });
});

describe("shared storage records and hashes", () => {
  test("clones entities and scopes hashes to audited mutation input", () => {
    const graph = makeFixtureGraph("api_key", 322);
    const context = mutationContext("shared:hash");
    const clone = cloneEntity("account", graph.account);
    const firstHash = mutationHash("insert", "account", graph.account, context);
    const changedHash = mutationHash("insert", "account", graph.account, {
      ...context,
      reasonCode: "OTHER_REASON",
    });

    expect(clone).toEqual(graph.account);
    expect(clone).not.toBe(graph.account);
    expect(firstHash).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(changedHash).not.toBe(firstHash);
    expect(idempotencyScope("insert", "account", context)).toBe(
      `${context.actorRef}|insert|account|${context.idempotencyKey}`,
    );
    expect(isAuthorityPromotion("account", graph.account, graph.activeAccount)).toBe(true);
    expect(isAuthorityPromotion("account", graph.account, graph.account)).toBe(false);
  });

  test("validates stored authority evidence and includes evidence in hashes", () => {
    const graph = makeFixtureGraph("api_key", 323);
    const ownership = evidenceRecord(graph.ownershipEvidence);
    const capacity = evidenceRecord(graph.capacityEvidence);
    const context = mutationContext("shared:authority-hash");
    const validated = validateVerifiedAuthorityEvidence(
      "account",
      graph.account.id,
      C0,
      [ownership],
    );

    expect(validated).toEqual([ownership]);
    expect(Object.isFrozen(validated[0])).toBe(true);
    expect(
      authorityPromotionHash("account", graph.activeAccount, C0, validated, context),
    ).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(authorityEvidenceInsertHash(graph.pool, capacity, context)).toMatch(
      /^sha256:[0-9a-f]{64}$/,
    );
    expect(credentialBindingInsertHash(graph.binding, graph.handle, context)).toMatch(
      /^sha256:[0-9a-f]{64}$/,
    );
    expect(() =>
      validateVerifiedAuthorityEvidence("account", graph.account.id, C0, []),
    ).toThrow(expect.objectContaining({ code: "VALIDATION_FAILED" }));
    expect(() =>
      validateVerifiedAuthorityEvidence("account", graph.account.id, C0, [
        { ...ownership, issuerRef: "authority:substituted" },
      ]),
    ).toThrow(expect.objectContaining({ code: "VALIDATION_FAILED" }));
  });

  test("accepts an exact replacement and rejects stale or non-advancing updates", () => {
    const graph = makeFixtureGraph("api_key", 324);
    expect(() =>
      assertReplacement("account", graph.account, graph.activeAccount, C0),
    ).not.toThrow();
    expect(() =>
      assertReplacement("account", graph.account, graph.activeAccount, "1" as typeof C0),
    ).toThrow(expect.objectContaining({ code: "STALE_REVISION" }));
    expect(() =>
      assertReplacement(
        "account",
        graph.account,
        { ...graph.activeAccount, updatedAt: CREATED_AT },
        C0,
      ),
    ).toThrow(expect.objectContaining({ code: "VALIDATION_FAILED" }));
  });
});
