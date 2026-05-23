import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { getDatabase, closeDatabase, resetDatabase } from "../db/database.js";
import { createTask, getTask } from "../db/tasks.js";
import { createProject } from "../db/projects.js";
import { linkTaskToCommit } from "../db/task-commits.js";
import { addTaskFile } from "../db/task-files.js";
import { findDuplicateCandidates, mergeTasks, scoreDuplicatePair } from "./task-dedupe.js";

beforeEach(() => {
  process.env["TODOS_DB_PATH"] = ":memory:";
  resetDatabase();
  getDatabase();
});

afterEach(() => {
  closeDatabase();
  delete process.env["TODOS_DB_PATH"];
});

describe("task dedupe", () => {
  it("detects exact title duplicates", () => {
    const project = createProject({ name: "dedupe", path: "/tmp/dedupe" });
    const a = createTask({ title: "Fix login bug", project_id: project.id });
    const b = createTask({ title: "Fix login bug", project_id: project.id });

    const scored = scoreDuplicatePair(a, b);
    expect(scored?.score).toBeGreaterThan(0.65);
    expect(scored?.signals.some((s) => s.type === "title")).toBe(true);
  });

  it("detects shared commit linkage", () => {
    const project = createProject({ name: "dedupe", path: "/tmp/dedupe2" });
    const a = createTask({ title: "Task A", project_id: project.id });
    const b = createTask({ title: "Task B", project_id: project.id });
    linkTaskToCommit({ task_id: a.id, sha: "abc123" });
    linkTaskToCommit({ task_id: b.id, sha: "abc123" });

    const candidates = findDuplicateCandidates({ project_id: project.id, min_score: 0.5 });
    expect(candidates.some((c) =>
      (c.task_a_id === a.id && c.task_b_id === b.id) || (c.task_a_id === b.id && c.task_b_id === a.id),
    )).toBe(true);
  });

  it("merges secondary into primary preserving audit", () => {
    const project = createProject({ name: "dedupe", path: "/tmp/dedupe3" });
    const primary = createTask({ title: "Primary", project_id: project.id });
    const secondary = createTask({ title: "Secondary", project_id: project.id, tags: ["dup"] });
    addTaskFile({ task_id: secondary.id, path: "src/foo.ts" });

    const result = mergeTasks({ primary_id: primary.id, secondary_id: secondary.id });
    expect(result.merged.length).toBeGreaterThan(0);
    expect(getTask(secondary.id)?.status).toBe("cancelled");
  });

  it("supports dry-run preview", () => {
    const project = createProject({ name: "dedupe", path: "/tmp/dedupe4" });
    const a = createTask({ title: "A", project_id: project.id });
    const b = createTask({ title: "B", project_id: project.id });
    const preview = mergeTasks({ primary_id: a.id, secondary_id: b.id, dry_run: true });
    expect(preview.dry_run).toBe(true);
    expect(getTask(b.id)?.status).not.toBe("cancelled");
  });
});
