import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import packageJson from "../package.json";
import { createTask } from "./db/task-crud.js";
import { closeDatabase, getDatabase, resetDatabase } from "./db/database.js";
import { createMcpManifest } from "./mcp.js";
import { withNoNetwork } from "./test/no-network.js";
import { cliSpawnBudgetMs } from "./test/spawn-budget.js";

const CWD = join(import.meta.dir, "..");
const cloudPackage = "@hasna" + "/cloud";
const originalFetch = globalThis.fetch;

let tmpDir: string;
let fakeHome: string;
let dbPath: string;

async function runCli(
  args: string[],
  env: Record<string, string | undefined>,
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const childEnv = Object.fromEntries(
    Object.entries({
      ...process.env,
      HOME: fakeHome,
      TODOS_DB_PATH: dbPath,
      TODOS_AUTO_PROJECT: "false",
      HASNA_TODOS_API_URL: "",
      HASNA_TODOS_API_KEY: "",
      TODOS_API_URL: "",
      TODOS_API_KEY: "",
      ...env,
    }).filter((entry): entry is [string, string] => entry[1] !== undefined),
  );
  const proc = Bun.spawn(["bun", "run", "src/cli/index.tsx", ...args], {
    cwd: CWD,
    env: childEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { stdout, stderr, exitCode };
}

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "todos-local-first-"));
  fakeHome = join(tmpDir, "home");
  dbPath = join(tmpDir, "todos.db");
  process.env["TODOS_DB_PATH"] = ":memory:";
  resetDatabase();
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  closeDatabase();
  delete process.env["TODOS_DB_PATH"];
  rmSync(tmpDir, { recursive: true, force: true });
});

describe("OSS local-first package surface", () => {
  test("does not expose hosted/cloud binaries, exports, or direct dependencies", () => {
    expect(packageJson.bin).not.toHaveProperty("todos-remote");
    expect(packageJson.exports).not.toHaveProperty("./remote");
    expect(packageJson.dependencies).not.toHaveProperty(cloudPackage);
    expect(packageJson.dependencies).not.toHaveProperty("@hasna/logs");
  });

  test("does not publish cloud MCP tools in the manifest", () => {
    const manifest = createMcpManifest();
    const names = manifest.tools.map((tool) => tool.name);
    const retiredToolPrefix = ["todos", "cloud"].join("_");

    for (const forbidden of [
      "sync_all",
      `${retiredToolPrefix}_conflicts`,
      `${retiredToolPrefix}_feedback`,
      `${retiredToolPrefix}_pull`,
      `${retiredToolPrefix}_push`,
      `${retiredToolPrefix}_status`,
      "todos_storage_conflicts",
      "todos_storage_feedback",
      "todos_storage_pull",
      "todos_storage_push",
      "todos_storage_status",
      "todos_inbox",
      "todos_retro",
      "migrate_pg",
    ]) {
      expect(names).not.toContain(forbidden);
    }
    expect(Object.keys(manifest.groups)).not.toContain("cloud");
    expect(Object.keys(manifest.groups)).not.toContain("storage");
  });
});

describe("OSS local-first runtime defaults", () => {
  test("local DB task creation does not call fetch when no webhooks are registered", () => {
    const task = createTask({ title: "Local task only" }, getDatabase());

    expect(task.title).toBe("Local task only");
  });

  test("no-network fixture fails local operations that unexpectedly fetch", async () => {
    const { result: task, calls } = await withNoNetwork(() => createTask({ title: "Trapped local task" }, getDatabase()));

    expect(task.title).toBe("Trapped local task");
    expect(calls).toEqual([]);
  });

  // Safe-by-default boundary after the storage-mode removal (owner directive
  // 2026-08-15): the API pair (HASNA_TODOS_API_URL + HASNA_TODOS_API_KEY) is
  // the SOLE http selector. Present together — with NO storage-mode variable —
  // it MUST route to the authority; the previous "flip-safety guard" that kept
  // a bare pair silently local was exactly the silent-drift defect the
  // directive removed.
  test("API_URL+API_KEY without any mode variable routes to the authority", async () => {
    let remoteCalls = 0;
    const server = Bun.serve({
      port: 0,
      fetch() {
        remoteCalls += 1;
        return Response.json({ error: "authority rejects" }, { status: 500 });
      },
    });

    try {
      const pairEnv = {
        HASNA_TODOS_API_URL: String(server.url).replace(/\/$/, ""),
        HASNA_TODOS_API_KEY: "remote-token",
      };
      const created = await runCli(["--json", "add", "Remote CLI task"], pairEnv);
      // The authority is reached and rejects: the CLI fails closed rather than
      // silently writing a different dataset.
      expect(remoteCalls).toBeGreaterThan(0);
      expect(created.exitCode).not.toBe(0);
      expect(created.stderr).toMatch(/local SQLite fallback is disabled/i);
    } finally {
      server.stop(true);
    }
  }, cliSpawnBudgetMs(1));

  // Regression for the exact failure class this removal fixes: a retired
  // storage-mode variable must hard-error, never silently route to local.
  test("a retired storage-mode variable refuses to boot, never routes", async () => {
    const result = await runCli(["--json", "add", "Banned task"], {
      HASNA_TODOS_STORAGE_MODE: "remote",
      HASNA_TODOS_API_URL: "https://todos.invalid",
      HASNA_TODOS_API_KEY: "remote-token",
    });
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("REMOTE_STORAGE_MODE_REMOVED");
    expect(result.stderr).toContain("Deployment modes no longer exist");
  }, cliSpawnBudgetMs(1));

  // Regression: `--project` is parsed onto the global program opts, so the add
  // command (which only read its local opts.project) silently dropped it and
  // left project_id null. It must honor opts.project || globalOpts.project.
  test("`add --project <id>` actually assigns the project", async () => {
    const seeded = await runCli(
      ["projects", "--add", fakeHome, "--name", "RegProj", "--json"],
      {},
    );
    expect(seeded.exitCode).toBe(0);
    const projectId = JSON.parse(seeded.stdout).id as string;
    expect(projectId).toBeTruthy();

    const added = await runCli(
      ["add", "Task with project", "--project", projectId, "--json"],
      {},
    );
    expect(added.exitCode).toBe(0);
    expect(JSON.parse(added.stdout).project_id).toBe(projectId);
    // Two sequential cold CLI starts (`projects --add`, then `add --project`).
  }, cliSpawnBudgetMs(2));
});
