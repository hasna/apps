import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { getDatabase, resetDatabase, closeDatabase } from "./database.js";
import { createTask } from "./tasks.js";
import { addDependency } from "./tasks.js";
import { registerAgent } from "./agents.js";
import { addTaskFile } from "./task-files.js";
import {
  syncKgEdges,
  getRelated,
  findPath,
  getImpactAnalysis,
  getCriticalPath,
  addKgEdge,
  removeKgEdges,
} from "./kg.js";

describe("Knowledge Graph", () => {
  let db: ReturnType<typeof getDatabase>;

  beforeEach(() => {
    process.env["TODOS_DB_PATH"] = ":memory:";
    resetDatabase();
    db = getDatabase();
  });

  afterEach(() => {
    closeDatabase();
  });

  function makeTask(title: string) {
    return createTask({ title }, db);
  }

  describe("syncKgEdges", () => {
    it("should sync task dependencies", () => {
      const t1 = makeTask("Task 1");
      const t2 = makeTask("Task 2");
      addDependency(t1.id, t2.id, db);
      const result = syncKgEdges(db);
      expect(result.synced).toBeGreaterThan(0);
      const edges = getRelated(t1.id, { relation_type: "depends_on" }, db);
      expect(edges.length).toBeGreaterThan(0);
    });

    it("should sync agent assignments", () => {
      const agent = registerAgent({ name: "testbot" }, db);
      if ("conflict" in agent) throw new Error("unexpected conflict");
      const t1 = createTask({ title: "Task 1", assigned_to: agent.id }, db);
      syncKgEdges(db);
      const edges = getRelated(t1.id, { relation_type: "assigned_to" }, db);
      expect(edges.length).toBe(1);
    });

    it("should sync file references", () => {
      const t1 = makeTask("Task 1");
      addTaskFile({ task_id: t1.id, path: "/src/index.ts" }, db);
      syncKgEdges(db);
      const edges = getRelated(t1.id, { relation_type: "references_file" }, db);
      expect(edges.length).toBe(1);
      expect(edges[0]!.target_id).toBe("/src/index.ts");
    });

    it("should be idempotent", () => {
      const t1 = makeTask("Task 1");
      const t2 = makeTask("Task 2");
      addDependency(t1.id, t2.id, db);
      syncKgEdges(db);
      syncKgEdges(db); // second sync should not fail
      const edges = getRelated(t1.id, { relation_type: "depends_on" }, db);
      expect(edges.length).toBe(1); // No duplicates
    });
  });

  describe("getRelated", () => {
    it("should filter by direction", () => {
      addKgEdge("a", "task", "b", "task", "depends_on", 1, {}, db);
      const outgoing = getRelated("a", { direction: "outgoing" }, db);
      expect(outgoing.length).toBe(1);
      const incoming = getRelated("a", { direction: "incoming" }, db);
      expect(incoming.length).toBe(0);
    });

    it("should filter by entity type", () => {
      addKgEdge("a", "task", "b", "agent", "assigned_to", 1, {}, db);
      addKgEdge("a", "task", "c", "project", "in_project", 1, {}, db);
      const agentEdges = getRelated("a", { entity_type: "agent" }, db);
      expect(agentEdges.length).toBe(1);
    });

    it("should respect limit", () => {
      for (let i = 0; i < 5; i++) {
        addKgEdge("a", "task", `b${i}`, "task", "depends_on", 1, {}, db);
      }
      const edges = getRelated("a", { limit: 3 }, db);
      expect(edges.length).toBe(3);
    });
  });

  describe("findPath", () => {
    it("should find a direct path", () => {
      addKgEdge("a", "task", "b", "task", "depends_on", 1, {}, db);
      const paths = findPath("a", "b", {}, db);
      expect(paths.length).toBe(1);
      expect(paths[0]!.length).toBe(1);
    });

    it("should find a multi-hop path", () => {
      addKgEdge("a", "task", "b", "task", "depends_on", 1, {}, db);
      addKgEdge("b", "task", "c", "task", "depends_on", 1, {}, db);
      const paths = findPath("a", "c", {}, db);
      expect(paths.length).toBe(1);
      expect(paths[0]!.length).toBe(2);
    });

    it("should return empty for no path", () => {
      addKgEdge("a", "task", "b", "task", "depends_on", 1, {}, db);
      const paths = findPath("a", "z", {}, db);
      expect(paths.length).toBe(0);
    });

    it("should respect max_depth", () => {
      addKgEdge("a", "task", "b", "task", "depends_on", 1, {}, db);
      addKgEdge("b", "task", "c", "task", "depends_on", 1, {}, db);
      addKgEdge("c", "task", "d", "task", "depends_on", 1, {}, db);
      const paths = findPath("a", "d", { max_depth: 2 }, db);
      expect(paths.length).toBe(0); // 3 hops needed, max 2
    });

    it("should filter by relation types", () => {
      addKgEdge("a", "task", "b", "task", "depends_on", 1, {}, db);
      addKgEdge("b", "task", "c", "task", "assigned_to", 1, {}, db);
      const paths = findPath("a", "c", { relation_types: ["depends_on"] }, db);
      expect(paths.length).toBe(0); // Can't reach c via depends_on only
    });
  });

  describe("getImpactAnalysis", () => {
    it("should find downstream entities", () => {
      addKgEdge("a", "task", "b", "task", "depends_on", 1, {}, db);
      addKgEdge("a", "task", "c", "agent", "assigned_to", 1, {}, db);
      const impact = getImpactAnalysis("a", {}, db);
      expect(impact.length).toBe(2);
      expect(impact.map(i => i.entity_id).sort()).toEqual(["b", "c"].sort());
    });

    it("should traverse multiple depths", () => {
      addKgEdge("a", "task", "b", "task", "depends_on", 1, {}, db);
      addKgEdge("b", "task", "c", "task", "depends_on", 1, {}, db);
      const impact = getImpactAnalysis("a", { max_depth: 3 }, db);
      expect(impact.length).toBe(2);
      const depths = impact.map(i => i.depth);
      expect(depths).toContain(1);
      expect(depths).toContain(2);
    });

    it("should not revisit nodes", () => {
      addKgEdge("a", "task", "b", "task", "r1", 1, {}, db);
      addKgEdge("a", "task", "b", "task", "r2", 1, {}, db);
      const impact = getImpactAnalysis("a", {}, db);
      // b should appear only once even though 2 edges lead to it
      expect(impact.filter(i => i.entity_id === "b").length).toBe(1);
    });
  });

  describe("getCriticalPath", () => {
    it("should find tasks that block the most work", () => {
      // a depends on b, c depends on b, d depends on c
      addKgEdge("a", "task", "b", "task", "depends_on", 1, {}, db);
      addKgEdge("c", "task", "b", "task", "depends_on", 1, {}, db);
      addKgEdge("d", "task", "c", "task", "depends_on", 1, {}, db);
      const critical = getCriticalPath({}, db);
      expect(critical.length).toBeGreaterThan(0);
      // b blocks a and c (and transitively d via c)
      const bEntry = critical.find(e => e.task_id === "b");
      expect(bEntry).toBeTruthy();
      expect(bEntry!.blocking_count).toBeGreaterThanOrEqual(2);
    });
  });

  describe("addKgEdge / removeKgEdges", () => {
    it("should add and remove edges", () => {
      addKgEdge("x", "task", "y", "agent", "assigned_to", 1, {}, db);
      const edges = getRelated("x", {}, db);
      expect(edges.length).toBe(1);
      const removed = removeKgEdges("x", "y", "assigned_to", db);
      expect(removed).toBe(1);
      expect(getRelated("x", {}, db).length).toBe(0);
    });
  });
});
