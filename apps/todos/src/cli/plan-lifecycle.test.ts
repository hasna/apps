import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const REPO_ROOT = join(import.meta.dir, "../..");
const tempRoots: string[] = [];

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

async function runCli(args: string[], root: string) {
  const proc = Bun.spawn(["bun", "run", "src/cli/index.tsx", ...args], {
    cwd: REPO_ROOT,
    env: {
      PATH: process.env.PATH ?? "",
      HOME: root,
      TMPDIR: root,
      LANG: "C.UTF-8",
      TODOS_DB_PATH: join(root, "todos.db"),
      TODOS_AUTO_PROJECT: "false",
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();
  return { exitCode: await proc.exited, stdout, stderr };
}

async function runJson(args: string[], root: string): Promise<Record<string, unknown>> {
  const result = await runCli(["--json", ...args], root);
  expect(result).toMatchObject({ exitCode: 0, stderr: "" });
  return JSON.parse(result.stdout) as Record<string, unknown>;
}

describe("local CLI plan lifecycle", () => {
  test("updates and renames a plan, then migrates its tasks before deletion", async () => {
    const root = mkdtempSync(join(tmpdir(), "todos-local-plan-migration-"));
    tempRoots.push(root);

    const source = await runJson(["plans", "--add", "Source", "--slug", "source"], root);
    const target = await runJson(["plans", "--add", "Target", "--slug", "target"], root);
    const task = await runJson(["add", "Migrated task", "--plan", "source"], root);

    await runJson(["plans", "--complete", String(source.id)], root);
    const updated = await runJson([
      "plans",
      "--update",
      "source",
      "--name",
      "Updated source",
      "--description",
      "Updated description",
      "--slug",
      "updated-source",
      "--status",
      "active",
    ], root);
    expect(updated).toMatchObject({
      id: source.id,
      name: "Updated source",
      description: "Updated description",
      slug: "updated-source",
      status: "active",
    });

    const renamed = await runJson(
      ["plans", "--rename", "updated-source", "Final source name"],
      root,
    );
    expect(renamed).toMatchObject({ id: source.id, name: "Final source name" });

    const deleted = await runJson(
      ["plans", "--delete", "updated-source", "--move-tasks-to", "target"],
      root,
    );
    expect(deleted).toEqual({
      deleted: true,
      moved_tasks: 1,
      orphaned_tasks: 0,
    });

    const movedTask = await runJson(["show", String(task.id)], root);
    expect(movedTask.plan_id).toBe(target.id);
  });

  test("warns before deleting a plan with tasks and reports the orphan count", async () => {
    const root = mkdtempSync(join(tmpdir(), "todos-local-plan-warning-"));
    tempRoots.push(root);

    const source = await runJson(["plans", "--add", "Source", "--slug", "source"], root);
    const task = await runJson(["add", "Orphaned task", "--plan", "source"], root);

    const result = await runCli(["--json", "plans", "--delete", String(source.id)], root);
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toContain("Warning: deleting plan Source will orphan 1 task");
    expect(result.stderr).toContain("--move-tasks-to");
    expect(JSON.parse(result.stdout)).toEqual({
      deleted: true,
      moved_tasks: 0,
      orphaned_tasks: 1,
    });

    const orphanedTask = await runJson(["show", String(task.id)], root);
    expect(orphanedTask.plan_id).toBeNull();
  });

  test("migrates a plan's archived tasks instead of silently orphaning them", async () => {
    const root = mkdtempSync(join(tmpdir(), "todos-local-plan-archived-move-"));
    tempRoots.push(root);

    const source = await runJson(["plans", "--add", "Source", "--slug", "source"], root);
    const target = await runJson(["plans", "--add", "Target", "--slug", "target"], root);
    const live = await runJson(["add", "Live task", "--plan", "source"], root);
    const duplicate = await runJson(["add", "Duplicate task", "--plan", "source"], root);

    // Merging archives the duplicate but leaves its plan_id intact, so the plan
    // still owns two tasks — one of them archived.
    await runJson(["dedupe", "merge", String(live.id), String(duplicate.id)], root);
    const archived = await runJson(["show", String(duplicate.id)], root);
    expect(archived.archived_at).not.toBeNull();
    expect(archived.plan_id).toBe(source.id);

    const deleted = await runJson(
      ["plans", "--delete", "source", "--move-tasks-to", "target"],
      root,
    );
    expect(deleted).toEqual({
      deleted: true,
      moved_tasks: 2,
      orphaned_tasks: 0,
    });

    expect((await runJson(["show", String(live.id)], root)).plan_id).toBe(target.id);
    expect((await runJson(["show", String(duplicate.id)], root)).plan_id).toBe(target.id);
  });

  test("counts an archived task in the orphan warning for a plan with no live tasks", async () => {
    const root = mkdtempSync(join(tmpdir(), "todos-local-plan-archived-warning-"));
    tempRoots.push(root);

    await runJson(["plans", "--add", "Source", "--slug", "source"], root);
    // The merge primary sits outside the plan, so archiving the duplicate leaves
    // the plan holding exactly one task and no live ones.
    const primary = await runJson(["add", "Primary task"], root);
    const duplicate = await runJson(["add", "Duplicate task", "--plan", "source"], root);
    await runJson(["dedupe", "merge", String(primary.id), String(duplicate.id)], root);

    const result = await runCli(["--json", "plans", "--delete", "source"], root);
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toContain("Warning: deleting plan Source will orphan 1 task");
    expect(result.stderr).toContain("--move-tasks-to");
    expect(JSON.parse(result.stdout)).toEqual({
      deleted: true,
      moved_tasks: 0,
      orphaned_tasks: 1,
    });

    expect((await runJson(["show", String(duplicate.id)], root)).plan_id).toBeNull();
  });
});
