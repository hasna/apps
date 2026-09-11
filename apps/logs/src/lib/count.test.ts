import { describe, expect, it } from "bun:test";
import { createTestDb } from "../db/index.ts";
import { countLogs, parseLogStats, statsLogs, statsWindowDays } from "./count.ts";
import { ingestBatch } from "./ingest.ts";

describe("countLogs", () => {
  it("counts all logs", () => {
    const db = createTestDb();
    ingestBatch(db, [
      { level: "error", message: "e" },
      { level: "warn", message: "w" },
      { level: "info", message: "i" },
    ]);
    const c = countLogs(db, {});
    expect(c.total).toBe(3);
    expect(c.errors).toBe(1);
    expect(c.warns).toBe(1);
    expect(c.fatals).toBe(0);
  });

  it("filters by project", () => {
    const db = createTestDb();
    const p = db
      .prepare("INSERT INTO projects (name) VALUES ('app') RETURNING id")
      .get() as { id: string };
    ingestBatch(db, [
      { level: "error", message: "e", project_id: p.id },
      { level: "error", message: "e2" },
    ]);
    const c = countLogs(db, { project_id: p.id });
    expect(c.total).toBe(1);
  });

  it("filters by service", () => {
    const db = createTestDb();
    ingestBatch(db, [
      { level: "error", message: "e", service: "api" },
      { level: "error", message: "e2", service: "db" },
    ]);
    expect(countLogs(db, { service: "api" }).total).toBe(1);
  });

  it("returns zero counts for empty db", () => {
    const c = countLogs(createTestDb(), {});
    expect(c.total).toBe(0);
    expect(c.errors).toBe(0);
    expect(c.by_level).toEqual({});
  });

  it("accepts relative since", () => {
    const db = createTestDb();
    ingestBatch(db, [{ level: "error", message: "recent" }]);
    const c = countLogs(db, { since: "1h" });
    expect(c.total).toBe(1);
  });
});

describe("statsLogs", () => {
  it("normalizes the daily window once", () => {
    expect(statsWindowDays(undefined)).toBe(7);
    expect(statsWindowDays(Number.NaN)).toBe(7);
    expect(statsWindowDays(0)).toBe(7);
    expect(statsWindowDays(0.5)).toBe(1);
    expect(statsWindowDays(1)).toBe(1);
    expect(statsWindowDays(2.9)).toBe(2);
    expect(statsWindowDays(366)).toBe(366);
    expect(statsWindowDays(999)).toBe(366);
  });

  it("combines NULL and literal dash service buckets", () => {
    const db = createTestDb();
    ingestBatch(db, [
      { level: "info", message: "missing service" },
      { level: "warn", message: "literal dash", service: "-" },
      { level: "error", message: "api", service: "api" },
    ]);

    expect(statsLogs(db).by_service).toEqual({ "-": 2, api: 1 });
  });

  it("returns only the five highest-volume service buckets", () => {
    const db = createTestDb();
    ingestBatch(
      db,
      ["a", "b", "c", "d", "e", "f", "g"].flatMap((service, index) =>
        Array.from({ length: index + 1 }, (_, row) => ({
          level: "info" as const,
          message: `${service}-${row}`,
          service,
        })),
      ),
    );

    expect(Object.keys(statsLogs(db).by_service).sort()).toEqual([
      "c",
      "d",
      "e",
      "f",
      "g",
    ]);
  });

  it("uses parsed instants for bounds/day buckets and ignores malformed timestamps", () => {
    const db = createTestDb();
    const older = new Date(Date.now() - 2 * 3_600_000);
    const newer = new Date(Date.now() - 3_600_000);
    const olderWithOffset = new Date(older.getTime() + 2 * 3_600_000)
      .toISOString()
      .replace("Z", "+0200");

    ingestBatch(db, [
      { level: "info", message: "older", timestamp: olderWithOffset },
      { level: "info", message: "newer", timestamp: newer.toISOString() },
      { level: "info", message: "invalid", timestamp: "not-a-timestamp" },
      { level: "info", message: "invalid hour", timestamp: "2026-09-17T24:30:00Z" },
      { level: "info", message: "invalid calendar", timestamp: "2026-02-30T12:00:00Z" },
    ]);

    const stats = statsLogs(db, { days: 1 });
    expect(stats.total).toBe(5);
    expect(stats.oldest).toBe(older.toISOString());
    expect(stats.newest).toBe(newer.toISOString());
    expect(Object.values(stats.by_day).reduce((sum, count) => sum + count, 0))
      .toBe(2);
  });
});


describe("parseLogStats", () => {
  const valid = {
    total: 2,
    errors: 1,
    warns: 0,
    fatals: 0,
    by_level: { error: 1, info: 1 },
    by_service: { api: 2 },
    by_day: { "2026-09-17": 2 },
    oldest: "2026-09-17T10:00:00.000Z",
    newest: "2026-09-17T11:00:00.000Z",
  };

  it("accepts the complete internally consistent wire shape", () => {
    expect(parseLogStats(valid)).toEqual(valid);
    expect(
      parseLogStats({
        ...valid,
        oldest: "2026-09-17T12:00:00+02",
        newest: "2026-09-17T12:00:00z",
      }),
    ).toMatchObject({
      oldest: "2026-09-17T12:00:00+02",
      newest: "2026-09-17T12:00:00z",
    });
    expect(
      parseLogStats({
        total: 0,
        errors: 0,
        warns: 0,
        fatals: 0,
        by_level: {},
        by_service: {},
        by_day: {},
        oldest: null,
        newest: null,
      }),
    ).toMatchObject({ total: 0, oldest: null, newest: null });
  });

  it("refuses malformed or inconsistent hosted success bodies", () => {
    expect(() => parseLogStats({ ...valid, total: "2" })).toThrow(
      "total must be a non-negative safe integer",
    );
    expect(() => parseLogStats({ ...valid, oldest: undefined })).toThrow(
      "oldest must be a finite timestamp or null",
    );
    expect(() => parseLogStats({ ...valid, by_level: { error: 1 } })).toThrow(
      "by_level does not sum to total",
    );
    expect(() => parseLogStats({ ...valid, errors: 2 })).toThrow(
      "level counters disagree with by_level",
    );
    expect(() =>
      parseLogStats({ ...valid, oldest: "0000-01-01T00:00:00Z" }),
    ).toThrow("oldest must be a finite timestamp or null");
    expect(() =>
      parseLogStats({ ...valid, oldest: "2026-09-17T12:00:00+16:00" }),
    ).toThrow("oldest must be a finite timestamp or null");
  });
});
