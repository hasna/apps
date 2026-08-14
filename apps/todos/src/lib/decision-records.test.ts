import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { getDatabase, closeDatabase, resetDatabase } from "../db/database.js";
import { createProject } from "../db/projects.js";
import { createPlan } from "../db/plans.js";
import {
  DECISION_RECORD_SCHEMA,
  KNOWLEDGE_SNAPSHOT_SCHEMA,
  createDecisionRecord,
  getDecisionRecord,
  getDecisionRecordByRef,
  listDecisionRecords,
  updateDecisionRecord,
  setDecisionStatus,
  supersedeDecisionRecord,
  formatDecisionRecordMarkdown,
  exportDecisionRecord,
  buildKnowledgeSnapshotPayload,
  captureKnowledgeSnapshot,
  getKnowledgeSnapshot,
  listKnowledgeSnapshots,
  formatKnowledgeSnapshotMarkdown,
  exportKnowledgeSnapshot,
} from "./decision-records.js";

let tempDir: string;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "todos-decisions-"));
  process.env["TODOS_DB_PATH"] = ":memory:";
  resetDatabase();
  getDatabase();
});

afterEach(() => {
  closeDatabase();
  delete process.env["TODOS_DB_PATH"];
  rmSync(tempDir, { recursive: true, force: true });
});

describe("decision records", () => {
  it("creates ADR with project-scoped short ref", () => {
    const project = createProject({ name: "decisions-proj", path: join(tempDir, "proj") });
    const record = createDecisionRecord({
      project_id: project.id,
      title: "Use SQLite for local storage",
      context: "Need offline-first task store",
      decision: "Use bun:sqlite with WAL mode",
      consequences: "Single-file local database",
      tags: ["storage", "sqlite"],
      agent_id: "agent-a",
    });

    expect(record.schema_version).toBe(DECISION_RECORD_SCHEMA);
    expect(record.short_ref).toMatch(/-00001$/);
    expect(record.status).toBe("proposed");
    expect(record.sequence_num).toBe(1);

    const loaded = getDecisionRecord(record.id);
    expect(loaded?.title).toBe("Use SQLite for local storage");
    expect(loaded?.tags).toEqual(["storage", "sqlite"]);
  });

  it("increments sequence numbers per project", () => {
    const project = createProject({ name: "seq-proj", path: join(tempDir, "seq") });
    const first = createDecisionRecord({ project_id: project.id, title: "First", decision: "A" });
    const second = createDecisionRecord({ project_id: project.id, title: "Second", decision: "B" });

    expect(first.sequence_num).toBe(1);
    expect(second.sequence_num).toBe(2);
    expect(getDecisionRecordByRef(second.short_ref)?.id).toBe(second.id);
  });

  it("updates and changes status", () => {
    const record = createDecisionRecord({ title: "Draft", decision: "Maybe X" });
    const updated = updateDecisionRecord(record.id, {
      title: "Final",
      decision: "Use X",
      consequences: "Simpler stack",
    });
    expect(updated.title).toBe("Final");
    expect(updated.decision).toBe("Use X");

    const accepted = setDecisionStatus(record.id, "accepted");
    expect(accepted.status).toBe("accepted");
  });

  it("supersedes a prior decision", () => {
    const project = createProject({ name: "sup-proj", path: join(tempDir, "sup") });
    const original = createDecisionRecord({
      project_id: project.id,
      title: "Old approach",
      decision: "REST only",
      status: "accepted",
    });

    const { previous, replacement } = supersedeDecisionRecord(original.id, {
      title: "New approach",
      decision: "Add MCP surface",
    });

    expect(previous.status).toBe("superseded");
    expect(previous.superseded_by_id).toBe(replacement.id);
    expect(replacement.supersedes_id).toBe(original.id);
    expect(replacement.status).toBe("accepted");
  });

  it("lists by project and tag", () => {
    const project = createProject({ name: "list-proj", path: join(tempDir, "list") });
    createDecisionRecord({ project_id: project.id, title: "A", decision: "1", tags: ["api"] });
    createDecisionRecord({ project_id: project.id, title: "B", decision: "2", tags: ["cli"] });
    createDecisionRecord({ title: "Other", decision: "3", tags: ["api"] });

    expect(listDecisionRecords({ project_id: project.id })).toHaveLength(2);
    expect(listDecisionRecords({ tag: "api" })).toHaveLength(2);
  });

  it("exports markdown ADR to disk", () => {
    const record = createDecisionRecord({
      title: "Export me",
      context: "Need portable docs",
      decision: "Write Markdown",
      alternatives: [{ title: "JSON only", rejected_reason: "Harder to read" }],
    });

    const out = join(tempDir, "adr.md");
    const result = exportDecisionRecord(record.id, out, "markdown");
    expect(result.path).toBe(out);
    expect(existsSync(out)).toBe(true);
    expect(readFileSync(out, "utf8")).toContain("# ");
    expect(readFileSync(out, "utf8")).toContain("Export me");
    expect(formatDecisionRecordMarkdown(record)).toContain("## Decision");
  });
});

describe("knowledge snapshots", () => {
  it("builds payload from project decisions and plans", () => {
    const project = createProject({
      name: "know-proj",
      path: join(tempDir, "know"),
      description: "Always use bun",
    });
    createPlan({ project_id: project.id, name: "Ship v1", status: "active" });
    createDecisionRecord({
      project_id: project.id,
      title: "Accepted choice",
      decision: "Use bun test",
      status: "accepted",
      tags: ["testing"],
    });
    createDecisionRecord({
      project_id: project.id,
      title: "Rejected idea",
      decision: "Use jest",
      status: "rejected",
    });

    const payload = buildKnowledgeSnapshotPayload({ project_id: project.id });
    expect(payload.schema_version).toBe(KNOWLEDGE_SNAPSHOT_SCHEMA);
    expect(payload.project?.name).toBe("know-proj");
    expect(payload.decisions).toHaveLength(1);
    expect(payload.active_plans).toHaveLength(1);
    expect(payload.topics).toContain("testing");
    expect(payload.conventions).toContain("Always use bun");
  });

  it("captures and lists snapshots", () => {
    const project = createProject({ name: "snap-proj", path: join(tempDir, "snap") });
    createDecisionRecord({
      project_id: project.id,
      title: "Keep it local",
      decision: "No cloud by default",
      status: "accepted",
    });

    const snapshot = captureKnowledgeSnapshot({
      project_id: project.id,
      summary: "Baseline project knowledge",
    });

    expect(snapshot.schema_version).toBe(KNOWLEDGE_SNAPSHOT_SCHEMA);
    expect(snapshot.content_hash).toHaveLength(64);
    expect(snapshot.decision_ids).toHaveLength(1);

    const loaded = getKnowledgeSnapshot(snapshot.id);
    expect(loaded?.snapshot.decisions[0]?.title).toBe("Keep it local");

    const listed = listKnowledgeSnapshots({ project_id: project.id });
    expect(listed).toHaveLength(1);
  });

  it("exports knowledge snapshot markdown", () => {
    const project = createProject({ name: "export-proj", path: join(tempDir, "export") });
    const snapshot = captureKnowledgeSnapshot({ project_id: project.id, title: "Baseline" });
    const out = join(tempDir, "knowledge.md");
    const result = exportKnowledgeSnapshot(snapshot.id, out, "markdown");

    expect(existsSync(out)).toBe(true);
    expect(result.content).toContain("Baseline");
    expect(formatKnowledgeSnapshotMarkdown(snapshot)).toContain("## Decisions");
  });
});
