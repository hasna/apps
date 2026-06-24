import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { closeDb, createSession, logAction } from "../db/index.js";
import type { Session } from "../types/index.js";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../..");
let tempDir: string | null = null;
const savedEnv = new Map<string, string | undefined>();

function useTempDb(): Record<string, string> {
  closeDb();
  savedEnv.clear();
  for (const key of ["COMPUTER_DB_PATH", "COMPUTER_DATA_DIR"] as const) {
    savedEnv.set(key, process.env[key]);
  }
  tempDir = mkdtempSync(join(tmpdir(), "computer-replay-cli-"));
  process.env.COMPUTER_DATA_DIR = tempDir;
  process.env.COMPUTER_DB_PATH = join(tempDir, "computer.db");
  return {
    COMPUTER_DATA_DIR: tempDir,
    COMPUTER_DB_PATH: join(tempDir, "computer.db"),
  };
}

afterEach(() => {
  closeDb();
  for (const [key, value] of savedEnv) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  savedEnv.clear();
  if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  tempDir = null;
});

function runCli(args: string[], env: Record<string, string>) {
  return spawnSync("bun", ["src/cli/index.ts", ...args], {
    cwd: repoRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      ...env,
    },
  });
}

describe("computer replay CLI", () => {
  test("defaults to a capped text replay with pagination hint", async () => {
    const env = useTempDb();
    const session: Session = {
      id: "replay-session-compact-001",
      task: "Replay a long session without dumping every action by default.",
      provider: "anthropic",
      model: "claude-sonnet-4-5",
      status: "completed",
      steps: 12,
      total_tokens_in: 1200,
      total_tokens_out: 300,
      total_duration_ms: 1200,
      created_at: "2026-06-24T06:00:00.000Z",
      completed_at: "2026-06-24T06:01:00.000Z",
    };
    await createSession(session);
    for (let step = 0; step < 12; step++) {
      await logAction({
        session_id: session.id,
        step,
        action: { type: "type", text: "hello world" },
        reasoning: "Long replay reasoning ".repeat(20),
        success: true,
        duration_ms: 0,
      });
    }

    const result = runCli(["replay", "replay-session", "--speed", "100"], env);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("[ 10]");
    expect(result.stdout).not.toContain("[ 11]");
    expect(result.stdout).toContain("More steps available: use --cursor 10");
  });
});
