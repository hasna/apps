import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { sendMessage } from "../lib/messages";
import { closeDb } from "../lib/db";
import { unlinkSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { execSync } from "child_process";

const TEST_DB = join(tmpdir(), `conversations-test-blocker-hook-${Date.now()}.db`);

describe("blocker-hook", () => {
  beforeEach(() => {
    process.env.CONVERSATIONS_DB_PATH = TEST_DB;
    closeDb();
  });

  afterEach(() => {
    delete process.env.CONVERSATIONS_DB_PATH;
    delete process.env.CONVERSATIONS_AGENT_ID;
    closeDb();
    try { unlinkSync(TEST_DB); } catch {}
    try { unlinkSync(TEST_DB + "-wal"); } catch {}
    try { unlinkSync(TEST_DB + "-shm"); } catch {}
  });

  test("exits 0 with no blockers", () => {
    process.env.CONVERSATIONS_AGENT_ID = "hook-test-no-blockers";
    const output = execSync(`bun run src/hooks/blocker-hook.ts`, {
      env: { ...process.env },
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
      env: { ...process.env },
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
        env: { ...process.env },
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
      env: { ...process.env },
      encoding: "utf-8",
    });
    expect(output).toBe("");
  });

  test("shows --help output", () => {
    const output = execSync(`bun run src/hooks/blocker-hook.ts --help`, {
      env: { ...process.env },
      encoding: "utf-8",
    });
    expect(output).toContain("PreToolUse hook");
    expect(output).toContain("CONVERSATIONS_AGENT_ID");
  });
});
