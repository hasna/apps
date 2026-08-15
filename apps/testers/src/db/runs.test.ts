process.env.TESTERS_DB_PATH = ":memory:";

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { resetDatabase, closeDatabase } from "./database.js";
import { createRun, getRun, listRuns, updateRun, deleteRun } from "./runs.js";

describe("runs", () => {
  beforeEach(() => {
    resetDatabase();
  });

  afterEach(() => {
    closeDatabase();
  });

  describe("createRun", () => {
    test("creates a run with correct fields", () => {
      const run = createRun({
        url: "http://localhost:3000",
        model: "claude-sonnet-4-6-20260311",
        headed: true,
        parallel: 4,
      });

      expect(run.id).toBeDefined();
      expect(run.url).toBe("http://localhost:3000");
      expect(run.model).toBe("claude-sonnet-4-6-20260311");
      expect(run.headed).toBe(true);
      expect(run.parallel).toBe(4);
      expect(run.status).toBe("pending");
      expect(run.total).toBe(0);
      expect(run.passed).toBe(0);
      expect(run.failed).toBe(0);
      expect(run.startedAt).toBeDefined();
      expect(run.finishedAt).toBeNull();
    });

    test("creates a run with default values", () => {
      const run = createRun({
        url: "http://localhost:3000",
        model: "claude-haiku-4-5-20251001",
      });

      expect(run.headed).toBe(false);
      expect(run.parallel).toBe(1);
      expect(run.projectId).toBeNull();
    });

    test("creates a run with a project ID", () => {
      const { createProject } = require("./projects.js");
      const project = createProject({ name: "test-proj" });
      const run = createRun({
        url: "http://localhost:3000",
        model: "claude-haiku-4-5-20251001",
        projectId: project.id,
      });

      expect(run.projectId).toBe(project.id);
    });
  });

  describe("getRun", () => {
    test("gets a run by full ID", () => {
      const created = createRun({ url: "http://localhost:3000", model: "claude-haiku-4-5-20251001" });
      const found = getRun(created.id);
      expect(found).not.toBeNull();
      expect(found!.id).toBe(created.id);
    });

    test("gets a run by partial ID", () => {
      const created = createRun({ url: "http://localhost:3000", model: "claude-haiku-4-5-20251001" });
      const partial = created.id.slice(0, 8);
      const found = getRun(partial);
      expect(found).not.toBeNull();
      expect(found!.id).toBe(created.id);
    });

    test("returns null for non-existent run", () => {
      const found = getRun("nonexistent");
      expect(found).toBeNull();
    });
  });

  describe("listRuns", () => {
    test("lists all runs when no filter provided", () => {
      createRun({ url: "http://localhost:3000", model: "model-a" });
      createRun({ url: "http://localhost:3001", model: "model-b" });

      const runs = listRuns();
      expect(runs.length).toBe(2);
    });

    test("filters by status", () => {
      const r1 = createRun({ url: "http://localhost:3000", model: "model-a" });
      createRun({ url: "http://localhost:3001", model: "model-b" });

      updateRun(r1.id, { status: "running" });

      const running = listRuns({ status: "running" });
      expect(running.length).toBe(1);
      expect(running[0]!.id).toBe(r1.id);

      const pending = listRuns({ status: "pending" });
      expect(pending.length).toBe(1);
    });

    test("respects limit", () => {
      for (let i = 0; i < 5; i++) {
        createRun({ url: `http://localhost:${3000 + i}`, model: "model" });
      }

      const limited = listRuns({ limit: 2 });
      expect(limited.length).toBe(2);
    });

    test("returns empty array when no runs exist", () => {
      const runs = listRuns();
      expect(runs).toEqual([]);
    });
  });

  describe("updateRun", () => {
    test("updates status", () => {
      const run = createRun({ url: "http://localhost:3000", model: "model" });
      const updated = updateRun(run.id, { status: "running" });
      expect(updated.status).toBe("running");
    });

    test("updates pass/fail counts", () => {
      const run = createRun({ url: "http://localhost:3000", model: "model" });
      const updated = updateRun(run.id, { total: 10, passed: 7, failed: 3 });
      expect(updated.total).toBe(10);
      expect(updated.passed).toBe(7);
      expect(updated.failed).toBe(3);
    });

    test("updates finished_at", () => {
      const run = createRun({ url: "http://localhost:3000", model: "model" });
      const finishedAt = new Date().toISOString();
      const updated = updateRun(run.id, { finished_at: finishedAt });
      expect(updated.finishedAt).toBe(finishedAt);
    });

    test("throws error for non-existent run", () => {
      expect(() => {
        updateRun("nonexistent", { status: "running" });
      }).toThrow("Run not found");
    });

    test("returns existing run when no updates provided", () => {
      const run = createRun({ url: "http://localhost:3000", model: "model" });
      const same = updateRun(run.id, {});
      expect(same.id).toBe(run.id);
      expect(same.status).toBe("pending");
    });
  });

  describe("deleteRun", () => {
    test("deletes an existing run", () => {
      const run = createRun({ url: "http://localhost:3000", model: "model" });
      const deleted = deleteRun(run.id);
      expect(deleted).toBe(true);

      const found = getRun(run.id);
      expect(found).toBeNull();
    });

    test("returns false for non-existent run", () => {
      const deleted = deleteRun("nonexistent");
      expect(deleted).toBe(false);
    });
  });
});
