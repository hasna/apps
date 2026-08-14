import { describe, expect, test } from "bun:test";
import {
  COMMENT_REDACTION_BACKFILL_CONFIRMATION,
  backfillPostgresCommentRedaction,
  isCommentRedactionBackfillComplete,
} from "./comment-redaction-backfill.js";
import type { TodosPostgresQueryClient } from "./postgres-sync.js";

interface Row {
  service: string;
  object_id: string;
  payload: Record<string, unknown>;
  deleted: boolean;
}

function fakeClient(initial: Row[], conflicts = new Set<string>()) {
  const rows = initial.map((row) => ({ ...row, payload: { ...row.payload } }));
  const calls: Array<{ sql: string; values: readonly unknown[] }> = [];
  const client: TodosPostgresQueryClient = {
    async query<T>(sql: string, values: readonly unknown[] = []) {
      calls.push({ sql, values });
      if (sql.includes("comment-redaction-backfill-scan")) {
        const [service, afterId, limit] = values;
        const excludesDeleted = sql.includes("deleted_at IS NULL");
        const selected = rows
          .filter((row) => row.service === service && (!excludesDeleted || !row.deleted) && row.object_id > String(afterId))
          .sort((left, right) => left.object_id.localeCompare(right.object_id))
          .slice(0, Number(limit))
          .map((row) => ({ object_id: row.object_id, payload: row.payload }));
        return { rows: selected as T[] };
      }
      if (sql.includes("comment-redaction-backfill-apply")) {
        const [service, objectId, nextPayload, originalPayload] = values;
        if (conflicts.has(String(objectId))) return { rows: [] as T[] };
        const excludesDeleted = sql.includes("deleted_at IS NULL");
        const row = rows.find((candidate) =>
          candidate.service === service && candidate.object_id === objectId && (!excludesDeleted || !candidate.deleted) &&
          JSON.stringify(candidate.payload) === JSON.stringify(originalPayload));
        if (!row) return { rows: [] as T[] };
        row.payload = { ...(nextPayload as Record<string, unknown>) };
        return { rows: [{ object_id: row.object_id }] as T[] };
      }
      throw new Error("Unexpected query in comment redaction backfill test");
    },
  };
  return { client, rows, calls };
}

describe("historical Postgres comment redaction backfill", () => {
  test("defaults to a bounded, non-mutating dry run and reports only aggregate counts", async () => {
    const database = fakeClient([
      { service: "todos", object_id: "a", payload: { content: "safe" }, deleted: false },
      { service: "todos", object_id: "b", payload: { content: "Bearer abcdefghijklmnop" }, deleted: false },
      { service: "other", object_id: "c", payload: { content: "Bearer abcdefghijklmnop" }, deleted: false },
      { service: "todos", object_id: "d", payload: { content: "Bearer abcdefghijklmnop" }, deleted: true },
    ]);

    const report = await backfillPostgresCommentRedaction(database.client, { batchSize: 1 });
    expect(report).toEqual({
      dry_run: true,
      scanned: 3,
      candidates: 2,
      updated: 0,
      conflicts: 0,
      batches: 3,
      remaining_candidates: 2,
    });
    expect(database.calls.filter((call) => call.sql.includes("backfill-apply"))).toHaveLength(0);
    expect(database.rows.find((row) => row.object_id === "b")!.payload["content"])
      .toBe("Bearer abcdefghijklmnop");
    for (const scan of database.calls.filter((call) => call.sql.includes("backfill-scan"))) {
      expect(scan.sql).toContain("object_id > $2");
      expect(scan.sql).toContain("LIMIT $3");
      expect(scan.sql).not.toContain("deleted_at IS NULL");
      expect(scan.values[2]).toBe(1);
    }
  });

  test("requires an explicit apply confirmation and is idempotent", async () => {
    const database = fakeClient([
      { service: "todos", object_id: "a", payload: { content: "Bearer abcdefghijklmnop" }, deleted: false },
      { service: "todos", object_id: "b", payload: { content: "safe" }, deleted: false },
    ]);

    await expect(backfillPostgresCommentRedaction(database.client, { apply: true }))
      .rejects.toThrow(COMMENT_REDACTION_BACKFILL_CONFIRMATION);
    expect(database.calls).toHaveLength(0);

    const applied = await backfillPostgresCommentRedaction(database.client, {
      apply: true,
      confirmation: COMMENT_REDACTION_BACKFILL_CONFIRMATION,
      batchSize: 2,
    });
    expect(applied).toEqual({
      dry_run: false,
      scanned: 2,
      candidates: 1,
      updated: 1,
      conflicts: 0,
      batches: 1,
      remaining_candidates: 0,
    });
    expect(isCommentRedactionBackfillComplete(applied)).toBe(true);
    expect(database.rows[0]!.payload["content"]).toBe("Bearer [REDACTED]");

    const repeated = await backfillPostgresCommentRedaction(database.client, {
      apply: true,
      confirmation: COMMENT_REDACTION_BACKFILL_CONFIRMATION,
      batchSize: 2,
    });
    expect(repeated).toEqual({
      dry_run: false,
      scanned: 2,
      candidates: 0,
      updated: 0,
      conflicts: 0,
      batches: 1,
      remaining_candidates: 0,
    });
  });

  test("reports compare-and-set conflicts without overwriting a concurrently changed row", async () => {
    const database = fakeClient([
      { service: "todos", object_id: "conflict", payload: { content: "Bearer abcdefghijklmnop" }, deleted: false },
    ], new Set(["conflict"]));
    const report = await backfillPostgresCommentRedaction(database.client, {
      apply: true,
      confirmation: COMMENT_REDACTION_BACKFILL_CONFIRMATION,
    });
    expect(report).toMatchObject({ candidates: 1, updated: 0, conflicts: 1, remaining_candidates: 1 });
    expect(isCommentRedactionBackfillComplete(report)).toBe(false);
    expect(database.rows[0]!.payload["content"]).toBe("Bearer abcdefghijklmnop");
  });

  test("redacts deleted comment payloads while preserving their tombstone state", async () => {
    const database = fakeClient([
      { service: "todos", object_id: "deleted", payload: { content: "Bearer abcdefghijklmnop" }, deleted: true },
    ]);
    const report = await backfillPostgresCommentRedaction(database.client, {
      apply: true,
      confirmation: COMMENT_REDACTION_BACKFILL_CONFIRMATION,
    });
    expect(report).toMatchObject({ updated: 1, conflicts: 0, remaining_candidates: 0 });
    expect(database.rows[0]).toMatchObject({ deleted: true, payload: { content: "Bearer [REDACTED]" } });
    const applyCall = database.calls.find((call) => call.sql.includes("backfill-apply"));
    expect(applyCall?.sql).not.toContain("deleted_at IS NULL");
  });

  test("rejects unsafe table names and unbounded batch sizes before querying", async () => {
    const database = fakeClient([]);
    await expect(backfillPostgresCommentRedaction(database.client, { tableName: "todos;drop" }))
      .rejects.toThrow(/unsafe postgres identifier/i);
    await expect(backfillPostgresCommentRedaction(database.client, { batchSize: 501 }))
      .rejects.toThrow(/between 1 and 500/i);
    expect(database.calls).toHaveLength(0);
  });
});
