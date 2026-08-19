/**
 * TEST-GAP suite: idempotency fingerprint edge conditions.
 *
 * AGENT-AUTHORED — the gpt-5.6-sol advisory consult was attempted on two
 * distinct provider accounts and refused at the capacity wall on both
 * ("Selected model is at capacity. Please try a different model."), so this
 * spec was produced from direct source analysis, not attributed to SOL.
 *
 * Locks gaps around stableStringify (key-order independence, undefined
 * filtering, nested structures), hash determinism, fingerprint key prefixes,
 * canonical-intent payload stability (status/approvalId excluded), and the
 * "new" decision path that tests/core.test.ts never exercises.
 */
import { describe, expect, test } from "bun:test";
import {
  canonicalIntentPayload,
  createIdempotencyFingerprint,
  createIntentFingerprint,
  decideIdempotencyReplay,
  hashPayload,
  moneyFromDecimal,
  stableStringify,
  type ActorRef,
  type PaymentRequestIntent,
} from "../src/index.ts";

const requester: ActorRef = { id: "agent-idem", type: "agent" };

function paymentIntent(overrides: Partial<PaymentRequestIntent> = {}): PaymentRequestIntent {
  return {
    id: "intent_idem_1",
    type: "payment.request",
    providerId: "mercury",
    requester,
    idempotencyKey: "payment:demo",
    status: "draft",
    createdAt: "2026-06-29T10:00:00.000Z",
    metadata: { reason: "test" },
    sourceAccountId: "acct_1",
    counterparty: { name: "Vendor", providerRecipientId: "recipient_1" },
    amount: moneyFromDecimal("100.00", "USD"),
    rail: "ach",
    ...overrides,
  };
}

describe("stableStringify canonicalization", () => {
  test("is independent of object key insertion order at every nesting level", () => {
    expect(stableStringify({ a: 1, b: 2 })).toBe(stableStringify({ b: 2, a: 1 }));
    expect(stableStringify({ b: { d: 4, c: 3 }, a: [1, 2] })).toBe(stableStringify({ a: [1, 2], b: { c: 3, d: 4 } }));
    expect(stableStringify([3, { b: 2, a: 1 }])).toBe(stableStringify([3, { a: 1, b: 2 }]));
  });

  test("drops undefined object values but keeps null and zero", () => {
    expect(stableStringify({ a: 1, b: undefined })).toBe('{"a":1}');
    expect(stableStringify({ a: null, b: 0 })).toBe('{"a":null,"b":0}');
  });

  test("hashPayload is deterministic across JSON key order", () => {
    expect(hashPayload({ a: 1, b: 2 })).toBe(hashPayload({ b: 2, a: 1 }));
    expect(hashPayload({ card: { number: "x", cvv: "y" }, amount: "1" }))
      .toBe(hashPayload({ amount: "1", card: { cvv: "y", number: "x" } }));
  });

  test("hashPayload fails closed on non-stringable top-level input", () => {
    // JSON.stringify(undefined) is not a string; createHash.update rejects it.
    expect(() => hashPayload(undefined)).toThrow();
  });
});

describe("idempotency fingerprint construction", () => {
  test("namespaces the key with the provided prefix and a 32-hex payload hash", () => {
    const fingerprint = createIdempotencyFingerprint("ns", { a: 1 });
    expect(fingerprint.key).toBe(`ns:${fingerprint.payloadHash.slice(0, 32)}`);
    expect(fingerprint.payloadHash).toMatch(/^[0-9a-f]{64}$/);
  });

  test("different namespaces produce different keys for the same payload", () => {
    const a = createIdempotencyFingerprint("ns-a", { a: 1 });
    const b = createIdempotencyFingerprint("ns-b", { a: 1 });
    expect(a.key).not.toBe(b.key);
    expect(a.payloadHash).toBe(b.payloadHash);
  });

  test("intent fingerprints key on provider and type, and ignore status and approvalId", () => {
    const intent = paymentIntent();
    const keyed = createIntentFingerprint(intent);
    expect(keyed.key.startsWith("intent:mercury:payment.request:")).toBe(true);
    expect(keyed.payloadHash).toHaveLength(64);

    const differentStatus = createIntentFingerprint({ ...intent, status: "succeeded" });
    expect(differentStatus.payloadHash).toBe(keyed.payloadHash);

    const withApproval = createIntentFingerprint({ ...intent, approvalId: "approval_9" } as PaymentRequestIntent);
    expect(withApproval.payloadHash).toBe(keyed.payloadHash);

    const changedAmount = createIntentFingerprint({ ...intent, amount: moneyFromDecimal("101.00", "USD") });
    expect(changedAmount.payloadHash).not.toBe(keyed.payloadHash);
    expect(changedAmount.key).not.toBe(keyed.key);
  });

  test("canonicalIntentPayload excludes status and approvalId but keeps everything else", () => {
    const intent = paymentIntent();
    const canonical = canonicalIntentPayload({ ...intent, status: "failed", approvalId: "approval_9" } as PaymentRequestIntent);
    expect(canonical).not.toHaveProperty("status");
    expect(canonical).not.toHaveProperty("approvalId");
    expect(canonical).toHaveProperty("sourceAccountId", "acct_1");
    expect(canonical).toHaveProperty("amount");
    expect(canonical).toHaveProperty("metadata");
  });
});

describe("replay decision matrix", () => {
  test("no existing fingerprint is a new reservation", () => {
    const incoming = createIntentFingerprint(paymentIntent());
    const decision = decideIdempotencyReplay(incoming);
    expect(decision).toEqual({ status: "new", key: incoming.key });
  });

  test("identical key and hash is a replay", () => {
    const first = createIntentFingerprint(paymentIntent());
    const second = createIntentFingerprint(paymentIntent());
    expect(decideIdempotencyReplay(second, first).status).toBe("replay");
  });

  test("same key with a different payload is a conflict carrying the reason", () => {
    const first = createIntentFingerprint(paymentIntent());
    const second = createIntentFingerprint(paymentIntent({ amount: moneyFromDecimal("50.00", "USD") }));
    const decision = decideIdempotencyReplay({ ...second, key: first.key }, first);
    expect(decision.status).toBe("conflict");
    expect(decision.reason).toBe("Idempotency key already exists with a different payload.");
  });
});
