import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { LoopMutationConflictError } from "./errors.js";
import type { LoopMutationEnvelope } from "./operation-contract.js";
import { Store } from "./store.js";

const authority = { authorityId: "loops-control-plane", tenantId: "tenant-a" };

function envelope(
  targetId: string,
  expectedRevision: string,
  patch: Partial<LoopMutationEnvelope> = {},
): LoopMutationEnvelope {
  return {
    schema: "openloops.loop_mutation.v1",
    operationId: "operation-a",
    stepId: "pause-step",
    targetId,
    action: "pause",
    expectedRevision,
    approvedPlanDigest: "1".repeat(64),
    manifestDigest: "2".repeat(64),
    descriptorRef: "owner-operation-target:loop-target-a",
    descriptorDigest: "3".repeat(64),
    ...patch,
  };
}

function createLoop(store: Store) {
  return store.createLoop({
    name: "mutation-target",
    schedule: { type: "interval", everyMs: 60_000 },
    target: { type: "command", command: "private-command", args: ["private-argument"] },
  }, new Date("2026-08-10T00:00:00.000Z"));
}

describe("loop mutation storage contract", () => {
  test("applies a full-id CAS mutation exactly once and replays immutable receipts", () => {
    const store = new Store(":memory:");
    try {
      const loop = createLoop(store);
      const input = envelope(loop.id, loop.updatedAt);
      const first = store.mutateLoop(input, authority, { now: new Date("2026-08-10T00:00:01.000Z") });
      const retry = store.mutateLoop(input, authority, { now: new Date("2026-08-10T00:00:02.000Z") });
      expect(first.replayed).toBe(false);
      expect(retry.replayed).toBe(true);
      expect(first.loop.status).toBe("paused");
      expect(retry.loop.updatedAt).toBe(first.loop.updatedAt);
      expect(retry.admission).toEqual(first.admission);
      expect(retry.terminal).toEqual(first.terminal);
      expect(store.getLoop(loop.id)?.updatedAt).toBe(first.loop.updatedAt);
      expect(JSON.stringify({
        binding: first.binding,
        admission: first.admission,
        terminal: first.terminal,
      })).not.toContain("private-command");
      expect(JSON.stringify({
        binding: first.binding,
        admission: first.admission,
        terminal: first.terminal,
      })).not.toContain("private-argument");
    } finally {
      store.close();
    }
  });

  test("rejects names, missing and stale revisions, changed retry bindings, and wrong tenants", () => {
    const store = new Store(":memory:");
    try {
      const loop = createLoop(store);
      expect(() => store.mutateLoop(envelope("mutation-target", loop.updatedAt), authority)).toThrow("full stable target id");
      expect(() => store.mutateLoop(envelope(loop.id, ""), authority)).toThrow("expectedRevision");
      expect(() => store.mutateLoop(envelope(loop.id, "2026-08-09T00:00:00.000Z"), authority))
        .toThrow("revision_mismatch");

      const input = envelope(loop.id, loop.updatedAt);
      store.mutateLoop(input, authority, { now: new Date("2026-08-10T00:00:01.000Z") });
      expect(() => store.mutateLoop(
        { ...input, descriptorDigest: "4".repeat(64) },
        authority,
      )).toThrow("binding_mismatch");
      expect(() => store.mutateLoop(
        { ...input, descriptorRef: "owner-operation-target:loop-target-b" },
        authority,
      )).toThrow("binding_mismatch");
      expect(store.getLoopMutationResult(
        { ...authority, tenantId: "tenant-b" },
        input.operationId,
        input.stepId,
      )).toBeUndefined();
    } finally {
      store.close();
    }
  });

  test("dry-run returns receipts without changing the target and reconciliation enforces every cap", () => {
    const store = new Store(":memory:");
    try {
      const loop = createLoop(store);
      const input = envelope(loop.id, loop.updatedAt, {
        operationId: "operation-dry",
        stepId: "stop-preview",
        action: "stop",
        dryRun: true,
      });
      const preview = store.mutateLoop(input, authority);
      expect(preview.terminal.state).toBe("dry_run");
      expect(preview.loop.status).toBe("active");
      expect(store.getLoop(loop.id)?.status).toBe("active");
      expect(store.getLoopMutationResult(authority, input.operationId, input.stepId)?.terminal)
        .toEqual(preview.terminal);
      expect(() => store.getLoopMutationResult(authority, input.operationId, input.stepId, {
        maxCalls: 0,
        maxRecords: 2,
        maxBytes: 64 * 1024,
        maxWallMs: 250,
      })).toThrow("call cap");
      expect(() => store.getLoopMutationResult(authority, input.operationId, input.stepId, {
        maxCalls: 1,
        maxRecords: 2,
        maxBytes: 1,
        maxWallMs: 250,
      })).toThrow("byte cap");
      expect(() => store.getLoopMutationResult(authority, input.operationId, input.stepId, {
        maxCalls: 1,
        maxRecords: 0,
        maxBytes: 64 * 1024,
        maxWallMs: 250,
      })).toThrow("record cap");
      expect(() => store.getLoopMutationResult(authority, input.operationId, input.stepId, {
        maxCalls: 1,
        maxRecords: 2,
        maxBytes: 64 * 1024,
        maxWallMs: -1,
      })).toThrow("wall-time cap");
    } finally {
      store.close();
    }
  });

  test("fails closed when another operation holds the target lease", () => {
    const dir = mkdtempSync(join(tmpdir(), "loops-mutation-"));
    const path = join(dir, "loops.db");
    const store = new Store(path);
    try {
      const loop = createLoop(store);
      const external = new Database(path);
      external.query(
        `INSERT INTO loop_mutation_leases
         (tenant_id,target_id,lease_id,operation_id,step_id,expires_at,created_at)
         VALUES (?,?,?,?,?,?,?)`,
      ).run(
        authority.tenantId,
        loop.id,
        "foreign-lease",
        "foreign-operation",
        "foreign-step",
        "2026-08-10T01:00:00.000Z",
        "2026-08-10T00:00:00.000Z",
      );
      external.close();
      expect(() => store.mutateLoop(
        envelope(loop.id, loop.updatedAt),
        authority,
        { now: new Date("2026-08-10T00:00:01.000Z") },
      )).toThrow(LoopMutationConflictError);
      expect(store.getLoop(loop.id)?.status).toBe("active");
    } finally {
      store.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("makes admission and terminal receipt rows immutable after commit", () => {
    const dir = mkdtempSync(join(tmpdir(), "loops-mutation-immutable-"));
    const path = join(dir, "loops.db");
    const store = new Store(path);
    try {
      const loop = createLoop(store);
      const input = envelope(loop.id, loop.updatedAt);
      store.mutateLoop(input, authority);
      const external = new Database(path);
      expect(() => external.query(
        `UPDATE loop_mutation_operations SET terminal_json='{}'
         WHERE tenant_id=? AND operation_id=? AND step_id=?`,
      ).run(authority.tenantId, input.operationId, input.stepId)).toThrow("immutable");
      expect(() => external.query(
        `DELETE FROM loop_mutation_operations
         WHERE tenant_id=? AND operation_id=? AND step_id=?`,
      ).run(authority.tenantId, input.operationId, input.stepId)).toThrow("immutable");
      external.close();
      expect(store.getLoopMutationResult(authority, input.operationId, input.stepId)?.terminal.receiptKind)
        .toBe("terminal");
    } finally {
      store.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
