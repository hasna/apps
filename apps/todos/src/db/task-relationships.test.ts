import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { getDatabase, resetDatabase, closeDatabase } from "./database.js";
import { createTask } from "./tasks.js";
import { createProject } from "./projects.js";
import { addTaskFile } from "./task-files.js";
import {
  addTaskRelationship,
  getTaskRelationship,
  removeTaskRelationship,
  removeTaskRelationshipByPair,
  getTaskRelationships,
  findRelatedTaskIds,
  autoDetectFileRelationships,
  RELATIONSHIP_TYPES,
} from "./task-relationships.js";

describe("Task Relationships", () => {
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

  describe("addTaskRelationship", () => {
    it("should create a relationship between two tasks", () => {
      const t1 = makeTask("Task 1");
      const t2 = makeTask("Task 2");
      const rel = addTaskRelationship({
        source_task_id: t1.id,
        target_task_id: t2.id,
        relationship_type: "related_to",
      }, db);
      expect(rel.source_task_id).toBe(t1.id);
      expect(rel.target_task_id).toBe(t2.id);
      expect(rel.relationship_type).toBe("related_to");
      expect(rel.id).toBeTruthy();
    });

    it("should prevent self-relationships", () => {
      const t1 = makeTask("Task 1");
      expect(() => addTaskRelationship({
        source_task_id: t1.id,
        target_task_id: t1.id,
        relationship_type: "related_to",
      }, db)).toThrow("Cannot create a relationship between a task and itself");
    });

    it("should be idempotent for symmetric relationships", () => {
      const t1 = makeTask("Task 1");
      const t2 = makeTask("Task 2");
      const r1 = addTaskRelationship({ source_task_id: t1.id, target_task_id: t2.id, relationship_type: "related_to" }, db);
      const r2 = addTaskRelationship({ source_task_id: t2.id, target_task_id: t1.id, relationship_type: "related_to" }, db);
      expect(r1.id).toBe(r2.id); // Same relationship returned
    });

    it("should allow duplicate directional relationships", () => {
      const t1 = makeTask("Task 1");
      const t2 = makeTask("Task 2");
      const r1 = addTaskRelationship({ source_task_id: t1.id, target_task_id: t2.id, relationship_type: "duplicates" }, db);
      const r2 = addTaskRelationship({ source_task_id: t1.id, target_task_id: t2.id, relationship_type: "duplicates" }, db);
      expect(r1.id).toBe(r2.id); // Idempotent for same direction
    });

    it("should store metadata", () => {
      const t1 = makeTask("Task 1");
      const t2 = makeTask("Task 2");
      const rel = addTaskRelationship({
        source_task_id: t1.id,
        target_task_id: t2.id,
        relationship_type: "conflicts_with",
        metadata: { reason: "same file" },
      }, db);
      expect(rel.metadata).toEqual({ reason: "same file" });
    });

    it("should support all relationship types", () => {
      for (const type of RELATIONSHIP_TYPES) {
        const t1 = makeTask(`Task ${type} 1`);
        const t2 = makeTask(`Task ${type} 2`);
        const rel = addTaskRelationship({
          source_task_id: t1.id,
          target_task_id: t2.id,
          relationship_type: type,
        }, db);
        expect(rel.relationship_type).toBe(type);
      }
    });
  });

  describe("getTaskRelationship", () => {
    it("should return null for nonexistent ID", () => {
      expect(getTaskRelationship("nonexistent", db)).toBeNull();
    });
  });

  describe("removeTaskRelationship", () => {
    it("should remove by ID", () => {
      const t1 = makeTask("Task 1");
      const t2 = makeTask("Task 2");
      const rel = addTaskRelationship({ source_task_id: t1.id, target_task_id: t2.id, relationship_type: "related_to" }, db);
      expect(removeTaskRelationship(rel.id, db)).toBe(true);
      expect(getTaskRelationship(rel.id, db)).toBeNull();
    });

    it("should return false for nonexistent ID", () => {
      expect(removeTaskRelationship("nonexistent", db)).toBe(false);
    });
  });

  describe("removeTaskRelationshipByPair", () => {
    it("should remove symmetric relationships in either direction", () => {
      const t1 = makeTask("Task 1");
      const t2 = makeTask("Task 2");
      addTaskRelationship({ source_task_id: t1.id, target_task_id: t2.id, relationship_type: "related_to" }, db);
      // Remove using reversed direction
      expect(removeTaskRelationshipByPair(t2.id, t1.id, "related_to", db)).toBe(true);
      expect(getTaskRelationships(t1.id, undefined, db)).toHaveLength(0);
    });
  });

  describe("getTaskRelationships", () => {
    it("should return all relationships for a task", () => {
      const t1 = makeTask("Task 1");
      const t2 = makeTask("Task 2");
      const t3 = makeTask("Task 3");
      addTaskRelationship({ source_task_id: t1.id, target_task_id: t2.id, relationship_type: "related_to" }, db);
      addTaskRelationship({ source_task_id: t1.id, target_task_id: t3.id, relationship_type: "conflicts_with" }, db);
      const rels = getTaskRelationships(t1.id, undefined, db);
      expect(rels).toHaveLength(2);
    });

    it("should filter by type", () => {
      const t1 = makeTask("Task 1");
      const t2 = makeTask("Task 2");
      const t3 = makeTask("Task 3");
      addTaskRelationship({ source_task_id: t1.id, target_task_id: t2.id, relationship_type: "related_to" }, db);
      addTaskRelationship({ source_task_id: t1.id, target_task_id: t3.id, relationship_type: "conflicts_with" }, db);
      const rels = getTaskRelationships(t1.id, "related_to", db);
      expect(rels).toHaveLength(1);
      expect(rels[0]!.relationship_type).toBe("related_to");
    });
  });

  describe("findRelatedTaskIds", () => {
    it("should return related task IDs", () => {
      const t1 = makeTask("Task 1");
      const t2 = makeTask("Task 2");
      const t3 = makeTask("Task 3");
      addTaskRelationship({ source_task_id: t1.id, target_task_id: t2.id, relationship_type: "related_to" }, db);
      addTaskRelationship({ source_task_id: t3.id, target_task_id: t1.id, relationship_type: "similar_to" }, db);
      const ids = findRelatedTaskIds(t1.id, undefined, db);
      expect(ids).toContain(t2.id);
      expect(ids).toContain(t3.id);
      expect(ids).toHaveLength(2);
    });
  });

  describe("autoDetectFileRelationships", () => {
    it("should detect tasks that share files", () => {
      const t1 = makeTask("Task 1");
      const t2 = makeTask("Task 2");
      addTaskFile({ task_id: t1.id, path: "/src/foo.ts" }, db);
      addTaskFile({ task_id: t2.id, path: "/src/foo.ts" }, db);
      const created = autoDetectFileRelationships(t1.id, db);
      expect(created).toHaveLength(1);
      expect(created[0]!.relationship_type).toBe("modifies_same_file");
      expect(created[0]!.metadata).toEqual({ shared_file: "/src/foo.ts" });
    });

    it("should return empty for tasks with no shared files", () => {
      const t1 = makeTask("Task 1");
      addTaskFile({ task_id: t1.id, path: "/src/foo.ts" }, db);
      const created = autoDetectFileRelationships(t1.id, db);
      expect(created).toHaveLength(0);
    });
  });
});
