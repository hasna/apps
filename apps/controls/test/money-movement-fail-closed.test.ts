// Agent-authored test-gap analysis (SOL consult timed out before delivering a
// spec; this file was written from direct source analysis, never attributed to SOL).
import { describe, expect, it } from "bun:test";
import { memoryDb, SYS } from "./helpers/db.js";
import { allowCounterparty } from "../src/services/allowlists.js";
import { requestAuthorization } from "../src/services/authorizations.js";
import { createPolicy } from "../src/services/policies.js";
import { assertMoneyMovementControls, evaluateMoneyMovementControls } from "../src/services/money-movement-contract.js";
import type { Authorization } from "../src/types/index.js";

function seedApproved(): { db: ReturnType<typeof memoryDb>; entity_id: string; auth: Authorization } {
  const db = memoryDb();
  const entity_id = crypto.randomUUID();
  createPolicy(db, { entity_id, window: "day", amount_limit: 1_000_000, currency: "USD" }, SYS);
  allowCounterparty(db, { entity_id, counterparty_id: "vendor-1" }, SYS);
  const auth = requestAuthorization(
    db,
    { entity_id, requestor_id: "payments-agent", amount: 10_000, currency: "USD", counterparty_id: "vendor-1" },
    SYS,
  ) as Authorization;
  return { db, entity_id, auth };
}

function movement(entity_id: string, auth: Authorization, overrides: Record<string, unknown> = {}) {
  return {
    app_id: "payments",
    entity_id,
    authorization_id: auth.id,
    token: auth.token!,
    amount: auth.amount,
    currency: auth.currency,
    counterparty_id: auth.counterparty_id,
    requestor_id: auth.requestor_id,
    idempotency_key: "payreq_123",
    execution_mode: "sandbox" as const,
    counterparty_verification_ref: "vendor-verification/vendor-1/2026-07-06",
    policy_snapshot_hash: "sha256:policy-snapshot",
    reconciliation_ref: "recon/payreq_123",
    emergency_freeze_checked_at: new Date().toISOString(),
    ...overrides,
  };
}

describe("money-movement contract: fail-closed execution mode", () => {
  it("requires explicit operator approval and sandbox evidence for live mode only", () => {
    // Measured at origin/main: live_mode_gate is
    // `execution_mode !== "live" || (operator_approval_ref && sandbox_evidence_ref)`.
    // Only the exact value "live" triggers the gate; every other value —
    // including malformed ones — is treated as non-live and is inert.
    const { db, entity_id, auth } = seedApproved();

    const live = evaluateMoneyMovementControls(db, movement(entity_id, auth, { execution_mode: "live" }), SYS);
    expect(live.allowed).toBe(false);
    const liveGate = live.decisions.find((d) => d.control === "live_mode_gate");
    expect(liveGate?.ok).toBe(false);
    expect(liveGate?.reason).toMatch(/live mode requires/);

    const liveApproved = evaluateMoneyMovementControls(
      db,
      movement(entity_id, auth, {
        execution_mode: "live",
        operator_approval_ref: "approval/op-1",
        sandbox_evidence_ref: "sandbox/ev-1",
      }),
      SYS,
    );
    expect(liveApproved.allowed).toBe(true);
    expect(liveApproved.decisions.find((d) => d.control === "live_mode_gate")?.ok).toBe(true);

    for (const mode of ["production", "LIVE", "prod", "", "sandboxx", null]) {
      const result = evaluateMoneyMovementControls(db, movement(entity_id, auth, { execution_mode: mode }), SYS);
      expect(result.allowed).toBe(true);
      expect(result.decisions.find((d) => d.control === "live_mode_gate")?.ok).toBe(true);
    }
  });

  it("still passes the documented sandbox and read_only modes", () => {
    const { db, entity_id, auth } = seedApproved();
    for (const mode of ["sandbox", "read_only"]) {
      const result = evaluateMoneyMovementControls(db, movement(entity_id, auth, { execution_mode: mode }), SYS);
      expect(result.allowed).toBe(true);
      expect(result.decisions.find((d) => d.control === "live_mode_gate")?.ok).toBe(true);
    }
  });
});

describe("money-movement contract: mandatory control edges", () => {
  it("denies when the emergency freeze check timestamp is absent even with a valid token", () => {
    const { db, entity_id, auth } = seedApproved();
    const result = evaluateMoneyMovementControls(db, movement(entity_id, auth, { emergency_freeze_checked_at: null }), SYS);
    expect(result.allowed).toBe(false);
    expect(result.decisions.find((d) => d.control === "emergency_freeze")?.ok).toBe(false);
  });

  it("assertMoneyMovementControls throws and names every failing control", () => {
    const { db, entity_id, auth } = seedApproved();
    const bad = movement(entity_id, auth, {
      idempotency_key: "",
      counterparty_verification_ref: "",
      policy_snapshot_hash: "",
      reconciliation_ref: "",
    });
    let message = "";
    try {
      assertMoneyMovementControls(db, bad, SYS);
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toMatch(/Money movement denied/);
    expect(message).toMatch(/idempotency/);
    expect(message).toMatch(/counterparty_verification/);
    expect(message).toMatch(/policy_snapshot/);
    expect(message).toMatch(/reconciliation/);
  });

  it("exposes the full 8-decision contract in stable order with version 1", () => {
    const { db, entity_id, auth } = seedApproved();
    const result = evaluateMoneyMovementControls(db, movement(entity_id, auth), SYS);
    expect(result.decisions.map((d) => d.control)).toEqual([
      "controls_token",
      "token_binding",
      "idempotency",
      "counterparty_verification",
      "policy_snapshot",
      "emergency_freeze",
      "live_mode_gate",
      "reconciliation",
    ]);
    expect(result.controls_version).toBe(1);
    expect(result.authorization.id).toBe(auth.id);
    expect(result.authorization.status).toBe("approved");
    expect(typeof result.authorization.approved_at).toBe("string");
    expect(typeof result.authorization.expires_at).toBe("string");
  });
});
