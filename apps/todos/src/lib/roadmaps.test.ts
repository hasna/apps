import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { closeDatabase, getDatabase, resetDatabase } from "../db/database.js";
import { createPlan } from "../db/plans.js";
import { createProject } from "../db/projects.js";
import { addDependency, createTask, updateTask } from "../db/tasks.js";
import { resetConfig } from "./config.js";
import {
  createMilestone,
  createRoadmap,
  exportRoadmapBundle,
  importRoadmapBundle,
  listRoadmaps,
  renderRoadmapMarkdown,
  summarizeRoadmap,
  upsertReleaseGroup,
} from "./roadmaps.js";

let previousDbPath: string | undefined;
let previousHome: string | undefined;
let home: string;

beforeEach(() => {
  previousDbPath = process.env["TODOS_DB_PATH"];
  previousHome = process.env["HOME"];
  home = mkdtempSync(join(tmpdir(), "todos-roadmaps-"));
  process.env["HOME"] = home;
  process.env["TODOS_DB_PATH"] = ":memory:";
  resetConfig();
  resetDatabase();
  getDatabase();
});

afterEach(() => {
  closeDatabase();
  resetConfig();
  if (previousDbPath === undefined) delete process.env["TODOS_DB_PATH"];
  else process.env["TODOS_DB_PATH"] = previousDbPath;
  if (previousHome === undefined) delete process.env["HOME"];
  else process.env["HOME"] = previousHome;
  rmSync(home, { recursive: true, force: true });
});

describe("local roadmaps", () => {
  test("summarizes milestones, release groups, and dependency readiness", () => {
    const db = getDatabase();
    const project = createProject({ name: "Roadmap Project", path: "/tmp/roadmap-project" }, db);
    const plan = createPlan({ name: "Release plan", project_id: project.id }, db);
    const blocker = createTask({ title: "Finish prerequisite", project_id: project.id }, db);
    const task = createTask({ title: "Ship roadmap feature", project_id: project.id, plan_id: plan.id }, db);
    addDependency(task.id, blocker.id, db);

    const roadmap = createRoadmap({
      name: "Local Roadmap",
      description: "Portable release planning",
      project_id: project.id,
      owner: "codex",
      release: "v1.0",
    });
    const milestone = createMilestone({
      roadmap_id: roadmap.id,
      title: "Public package launch",
      due_at: "2026-06-01",
      task_ids: [task.id],
      plan_ids: [plan.id],
      release: "v1.0",
      tags: ["release"],
    });
    const release = upsertReleaseGroup({
      roadmap_id: roadmap.id,
      name: "v1.0",
      version: "1.0.0",
      milestone_ids: [milestone.id],
      task_ids: [task.id],
      plan_ids: [plan.id],
      notes: "Launch-ready local planning bundle.",
    });

    const blocked = summarizeRoadmap(roadmap.id, db);
    expect(blocked.progress).toMatchObject({
      task_count: 1,
      blocked_count: 1,
      readiness: "blocked",
      plan_count: 1,
    });
    expect(blocked.milestones[0]?.blockers[0]?.blockers[0]?.id).toBe(blocker.id);
    expect(blocked.releases[0]?.name).toBe(release.name);
    expect(renderRoadmapMarkdown(roadmap.id, db)).toContain("Public package launch");

    const currentBlocker = updateTask(blocker.id, { version: blocker.version, status: "completed" }, db);
    updateTask(task.id, { version: task.version, status: "completed" }, db);
    expect(currentBlocker.status).toBe("completed");
    const complete = summarizeRoadmap(roadmap.id, db);
    expect(complete.progress.readiness).toBe("complete");
    expect(complete.progress.percent_complete).toBe(100);
  });

  test("exports previews and imports deterministic roadmap bundles", () => {
    const roadmap = createRoadmap({ name: "Portable Roadmap", release: "v2" });
    createMilestone({ roadmap_id: roadmap.id, title: "Portable Milestone", release: "v2" });
    upsertReleaseGroup({ roadmap_id: roadmap.id, name: "v2", version: "2.0.0" });

    const bundle = exportRoadmapBundle(roadmap.id);
    expect(bundle.kind).toBe("hasna.todos.roadmap-bundle");
    expect(importRoadmapBundle(bundle, { apply: false })).toEqual({
      applied: false,
      roadmap_id: roadmap.id,
      milestones: 1,
      releases: 1,
    });

    const importHome = mkdtempSync(join(tmpdir(), "todos-roadmaps-import-"));
    try {
      process.env["HOME"] = importHome;
      resetConfig();
      expect(listRoadmaps()).toHaveLength(0);
      const result = importRoadmapBundle(bundle, { apply: true });
      expect(result.applied).toBe(true);
      expect(listRoadmaps()[0]?.name).toBe("Portable Roadmap");
      expect(summarizeRoadmap(roadmap.id).releases[0]?.version).toBe("2.0.0");
    } finally {
      process.env["HOME"] = home;
      resetConfig();
      rmSync(importHome, { recursive: true, force: true });
    }
  });
});
