import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { unlinkSync } from "node:fs";
import { closeDatabase, getDatabase, resetDatabase } from "../db/database.js";
import { createPlan } from "../db/plans.js";
import { createProject } from "../db/projects.js";
import { linkTaskToCommit, addTaskVerification } from "../db/task-commits.js";
import { createTask } from "../db/task-crud.js";
import { generateReleaseNotes, renderReleaseNotesMarkdown } from "./release-notes.js";
import { validateJsonContract } from "../json-contracts.js";

const dbPath = "/tmp/todos-release-notes-test.db";

beforeEach(() => {
  process.env["TODOS_DB_PATH"] = dbPath;
  resetDatabase();
  try { unlinkSync(dbPath); } catch {}
  try { unlinkSync(`${dbPath}-shm`); } catch {}
  try { unlinkSync(`${dbPath}-wal`); } catch {}
});

afterEach(() => {
  closeDatabase();
  delete process.env["TODOS_DB_PATH"];
  try { unlinkSync(dbPath); } catch {}
  try { unlinkSync(`${dbPath}-shm`); } catch {}
  try { unlinkSync(`${dbPath}-wal`); } catch {}
});

describe("local release notes generation", () => {
  test("builds deterministic changelog JSON and Markdown from local task evidence", () => {
    const db = getDatabase();
    const project = createProject({ name: "Release Project", path: "/tmp/release-project" }, db);
    const plan = createPlan({ name: "v1.1", project_id: project.id }, db);
    const task = createTask({
      title: "Ship release notes",
      description: "Generate local release output",
      priority: "high",
      project_id: project.id,
      plan_id: plan.id,
      tags: ["release"],
      metadata: {
        breaking_change: "Removed the old hosted changelog endpoint.",
        migration_notes: ["Run todos release-notes locally before publishing."],
      },
    }, db);
    db.run("UPDATE tasks SET status = 'completed', completed_at = ?, updated_at = ? WHERE id = ?", [
      "2026-01-02T03:04:05.000Z",
      "2026-01-02T03:04:05.000Z",
      task.id,
    ]);
    linkTaskToCommit({
      task_id: task.id,
      sha: "abcdef1234567890",
      message: "Add release notes",
      files_changed: ["src/lib/release-notes.ts"],
      committed_at: "2026-01-02T03:05:00.000Z",
    }, db);
    addTaskVerification({
      task_id: task.id,
      command: "bun test src/lib/release-notes.test.ts",
      status: "passed",
      output_summary: "release notes tests passed",
      run_at: "2026-01-02T03:06:00.000Z",
    }, db);

    const notes = generateReleaseNotes({
      project_id: project.id,
      plan_id: plan.id,
      tag: "release",
      title: "v1.1 Release",
      version: "1.1.0",
      generated_at: "2026-01-02T04:00:00.000Z",
    }, db);

    expect(validateJsonContract("release_notes", notes).ok).toBe(true);
    expect(notes.local_only).toBe(true);
    expect(notes.summary).toMatchObject({
      tasks: 1,
      plans: 1,
      commits: 1,
      verifications: 1,
      passed_verifications: 1,
      breaking_changes: 1,
      migration_notes: 1,
    });
    expect(notes.tasks[0]?.commits[0]?.sha).toBe("abcdef1234567890");
    expect(notes.breaking_changes[0]?.note).toContain("hosted changelog");

    const markdown = renderReleaseNotesMarkdown(notes);
    expect(markdown).toContain("# v1.1 Release");
    expect(markdown).toContain("commit abcdef123456");
    expect(markdown).toContain("verification passed: bun test src/lib/release-notes.test.ts");
    expect(markdown).toContain("Run todos release-notes locally before publishing.");
  });

  test("CLI returns JSON release notes without network access", async () => {
    const db = getDatabase();
    const project = createProject({ name: "CLI Release", path: "/tmp/cli-release" }, db);
    const task = createTask({
      title: "Document CLI release notes",
      project_id: project.id,
      tags: ["release"],
    }, db);
    db.run("UPDATE tasks SET status = 'completed', completed_at = ? WHERE id = ?", [
      "2026-01-03T03:04:05.000Z",
      task.id,
    ]);
    closeDatabase();

    const proc = Bun.spawn({
      cmd: [
        process.execPath,
        "src/cli/index.tsx",
        "release-notes",
        "--project",
        project.id,
        "--json",
      ],
      cwd: `${import.meta.dir}/../..`,
      env: { ...process.env, TODOS_DB_PATH: dbPath, TODOS_AUTO_PROJECT: "false" },
      stdout: "pipe",
      stderr: "pipe",
    });
    const stdout = await new Response(proc.stdout).text();
    const stderr = await new Response(proc.stderr).text();
    const exitCode = await proc.exited;

    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
    const payload = JSON.parse(stdout);
    expect(payload.scope.project_id).toBe(project.id);
    expect(payload.summary.tasks).toBe(1);
    expect(payload.tasks[0].title).toBe("Document CLI release notes");
  });
});
