import { describe, expect, it } from "bun:test";
import { createTestDb } from "../db/index.ts";
import { getEventRecord, verifyEventStore } from "./event-store.ts";
import { ingestBatch, ingestLog } from "./ingest.ts";
import { runRetentionForProject, setRetentionPolicy } from "./retention.ts";

function seedProject(db: ReturnType<typeof createTestDb>, name = "app") {
  return db
    .prepare("INSERT INTO projects (name) VALUES (?) RETURNING id")
    .get(name) as { id: string };
}

describe("retention", () => {
  it("does nothing when under max_rows", () => {
    const db = createTestDb();
    const p = seedProject(db);
    ingestBatch(
      db,
      Array.from({ length: 5 }, () => ({
        level: "info" as const,
        message: "x",
        project_id: p.id,
      })),
    );
    const result = runRetentionForProject(db, p.id);
    expect(result.deleted).toBe(0);
  });

  it("enforces max_rows", () => {
    const db = createTestDb();
    const p = seedProject(db);
    setRetentionPolicy(db, p.id, { max_rows: 3 });
    ingestBatch(
      db,
      Array.from({ length: 10 }, () => ({
        level: "info" as const,
        message: "x",
        project_id: p.id,
      })),
    );
    runRetentionForProject(db, p.id);
    const count = (
      db
        .prepare("SELECT COUNT(*) as c FROM logs WHERE project_id = ?")
        .get(p.id) as { c: number }
    ).c;
    expect(count).toBeLessThanOrEqual(3);
  });

  it("re-ingest after max_rows eviction re-materializes without growing the event store", () => {
    const db = createTestDb();
    const p = seedProject(db);
    setRetentionPolicy(db, p.id, { max_rows: 1 });
    // Recent timestamps: the info TTL (168h default) must not fire, so only
    // max_rows evicts the oldest projection row.
    const olderTimestamp = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    const newerTimestamp = new Date().toISOString();
    const older = ingestLog(db, {
      id: "retention-retry-evt-older",
      timestamp: olderTimestamp,
      level: "info",
      message: "evicted",
      project_id: p.id,
    });
    ingestLog(db, {
      id: "retention-retry-evt-newer",
      timestamp: newerTimestamp,
      level: "info",
      message: "kept",
      project_id: p.id,
    });

    // max_rows eviction deletes only the oldest logs projection row; the raw
    // event and its event_records index row survive.
    const result = runRetentionForProject(db, p.id);
    expect(result.deleted).toBe(1);
    expect(
      (
        db
          .prepare("SELECT COUNT(*) AS count FROM logs WHERE id = ?")
          .get(older.id) as { count: number }
      ).count,
    ).toBe(0);
    expect(getEventRecord(db, older.id)).toBeTruthy();

    // SDK retry of the evicted deterministic id must not throw and must not
    // append a duplicate raw line.
    const replayed = ingestLog(db, {
      id: "retention-retry-evt-older",
      timestamp: olderTimestamp,
      level: "info",
      message: "evicted",
      project_id: p.id,
    });
    expect(replayed.id).toBe(older.id);
    expect(replayed.message).toBe("evicted");
    expect(
      (
        db.prepare("SELECT SUM(event_count) AS count FROM event_segments")
          .get() as { count: number }
      ).count,
    ).toBe(2);
    expect(verifyEventStore(db).ok).toBe(true);
  });

  it("returns 0 for unknown project", () => {
    const db = createTestDb();
    expect(runRetentionForProject(db, "nope").deleted).toBe(0);
  });

  it("setRetentionPolicy updates project config", () => {
    const db = createTestDb();
    const p = seedProject(db);
    setRetentionPolicy(db, p.id, { max_rows: 500, debug_ttl_hours: 1 });
    const proj = db
      .prepare("SELECT max_rows, debug_ttl_hours FROM projects WHERE id = ?")
      .get(p.id) as { max_rows: number; debug_ttl_hours: number };
    expect(proj.max_rows).toBe(500);
    expect(proj.debug_ttl_hours).toBe(1);
  });
});
