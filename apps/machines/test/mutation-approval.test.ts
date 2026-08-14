import { createHmac } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "bun:test";
import { closeDb } from "../src/db.js";
import {
  LEGACY_MUTATION_APPROVAL_FLAG_ENV,
  MUTATION_APPROVAL_FLAG_ENV,
  MUTATION_APPROVAL_REPLAY_PATH_ENV,
  MUTATION_APPROVAL_TOKEN_ENV,
  assertMutationApproved,
  canonicalMutationArgs,
  createMutationApprovalToken,
  isMutationApproved,
  mutationArgsSha256,
  verifyMutationApprovalToken,
  type MutationApprovalClaims,
} from "../src/commands/mutation-approval.js";

function signLegacyTokenWithoutNonce(claims: Omit<MutationApprovalClaims, "nonce">, secret: string): string {
  const payload = Buffer.from(JSON.stringify(claims)).toString("base64url");
  const signature = createHmac("sha256", secret).update(payload).digest("base64url");
  return `machines-mut-v1.${payload}.${signature}`;
}

afterEach(() => {
  closeDb();
});

describe("mutation approval", () => {
  test("denies mutations by default", () => {
    const env = {};
    expect(isMutationApproved({ env })).toBe(false);
    expect(isMutationApproved({
      env,
      surface: "mcp",
      operation: "machines_manifest_remove",
      machineId: "demo-node-01",
      transport: "mcp",
    })).toBe(false);
    expect(() => assertMutationApproved({ surface: "mcp", operation: "machines_apps_apply", env }))
      .toThrow("requires operator approval");
  });

  test("accepts explicit local opt-in flags", () => {
    expect(isMutationApproved({ env: { [MUTATION_APPROVAL_FLAG_ENV]: "1" } })).toBe(true);
    expect(isMutationApproved({ env: { [LEGACY_MUTATION_APPROVAL_FLAG_ENV]: "true" } })).toBe(true);
  });

  test("requires scoped signed approval token when token mode is configured", () => {
    const env = {
      [MUTATION_APPROVAL_FLAG_ENV]: "1",
      [MUTATION_APPROVAL_TOKEN_ENV]: "secret",
    };
    const now = Date.UTC(2026, 5, 19, 8, 0, 0);
    const token = createMutationApprovalToken({
      surface: "mcp",
      operation: "machines_manifest_remove",
      machineId: "demo-node-01",
      callerId: "mcp-test-client",
      runId: "run-001",
      transport: "mcp",
    }, { env, now, nonce: "nonce-001" });

    expect(isMutationApproved({ env })).toBe(true);
    expect(isMutationApproved({
      env,
      surface: "mcp",
      operation: "machines_manifest_remove",
      machineId: "demo-node-01",
      transport: "mcp",
      now,
    })).toBe(false);
    expect(isMutationApproved({
      env,
      approvalToken: "wrong",
      surface: "mcp",
      operation: "machines_manifest_remove",
      machineId: "demo-node-01",
      transport: "mcp",
      now,
    })).toBe(false);
    expect(isMutationApproved({
      env,
      approvalToken: "secret",
      surface: "mcp",
      operation: "machines_manifest_remove",
      machineId: "demo-node-01",
      transport: "mcp",
      now,
    })).toBe(false);
    expect(isMutationApproved({
      env,
      approvalToken: token,
      surface: "mcp",
      operation: "machines_manifest_remove",
      machineId: "demo-node-01",
      transport: "mcp",
      now,
    })).toBe(true);
    expect(isMutationApproved({
      env,
      approvalToken: token,
      surface: "mcp",
      operation: "machines_manifest_remove",
      machineId: "other-node",
      transport: "mcp",
      now,
    })).toBe(false);
    expect(isMutationApproved({
      env,
      approvalToken: token,
      surface: "mcp",
      operation: "machines_manifest_remove",
      machineId: "demo-node-01",
      transport: "cli",
      now,
    })).toBe(false);
    expect(verifyMutationApprovalToken({
      env,
      approvalToken: token,
      surface: "mcp",
      operation: "machines_manifest_remove",
      machineId: "demo-node-01",
      callerId: "other-client",
      transport: "mcp",
      now,
    }).approved).toBe(false);
    expect(verifyMutationApprovalToken({
      env,
      approvalToken: token,
      surface: "mcp",
      operation: "machines_manifest_remove",
      machineId: "demo-node-01",
      transport: "mcp",
      now: now + 301_000,
    }).approved).toBe(false);
  });

  test("binds scoped tokens to canonical mutation arguments", () => {
    const env = { [MUTATION_APPROVAL_TOKEN_ENV]: "secret" };
    const now = Date.UTC(2026, 5, 19, 8, 0, 0);
    expect(canonicalMutationArgs({
      target: "safe",
      approval_token: "redacted",
      nested: { b: 2, a: true, approvalToken: "redacted" },
    })).toBe(canonicalMutationArgs({
      nested: { approvalToken: "different", a: true, b: 2 },
      approval_token: "different",
      target: "safe",
    }));

    const args = {
      machine_id: "demo-node-01",
      yes: true,
      data: { nested: ["a", "b"] },
      approval_token: "not-hashed",
    };
    const token = createMutationApprovalToken({
      surface: "mcp",
      operation: "machines_events_emit",
      resourceId: "event:demo:*:*",
      callerId: "mcp",
      runId: "mcp",
      transport: "mcp:stdio",
      args,
    }, { env, now, nonce: "args-bound" });

    expect(verifyMutationApprovalToken({
      env,
      approvalToken: token,
      surface: "mcp",
      operation: "machines_events_emit",
      resourceId: "event:demo:*:*",
      callerId: "mcp",
      runId: "mcp",
      transport: "mcp:stdio",
      args: { ...args, approval_token: "different-token-value" },
      now,
    }).approved).toBe(true);
    expect(verifyMutationApprovalToken({
      env,
      approvalToken: token,
      surface: "mcp",
      operation: "machines_events_emit",
      resourceId: "event:demo:*:*",
      callerId: "mcp",
      runId: "mcp",
      transport: "mcp:stdio",
      args: { ...args, data: { nested: ["tampered"] } },
      now,
    }).reason).toContain("args_sha256");
    expect(verifyMutationApprovalToken({
      env,
      approvalToken: createMutationApprovalToken({
        surface: "mcp",
        operation: "machines_events_emit",
        resourceId: "event:demo:*:*",
        callerId: "mcp",
        runId: "mcp",
        transport: "mcp:stdio",
      }, { env, now, nonce: "missing-args-hash" }),
      surface: "mcp",
      operation: "machines_events_emit",
      resourceId: "event:demo:*:*",
      callerId: "mcp",
      runId: "mcp",
      transport: "mcp:stdio",
      args,
      now,
    }).approved).toBe(false);
    expect(mutationArgsSha256(args)).toMatch(/^[a-f0-9]{64}$/);
  });

  test("rejects scoped tokens without caller, run, transport, or bounded TTL claims", () => {
    const env = { [MUTATION_APPROVAL_TOKEN_ENV]: "secret" };
    const now = Date.UTC(2026, 5, 19, 8, 0, 0);
    const missingRun = createMutationApprovalToken({
      surface: "mcp",
      operation: "machines_manifest_remove",
      machineId: "demo-node-01",
      callerId: "mcp-test-client",
      transport: "mcp",
    }, { env, now });
    const longLived = createMutationApprovalToken({
      surface: "mcp",
      operation: "machines_manifest_remove",
      machineId: "demo-node-01",
      callerId: "mcp-test-client",
      runId: "run-001",
      transport: "mcp",
    }, { env, now, ttlMs: 301_000 });

    expect(verifyMutationApprovalToken({
      env,
      approvalToken: missingRun,
      surface: "mcp",
      operation: "machines_manifest_remove",
      machineId: "demo-node-01",
      transport: "mcp",
      now,
    }).reason).toContain("caller and run");
    expect(verifyMutationApprovalToken({
      env,
      approvalToken: longLived,
      surface: "mcp",
      operation: "machines_manifest_remove",
      machineId: "demo-node-01",
      transport: "mcp",
      now,
    }).reason).toContain("TTL");
  });

  test("records and rejects replayed nonces when a durable replay database is configured", () => {
    const dir = mkdtempSync(join(tmpdir(), "machines-replay-db-"));
    try {
      const env = {
        [MUTATION_APPROVAL_TOKEN_ENV]: "secret",
        [MUTATION_APPROVAL_REPLAY_PATH_ENV]: join(dir, "machines.db"),
      };
      const now = Date.UTC(2026, 5, 19, 8, 0, 0);
      const scope = {
        surface: "mcp",
        operation: "machines_manifest_remove",
        machineId: "demo-node-01",
        callerId: "mcp",
        runId: "mcp",
        transport: "mcp:stdio",
        args: { machine_id: "demo-node-01" },
      };
      const token = createMutationApprovalToken(scope, { env, now, nonce: "replay-001" });

      expect(verifyMutationApprovalToken({
        env,
        approvalToken: token,
        ...scope,
        now,
      }).approved).toBe(true);
      const replay = verifyMutationApprovalToken({
        env,
        approvalToken: token,
        ...scope,
        now,
      });
      expect(replay.approved).toBe(false);
      expect(replay.reason).toContain("already been used");
    } finally {
      closeDb();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("allows legacy no-nonce tokens without replay storage and rejects them with replay storage", () => {
    const dir = mkdtempSync(join(tmpdir(), "machines-legacy-replay-db-"));
    try {
      const secret = "secret";
      const now = Date.UTC(2026, 5, 19, 8, 0, 0);
      const args = { machine_id: "demo-node-01" };
      const token = signLegacyTokenWithoutNonce({
        version: 1,
        surface: "mcp",
        operation: "machines_manifest_remove",
        machineId: "demo-node-01",
        callerId: "mcp",
        runId: "mcp",
        transport: "mcp:stdio",
        issuedAt: now,
        expiresAt: now + 60_000,
        args_sha256: mutationArgsSha256(args),
      }, secret);
      const base = {
        [MUTATION_APPROVAL_TOKEN_ENV]: secret,
      };

      expect(verifyMutationApprovalToken({
        env: base,
        approvalToken: token,
        surface: "mcp",
        operation: "machines_manifest_remove",
        machineId: "demo-node-01",
        callerId: "mcp",
        runId: "mcp",
        transport: "mcp:stdio",
        args,
        now,
      }).approved).toBe(true);

      const replayProtected = verifyMutationApprovalToken({
        env: { ...base, [MUTATION_APPROVAL_REPLAY_PATH_ENV]: join(dir, "machines.db") },
        approvalToken: token,
        surface: "mcp",
        operation: "machines_manifest_remove",
        machineId: "demo-node-01",
        callerId: "mcp",
        runId: "mcp",
        transport: "mcp:stdio",
        args,
        now,
      });
      expect(replayProtected.approved).toBe(false);
      expect(replayProtected.reason).toContain("nonce claim");
    } finally {
      closeDb();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("does not claim replay nonces for expired tokens and does not fall back to local flags after token replay", () => {
    const dir = mkdtempSync(join(tmpdir(), "machines-replay-expired-"));
    try {
      const env = {
        [MUTATION_APPROVAL_TOKEN_ENV]: "secret",
        [MUTATION_APPROVAL_REPLAY_PATH_ENV]: join(dir, "machines.db"),
        [MUTATION_APPROVAL_FLAG_ENV]: "1",
      };
      const now = Date.UTC(2026, 5, 19, 8, 0, 0);
      const scope = {
        surface: "cli",
        operation: "manifest_remove",
        machineId: "demo-node-01",
        callerId: "cli",
        runId: "cli",
        transport: "cli",
        args: { machine_id: "demo-node-01" },
      };
      const expired = createMutationApprovalToken(scope, { env, now, ttlMs: 1, nonce: "expired-not-claimed" });
      expect(verifyMutationApprovalToken({
        env,
        approvalToken: expired,
        ...scope,
        now: now + 2_000,
      }).reason).toContain("expired");

      const valid = createMutationApprovalToken(scope, { env, now: now + 2_000, nonce: "expired-not-claimed" });
      expect(isMutationApproved({
        env,
        approvalToken: valid,
        ...scope,
        now: now + 2_000,
      })).toBe(true);
      expect(isMutationApproved({
        env,
        approvalToken: valid,
        ...scope,
        now: now + 2_000,
      })).toBe(false);
    } finally {
      closeDb();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
