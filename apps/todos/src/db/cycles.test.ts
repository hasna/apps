import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { getDatabase, closeDatabase, resetDatabase } from "./database.js";
import { createProject } from "./projects.js";
import { createTask } from "./tasks.js";
import {
  createCycle,
  getCycle,
  getCycleByNumber,
  listCycles,
  updateCycle,
  deleteCycle,
  generateCycles,
  getCurrentCycle,
  getNextCycle,
  getCycleStats,
  listCyclesWithStats,
} from "./cycles.js";
import type { CycleWithStats } from "./cycles.js";

let db: ReturnType<typeof getDatabase>;

beforeEach(() => {
  process.env["TODOS_DB_PATH"] = ":memory:";
  resetDatabase();
  db = getDatabase();
});

afterEach(() => {
  closeDatabase();
  delete process.env["TODOS_DB_PATH"];
});

describe("createCycle", () => {
  it("creates a basic cycle with auto-generated fields", () => {
    const cycle = createCycle({ start_date: "2024-01-15" }, db);
    expect(cycle.id).toBeDefined();
    expect(cycle.number).toBe(1);
    expect(cycle.start_date).toBe("2024-01-15");
    expect(cycle.end_date).toBe("2024-01-22"); // +7 days (1 week)
    expect(cycle.duration_weeks).toBe(1);
    expect(cycle.status).toBe("active");
  });

  it("creates a cycle with custom duration", () => {
    const cycle = createCycle({ start_date: "2024-01-01", duration_weeks: 2 }, db);
    expect(cycle.duration_weeks).toBe(2);
    expect(cycle.end_date).toBe("2024-01-15");
  });

  it("creates a cycle with explicit number", () => {
    const cycle = createCycle({ start_date: "2024-01-01", number: 5 }, db);
    expect(cycle.number).toBe(5);
  });

  it("creates a cycle with explicit status", () => {
    const cycle = createCycle({ start_date: "2024-01-01", status: "archived" }, db);
    expect(cycle.status).toBe("archived");
  });

  it("auto-increments number for same project", () => {
    const project = createProject({ name: "Test", path: "/tmp/test" }, db);
    const c1 = createCycle({ project_id: project.id, start_date: "2024-01-01" }, db);
    const c2 = createCycle({ project_id: project.id, start_date: "2024-01-08" }, db);
    const c3 = createCycle({ project_id: project.id, start_date: "2024-01-15" }, db);
    expect(c1.number).toBe(1);
    expect(c2.number).toBe(2);
    expect(c3.number).toBe(3);
  });

  it("keeps number=1 for cycles without project_id", () => {
    createCycle({ start_date: "2024-01-01" }, db);
    const c2 = createCycle({ start_date: "2024-01-08" }, db);
    expect(c2.number).toBe(1);
  });

  it("links cycle to project", () => {
    const project = createProject({ name: "Proj", path: "/tmp/proj" }, db);
    const cycle = createCycle({ project_id: project.id, start_date: "2024-02-01" }, db);
    expect(cycle.project_id).toBe(project.id);
  });
});

describe("getCycle", () => {
  it("returns cycle by id", () => {
    const cycle = createCycle({ start_date: "2024-01-01" }, db);
    const found = getCycle(cycle.id, db);
    expect(found).not.toBeNull();
    expect(found!.number).toBe(1);
  });

  it("returns null for nonexistent id", () => {
    expect(getCycle("nonexistent", db)).toBeNull();
  });

  it("uses default database when not provided", () => {
    const cycle = createCycle({ start_date: "2024-01-01" }, db);
    const found = getCycle(cycle.id);
    expect(found).not.toBeNull();
  });
});

describe("getCycleByNumber", () => {
  it("returns cycle by project and number", () => {
    const project = createProject({ name: "Proj", path: "/tmp/proj" }, db);
    createCycle({ project_id: project.id, start_date: "2024-01-01" }, db);
    const c2 = createCycle({ project_id: project.id, start_date: "2024-01-08" }, db);
    const found = getCycleByNumber(project.id, 2, db);
    expect(found).not.toBeNull();
    expect(found!.id).toBe(c2.id);
  });

  it("returns null for nonexistent number", () => {
    const project = createProject({ name: "Proj", path: "/tmp/proj" }, db);
    expect(getCycleByNumber(project.id, 999, db)).toBeNull();
  });
});

