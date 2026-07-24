import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { addTaskVerification } from "../db/task-commits.js";
import { getDatabase, getDatabasePath, resetDatabase } from "../db/database.js";
import { createTask, getTask, updateTask } from "../db/tasks.js";
import {
  checkTaskDoneContract,
  getTaskContract,
  getTaskReview,
  recordTaskReview,
  requestTaskReview,
  setTaskContract,
} from "./task-contracts.js";

const taskContractsRoot = mkdtempSync(join(tmpdir(), "todos-task-contracts-"));
const taskContractsDb = join(taskContractsRoot, "task-contracts.db");
const originalPrimaryDb = process.env.HASNA_TODOS_DB_PATH;
const originalFallbackDb = process.env.TODOS_DB_PATH;

beforeEach(() => {
  resetDatabase();
  process.env.HASNA_TODOS_DB_PATH = taskContractsDb;
  process.env.TODOS_DB_PATH = taskContractsDb;
});

afterAll(() => {
  resetDatabase();
  if (originalPrimaryDb === undefined) delete process.env.HASNA_TODOS_DB_PATH;
  else process.env.HASNA_TODOS_DB_PATH = originalPrimaryDb;
  if (originalFallbackDb === undefined) delete process.env.TODOS_DB_PATH;
  else process.env.TODOS_DB_PATH = originalFallbackDb;
  rmSync(taskContractsRoot, { recursive: true, force: true });
});

describe("local task contracts and reviews", () => {
  test("uses only its explicit disposable database", () => {
    expect(getDatabasePath()).toBe(taskContractsDb);
    expect(getDatabase()).toBeDefined();
  });

  test("stores acceptance criteria and reports missing done evidence", () => {
    const db = getDatabase();
    const task = createTask({ title: "Ship parser" }, db);

    const contract = setTaskContract({
      task_id: task.id,
      acceptance_criteria: ["Parses quoted task titles", "Rejects malformed checkboxes"],
      verification_commands: ["bun test src/parser.test.ts"],
      expected_artifacts: ["logs/parser.txt"],
      relevant_files: ["src/parser.ts"],
      risk_level: "medium",
      done_definition: ["review approved"],
    }, db);

    expect(contract.acceptance_criteria).toHaveLength(2);
    expect(getTaskContract(task.id, db)?.verification_commands).toEqual(["bun test src/parser.test.ts"]);
    expect(getTask(task.id, db)?.metadata.acceptance_criteria).toEqual(["Parses quoted task titles", "Rejects malformed checkboxes"]);

    const review = requestTaskReview({ task_id: task.id, requester: "codex", reviewer: "reviewer", notes: "Ready for verification" }, db);
    expect(review.state).toBe("requested");
    expect(getTaskReview(task.id, db)?.reviewer).toBe("reviewer");

    const result = checkTaskDoneContract(task.id, db);
    expect(result.ok).toBe(false);
    expect(result.missing).toEqual(expect.arrayContaining([
      "task_status_completed",
      "passed_verification:bun test src/parser.test.ts",
      "artifact:logs/parser.txt",
      "review_approved",
    ]));
    expect(result.evidence.acceptance_criteria).toBe(2);
  });

  test("passes when completion, verification, artifacts, and review satisfy the contract", () => {
    const db = getDatabase();
    const task = createTask({ title: "Ship parser", requires_approval: true }, db);
    setTaskContract({
      task_id: task.id,
      acceptance_criteria: ["Parser handles quotes"],
      verification_commands: ["bun test src/parser.test.ts"],
      expected_artifacts: ["logs/parser.txt"],
      done_definition: ["review approved"],
    }, db);
    requestTaskReview({ task_id: task.id, requester: "codex", reviewer: "reviewer" }, db);

    addTaskVerification({
      task_id: task.id,
      command: "bun test src/parser.test.ts",
      status: "passed",
      output_summary: "12 pass",
      artifact_path: "logs/parser.txt",
      agent_id: "codex",
    }, db);
    const current = getTask(task.id, db)!;
    updateTask(task.id, { version: current.version, status: "completed", approved_by: "reviewer" }, db);
    recordTaskReview({ task_id: task.id, state: "approved", reviewer: "reviewer", notes: "Evidence matches criteria" }, db);

    const result = checkTaskDoneContract(task.id, db);
    expect(result.ok).toBe(true);
    expect(result.missing).toEqual([]);
    expect(result.evidence.passed_verifications).toEqual(["bun test src/parser.test.ts"]);
    expect(result.evidence.artifacts).toEqual(["logs/parser.txt"]);
    expect(result.evidence.review_state).toBe("approved");
  });

  test("records requested changes as a machine-readable review state", () => {
    const db = getDatabase();
    const task = createTask({ title: "Needs review" }, db);

    requestTaskReview({ task_id: task.id, requester: "codex", reviewer: "reviewer" }, db);
    const review = recordTaskReview({
      task_id: task.id,
      state: "changes_requested",
      reviewer: "reviewer",
      notes: "Add regression coverage",
      changes_requested: ["Add failing fixture", "Record verification evidence"],
    }, db);

    expect(review.state).toBe("changes_requested");
    expect(review.changes_requested).toEqual(["Add failing fixture", "Record verification evidence"]);
    expect(getTaskReview(task.id, db)?.history.at(-1)?.state).toBe("changes_requested");

    const reopened = recordTaskReview({
      task_id: task.id,
      state: "reopened",
      reviewer: "reviewer",
      notes: "Reopen after requested changes",
    }, db);

    expect(reopened.state).toBe("reopened");
    expect(reopened.changes_requested).toEqual([]);
    expect(getTaskReview(task.id, db)?.history.at(-1)?.state).toBe("reopened");
  });

  test("does not allow stale approval metadata to bypass requested changes", () => {
    const db = getDatabase();
    const task = createTask({ title: "Needs explicit review", requires_approval: true }, db);
    setTaskContract({
      task_id: task.id,
      acceptance_criteria: ["Reviewer accepts the evidence"],
      done_definition: ["review approved"],
    }, db);
    requestTaskReview({ task_id: task.id, requester: "codex", reviewer: "reviewer" }, db);
    recordTaskReview({
      task_id: task.id,
      state: "changes_requested",
      reviewer: "reviewer",
      changes_requested: ["Add regression evidence"],
    }, db);
    const current = getTask(task.id, db)!;
    updateTask(task.id, { version: current.version, status: "completed", approved_by: "reviewer" }, db);

    const result = checkTaskDoneContract(task.id, db);
    expect(result.ok).toBe(false);
    expect(result.missing).toContain("review_approved");
    expect(result.evidence.review_state).toBe("changes_requested");
  });
});
