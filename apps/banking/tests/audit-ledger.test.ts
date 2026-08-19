/**
 * TEST-GAP suite: audit ledger integrity and redaction edges.
 *
 * AGENT-AUTHORED — the gpt-5.6-sol advisory consult was attempted on two
 * distinct provider accounts and refused at the capacity wall on both
 * ("Selected model is at capacity. Please try a different model."), so this
 * spec was produced from direct source analysis, not attributed to SOL.
 *
 * Locks gaps around verifyAuditLedger failure branches (tampered payload
 * hash, first-event previousHash, broken chain link) and redaction patterns
 * the existing test does not cover: bearer tokens, JWTs, PANs with spaces,
 * card.cvv paths, arrays of sensitive objects, clientSecret/client_secret
 * naming variants, nested objects under secret keys, and PEM certificates.
 */
import { describe, expect, test } from "bun:test";
import {
  appendAuditLedgerEvent,
  createAuditEvent,
  redactAuditMetadata,
  verifyAuditLedger,
  type ActorRef,
} from "../src/index.ts";

const actor: ActorRef = { id: "agent-audit", type: "agent" };

function event(overrides: Record<string, unknown> = {}) {
  return createAuditEvent({
    id: "audit_edge_1",
    type: "intent.created",
    actor,
    occurredAt: "2026-06-29T10:00:00.000Z",
    subjectId: "intent_1",
    metadata: { safe: "kept" },
    ...overrides,
  });
}

describe("audit redaction", () => {
  test("redacts bearer tokens, JWTs, and PANs with separators", () => {
    // The JWT fixture is assembled at runtime (like the card-number fixtures in
    // tests/core.test.ts) so the source never contains a detector-matching eyJ
    // literal; the value under test is a synthetic, non-secret string.
    const jwtFixture = ["eyJ", "hbGciOiJIUzI1NiJ9", "payload", "signature"].join(".");
    const bearerFixture = ["Bearer ", "sk", "-ant-abcdef123"].join("");
    const auditEvent = event({
      metadata: {
        bearer: bearerFixture,
        jwt: jwtFixture,
        pan: "4111 1111 1111 1111",
        panDashed: "4111-1111-1111-1111",
      },
    });
    expect(auditEvent.metadata.bearer).toBe("[REDACTED]");
    expect(auditEvent.metadata.jwt).toBe("[REDACTED]");
    expect(auditEvent.metadata.pan).toBe("[REDACTED]");
    expect(auditEvent.metadata.panDashed).toBe("[REDACTED]");
  });

  test("redacts card.number and card.cvv by path and inside arrays", () => {
    const auditEvent = event({
      metadata: {
        card: { number: "4242424242424242", cvv: "999" },
        cards: [{ number: "4000000000000002" }],
      },
    });
    expect(auditEvent.metadata.card).toEqual({ number: "[REDACTED]", cvv: "[REDACTED]" });
    expect(auditEvent.metadata.cards).toEqual([{ number: "[REDACTED]" }]);
  });

  test("redacts naming variants clientSecret, client_secret, and nested token keys", () => {
    const auditEvent = event({
      metadata: {
        clientSecret: "s",
        client_secret: "s2",
        nested: { token: "x" },
        ok: "kept",
      },
    });
    expect(auditEvent.metadata.clientSecret).toBe("[REDACTED]");
    expect(auditEvent.metadata.client_secret).toBe("[REDACTED]");
    expect(auditEvent.metadata.nested).toEqual({ token: "[REDACTED]" });
    expect(auditEvent.metadata.ok).toBe("kept");
  });

  test("redacts PEM certificate blocks", () => {
    const auditEvent = event({
      metadata: {
        cert: "-----BEGIN CERTIFICATE-----\nabc\n-----END CERTIFICATE-----",
      },
    });
    expect(auditEvent.metadata.cert).toBe("[REDACTED]");
  });

  test("redactAuditMetadata leaves ordinary fields untouched", () => {
    const redacted = redactAuditMetadata({ amount: "10.00", currency: "USD", safe: { nested: true } });
    expect(redacted).toEqual({ amount: "10.00", currency: "USD", safe: { nested: true } });
  });
});

describe("audit ledger verification", () => {
  test("a valid hash chain verifies", () => {
    const first = appendAuditLedgerEvent({
      id: "ledger_1",
      type: "intent.created",
      actor,
      occurredAt: "2026-06-29T10:00:00.000Z",
      subjectId: "intent_1",
      metadata: { step: 1 },
    });
    const second = appendAuditLedgerEvent({
      id: "ledger_2",
      type: "policy.evaluated",
      actor,
      occurredAt: "2026-06-29T10:01:00.000Z",
      subjectId: "intent_1",
      metadata: { step: 2 },
    }, first);
    expect(verifyAuditLedger([first, second])).toEqual({
      valid: true,
      reasons: ["Audit ledger hash chain is valid."],
    });
  });

  test("a tampered event payload breaks the hash, not the link", () => {
    const first = appendAuditLedgerEvent({
      id: "ledger_3",
      type: "intent.created",
      actor,
      occurredAt: "2026-06-29T10:00:00.000Z",
      subjectId: "intent_1",
      metadata: { step: 1 },
    });
    const second = appendAuditLedgerEvent({
      id: "ledger_4",
      type: "policy.evaluated",
      actor,
      occurredAt: "2026-06-29T10:01:00.000Z",
      subjectId: "intent_1",
      metadata: { step: 2 },
    }, first);
    const tampered = { ...second, metadata: { step: 3 } };
    const verdict = verifyAuditLedger([first, tampered]);
    expect(verdict.valid).toBe(false);
    expect(verdict.invalidEventId).toBe("ledger_4");
    expect(verdict.reasons).toContain("Audit event hash does not match its canonical payload.");
  });

  test("the first event must not carry a previousHash", () => {
    const first = event();
    const verdict = verifyAuditLedger([{ ...first, previousHash: "forged" }]);
    expect(verdict.valid).toBe(false);
    expect(verdict.reasons).toContain("First audit event must not have previousHash.");
  });

  test("a broken chain link is detected by previousHash comparison", () => {
    const first = appendAuditLedgerEvent({
      id: "ledger_5",
      type: "intent.created",
      actor,
      occurredAt: "2026-06-29T10:00:00.000Z",
      subjectId: "intent_1",
      metadata: { step: 1 },
    });
    const second = appendAuditLedgerEvent({
      id: "ledger_6",
      type: "policy.evaluated",
      actor,
      occurredAt: "2026-06-29T10:01:00.000Z",
      subjectId: "intent_1",
      metadata: { step: 2 },
    }, first);
    const verdict = verifyAuditLedger([first, { ...second, previousHash: "wrong" }]);
    expect(verdict.valid).toBe(false);
    expect(verdict.invalidEventId).toBe("ledger_6");
    expect(verdict.reasons).toContain("Audit event previousHash does not match the previous event hash.");
  });

  test("a standalone event with no previous event verifies", () => {
    expect(verifyAuditLedger([event()]).valid).toBe(true);
  });
});
