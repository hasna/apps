import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { closeDatabase, getDatabase, resetDatabase } from "../db/database.js";
import { registerAgent } from "../db/agents.js";
import { createPlan } from "../db/plans.js";
import { startTaskRun } from "../db/task-runs.js";
import { createTask } from "../db/tasks.js";
import { resolveMentions } from "./mention-resolver.js";

function git(root: string, args: string[]): string {
  const result = Bun.spawnSync(["git", ...args], { cwd: root, stdout: "pipe", stderr: "pipe" });
  if (result.exitCode !== 0) {
    throw new Error(new TextDecoder().decode(result.stderr));
  }
  return new TextDecoder().decode(result.stdout).trim();
}

function createGitWorkspace(): { root: string; sha: string } {
  const root = mkdtempSync(join(tmpdir(), "todos-refs-"));
  git(root, ["init", "-q"]);
  writeFileSync(join(root, "app.ts"), [
    "export function createProject() {",
    "  return 'ok';",
    "}",
    "",
  ].join("\n"));
  git(root, ["add", "app.ts"]);
  git(root, ["-c", "user.email=agent@example.invalid", "-c", "user.name=Agent", "commit", "-q", "-m", "init"]);
  git(root, ["branch", "feature/mentions"]);
  return { root, sha: git(root, ["rev-parse", "HEAD"]) };
}

beforeEach(() => {
  process.env["TODOS_DB_PATH"] = ":memory:";
  resetDatabase();
  getDatabase();
});

afterEach(() => {
  closeDatabase();
  delete process.env["TODOS_DB_PATH"];
});

describe("local mention resolver", () => {
  it("resolves local files, line anchors, symbols, commits, and branches", () => {
    const { root, sha } = createGitWorkspace();
    try {
      const report = resolveMentions({
        workspace: root,
        mentions: [
          "file:app.ts:2",
          "symbol:createProject",
          `commit:${sha.slice(0, 12)}`,
          "branch:feature/mentions",
        ],
        now: "2026-01-02T03:04:05.000Z",
      });

      expect(report).toMatchObject({
        schema_version: 1,
        local_only: true,
        no_network: true,
        generated_at: "2026-01-02T03:04:05.000Z",
        workspace: root,
      });
      expect(report.references.map((reference) => reference.resolved)).toEqual([true, true, true, true]);
      expect(report.references[0]!.canonical).toBe("file:app.ts:2");
      expect(report.references[1]!.canonical).toBe("symbol:createProject@app.ts:1");
      expect(report.references[2]!.sha).toBe(sha);
      expect(report.references[3]!.backlinks.map((item) => item.key)).toContain(`commit:${sha}`);
      expect(report.backlinks.map((item) => item.key)).toEqual(expect.arrayContaining([
        "file:app.ts:2",
        "symbol:createProject@app.ts:1",
        `commit:${sha}`,
        "branch:feature/mentions",
      ]));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("resolves plans, task runs, agents, and tasks from local sqlite state", () => {
    const root = mkdtempSync(join(tmpdir(), "todos-refs-state-"));
    try {
      const db = getDatabase();
      const task = createTask({ title: "Resolve local references" }, db);
      const plan = createPlan({ name: "Reference Plan" }, db);
      const run = startTaskRun({ task_id: task.id, agent_id: "marcus", title: "Resolve run" }, db);
      const agent = registerAgent({ name: "Marcus", working_dir: root }, db);
      if ("conflict" in agent) throw new Error(agent.message);

      const report = resolveMentions({
        workspace: root,
        mentions: [
          `plan:${plan.id.slice(0, 8)}`,
          `run:${run.id.slice(0, 8)}`,
          "agent:marcus",
          `task:${task.id.slice(0, 8)}`,
        ],
      }, db);

      expect(report.references.map((reference) => reference.canonical)).toEqual([
        `plan:${plan.id}`,
        `run:${run.id}`,
        `agent:${agent.id}`,
        `task:${task.id}`,
      ]);
      expect(report.backlinks.map((item) => item.key)).toEqual(expect.arrayContaining([
        `plan:${plan.id}`,
        `run:${run.id}`,
        `agent:${agent.id}`,
        `task:${task.id}`,
      ]));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("does not use hosted lookups for pull request refs", () => {
    const { root } = createGitWorkspace();
    try {
      const report = resolveMentions({ workspace: root, mentions: ["pr:123"] });
      expect(report.references[0]!.resolved).toBe(false);
      expect(report.references[0]!.warnings.join(" ")).toContain("hosted lookups are not used");
      expect(report.no_network).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
