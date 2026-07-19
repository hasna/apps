import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { sendMessage } from "../lib/messages";
import { closeDb } from "../lib/db";
import { execSync } from "child_process";
import { createDisposableStore, enterHermeticTestEnv, hermeticSpawnEnv } from "../test/hermetic";

describe("blocker-hook", () => {
  let testStore: ReturnType<typeof createDisposableStore>;
  let restoreEnv: () => void;

  beforeEach(() => {
    testStore = createDisposableStore("blocker-hook");
    restoreEnv = enterHermeticTestEnv({
      HASNA_CONVERSATIONS_STORAGE_MODE: "local",
      CONVERSATIONS_DB_PATH: testStore.dbPath,
    });
    closeDb();
  });

  afterEach(() => {
    closeDb();
    restoreEnv();
    testStore.cleanup();
  });

  function spawnEnv(): Record<string, string> {
    const agent = process.env.CONVERSATIONS_AGENT_ID;
    return hermeticSpawnEnv({
      HASNA_CONVERSATIONS_STORAGE_MODE: "local",
      CONVERSATIONS_DB_PATH: testStore.dbPath,
      ...(agent ? { CONVERSATIONS_AGENT_ID: agent } : {}),
    });
  }

  test("exits 0 with no blockers", () => {
    process.env.CONVERSATIONS_AGENT_ID = "hook-test-no-blockers";
    const output = execSync(`bun run src/hooks/blocker-hook.ts`, {
      env: spawnEnv(),
      encoding: "utf-8",
    });
    expect(output).toBe("");
  });

  test("outputs blocking messages when they exist", () => {
    process.env.CONVERSATIONS_AGENT_ID = "hook-test-blockers";
    // Send a blocking message to our agent
    sendMessage({
      from: "hook-test-sender",
      to: "hook-test-blockers",
      content: "Fix this urgently!",
      blocking: true,
    });

    const output = execSync(`bun run src/hooks/blocker-hook.ts`, {
      env: spawnEnv(),
      encoding: "utf-8",
    });
    expect(output).toContain("BLOCKING MESSAGES");
    expect(output).toContain("Fix this urgently!");
    expect(output).toContain("hook-test-sender");
  });

  test("exits 0 even when blockers found (non-blocking exit)", () => {
    process.env.CONVERSATIONS_AGENT_ID = "hook-test-exit-zero";
    sendMessage({
      from: "hook-sender-2",
      to: "hook-test-exit-zero",
      content: "Block me",
      blocking: true,
    });

    // Should exit 0, not 2
    try {
      execSync(`bun run src/hooks/blocker-hook.ts`, {
        env: spawnEnv(),
        encoding: "utf-8",
      });
      // exit 0 is expected
    } catch (e: any) {
      // If it throws, it should not be exit code 2
      expect(e.status).not.toBe(2);
    }
  });

  test("skips messages already read", async () => {
    process.env.CONVERSATIONS_AGENT_ID = "hook-test-read";
    const msg = sendMessage({
      from: "hook-reader",
      to: "hook-test-read",
      content: "Already read blocker",
      blocking: true,
    });

    // Mark the message as read
    const { markRead } = await import("../lib/messages");
    markRead([msg.id], "hook-test-read");

    const output = execSync(`bun run src/hooks/blocker-hook.ts`, {
      env: spawnEnv(),
      encoding: "utf-8",
    });
    expect(output).toBe("");
  });

  test("shows --help output", () => {
    const output = execSync(`bun run src/hooks/blocker-hook.ts --help`, {
      env: spawnEnv(),
      encoding: "utf-8",
    });
    expect(output).toContain("PreToolUse hook");
    expect(output).toContain("CONVERSATIONS_AGENT_ID");
  });
});
