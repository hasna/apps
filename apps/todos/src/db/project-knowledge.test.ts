import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import type { Database } from "bun:sqlite";
import { closeDatabase, getDatabase, resetDatabase } from "./database.js";
import { createProject } from "./projects.js";
import { createTask } from "./tasks.js";
import {
  createKnowledgeExportReport,
  createKnowledgeRecord,
  createKnowledgeSnapshot,
  listKnowledgeRecords,
  renderKnowledgeExportMarkdown,
  searchKnowledgeRecords,
} from "./project-knowledge.js";

let db: Database;

beforeEach(() => {
  process.env["TODOS_DB_PATH"] = ":memory:";
  resetDatabase();
  db = getDatabase();
});

afterEach(() => {
  closeDatabase();
  delete process.env["TODOS_DB_PATH"];
});

describe("project knowledge records", () => {
  it("stores decisions and tradeoffs locally with task and project links", () => {
    const project = createProject({ name: "Knowledge", path: "/tmp/knowledge" }, db);
    const task = createTask({ title: "Capture architecture decision", project_id: project.id }, db);

    const record = createKnowledgeRecord({
      record_type: "decision",
      title: "Use local SQLite for OSS knowledge",
      content: "The OSS package must not call hosted services for project memory.",
      decision: "Store knowledge records in the local todos database.",
      rationale: "Agents can search and export context while offline.",
      alternatives: ["Hosted notes API", "Markdown-only ADRs"],
      task_id: task.id.slice(0, 8),
      project_id: project.id.slice(0, 8),
      tags: ["architecture", "local-only"],
      metadata: { sensitivity: "internal" },
    }, db);

    expect(record.record_type).toBe("decision");
    expect(record.task_id).toBe(task.id);
    expect(record.project_id).toBe(project.id);
    expect(record.alternatives).toEqual(["Hosted notes API", "Markdown-only ADRs"]);
    expect(record.tags).toEqual(["architecture", "local-only"]);

    const listed = listKnowledgeRecords({ project_id: project.id, tag: "local-only" }, db);
    expect(listed.map((item) => item.id)).toEqual([record.id]);

    const found = searchKnowledgeRecords({ query: "offline", project_id: project.id }, db);
    expect(found.map((item) => item.id)).toEqual([record.id]);
  });

  it("creates task-linked context snapshots and exports deterministic local reports", () => {
    const project = createProject({ name: "Snapshots", path: "/tmp/snapshots" }, db);
    const task = createTask({ title: "Continue agent run", project_id: project.id }, db);

    const result = createKnowledgeSnapshot({
      title: "Run handoff after parser fix",
      summary: "Parser fix is implemented; tests still need a full run.",
      snapshot_type: "handoff",
      task_id: task.id,
      project_id: project.id,
      agent_id: "codex",
      files_open: ["src/parser.ts"],
      attempts: ["Added regression coverage"],
      blockers: ["Blacksmith unavailable"],
      next_steps: "Run guarded bun test locally.",
      tags: ["handoff"],
    }, db);

    expect(result.snapshot_id).toBeTruthy();
    expect(result.record.record_type).toBe("context_snapshot");
    expect(result.record.snapshot_id).toBe(result.snapshot_id);
    expect(result.record.metadata["snapshot_type"]).toBe("handoff");

    const report = createKnowledgeExportReport({ project_id: project.id }, db);
    expect(report.local_only).toBe(true);
    expect(report.no_network).toBe(true);
    expect(report.records).toHaveLength(1);
    expect(report.records[0]!.title).toBe("Run handoff after parser fix");

    const markdown = renderKnowledgeExportMarkdown(report);
    expect(markdown).toContain("# Project Knowledge");
    expect(markdown).toContain("Run handoff after parser fix");
    expect(markdown).toContain("Parser fix is implemented");
  });
});
