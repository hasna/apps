import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { getDatabase, closeDatabase, resetDatabase } from "../db/database.js";
import { createTask } from "../db/tasks.js";
import {
  VERIFICATION_EVIDENCE_SCHEMA,
  createVerificationEvidence,
  listVerificationEvidence,
  exportVerificationEvidence,
  writeVerificationExport,
} from "./verification-evidence.js";

let tempDir: string;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "todos-ver-ev-"));
  process.env["TODOS_DB_PATH"] = ":memory:";
  resetDatabase();
  getDatabase();
});

afterEach(() => {
  closeDatabase();
  delete process.env["TODOS_DB_PATH"];
  rmSync(tempDir, { recursive: true, force: true });
});

describe("verification evidence", () => {
  it("creates portable evidence with commands and links", () => {
    const task = createTask({ title: "Verify me" });
    const record = createVerificationEvidence({
      task_id: task.id,
      agent_id: "agent-1",
      status: "passed",
      summary: "All checks passed",
      confidence: 0.95,
      commands: [{ command: "bun test", exit_code: 0, duration_ms: 1200 }],
      test_results: [{ name: "auth.test.ts", status: "passed" }],
      links: [{ label: "CI run", url: "https://ci.example/run/1", kind: "ci" }],
    });

    expect(record.schema_version).toBe(VERIFICATION_EVIDENCE_SCHEMA);
    expect(record.commands).toHaveLength(1);
    expect(record.links[0]!.kind).toBe("ci");
    expect(record.confidence).toBe(0.95);
    expect(record.verifier.agent_id).toBe("agent-1");
  });

  it("lists and exports evidence for a task", () => {
    const task = createTask({ title: "Export task" });
    createVerificationEvidence({ task_id: task.id, status: "passed", summary: "ok" });
    createVerificationEvidence({ task_id: task.id, status: "failed", summary: "fail" });

    const listed = listVerificationEvidence({ task_id: task.id });
    expect(listed).toHaveLength(2);

    const bundle = exportVerificationEvidence({ task_id: task.id });
    expect(bundle.records).toHaveLength(2);
    expect(bundle.task_id).toBe(task.id);
  });

  it("writes export bundle to file", () => {
    const task = createTask({ title: "File export" });
    createVerificationEvidence({ task_id: task.id, status: "passed", summary: "done" });
    const path = join(tempDir, "evidence.json");
    writeVerificationExport(exportVerificationEvidence({ task_id: task.id }), path);
    expect(existsSync(path)).toBe(true);
    const parsed = JSON.parse(readFileSync(path, "utf8"));
    expect(parsed.schema_version).toBe(VERIFICATION_EVIDENCE_SCHEMA);
  });

  it("normalizes provider-run records to portable format", () => {
    const task = createTask({ title: "Provider run" });
    const raw = createVerificationEvidence({
      task_id: task.id,
      provider_name: "manual",
      status: "passed",
      summary: "Looks good",
    });
    expect(raw.schema_version).toBe(VERIFICATION_EVIDENCE_SCHEMA);
    expect(raw.summary).toContain("Looks good");
  });
});