describe("listCycles", () => {
  it("returns all cycles", () => {
    createCycle({ start_date: "2024-01-01" }, db);
    createCycle({ start_date: "2024-01-08" }, db);
    const cycles = listCycles({}, db);
    expect(cycles).toHaveLength(2);
  });

  it("filters by project_id", () => {
    const p1 = createProject({ name: "P1", path: "/tmp/p1" }, db);
    const p2 = createProject({ name: "P2", path: "/tmp/p2" }, db);
    createCycle({ project_id: p1.id, start_date: "2024-01-01" }, db);
    createCycle({ project_id: p2.id, start_date: "2024-01-01" }, db);
    const cycles = listCycles({ project_id: p1.id }, db);
    expect(cycles).toHaveLength(1);
    expect(cycles[0]!.project_id).toBe(p1.id);
  });

  it("filters by status", () => {
    createCycle({ start_date: "2024-01-01", status: "active" }, db);
    createCycle({ start_date: "2024-01-08", status: "completed" }, db);
    createCycle({ start_date: "2024-01-15", status: "archived" }, db);
    expect(listCycles({ status: "active" }, db)).toHaveLength(1);
    expect(listCycles({ status: "completed" }, db)).toHaveLength(1);
  });

  it("respects limit parameter", () => {
    for (let i = 0; i < 5; i++) {
      createCycle({ start_date: `2024-01-${String(i + 1).padStart(2, "0")}` }, db);
    }
    const cycles = listCycles({ limit: 2 }, db);
    expect(cycles).toHaveLength(2);
  });

  it("returns empty array when no cycles exist", () => {
    expect(listCycles({}, db)).toEqual([]);
  });

  it("orders by start_date DESC", () => {
    createCycle({ start_date: "2024-01-01" }, db);
    createCycle({ start_date: "2024-01-15" }, db);
    createCycle({ start_date: "2024-01-08" }, db);
    const cycles = listCycles({}, db);
    expect(cycles[0]!.start_date).toBe("2024-01-15");
    expect(cycles[1]!.start_date).toBe("2024-01-08");
    expect(cycles[2]!.start_date).toBe("2024-01-01");
  });
});

describe("updateCycle", () => {
  it("updates cycle status", () => {
    const cycle = createCycle({ start_date: "2024-01-01" }, db);
    const updated = updateCycle(cycle.id, { status: "completed" }, db);
    expect(updated).not.toBeNull();
    expect(updated!.status).toBe("completed");
  });

  it("updates start_date", () => {
    const cycle = createCycle({ start_date: "2024-01-01" }, db);
    const updated = updateCycle(cycle.id, { start_date: "2024-02-01" }, db);
    expect(updated!.start_date).toBe("2024-02-01");
  });

  it("updates end_date", () => {
    const cycle = createCycle({ start_date: "2024-01-01", duration_weeks: 1 }, db);
    const updated = updateCycle(cycle.id, { end_date: "2024-03-01" }, db);
    expect(updated!.end_date).toBe("2024-03-01");
  });

  it("returns null for nonexistent id", () => {
    expect(updateCycle("nonexistent", { status: "completed" }, db)).toBeNull();
  });

  it("updates updated_at timestamp", () => {
    const cycle = createCycle({ start_date: "2024-01-01" }, db);
    // Force a different second to make the assertion meaningful
    const updated = updateCycle(cycle.id, { status: "completed", end_date: "2024-02-01" }, db);
    expect(updated).not.toBeNull();
    expect(updated!.end_date).toBe("2024-02-01");
  });
});

