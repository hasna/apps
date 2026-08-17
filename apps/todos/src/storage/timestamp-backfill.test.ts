/**
 * Unit tests for the terminal-status timestamp backfill (fleet Postgres store).
 *
 * The write-path enforcement is covered by src/db/timestamp-contract.test.ts
 * and src/storage/postgres-timestamp-contract.test.ts. This module repairs the
 * rows that predate the fix: only NULL columns are ever filled, from the audit
 * trail (action 'start' / 'complete' / 'fail' receipts), then failure metadata,
 * then the row's own updated_at — with a dry-run default, an apply
 * confirmation gate, a mandatory evidence file written before mutation, and a
 * compare-and-set guard so a concurrent writer is never overwritten.
 */
import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  backfillMissingTimestamps,
  TIMESTAMP_BACKFILL_CONFIRMATION,
} from "./timestamp-backfill.js";
import type { TodosPostgresQueryClient } from "./postgres-sync.js";

const SERVICE = "todos-timestamp-backfill";

interface StoredRow {
  service: string;
  objectType: string;
  objectId: string;
  payload: Record<string, unknown>;
  deletedAt: boolean;
}

function createFake(rows: StoredRow[]) {
  const state = new Map<string, StoredRow>();
  for (const row of rows) state.set(`${row.objectType}:${row.objectId}`, structuredClone(row));
  const updates: Array<{ objectId: string; completedAt: string | null; startedAt: string | null }> = [];

  const client: TodosPostgresQueryClient = {
    async query<T>(sql: string, values: readonly unknown[] = []) {
      if (sql.includes("timestamp-backfill-candidates")) {
        const service = values[0];
        const cursor = values[1] as string | null;
        const limit = values[2] as number;
        const out = [...state.values()]
          .filter((row) => row.service === service && row.objectType === "tasks" && !row.deletedAt)
          .filter((row) => {
            const payload = row.payload as Record<string, unknown>;
            const status = payload.status;
            // Mirrors the real SQL: null OR the double-encoded string 'null'.
            const nullish = (value: unknown) => value == null || value === "null";
            return (status === "completed" && nullish(payload.completed_at))
              || (status === "failed"
                && (nullish(payload.started_at) || nullish(payload.completed_at)));
          })
          .filter((row) => cursor === null || row.objectId > cursor)
          .sort((a, b) => a.objectId.localeCompare(b.objectId))
          .slice(0, limit);
        return {
          rows: out.map((row) => {
            const payload = row.payload as Record<string, unknown>;
            const metadata = (payload.metadata ?? {}) as Record<string, unknown>;
            const failure = (metadata._failure ?? {}) as Record<string, unknown>;
            return {
              object_id: row.objectId,
              status: payload.status,
              started_at: payload.started_at ?? null,
              completed_at: payload.completed_at ?? null,
              updated_at: payload.updated_at ?? null,
              failed_at: failure.failed_at ?? null,
            };
          }) as T[],
        };
      }

      if (sql.includes("timestamp-backfill-history")) {
        const service = values[0];
        const taskIds = new Set(values[1] as string[]);
        const out = [...state.values()]
          .filter((row) => row.service === service && row.objectType === "audit_history" && !row.deletedAt)
          .filter((row) => {
            const payload = row.payload as Record<string, unknown>;
            return taskIds.has(String(payload.task_id))
              && ["start", "complete", "fail"].includes(String(payload.action));
          });
        return {
          rows: out.map((row) => {
            const payload = row.payload as Record<string, unknown>;
            return {
              task_id: payload.task_id,
              action: payload.action,
              new_value: payload.new_value ?? null,
              created_at: payload.created_at ?? null,
            };
          }) as T[],
        };
      }

      if (sql.includes("timestamp-backfill-apply")) {
        const service = values[0];
        const objectId = values[1];
        const completedAt = values[2] as string | null;
        const startedAt = values[3] as string | null;
        const existing = state.get(`tasks:${objectId}`);
        if (!existing || existing.deletedAt || existing.service !== service) {
          return { rows: [] as T[] };
        }
        const payload = existing.payload as Record<string, unknown>;
        // CAS guard: only fill columns that are still NULL (including the
        // double-encoded string 'null', mirroring the real SQL arms).
        const nullish = (value: unknown) => value == null || value === "null";
        const canCompleted = completedAt === null || nullish(payload.completed_at);
        const canStarted = startedAt === null || nullish(payload.started_at);
        if (!canCompleted && !canStarted) return { rows: [] as T[] };
        const wroteCompleted = completedAt !== null && canCompleted;
        const wroteStarted = startedAt !== null && canStarted;
        if (wroteCompleted) payload.completed_at = completedAt;
        if (wroteStarted) payload.started_at = startedAt;
        updates.push({ objectId, completedAt: canCompleted ? completedAt : null, startedAt: canStarted ? startedAt : null });
        return {
          rows: [{
            object_id: objectId,
            completed_written: wroteCompleted,
            started_written: wroteStarted,
          }] as T[],
        };
      }

      return { rows: [] as T[] };
    },
  };

  return { client, updates, state };
}

