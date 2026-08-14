import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { closeDatabase, getDatabase, resetDatabase } from "../db/database.js";
import { createProject } from "../db/projects.js";
import { createTask, getTask, updateTask } from "../db/tasks.js";
import { resetConfig } from "./config.js";
import { getTaskReview } from "./task-contracts.js";
import {
  approveReviewItem,
  claimReviewItem,
  listReviewQueue,
  listReviewRoutingRules,
  removeReviewRoutingRule,
  requestReviewQueue,
  returnReviewItem,
  upsertReviewRoutingRule,
} from "./review-queues.js";

let previousDbPath: string | undefined;
let previousHome: string | undefined;
let home: string;

beforeEach(() => {
  previousDbPath = process.env["TODOS_DB_PATH"];
  previousHome = process.env["HOME"];
  home = mkdtempSync(join(tmpdir(), "todos-review-queues-"));
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

describe("local review queues", () => {
  test("routes review requests through local rules and claim approve history", () => {
    const db = getDatabase();
    const project = createProject({ name: "Review Project", path: "/tmp/review-project" }, db);
    const task = createTask({
      title: "Review routed task",
      project_id: project.id,
      priority: "high",
      tags: ["security"],
    }, db);

    const rule = upsertReviewRoutingRule({
      name: "security",
      queue: "security-review",
      reviewers: ["reviewer"],
      tags: ["security"],
      priorities: ["high"],
      project_id: project.id,
    });
    expect(rule.queue).toBe("security-review");
    expect(listReviewRoutingRules()).toHaveLength(1);

    const requested = requestReviewQueue({
      task_id: task.id,
      requester: "codex",
      reason: "security-sensitive change",
    }, db);
    expect(requested).toMatchObject({
      task_id: task.id,
      queue: "security-review",
      state: "requested",
      reviewer: "reviewer",
      routing_rule: "security",
    });
    expect(getTaskReview(task.id, db)?.state).toBe("requested");

    const claimed = claimReviewItem({ task_id: task.id, reviewer: "reviewer", note: "taking this" }, db);
    expect(claimed.state).toBe("claimed");
    expect(claimed.claimed_by).toBe("reviewer");

    const approved = approveReviewItem({ task_id: task.id, reviewer: "reviewer", note: "evidence accepted" }, db);
    expect(approved.state).toBe("approved");
    expect(approved.review?.state).toBe("approved");
    expect(approved.changes_requested).toEqual([]);
    expect(listReviewQueue({ state: "approved" }, db)[0]?.task_id).toBe(task.id);

    const metadata = getTask(task.id, db)?.metadata["_review_queue"] as { history: unknown[] };
    expect(metadata.history).toHaveLength(3);
  });

  test("returns work with requested changes and supports filtering", () => {
    const db = getDatabase();
    const task = createTask({ title: "Needs changes", priority: "medium" }, db);

    requestReviewQueue({ task_id: task.id, requester: "codex", reviewer: "qa", queue: "qa" }, db);
    claimReviewItem({ task_id: task.id, reviewer: "qa" }, db);
    const returned = returnReviewItem({
      task_id: task.id,
      reviewer: "qa",
      note: "not ready",
      changes_requested: ["add regression", "record verification"],
    }, db);

    expect(returned.state).toBe("returned");
    expect(returned.changes_requested).toEqual(["add regression", "record verification"]);
    expect(getTaskReview(task.id, db)?.state).toBe("changes_requested");
    expect(listReviewQueue({ queue: "qa", reviewer: "qa" }, db)).toHaveLength(1);
    expect(listReviewQueue({ queue: "other" }, db)).toHaveLength(0);
  });

  test("derives queue items for completed tasks requiring approval or low confidence", () => {
    const db = getDatabase();
    const approvalTask = createTask({ title: "Approval", requires_approval: true }, db);
    updateTask(approvalTask.id, { version: approvalTask.version, status: "completed" }, db);
    const lowConfidence = createTask({ title: "Low confidence" }, db);
    updateTask(lowConfidence.id, { version: lowConfidence.version, status: "completed", confidence: 0.2 }, db);

    const queue = listReviewQueue({}, db);
    expect(queue.map((item) => item.task_id)).toEqual(expect.arrayContaining([approvalTask.id, lowConfidence.id]));
    expect(queue.find((item) => item.task_id === approvalTask.id)?.reason).toBe("completed task requires approval");
    expect(queue.find((item) => item.task_id === lowConfidence.id)?.reason).toContain("low completion confidence");
  });

  test("removes routing rules without deleting queued review metadata", () => {
    const db = getDatabase();
    const task = createTask({ title: "Rule removal", tags: ["docs"] }, db);
    upsertReviewRoutingRule({ name: "docs", queue: "docs-review", reviewers: ["writer"], tags: ["docs"] });
    requestReviewQueue({ task_id: task.id, requester: "codex" }, db);

    expect(removeReviewRoutingRule("docs")).toBe(true);
    expect(listReviewRoutingRules()).toHaveLength(0);
    expect(listReviewQueue({ queue: "docs-review" }, db)).toHaveLength(1);
  });
});
