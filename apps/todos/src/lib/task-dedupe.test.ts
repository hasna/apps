import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { Database } from "bun:sqlite";
import { addComment, listComments } from "../db/comments.js";
import { closeDatabase, getDatabase, resetDatabase } from "../db/database.js";
import { createInboxItem } from "../db/inbox.js";
import { addDependency, createTask, getTask, getTaskDependencies } from "../db/tasks.js";
import { addTaskFile, listTaskFiles } from "../db/task-files.js";
import { addTaskVerification, getTaskVerifications } from "../db/task-commits.js";
import { addTaskRunCommand, getTaskRunLedger, startTaskRun } from "../db/task-runs.js";
import { getTaskRelationships } from "../db/task-relationships.js";
import { findDuplicateTasks, mergeDuplicateTask } from "./task-dedupe.js";

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

describe("local task duplicate detection and merge", () => {
  test("detects duplicates from imported issue URLs and stack traces", () => {
    const issueA = createTask({
      title: "[GH#42] Fix parser crash",
      description: "Imported issue",
      metadata: { github_url: "https://github.com/hasna/todos/issues/42", github_number: 42 },
    }, db);
    const issueB = createTask({
      title: "Parser crash on empty input",
      description: "Same imported issue",
      metadata: { github_url: "https://github.com/hasna/todos/issues/42", github_number: 42 },
    }, db);
    const stackA = createTask({
      title: "TypeError in runner",
      description: "TypeError: Cannot read properties\n    at runTask (src/runner.ts:10:5)\n    at main (src/index.ts:2:1)",
    }, db);
    const stackB = createTask({
      title: "Runner fails with typeerror",
      description: "Traceback\nTypeError: Cannot read properties\n    at runTask (src/runner.ts:10:5)\n    at main (src/index.ts:2:1)",
    }, db);
    createTask({ title: "Unrelated docs work", description: "Update README" }, db);

    const candidates = findDuplicateTasks({ threshold: 0.72 }, db);
    const pairs = candidates.map((candidate) => new Set([candidate.primary_task.id, candidate.duplicate_task.id]));

    expect(pairs.some((pair) => pair.has(issueA.id) && pair.has(issueB.id))).toBe(true);
    expect(pairs.some((pair) => pair.has(stackA.id) && pair.has(stackB.id))).toBe(true);
    expect(candidates.every((candidate) => candidate.reasons.length > 0)).toBe(true);
  });

  test("merges duplicates without losing local comments dependencies runs files inbox or verification evidence", () => {
    const blocker = createTask({ title: "Blocker" }, db);
    const downstream = createTask({ title: "Downstream" }, db);
    const primary = createTask({
      title: "Fix flaky CLI parser",
      tags: ["cli"],
      metadata: { source_url: "https://github.com/hasna/todos/issues/50" },
    }, db);
    const duplicate = createTask({
      title: "CLI parser flaky failure",
      description: "Same issue",
      tags: ["bug"],
      metadata: { source_url: "https://github.com/hasna/todos/issues/50", extra: true },
    }, db);

    addDependency(duplicate.id, blocker.id, db);
    addDependency(downstream.id, duplicate.id, db);
    addComment({ task_id: duplicate.id, content: "Duplicate has useful context", agent_id: "codex" }, db);
    addTaskFile({ task_id: duplicate.id, path: "src/parser.ts", status: "modified", note: "same file" }, db);
    addTaskVerification({ task_id: duplicate.id, command: "bun test parser", status: "passed", output_summary: "ok" }, db);
    const run = startTaskRun({ task_id: duplicate.id, agent_id: "codex", title: "duplicate run" }, db);
    addTaskRunCommand({ run_id: run.id, command: "bun test", status: "passed" }, db);
    const inbox = createInboxItem({
      body: "https://github.com/hasna/todos/issues/50",
      source_url: "https://github.com/hasna/todos/issues/50",
      create_task: false,
    }, db).item;
    db.run("UPDATE inbox_items SET task_id = ? WHERE id = ?", [duplicate.id, inbox.id]);

    const result = mergeDuplicateTask({
      primary_task_id: primary.id,
      duplicate_task_id: duplicate.id,
      agent_id: "codex",
      reason: "same imported issue",
    }, db);

    expect(result.primary_task.id).toBe(primary.id);
    expect(result.archived_duplicate.status).toBe("cancelled");
    expect(result.moved.comments).toBe(1);
    expect(result.moved.runs).toBe(1);
    expect(result.moved.verifications).toBe(1);
    expect(result.moved.inbox_items).toBe(1);

    expect(listComments(primary.id, db).map((comment) => comment.content)).toContain("Duplicate has useful context");
    expect(getTaskDependencies(primary.id, db).map((dep) => dep.depends_on)).toContain(blocker.id);
    expect(getTaskDependencies(downstream.id, db).map((dep) => dep.depends_on)).toContain(primary.id);
    expect(getTaskRunLedger(run.id, db)?.run.task_id).toBe(primary.id);
    expect(listTaskFiles(primary.id, db).map((file) => file.path)).toContain("src/parser.ts");
    expect(getTaskVerifications(primary.id, db).map((verification) => verification.command)).toContain("bun test parser");
    expect((db.query("SELECT task_id FROM inbox_items WHERE id = ?").get(inbox.id) as { task_id: string }).task_id).toBe(primary.id);
    expect(getTaskRelationships(primary.id, "duplicates", db).some((rel) => rel.target_task_id === duplicate.id)).toBe(true);

    const duplicateAfter = getTask(duplicate.id, db)!;
    expect(duplicateAfter.metadata["merged_into"]).toBe(primary.id);
    expect((db.query("SELECT archived_at FROM tasks WHERE id = ?").get(duplicate.id) as { archived_at: string | null }).archived_at).toBeTruthy();
  });
});