describe("deleteCycle", () => {
  it("deletes a cycle", () => {
    const cycle = createCycle({ start_date: "2024-01-01" }, db);
    expect(deleteCycle(cycle.id, db)).toBe(true);
    expect(getCycle(cycle.id, db)).toBeNull();
  });

  it("returns false for nonexistent id", () => {
    expect(deleteCycle("nonexistent", db)).toBe(false);
  });
});

describe("generateCycles", () => {
  it("generates multiple sequential cycles", () => {
    const project = createProject({ name: "Proj", path: "/tmp/proj" }, db);
    const cycles = generateCycles(project.id, { start_date: "2024-01-01", count: 4 }, db);
    expect(cycles).toHaveLength(4);
    expect(cycles[0]!.number).toBe(1);
    expect(cycles[0]!.start_date).toBe("2024-01-01");
    expect(cycles[1]!.start_date).toBe("2024-01-08");
    expect(cycles[2]!.start_date).toBe("2024-01-15");
    expect(cycles[3]!.start_date).toBe("2024-01-22");
  });

  it("generates 2-week cycles", () => {
    const project = createProject({ name: "Proj", path: "/tmp/proj" }, db);
    const cycles = generateCycles(project.id, { start_date: "2024-01-01", count: 2, duration_weeks: 2 }, db);
    expect(cycles[0]!.duration_weeks).toBe(2);
    expect(cycles[0]!.end_date).toBe("2024-01-15");
    expect(cycles[1]!.start_date).toBe("2024-01-15");
    expect(cycles[1]!.end_date).toBe("2024-01-29");
  });

  it("auto-increments numbers", () => {
    const project = createProject({ name: "Proj", path: "/tmp/proj" }, db);
    const cycles = generateCycles(project.id, { start_date: "2024-01-01", count: 3 }, db);
    expect(cycles.map(c => c.number)).toEqual([1, 2, 3]);
  });
});

describe("getCurrentCycle", () => {
  it("returns the cycle that contains today", () => {
    const project = createProject({ name: "Proj", path: "/tmp/proj" }, db);
    const today = new Date();
    const past = new Date(today);
    past.setDate(past.getDate() - 1);
    const future = new Date(today);
    future.setDate(future.getDate() + 6);
    createCycle({
      project_id: project.id,
      start_date: past.toISOString().split("T")[0],
      duration_weeks: 1,
    }, db);
    const current = getCurrentCycle(project.id, db);
    expect(current).not.toBeNull();
  });

  it("returns null when no active cycle contains today", () => {
    const project = createProject({ name: "Proj", path: "/tmp/proj" }, db);
    createCycle({ project_id: project.id, start_date: "2020-01-01" }, db);
    expect(getCurrentCycle(project.id, db)).toBeNull();
  });

  it("returns null for project with no cycles", () => {
    const project = createProject({ name: "Proj", path: "/tmp/proj" }, db);
    expect(getCurrentCycle(project.id, db)).toBeNull();
  });

  it("returns most recent active cycle when multiple overlap", () => {
    const project = createProject({ name: "Proj", path: "/tmp/proj" }, db);
    const today = new Date();
    // Create an older cycle that also contains today (long duration)
    const oldStart = new Date(today);
    oldStart.setDate(oldStart.getDate() - 20);
    createCycle({
      project_id: project.id,
      start_date: oldStart.toISOString().split("T")[0],
      duration_weeks: 4,
    }, db);
    // Create a newer cycle that also contains today
    const newStart = new Date(today);
    newStart.setDate(newStart.getDate() - 3);
    createCycle({
      project_id: project.id,
      start_date: newStart.toISOString().split("T")[0],
      duration_weeks: 1,
    }, db);
    const current = getCurrentCycle(project.id, db);
    expect(current).not.toBeNull();
    expect(current!.number).toBe(2);
  });
});

