// Sol-guided coverage (tests-coverage-sol workflow, lane controls) — Priority 1:
// money-authorization token forgery prevention (src/services/token.ts).
// The gate: on the PostgreSQL backend a real HASNA_CONTROLS_TOKEN_SECRET /
// CONTROLS_TOKEN_SECRET is REQUIRED before signing, because anyone who knows the
// open-source local-dev default plus an authorization's non-secret fields could
// forge a valid single-use money token. These tests must fail if that gate is
// removed.
import { afterEach, describe, expect, it } from "bun:test";
import { signAuthorizationToken, verifyAuthorizationToken } from "../src/services/token.js";
import type { Authorization } from "../src/types/index.js";

const ENV_KEYS = [
  "HASNA_CONTROLS_DATABASE_URL",
  "CONTROLS_DATABASE_URL",
  "HASNA_CONTROLS_TOKEN_SECRET",
  "CONTROLS_TOKEN_SECRET",
] as const;

function auth(overrides: Partial<Pick<Authorization, "id" | "entity_id" | "amount" | "currency" | "counterparty_id" | "requestor_id">> = {}) {
  return {
    id: "auth-1",
    entity_id: "ent-1",
    amount: 500,
    currency: "USD",
    counterparty_id: "cp-1",
    requestor_id: "req-1",
    ...overrides,
  };
}

function thrownMessage(fn: () => unknown): string {
  try {
    fn();
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
  throw new Error("expected the call to throw, but it returned");
}

afterEach(() => {
  for (const key of ENV_KEYS) delete process.env[key];
});

describe("token signing: PostgreSQL forgery gate", () => {
  it("refuses to sign with the built-in local-dev default on PostgreSQL (the forgery gate)", () => {
    // Presence of a DATABASE_URL selects the PostgreSQL backend; the value is
    // never read — a placeholder is enough and nothing here connects anywhere.
    process.env["HASNA_CONTROLS_DATABASE_URL"] = "postgresql://placeholder-host/controls";
    const message = thrownMessage(() => signAuthorizationToken(auth()));
    expect(message).toContain("HASNA_CONTROLS_TOKEN_SECRET");
    expect(message).toContain("built-in local-dev default");
    // And the refusal is exact: it names the two accepted env-var names.
    expect(message).toContain("CONTROLS_TOKEN_SECRET");
  });

  it("the short CONTROLS_DATABASE_URL alias also selects PostgreSQL and refuses", () => {
    process.env["CONTROLS_DATABASE_URL"] = "postgresql://placeholder-host/controls";
    expect(thrownMessage(() => signAuthorizationToken(auth()))).toContain("built-in local-dev default");
  });
});

describe("token signing: configured secret", () => {
  it("signs and verifies, and any tampered money field fails verification (two-sided)", () => {
    process.env["HASNA_CONTROLS_TOKEN_SECRET"] = "test-signing-secret-0123456789abcdef";
    const original = auth();
    const token = signAuthorizationToken(original);
    expect(token).toMatch(/^[0-9a-f]{64}$/);
    expect(verifyAuthorizationToken(original, token)).toBe(true);

    // Negative cases: every money-relevant field is bound to the token.
    expect(verifyAuthorizationToken(auth({ amount: 501 }), token)).toBe(false);
    expect(verifyAuthorizationToken(auth({ currency: "EUR" }), token)).toBe(false);
    expect(verifyAuthorizationToken(auth({ counterparty_id: "cp-2" }), token)).toBe(false);
    expect(verifyAuthorizationToken(auth({ id: "auth-2" }), token)).toBe(false);
    expect(verifyAuthorizationToken(auth({ entity_id: "ent-2" }), token)).toBe(false);
    expect(verifyAuthorizationToken(auth({ requestor_id: "req-2" }), token)).toBe(false);
    // A different authorization signs a different token.
    expect(signAuthorizationToken(auth({ amount: 501 }))).not.toBe(token);
  });

  it("honors the short CONTROLS_TOKEN_SECRET alias", () => {
    process.env["CONTROLS_TOKEN_SECRET"] = "test-short-alias-secret-abcdef0123456789";
    const original = auth();
    const token = signAuthorizationToken(original);
    expect(verifyAuthorizationToken(original, token)).toBe(true);
    expect(verifyAuthorizationToken(auth({ amount: 1 }), token)).toBe(false);
  });
});

describe("token signing: SQLite local-development default", () => {
  it("signs and verifies with the built-in default when no DATABASE_URL is set", () => {
    // No DATABASE_URL, no secret: the SQLite backend may use the local-dev default.
    const original = auth();
    const token = signAuthorizationToken(original);
    expect(verifyAuthorizationToken(original, token)).toBe(true);
    // Still bound to the money fields.
    expect(verifyAuthorizationToken(auth({ amount: 499 }), token)).toBe(false);
  });
});
