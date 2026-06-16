import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let tempDir = "";

async function runTodos(args: string[]) {
  const child = Bun.spawn({
    cmd: ["bun", "run", "src/cli/index.tsx", ...args],
    cwd: process.cwd(),
    env: {
      ...process.env,
      HOME: join(tempDir, "home"),
      HASNA_EVENTS_DIR: join(tempDir, "events"),
      TODOS_DB_PATH: join(tempDir, "todos.db"),
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  return { stdout, stderr, exitCode };
}

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "todos-events-cli-"));
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

describe("shared events CLI integration", () => {
  test("prints JSON for event and webhook list commands", async () => {
    const events = await runTodos(["events", "list", "--json"]);
    expect(events.exitCode).toBe(0);
    expect(events.stderr).toBe("");
    expect(JSON.parse(events.stdout)).toEqual([]);

    const webhooks = await runTodos(["webhooks", "list", "--json"]);
    expect(webhooks.exitCode).toBe(0);
    expect(webhooks.stderr).toBe("");
    expect(JSON.parse(webhooks.stdout)).toEqual([]);
  });
});