describe("getNextCycle", () => {
  it("returns the next upcoming cycle", () => {
    const project = createProject({ name: "Proj", path: "/tmp/proj" }, db);
    const today = new Date();
    const future1 = new Date(today);
    future1.setDate(future1.getDate() + 7);
    const future2 = new Date(today);
    future2.setDate(future2.getDate() + 14);
    createCycle({ project_id: project.id, start_date: future1.toISOString().split("T")[0] }, db);
    createCycle({ project_id: project.id, start_date: future2.toISOString().split("T")[0] }, db);
    const next = getNextCycle(project.id, db);
    expect(next).not.toBeNull();
    expect(next!.start_date).toBe(future1.toISOString().split("T")[0]);
  });

  it("returns null when no upcoming cycles", () => {
    const project = createProject({ name: "Proj", path: "/tmp/proj" }, db);
    createCycle({ project_id: project.id, start_date: "2020-01-01" }, db);
    expect(getNextCycle(project.id, db)).toBeNull();
  });
});

describe("getCycleStats", () => {
  it("returns stats for a cycle", () => {
    const project = createProject({ name: "Proj", path: "/tmp/proj" }, db);
    const cycle = createCycle({ project_id: project.id, start_date: "2024-01-01" }, db);
    createTask({ title: "Done", cycle_id: cycle.id, status: "completed" }, db);
    createTask({ title: "In progress", cycle_id: cycle.id, status: "in_progress" }, db);
    createTask({ title: "Pending", cycle_id: cycle.id, status: "pending" }, db);
    const stats = getCycleStats(cycle.id, db);
    expect(stats).not.toBeNull();
    expect(stats!.task_count).toBe(3);
    expect(stats!.completed_count).toBe(1);
    expect(stats!.started_count).toBe(1);
    expect(stats!.uncompleted_count).toBe(2);
  });

  it("returns zeros for nonexistent cycle", () => {
    const stats = getCycleStats("nonexistent", db);
    expect(stats).not.toBeNull();
    expect(stats!.task_count).toBe(0);
  });

  it("returns zeros when no tasks", () => {
    const cycle = createCycle({ start_date: "2024-01-01" }, db);
    const stats = getCycleStats(cycle.id, db);
    expect(stats).not.toBeNull();
    expect(stats!.task_count).toBe(0);
    expect(stats!.completed_count).toBe(0);
  });
});

describe("listCyclesWithStats", () => {
  it("returns cycles with task counts", () => {
    const project = createProject({ name: "Proj", path: "/tmp/proj" }, db);
    const c1 = createCycle({ project_id: project.id, start_date: "2024-01-01" }, db);
    const c2 = createCycle({ project_id: project.id, start_date: "2024-01-08" }, db);
    createTask({ title: "T1", cycle_id: c1.id }, db);
    createTask({ title: "T2", cycle_id: c1.id }, db);
    createTask({ title: "T3", cycle_id: c2.id, status: "completed" }, db);
    const withStats = listCyclesWithStats({ project_id: project.id }, db) as CycleWithStats[];
    expect(withStats).toHaveLength(2);
    const s1 = withStats.find(c => c.id === c1.id)!;
    const s2 = withStats.find(c => c.id === c2.id)!;
    expect(s1.task_count).toBe(2);
    expect(s2.task_count).toBe(1);
    expect(s2.completed_count).toBe(1);
  });

  it("includes cycles with no tasks", () => {
    const project = createProject({ name: "Proj", path: "/tmp/proj" }, db);
    createCycle({ project_id: project.id, start_date: "2024-01-01" }, db);
    const withStats = listCyclesWithStats({ project_id: project.id }, db);
    expect(withStats[0]!.task_count).toBe(0);
  });

  it("respects query options", () => {
    const project = createProject({ name: "Proj", path: "/tmp/proj" }, db);
    createCycle({ project_id: project.id, start_date: "2024-01-01", status: "active" }, db);
    createCycle({ project_id: project.id, start_date: "2024-01-08", status: "completed" }, db);
    const withStats = listCyclesWithStats({ project_id: project.id, status: "active" }, db);
    expect(withStats).toHaveLength(1);
    expect(withStats[0]!.status).toBe("active");
  });

  it("returns empty array when no cycles", () => {
    expect(listCyclesWithStats({}, db)).toEqual([]);
  });
});
