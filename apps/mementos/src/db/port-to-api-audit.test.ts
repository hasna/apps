import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { stubApiEnv } from "../test-support/store-isolation.js";

let server: ReturnType<typeof Bun.spawn> | undefined;
let captureFile = "";
let baseUrl = "";

async function start(): Promise<string> {
  captureFile = join(tmpdir(), `mementos-audit-capture-${crypto.randomUUID()}.log`);
  writeFileSync(captureFile, "", { mode: 0o600 });
  server = Bun.spawn(["bun", "run", `${import.meta.dir}/__fixtures__/port-slice-a-capture-server.ts`], {
    env: { ...(process.env as Record<string, string>), CAPTURE_FILE: captureFile },
    stdout: "pipe",
    stderr: "pipe",
  });
  const text = new TextDecoder().decode((await server.stdout.getReader().read()).value ?? new Uint8Array());
  const match = /READY (\d+)/.exec(text);
  if (!match) throw new Error(`audit capture server did not start: ${text}`);
  return `http://127.0.0.1:${match[1]}`;
}

function walk(root: string, prefix = ""): string[] {
  return readdirSync(root).flatMap((name) => {
    const path = join(root, name);
    const relative = prefix ? `${prefix}/${name}` : name;
    return statSync(path).isDirectory() ? walk(path, relative) : [relative];
  });
}

async function scenario(name: string, mode = "valid"): Promise<string[]> {
  writeFileSync(captureFile, "", { mode: 0o600 });
  const home = mkdtempSync(join(tmpdir(), "mementos-audit-home-"));
  const env = stubApiEnv(baseUrl, { apiKey: `stub-${mode}` });
  Object.assign(env, { HOME: home, CAPTURE_FILE: captureFile, SCENARIO: name });
  const child = Bun.spawn(["bun", "run", `${import.meta.dir}/__fixtures__/port-slice-a-client-runner.ts`], {
    env,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [code, stderr] = await Promise.all([child.exited, new Response(child.stderr).text()]);
  if (code !== 0) throw new Error(`${name} failed: ${stderr}`);
  expect(walk(home).filter((path) => /(?:\.db|\.sqlite|\.sqlite3|\.json|\.jsonl)(?:$|-wal$|-shm$)/.test(path))).toEqual([]);
  rmSync(home, { recursive: true, force: true });
  return readFileSync(captureFile, "utf8").trim().split("\n").filter(Boolean);
}

beforeAll(async () => { baseUrl = await start(); });
afterAll(() => {
  server?.kill();
  if (captureFile && existsSync(captureFile)) rmSync(captureFile);
});

describe("hosted immutable audit transport", () => {
  test("MCP audit tools use the canonical /v1 routes and no local store", async () => {
    const trail = await scenario("memory_audit_trail");
    const exported = await scenario("memory_audit_export");
    const stats = await scenario("memory_audit_stats");
    expect(trail[0]).toContain("GET /v1/memories/mem-1/audit-trail?limit=10");
    expect(exported[0]).toContain("GET /v1/audit/export?operation=update&limit=10");
    expect(stats[0]).toContain("GET /v1/audit/stats");
    expect([...trail, ...exported, ...stats].some((line) => line.includes("/v1/v1/"))).toBe(false);
  });

  test.each([
    "malformed-audit-trail",
    "false-empty-audit-trail",
    "malformed-audit-export",
    "limit-mismatch-audit-export",
    "filter-mismatch-audit-export",
    "malformed-audit-stats",
  ])(
    "%s refuses malformed 2xx without fallback",
    async (name) => {
      const lines = await scenario(name, name);
      expect(lines.length).toBe(name === "false-empty-audit-trail" ? 2 : 1);
    },
  );
});
