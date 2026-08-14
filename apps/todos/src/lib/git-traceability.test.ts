import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { getDatabase, closeDatabase, resetDatabase } from "../db/database.js";
import { createTask } from "../db/tasks.js";
import { createProject } from "../db/projects.js";
import {
  linkTaskToCommit,
  getTaskCommits,
  getTaskTraceability,
} from "../db/task-commits.js";
import {
  inspectGitCommit,
  getHeadSha,
  formatTraceabilityReport,
  linkTaskGitTrace,
  loadCiSnapshot,
  GIT_TRACEABILITY_SCHEMA_VERSION,
} from "./git-traceability.js";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

let tempDir: string;

beforeEach(() => {
  process.env["TODOS_DB_PATH"] = ":memory:";
  resetDatabase();
  getDatabase();
  tempDir = mkdtempSync(join(tmpdir(), "git-trace-test-"));
});

afterEach(() => {
  closeDatabase();
  delete process.env["TODOS_DB_PATH"];
  rmSync(tempDir, { recursive: true, force: true });
});

describe("task commit traceability fields", () => {
  it("stores branch, PR, CI snapshot, and release tag", () => {
    const project = createProject({ name: "trace-proj", path: tempDir });
    const task = createTask({ title: "Git task", project_id: project.id });

    const commit = linkTaskToCommit({
      task_id: task.id,
      sha: "abc123def456",
      message: "feat: traceability",
      branch: "feature/trace",
      pr_url: "https://github.com/org/repo/pull/42",
      pr_number: 42,
      pr_state: "OPEN",
      release_tag: "v1.2.0",
      repo_path: tempDir,
      files_changed: ["src/foo.ts"],
      ci_snapshot: { status: "passed", provider: "local" },
      traceability: { schema_version: GIT_TRACEABILITY_SCHEMA_VERSION },
    });

    expect(commit.branch).toBe("feature/trace");
    expect(commit.pr_number).toBe(42);
    expect(commit.ci_snapshot?.status).toBe("passed");
    expect(commit.release_tag).toBe("v1.2.0");

    const report = getTaskTraceability(task.id);
    expect(report.branches).toContain("feature/trace");
    expect(report.pull_requests[0]?.url).toContain("/pull/42");
    expect(report.release_tags).toContain("v1.2.0");
    expect(getTaskCommits(task.id)).toHaveLength(1);
  });

  it("formats traceability report", () => {
    const project = createProject({ name: "trace-proj", path: tempDir });
    const task = createTask({ title: "Git task", project_id: project.id });
    linkTaskToCommit({
      task_id: task.id,
      sha: "deadbeef",
      message: "fix bug",
      branch: "main",
      pr_url: "https://example.com/pr/1",
    });
    const text = formatTraceabilityReport(getTaskTraceability(task.id));
    expect(text).toContain("deadbee");
    expect(text).toContain("main");
    expect(text).toContain("https://example.com/pr/1");
  });
});

describe("git capture helpers", () => {
  it("fails clearly when git is unavailable", () => {
    const project = createProject({ name: "no-git-project", path: tempDir });
    const task = createTask({ title: "No git task", project_id: project.id });
    const originalPath = process.env.PATH;
    process.env.PATH = "/todos-container-no-host-tools";
    try {
      expect(() => linkTaskGitTrace({ task_id: task.id, cwd: tempDir })).toThrow(
        "Could not resolve git commit SHA",
      );
    } finally {
      if (originalPath === undefined) delete process.env.PATH;
      else process.env.PATH = originalPath;
    }
  });

  it("loads CI snapshot from path", () => {
    const path = join(tempDir, "ci.json");
    writeFileSync(path, JSON.stringify({ status: "passed", provider: "test" }));
    const snap = loadCiSnapshot(path);
    expect(snap?.status).toBe("passed");
  });

  it("inspects current repo HEAD commit", () => {
    const repoRoot = process.cwd();
    const sha = getHeadSha(repoRoot);
    if (!sha) return;
    const info = inspectGitCommit(sha, repoRoot);
    expect(info?.sha).toBe(sha);
    expect(info?.message.length).toBeGreaterThan(0);
  });

  it("links git trace from HEAD in repo", () => {
    const repoRoot = process.cwd();
    const sha = getHeadSha(repoRoot);
    if (!sha) return;

    const project = createProject({ name: "trace-proj", path: repoRoot });
    const task = createTask({ title: "Git task", project_id: project.id });
    const linked = linkTaskGitTrace({ task_id: task.id, sha, cwd: repoRoot });
    expect(linked.sha).toBe(sha);
    expect(linked.repo_path).toBeTruthy();
    expect(linked.traceability.schema_version).toBe(GIT_TRACEABILITY_SCHEMA_VERSION);
  });
});