function taskRow(objectId: string, overrides: Record<string, unknown> = {}): StoredRow {
  return {
    service: SERVICE,
    objectType: "tasks",
    objectId,
    payload: {
      id: objectId,
      status: "pending",
      started_at: null,
      completed_at: null,
      updated_at: "2026-08-01T00:00:00.000Z",
      metadata: {},
      ...overrides,
    },
    deletedAt: false,
  };
}

function historyRow(taskId: string, historyId: string, action: string, createdAt: string): StoredRow {
  return {
    service: SERVICE,
    objectType: "audit_history",
    objectId: historyId,
    payload: { task_id: taskId, action, created_at: createdAt },
    deletedAt: false,
  };
}

describe("backfillMissingTimestamps", () => {
  test("dry run reports candidates and writes nothing", async () => {
    const harness = createFake([
      taskRow("t-1", { status: "completed", completed_at: null }),
      taskRow("t-2", { status: "failed", started_at: null, completed_at: null }),
      taskRow("t-3", { status: "completed", completed_at: "2026-08-02T00:00:00.000Z" }),
    ]);

    const report = await backfillMissingTimestamps(harness.client, { service: SERVICE });

    expect(report.dry_run).toBe(true);
    expect(report.candidates).toBe(2);
    expect(report.completed_at_backfilled).toBe(0);
    expect(report.started_at_backfilled).toBe(0);
    expect(report.remaining_candidates).toBe(2);
    expect(report.evidence_path).toBeNull();
    expect(harness.updates).toHaveLength(0);
  });

  test("apply without confirmation is refused", async () => {
    const harness = createFake([taskRow("t-1", { status: "failed" })]);

    await expect(
      backfillMissingTimestamps(harness.client, {
        service: SERVICE,
        apply: true,
        confirmation: "WRONG",
        evidencePath: "/tmp/nope.jsonl",
      }),
    ).rejects.toThrow(/--confirm/);
  });

  test("apply without an evidence path is refused (preserve-before-mutate gate)", async () => {
    const harness = createFake([taskRow("t-1", { status: "failed" })]);

    await expect(
      backfillMissingTimestamps(harness.client, {
        service: SERVICE,
        apply: true,
        confirmation: TIMESTAMP_BACKFILL_CONFIRMATION,
      }),
    ).rejects.toThrow(/evidence-path/);
  });

  test("apply fills completed_at from the audit trail and started_at from the start receipt", async () => {
    const dir = mkdtempSync(join(tmpdir(), "todos-backfill-"));
    const evidencePath = join(dir, "evidence.jsonl");
    const harness = createFake([
      taskRow("t-1", { status: "completed", completed_at: null }),
      taskRow("t-2", { status: "failed", started_at: null, completed_at: null }),
    ]);
    harness.state.set("audit_history:h-1", historyRow("t-1", "h-1", "complete", "2026-08-03T10:00:00.000Z"));
    harness.state.set("audit_history:h-2", historyRow("t-2", "h-2", "start", "2026-08-03T08:00:00.000Z"));
    harness.state.set("audit_history:h-3", historyRow("t-2", "h-3", "fail", "2026-08-03T11:30:00.000Z"));

    const report = await backfillMissingTimestamps(harness.client, {
      service: SERVICE,
      apply: true,
      confirmation: TIMESTAMP_BACKFILL_CONFIRMATION,
      evidencePath,
    });

    expect(report.candidates).toBe(2);
    expect(report.completed_at_backfilled).toBe(2);
    expect(report.started_at_backfilled).toBe(1);
    expect(report.remaining_candidates).toBe(0);

    const t1 = harness.state.get("tasks:t-1")!.payload as Record<string, unknown>;
    expect(t1.completed_at).toBe("2026-08-03T10:00:00.000Z");
    const t2 = harness.state.get("tasks:t-2")!.payload as Record<string, unknown>;
    expect(t2.completed_at).toBe("2026-08-03T11:30:00.000Z");
    expect(t2.started_at).toBe("2026-08-03T08:00:00.000Z");

    // Pre-state evidence was written before mutation.
    const evidence = readFileSync(evidencePath, "utf8").trim().split("\n");
    expect(evidence).toHaveLength(2);
    expect(JSON.parse(evidence[0]!).completed_at).toBeNull();
    rmSync(dir, { recursive: true, force: true });
  });

  test("failed row without history uses failure metadata, then updated_at fallback", async () => {
    const dir = mkdtempSync(join(tmpdir(), "todos-backfill-"));
    const evidencePath = join(dir, "evidence.jsonl");
    const harness = createFake([
      taskRow("t-1", {
        status: "failed",
        started_at: null,
        completed_at: null,
        metadata: { _failure: { failed_at: "2026-08-04T09:00:00.000Z" } },
      }),
      taskRow("t-2", { status: "completed", completed_at: null, updated_at: "2026-08-05T12:00:00.000Z" }),
    ]);

    const report = await backfillMissingTimestamps(harness.client, {
      service: SERVICE,
      apply: true,
      confirmation: TIMESTAMP_BACKFILL_CONFIRMATION,
      evidencePath,
    });

    expect(report.completed_at_backfilled).toBe(2);
    const t1 = harness.state.get("tasks:t-1")!.payload as Record<string, unknown>;
    expect(t1.completed_at).toBe("2026-08-04T09:00:00.000Z");
    expect(t1.started_at).toBeNull(); // undeterminable start stays null
    const t2 = harness.state.get("tasks:t-2")!.payload as Record<string, unknown>;
    expect(t2.completed_at).toBe("2026-08-05T12:00:00.000Z");
    // t-1 is still a candidate (started_at undeterminable); t-2 is complete.
    expect(report.remaining_candidates).toBe(1);
    rmSync(dir, { recursive: true, force: true });
  });

  test("compare-and-set guard: a concurrently-stamped column is never overwritten", async () => {
    const dir = mkdtempSync(join(tmpdir(), "todos-backfill-"));
    const evidencePath = join(dir, "evidence.jsonl");
    const harness = createFake([
      taskRow("t-1", { status: "failed", started_at: null, completed_at: null }),
    ]);
    harness.state.set("audit_history:h-1", historyRow("t-1", "h-1", "fail", "2026-08-03T11:30:00.000Z"));

    // A concurrent writer stamps completed_at between the scan and the apply
    // (the stamp lands BEFORE the backfill's UPDATE executes, so the UPDATE's
    // column-still-NULL guard must refuse the completed_at fill).
    const original = harness.client.query.bind(harness.client);
    let applied = false;
    const guardedClient: TodosPostgresQueryClient = {
      ...harness.client,
      query: async <T>(sql: string, values: readonly unknown[] = []) => {
        if (sql.includes("timestamp-backfill-apply") && !applied) {
          applied = true;
          const payload = harness.state.get("tasks:t-1")!.payload as Record<string, unknown>;
          payload.completed_at = "2026-08-03T12:00:00.000Z"; // concurrent stamp
        }
        return original(sql, values);
      },
    };

    const report = await backfillMissingTimestamps(guardedClient, {
      service: SERVICE,
      apply: true,
      confirmation: TIMESTAMP_BACKFILL_CONFIRMATION,
      evidencePath,
    });

    // The concurrent value survives; the started_at fill still lands.
    const t1 = harness.state.get("tasks:t-1")!.payload as Record<string, unknown>;
    expect(t1.completed_at).toBe("2026-08-03T12:00:00.000Z");
    expect(report.completed_at_backfilled).toBe(0);
    expect(report.started_at_backfilled).toBe(0);
    expect(report.remaining_candidates).toBe(1);
    rmSync(dir, { recursive: true, force: true });
  });

  test("double-encoded 'null' STRING timestamps are treated as fillable (fleet legacy shape)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "todos-backfill-"));
    const evidencePath = join(dir, "evidence.jsonl");
    // The fleet historically stored double-encoded payloads where the value is
    // the JSON STRING "null", which `IS NULL` alone never matches.
    const harness = createFake([
      taskRow("t-1", { status: "completed", completed_at: "null" }),
      taskRow("t-2", { status: "failed", started_at: "null", completed_at: "null" }),
    ]);

    const report = await backfillMissingTimestamps(harness.client, {
      service: SERVICE,
      apply: true,
      confirmation: TIMESTAMP_BACKFILL_CONFIRMATION,
      evidencePath,
    });

    expect(report.candidates).toBe(2);
    expect(report.completed_at_backfilled).toBe(2);
    const t1 = harness.state.get("tasks:t-1")!.payload as Record<string, unknown>;
    expect(t1.completed_at).toBeTruthy();
    expect(t1.completed_at).not.toBe("null");
    const t2 = harness.state.get("tasks:t-2")!.payload as Record<string, unknown>;
    expect(t2.completed_at).toBeTruthy();
    rmSync(dir, { recursive: true, force: true });
  });

  test("paginates in bounded batches", async () => {
    const dir = mkdtempSync(join(tmpdir(), "todos-backfill-"));
    const evidencePath = join(dir, "evidence.jsonl");
    const harness = createFake([
      taskRow("t-1", { status: "completed", completed_at: null }),
      taskRow("t-2", { status: "failed", started_at: null, completed_at: null }),
      taskRow("t-3", { status: "completed", completed_at: null }),
      taskRow("t-4", { status: "failed", started_at: null, completed_at: null }),
      taskRow("t-5", { status: "completed", completed_at: null }),
    ]);

    const report = await backfillMissingTimestamps(harness.client, {
      service: SERVICE,
      apply: true,
      confirmation: TIMESTAMP_BACKFILL_CONFIRMATION,
      evidencePath,
      batchSize: 2,
    });

    expect(report.candidates).toBe(5);
    expect(report.batches).toBeGreaterThanOrEqual(3);
    for (const id of ["t-1", "t-3", "t-5"]) {
      const payload = harness.state.get(`tasks:${id}`)!.payload as Record<string, unknown>;
      expect(payload.completed_at).toBeTruthy();
    }
    for (const id of ["t-2", "t-4"]) {
      const payload = harness.state.get(`tasks:${id}`)!.payload as Record<string, unknown>;
      expect(payload.completed_at).toBeTruthy();
    }
    rmSync(dir, { recursive: true, force: true });
  });
});
