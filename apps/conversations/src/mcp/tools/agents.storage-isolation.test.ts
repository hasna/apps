import { afterEach, expect, test } from "bun:test";
import { Database as BunDatabase } from "bun:sqlite";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { openDatabase } from "../../lib/db.js";

const cleanupPaths: string[] = [];

afterEach(() => {
  for (const path of cleanupPaths.splice(0)) {
    rmSync(path, { force: true, recursive: true });
  }
});

test("agent MCP fixtures cannot fall back to inherited production storage", async () => {
  const root = mkdtempSync(join(tmpdir(), "conversations-agent-storage-isolation-"));
  cleanupPaths.push(root);

  const productionDbPath = join(root, "production.db");
  const configPath = join(root, "production-config.json");
  const configContents = JSON.stringify({ sentinel: "unchanged" });
  writeFileSync(configPath, configContents);

  const productionDb = openDatabase(productionDbPath);
  productionDb.prepare(`
    INSERT INTO agent_presence (
      id, agent, session_id, role, project_id, status, last_seen_at, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%f', 'now'), strftime('%Y-%m-%dT%H:%M:%f', 'now'))
  `).run("sentinel", "production-sentinel", "sentinel-session", "agent", "", "online");
  productionDb.close();

  const runs = Array.from({ length: 4 }, async (_, index) => {
    const runRoot = join(root, `run-${index}`);
    const home = join(runRoot, "home");
    const temp = join(runRoot, "tmp");
    const intendedTestDbPath = join(runRoot, "intended-test.db");
    const agentIdPath = join(home, ".hasna", "conversations", "agent-id");
    mkdirSync(join(home, ".hasna", "conversations"), { recursive: true });
    mkdirSync(temp, { recursive: true });
    const seededIdentity = index % 2 === 0;
    if (seededIdentity) {
      writeFileSync(agentIdPath, "production-identity\n");
    }

    const subprocess = Bun.spawn(
      [process.execPath, "test", "src/mcp/tools/agents.test.ts"],
      {
        cwd: process.cwd(),
        env: {
          ...process.env,
          HOME: home,
          TMPDIR: temp,
          HASNA_CONVERSATIONS_DB_PATH: productionDbPath,
          CONVERSATIONS_DB_PATH: intendedTestDbPath,
          CONVERSATIONS_CONFIG_PATH: configPath,
          HASNA_CONVERSATIONS_STORAGE_MODE: "local",
          HASNA_CONVERSATIONS_API_URL: "",
          HASNA_CONVERSATIONS_API_KEY: "",
          CONVERSATIONS_API_URL: "",
          CONVERSATIONS_API_KEY: "",
        },
        stdout: "pipe",
        stderr: "pipe",
      },
    );

    const [exitCode, stdout, stderr] = await Promise.all([
      subprocess.exited,
      new Response(subprocess.stdout).text(),
      new Response(subprocess.stderr).text(),
    ]);

    expect(
      { exitCode, stdout, stderr },
      `isolated agent MCP test run ${index} failed`,
    ).toMatchObject({ exitCode: 0 });
    expect(existsSync(intendedTestDbPath)).toBe(false);
    if (seededIdentity) {
      expect(readFileSync(agentIdPath, "utf8")).toBe("production-identity\n");
    } else {
      expect(existsSync(agentIdPath)).toBe(false);
    }
  });

  await Promise.all(runs);

  const readonlyProductionDb = new BunDatabase(productionDbPath, { readonly: true });
  const agents = readonlyProductionDb
    .query("SELECT agent FROM agent_presence ORDER BY agent")
    .all() as Array<{ agent: string }>;
  readonlyProductionDb.close();

  expect(agents).toEqual([{ agent: "production-sentinel" }]);
  expect(agents.some(({ agent }) => agent === "rename-old" || agent === "rename-new")).toBe(false);
  expect(readFileSync(configPath, "utf8")).toBe(configContents);
});
