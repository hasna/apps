import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { getDatabase, closeDatabase, resetDatabase } from "../db/database.js";
import { discoverWorkspace, bootstrapWorkspace, getBootstrapStatus, BOOTSTRAP_SCHEMA } from "./project-bootstrap.js";

let tempDir: string;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "bootstrap-test-"));
  process.env["TODOS_DB_PATH"] = ":memory:";
  resetDatabase();
  getDatabase();
});

afterEach(() => {
  closeDatabase();
  delete process.env["TODOS_DB_PATH"];
  rmSync(tempDir, { recursive: true, force: true });
});

describe("project bootstrap", () => {
  it("discovers workspace from package.json name", () => {
    writeFileSync(join(tempDir, "package.json"), JSON.stringify({ name: "@scope/my-app" }));
    const discovery = discoverWorkspace(tempDir);
    expect(discovery.project_name).toBe("my-app");
    expect(discovery.todos_dir).toContain(".todos");
  });

  it("bootstraps project with default task list and manifest", () => {
    writeFileSync(join(tempDir, "package.json"), JSON.stringify({ name: "demo-app" }));
    const result = bootstrapWorkspace({ cwd: tempDir, init_todos_md: true });
    expect(result.schema_version).toBe(BOOTSTRAP_SCHEMA);
    expect(result.project.name).toBeTruthy();
    expect(result.task_list_id).toBeTruthy();
    expect(existsSync(result.manifest_path)).toBe(true);
  });

  it("is idempotent on second bootstrap", () => {
    writeFileSync(join(tempDir, "package.json"), JSON.stringify({ name: "demo-app" }));
    bootstrapWorkspace({ cwd: tempDir });
    const second = bootstrapWorkspace({ cwd: tempDir });
    expect(second.first_run).toBe(false);
  });

  it("reports bootstrap status", () => {
    writeFileSync(join(tempDir, "package.json"), JSON.stringify({ name: "status-app" }));
    bootstrapWorkspace({ cwd: tempDir });
    const status = getBootstrapStatus(tempDir);
    expect(status.bootstrapped).toBe(true);
    expect(status.project?.path).toBe(tempDir);
  });
});
