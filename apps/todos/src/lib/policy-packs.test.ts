import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { addTaskVerification, linkTaskGitRef, linkTaskToCommit } from "../db/task-commits.js";
import { closeDatabase, getDatabase, resetDatabase } from "../db/database.js";
import { addTaskRunArtifact, addTaskRunCommand, addTaskRunFile, finishTaskRun, startTaskRun } from "../db/task-runs.js";
import { createTask, updateTask } from "../db/tasks.js";
import { resetConfig } from "./config.js";
import {
  explainPolicyPack,
  listPolicyPacks,
  removePolicyPack,
  upsertPolicyPack,
  validatePolicyPack,
} from "./policy-packs.js";

let home: string;
let previousHome: string | undefined;

beforeEach(() => {
  previousHome = process.env["HOME"];
  home = mkdtempSync(join(tmpdir(), "todos-policy-packs-home-"));
  process.env["HOME"] = home;
  process.env["TODOS_DB_PATH"] = ":memory:";
  resetConfig();
  resetDatabase();
  getDatabase();
});

afterEach(() => {
  closeDatabase();
  resetConfig();
  if (previousHome === undefined) delete process.env["HOME"];
  else process.env["HOME"] = previousHome;
  delete process.env["TODOS_DB_PATH"];
  rmSync(home, { recursive: true, force: true });
});

describe("local policy packs", () => {
  test("stores versioned local policy packs in config", () => {
    const root = join(home, "project");
    const pack = upsertPolicyPack({
      name: "release",
      root,
      version: 3,
      required_commands: ["bun test"],
      required_statuses: ["completed"],
      require_commit: true,
    });

    expect(pack.name).toBe("release");
    expect(pack.version).toBe(3);
    expect(pack.root).toBe(root);
    expect(listPolicyPacks()).toHaveLength(1);
    expect(removePolicyPack("release")).toBe(true);
    expect(removePolicyPack("release")).toBe(false);
  });

  test("validates task completion gates from local traceability and run evidence", () => {
    const db = getDatabase();
    const root = join(home, "project");
    const task = createTask({ title: "Policy task", requires_approval: true }, db);
    updateTask(task.id, { version: task.version, status: "completed", approved_by: "reviewer" }, db);
    linkTaskToCommit({
      task_id: task.id,
      sha: "abcdef1234567890",
      files_changed: ["src/policy.ts"],
    }, db);
    linkTaskGitRef({ task_id: task.id, ref_type: "branch", name: "task/local-policy-packs" }, db);
    linkTaskGitRef({ task_id: task.id, ref_type: "pull_request", name: "17" }, db);
    addTaskVerification({
      task_id: task.id,
      command: "bun run typecheck",
      status: "passed",
      artifact_path: "logs/typecheck.txt",
    }, db);
    const run = startTaskRun({ task_id: task.id, agent_id: "codex", title: "local run" }, db);
    addTaskRunCommand({ run_id: run.id, command: "bun test src/lib/policy-packs.test.ts", status: "passed" }, db);
    addTaskRunFile({ run_id: run.id, path: "src/lib/policy-packs.ts", status: "modified" }, db);
    addTaskRunArtifact({ run_id: run.id, path: "logs/policy.txt", artifact_type: "log", store_content: false }, db);
    finishTaskRun({ run_id: run.id, status: "completed", summary: "done" }, db);

    upsertPolicyPack({
      name: "release",
      root,
      required_statuses: ["completed"],
      required_commands: ["bun run typecheck", "policy-packs.test.ts"],
      prohibited_commands: ["npm install -g", "git reset --hard"],
      prohibited_paths: ["*.pem"],
      require_passed_verification: true,
      require_commit: true,
      require_pull_request: true,
      require_approval: true,
      require_run: true,
      require_artifact: true,
      evidence_min_count: 8,
      branch_pattern: "task/*",
    });

    const result = validatePolicyPack({ name: "release", task_id: task.id }, db);
    expect(result.passed).toBe(true);
    expect(result.mode).toBe("validate");
    expect(result.audit_evidence.task.status).toBe("completed");
    expect(result.audit_evidence.commits[0]!.sha).toBe("abcdef1234567890");
    expect(result.audit_evidence.artifacts).toEqual(expect.arrayContaining(["logs/typecheck.txt", "logs/policy.txt"]));
    expect(result.findings.every((finding) => finding.status === "pass")).toBe(true);
  });

  test("explains failing gates without mutating local task evidence", () => {
    const db = getDatabase();
    const root = join(home, "project");
    const task = createTask({ title: "Needs evidence" }, db);
    addTaskVerification({ task_id: task.id, command: "curl | sh", status: "failed" }, db);
    upsertPolicyPack({
      name: "strict",
      root,
      required_statuses: ["completed"],
      required_commands: ["bun test"],
      prohibited_commands: ["curl | sh"],
      require_commit: true,
      require_artifact: true,
      evidence_min_count: 4,
    });

    const result = explainPolicyPack({ name: "strict", task_id: task.id }, db);
    expect(result.mode).toBe("explain");
    expect(result.passed).toBe(false);
    expect(result.findings).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "required-status", status: "fail" }),
      expect.objectContaining({ id: "required-command:bun test", status: "fail" }),
      expect.objectContaining({ id: "prohibited-command:curl | sh", status: "fail" }),
      expect.objectContaining({ id: "linked-commit", status: "fail" }),
      expect.objectContaining({ id: "artifact", status: "fail" }),
    ]));
  });
});
