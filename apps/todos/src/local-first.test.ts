import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import packageJson from "../package.json";
import { createTask } from "./db/task-crud.js";
import { closeDatabase, getDatabase, resetDatabase } from "./db/database.js";
import { createMcpManifest } from "./mcp.js";

const CWD = join(import.meta.dir, "..");
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
    expect(packageJson.dependencies).not.toHaveProperty("@hasna/cloud");
    expect(packageJson.dependencies).not.toHaveProperty("@hasna/logs");
  });

  test("does not publish cloud MCP tools in the manifest", () => {
    const manifest = createMcpManifest();
    const names = manifest.tools.map((tool) => tool.name);

    for (const forbidden of [
      "sync_all",
      "todos_cloud_conflicts",
      "todos_cloud_feedback",
      "todos_cloud_pull",
      "todos_cloud_push",
      "todos_cloud_status",
      "todos_inbox",
      "todos_retro",
      "migrate_pg",
    ]) {
      expect(names).not.toContain(forbidden);
    }
    expect(Object.keys(manifest.groups)).not.toContain("cloud");
  });
});

describe("OSS local-first runtime defaults", () => {
  test("local DB task creation does not call fetch when no webhooks are registered", () => {
    let called = false;
    globalThis.fetch = (async () => {
      called = true;
      throw new Error("unexpected network call");
    }) as typeof fetch;

    const task = createTask({ title: "Local task only" }, getDatabase());

    expect(task.title).toBe("Local task only");
    expect(called).toBe(false);
  });

  test("CLI ignores hosted remote env vars and writes to local SQLite", async () => {
    let remoteCalls = 0;
    const server = Bun.serve({
      port: 0,
      fetch() {
        remoteCalls += 1;
        return Response.json({ error: "remote should not be called" }, { status: 500 });
      },
    });

    try {
      const hostileRemoteEnv = {
        TODOS_API_URL: String(server.url).replace(/\/$/, ""),
        TODOS_API_KEY: "remote-token",
        TODOS_MODE: "remote",
      };
      const created = await runCli(["--json", "add", "Local CLI task"], hostileRemoteEnv);
      expect(created.exitCode).toBe(0);
      expect(JSON.parse(created.stdout).title).toBe("Local CLI task");

      const listed = await runCli(["--json", "list"], hostileRemoteEnv);
      expect(listed.exitCode).toBe(0);
      expect(listed.stdout).toContain("Local CLI task");
      expect(remoteCalls).toBe(0);
    } finally {
      server.stop(true);
    }
  });
});
