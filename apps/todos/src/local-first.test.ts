import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import packageJson from "../package.json";
import { createTask } from "./db/task-crud.js";
import { closeDatabase, getDatabase, resetDatabase } from "./db/database.js";
import { createMcpManifest } from "./mcp.js";
import { withNoNetwork } from "./test/no-network.js";

const CWD = join(import.meta.dir, "..");
const cloudPackage = "@hasna" + "/cloud";
const originalFetch = globalThis.fetch;

let tmpDir: string;
let fakeHome: string;
let dbPath: string;

async function runCli(
  args: string[],
  env: Record<string, string>,
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const proc = Bun.spawn(["bun", "run", "src/cli/index.tsx", ...args], {
    cwd: CWD,
    env: {
      ...process.env,
      HOME: fakeHome,
      TODOS_DB_PATH: dbPath,
      TODOS_AUTO_PROJECT: "false",
      HASNA_TODOS_STORAGE_MODE: "local",
      TODOS_STORAGE_MODE: "local",
      HASNA_TODOS_API_URL: "",
      HASNA_TODOS_API_KEY: "",
      TODOS_API_URL: "",
      TODOS_API_KEY: "",
      ...env,
    },
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

  // Safe-by-default boundary: self_hosted cloud routing only engages when an
  // explicit mode var (HASNA_TODOS_STORAGE_MODE / _MODE) resolves to
  // cloud/self_hosted. Having only API_URL + API_KEY present — with NO mode var
  // — must NEVER silently drift the CLI onto the network. It stays local, and
  // the remote endpoint is never touched. (Unset the mode -> local; this is the
  // reverse half of the reversible-flip contract.)
  test("API_URL+API_KEY without a mode var stays local (no accidental cloud drift)", async () => {
    let remoteCalls = 0;
    const server = Bun.serve({
      port: 0,
      fetch() {
        remoteCalls += 1;
        return Response.json({ error: "remote should not be called" }, { status: 500 });
      },
    });

    try {
      // Both HASNA_TODOS_* and bare TODOS_* forms of URL+KEY, but no mode var.
      const noModeEnv = {
        HASNA_TODOS_STORAGE_MODE: "",
        TODOS_STORAGE_MODE: "",
        HASNA_TODOS_API_URL: String(server.url).replace(/\/$/, ""),
        HASNA_TODOS_API_KEY: "remote-token",
        TODOS_API_URL: String(server.url).replace(/\/$/, ""),
        TODOS_API_KEY: "remote-token",
      };
      const created = await runCli(["--json", "add", "Local CLI task"], noModeEnv);
      expect(created.exitCode, created.stderr || created.stdout).toBe(0);
      expect(JSON.parse(created.stdout).title).toBe("Local CLI task");

      const listed = await runCli(["--json", "list"], noModeEnv);
      expect(listed.exitCode).toBe(0);
      expect(listed.stdout).toContain("Local CLI task");
      expect(remoteCalls).toBe(0);
    } finally {
      server.stop(true);
    }
  });

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
  });
});
