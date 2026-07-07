import { describe, it, expect } from "bun:test";
import { normalizeImportSnapshot, countSnapshotRecords } from "./v1.js";

describe("normalizeImportSnapshot", () => {
  it("defaults every record array to [] for an empty body", () => {
    const snap = normalizeImportSnapshot({});
    expect(snap.tasks).toEqual([]);
    expect(snap.projects).toEqual([]);
    expect(snap.plans).toEqual([]);
    expect(snap.agents).toEqual([]);
    expect(snap.taskLists).toEqual([]);
    expect(snap.templates).toEqual([]);
    expect(snap.auditHistory).toEqual([]);
    expect(snap.projectMachinePaths).toEqual([]);
    expect(snap.tombstones).toEqual([]);
    expect(snap.source).toBe("sqlite");
    expect(typeof snap.exportedAt).toBe("string");
    expect(countSnapshotRecords(snap)).toBe(0);
  });

  it("accepts a partial snapshot carrying only tasks (chunked backfill)", () => {
    const snap = normalizeImportSnapshot({
      tasks: [{ id: "t1", title: "a" }, { id: "t2", title: "b" }],
    });
    expect(snap.tasks).toHaveLength(2);
    expect(snap.projects).toEqual([]);
    expect(countSnapshotRecords(snap)).toBe(2);
  });

  it("coerces non-array record fields to [] instead of throwing", () => {
    const snap = normalizeImportSnapshot({ tasks: "not-an-array", projects: null, plans: 42 });
    expect(snap.tasks).toEqual([]);
    expect(snap.projects).toEqual([]);
    expect(snap.plans).toEqual([]);
    expect(countSnapshotRecords(snap)).toBe(0);
  });

  it("preserves a caller-supplied exportedAt and source", () => {
    const snap = normalizeImportSnapshot({ exportedAt: "2026-01-01T00:00:00.000Z", source: "postgres" });
    expect(snap.exportedAt).toBe("2026-01-01T00:00:00.000Z");
    expect(snap.source).toBe("postgres");
  });

  it("treats a non-object body as an empty snapshot", () => {
    for (const bad of [null, undefined, 7, "x", true]) {
      const snap = normalizeImportSnapshot(bad as unknown);
      expect(countSnapshotRecords(snap)).toBe(0);
    }
  });

  it("counts every object type across a full snapshot", () => {
    const snap = normalizeImportSnapshot({
      tasks: [{ id: "t1" }],
      projects: [{ id: "p1" }, { id: "p2" }],
      plans: [{ id: "pl1" }],
      agents: [{ id: "a1" }],
      taskLists: [{ id: "tl1" }],
      templates: [{ id: "tp1" }],
      auditHistory: [{ id: "h1" }, { id: "h2" }],
      projectMachinePaths: [{ id: "pmp1" }],
      tombstones: [{ object_type: "tasks", object_id: "z" }],
    });
    expect(countSnapshotRecords(snap)).toBe(11);
  });
});
