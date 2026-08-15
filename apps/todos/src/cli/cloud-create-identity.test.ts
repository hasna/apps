import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const REPO_ROOT = join(import.meta.dir, "../..");
const FETCH_FIXTURE = join(import.meta.dir, "fixtures/cloud-create-identity-fetch.ts");
const CANONICAL_CREATE_ID = "2c4b7a7f-658e-424c-bcaf-475c3206f76e";
const CREATE_SHORT_ID = "IAP9-00378";
const MISSING_TASK_ID = "ffffffff-ffff-4fff-8fff-ffffffffffff";
const tempRoots: string[] = [];

afterEach(() => {
  for (const root of tempRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

async function runCli(args: string[], root: string, requestLog: string) {
  const proc = Bun.spawn([
    "bun", "run", "--preload", FETCH_FIXTURE, "src/cli/index.tsx", ...args,
  ], {
    cwd: REPO_ROOT,
    env: {
      PATH: process.env.PATH ?? "",
      HOME: root,
      TMPDIR: root,
      LANG: "C.UTF-8",
      TODOS_DB_PATH: join(root, "must-not-exist.db"),
      TODOS_AUTO_PROJECT: "false",
      TODOS_AGENT_ID: "identity-regression",
      HASNA_TODOS_API_URL: "https://identity.fixture.invalid",
      HASNA_TODOS_API_KEY: "fixture-key-not-a-secret",
      TODOS_CREATE_IDENTITY_REQUEST_LOG: requestLog,
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

describe("cloud create response identity", () => {
  test("add returns the canonical UUID that full-ID and short-ID inspection resolve", async () => {
    const root = mkdtempSync(join(tmpdir(), "todos-create-identity-"));
    tempRoots.push(root);
    const requestLog = join(root, "requests.log");
    writeFileSync(requestLog, "");

    const added = await runCli([
      "--json", "add", "Stable create identity regression", "--no-project",
    ], root, requestLog);
    expect(added).toMatchObject({ exitCode: 0, stderr: "" });
    const addedTask = JSON.parse(added.stdout) as { id: string };
    expect(addedTask.id).toBe(CANONICAL_CREATE_ID);

    const byReturnedId = await runCli(["--json", "inspect", addedTask.id], root, requestLog);
    expect(byReturnedId).toMatchObject({ exitCode: 0, stderr: "" });
    expect((JSON.parse(byReturnedId.stdout) as { id: string }).id).toBe(CANONICAL_CREATE_ID);

    const byShortId = await runCli(["--json", "inspect", CREATE_SHORT_ID], root, requestLog);
    expect(byShortId).toMatchObject({ exitCode: 0, stderr: "" });
    expect((JSON.parse(byShortId.stdout) as { id: string }).id).toBe(addedTask.id);

    const missing = await runCli(["--json", "inspect", MISSING_TASK_ID], root, requestLog);
    expect(missing.exitCode).toBe(1);
    expect(JSON.parse(missing.stdout)).toEqual({ error: `Task not found: ${MISSING_TASK_ID}` });

    const listed = await runCli(["--json", "list", "--limit", "10"], root, requestLog);
    expect(listed).toMatchObject({ exitCode: 0, stderr: "" });
    const tasks = JSON.parse(listed.stdout) as Array<{ id: string; short_id: string | null }>;
    expect(tasks).toHaveLength(1);
    expect(tasks.filter((task) => task.short_id === CREATE_SHORT_ID)).toEqual([
      expect.objectContaining({ id: CANONICAL_CREATE_ID }),
    ]);

    const requests = readFileSync(requestLog, "utf8").trim().split("\n").filter(Boolean);
    expect(requests.filter((request) => request === "POST /v1/tasks")).toHaveLength(1);
  }, 30_000);
});
