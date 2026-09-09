import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { getStore } from "../lib/store/index.js";
import { startLoopbackApiFixture } from "../lib/store/test-support/loopback-api-fixture.js";
import { activateClientEnvironment } from "../lib/store/test-support/client-environment.js";
import { closeDb } from "../lib/db";
import { unlinkSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { execFileSync } from "child_process";

const TEST_DB = join(tmpdir(), `conversations-test-blocker-hook-${Date.now()}.db`);

describe("blocker-hook", () => {
  let fixture: Awaited<ReturnType<typeof startLoopbackApiFixture>>;
  let restore: () => void;
  beforeEach(async () => { fixture=await startLoopbackApiFixture(); restore=activateClientEnvironment(fixture.env); });
  afterEach(async () => { try { await fixture.stop(); } finally { restore(); } });

  test("exits 0 with no blockers", async () => {
    process.env.CONVERSATIONS_AGENT_ID = "hook-test-no-blockers";
    const output = execFileSync(process.execPath, ["--no-env-file", "run", "src/hooks/blocker-hook.ts"], {
      env: { ...process.env },
      encoding: "utf-8",
    });
    expect(output).toBe("");
  });

  test("outputs blocking messages when they exist", async () => {
    process.env.CONVERSATIONS_AGENT_ID = "hook-test-blockers";
    // Send a blocking message to our agent
    await getStore().sendMessage({
      from: "hook-test-sender",
      to: "hook-test-blockers",
      content: "Fix this urgently!",
      blocking: true,
    });

    const output = execFileSync(process.execPath, ["--no-env-file", "run", "src/hooks/blocker-hook.ts"], {
      env: { ...process.env },
      encoding: "utf-8",
    });
    expect(output).toContain("BLOCKING MESSAGES");
    expect(output).toContain("Fix this urgently!");
    expect(output).toContain("hook-test-sender");
  });

  test("exits 0 even when blockers found (non-blocking exit)", async () => {
    process.env.CONVERSATIONS_AGENT_ID = "hook-test-exit-zero";
    await getStore().sendMessage({
      from: "hook-sender-2",
      to: "hook-test-exit-zero",
      content: "Block me",
      blocking: true,
    });

    // Should exit 0, not 2
    try {
      execFileSync(process.execPath, ["--no-env-file", "run", "src/hooks/blocker-hook.ts"], {
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
    const msg = await getStore().sendMessage({
      from: "hook-reader",
      to: "hook-test-read",
      content: "Already read blocker",
      blocking: true,
    });

    // Mark the message as read
    await getStore().markRead([msg.id], "hook-test-read");

    const output = execFileSync(process.execPath, ["--no-env-file", "run", "src/hooks/blocker-hook.ts"], {
      env: { ...process.env },
      encoding: "utf-8",
    });
    expect(output).toBe("");
  });

  test("shows --help output", () => {
    const output = execFileSync(process.execPath, ["--no-env-file", "run", "src/hooks/blocker-hook.ts", "--help"], {
      env: { ...process.env },
      encoding: "utf-8",
    });
    expect(output).toContain("PreToolUse hook");
    expect(output).toContain("CONVERSATIONS_AGENT_ID");
  });
});
