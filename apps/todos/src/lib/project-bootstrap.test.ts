import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { closeDatabase, getDatabase, resetDatabase } from "../db/database.js";
import { listProjectSources } from "../db/projects.js";
import { listTaskLists } from "../db/task-lists.js";
import { withNoNetwork } from "../test/no-network.js";
import { bootstrapProject, discoverProjectWorkspace } from "./project-bootstrap.js";

let root: string;

beforeEach(() => {
  process.env["TODOS_DB_PATH"] = ":memory:";
  resetDatabase();
  getDatabase();
  root = mkdtempSync(join(tmpdir(), "todos-bootstrap-"));
});

afterEach(() => {
  closeDatabase();
  delete process.env["TODOS_DB_PATH"];
  rmSync(root, { recursive: true, force: true });
});

function writeJson(path: string, value: unknown): void {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

describe("project bootstrap discovery", () => {
  test("discovers a plain git package without network access", async () => {
    mkdirSync(join(root, ".git"));
    writeJson(join(root, "package.json"), { name: "@hasna/example" });

    const { result, calls } = await withNoNetwork(() => discoverProjectWorkspace(root));

    expect(calls).toEqual([]);
    expect(result.projectPath).toBe(root);
    expect(result.projectName).toBe("example");
    expect(result.gitRoot).toBe(root);
    expect(result.packageRoot).toBe(root);
    expect(result.monorepo).toBe(false);
  });

  test("detects monorepo package roots and workspace metadata", () => {
    mkdirSync(join(root, ".git"));
    mkdirSync(join(root, "packages", "cli"), { recursive: true });
    writeJson(join(root, "package.json"), { name: "workspace-root", workspaces: ["packages/*"] });
    writeJson(join(root, "packages", "cli", "package.json"), { name: "@hasna/todos-cli" });
    writeFileSync(join(root, "turbo.json"), "{}\n");

    const discovery = discoverProjectWorkspace(join(root, "packages", "cli"));

    expect(discovery.projectPath).toBe(join(root, "packages", "cli"));
    expect(discovery.projectName).toBe("todos-cli");
    expect(discovery.workspaceRoot).toBe(root);
    expect(discovery.workspaceKind).toBe("package.json#workspaces");
    expect(discovery.monorepo).toBe(true);
    expect(discovery.markers).toEqual(expect.arrayContaining(["package.json#workspaces", "turbo.json"]));
  });
});

describe("project bootstrap state", () => {
  test("dry-run reports discovery without writing project state", () => {
    mkdirSync(join(root, ".git"));

    const result = bootstrapProject({ path: root, dryRun: true });

    expect(result.dryRun).toBe(true);
    expect(result.project).toBeNull();
    expect(result.taskList).toBeNull();
    expect(listTaskLists()).toEqual([]);
  });

  test("creates project identity default task list and local sources idempotently", () => {
    mkdirSync(join(root, ".git"));
    writeJson(join(root, "package.json"), { name: "bootstrap-app" });

    const first = bootstrapProject({ path: root });
    const second = bootstrapProject({ path: root });

    expect(first.created.project).toBe(true);
    expect(first.created.taskList).toBe(true);
    expect(first.project?.name).toBe("bootstrap-app");
    expect(first.taskList?.slug).toBe("todos-bootstrap-app");
    expect(second.created.project).toBe(false);
    expect(second.created.taskList).toBe(false);
    expect(second.project?.id).toBe(first.project?.id);

    const lists = listTaskLists(first.project!.id);
    expect(lists).toHaveLength(1);
    expect(lists[0]!.slug).toBe("todos-bootstrap-app");

    const sources = listProjectSources(first.project!.id);
    expect(sources.map((source) => source.type).sort()).toEqual(["git", "local"]);
  });

  test("allows explicit project names and task list conventions", () => {
    mkdirSync(join(root, ".git"));

    const result = bootstrapProject({
      path: root,
      name: "Custom Workspace",
      taskListSlug: "custom-tasks",
    });

    expect(result.project?.name).toBe("Custom Workspace");
    expect(result.project?.task_list_id).toBe("custom-tasks");
    expect(result.taskList?.slug).toBe("custom-tasks");
  });
});
