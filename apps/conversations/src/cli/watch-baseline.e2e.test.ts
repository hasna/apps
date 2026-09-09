import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getStore } from "../lib/store/index.js";
import { startLoopbackApiFixture } from "../lib/store/test-support/loopback-api-fixture.js";
import { activateClientEnvironment } from "../lib/store/test-support/client-environment.js";
let fixture: Awaited<ReturnType<typeof startLoopbackApiFixture>>;
let restore:()=>void;
const CLI = [process.execPath, "--no-env-file", "run", "./src/cli/index.tsx"];
const WATCHER = "watch-baseline-agent";
const CHANNEL = "watch-baseline-channel";
const PREARM_DM = "PREARMDMTOKEN";
const PREARM_CHANNEL = "PREARMCHANNELTOKEN";
const LIVE_DM = "LIVEDMTOKEN";
const LIVE_CHANNEL = "LIVECHANNELTOKEN";

beforeEach(async () => { fixture=await startLoopbackApiFixture(); restore=activateClientEnvironment(fixture.env); });
afterEach(async () => { try { await fixture.stop(); } finally { restore(); } });

function countOccurrences(text: string, needle: string): number {
  return text.split(needle).length - 1;
}

async function waitForOutput(
  readOutput: () => string,
  needle: string,
  readStderr: () => string,
  timeoutMs = 5_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (readOutput().includes(needle)) return;
    await Bun.sleep(10);
  }

  throw new Error(
    `Timed out waiting for ${JSON.stringify(needle)}.\n` +
      `stdout:\n${readOutput()}\n` +
      `stderr:\n${readStderr()}`,
  );
}

function capture(
  stream: ReadableStream<Uint8Array>,
  append: (text: string) => void,
): Promise<void> {
  return (async () => {
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      append(decoder.decode(value, { stream: true }));
    }
    append(decoder.decode());
  })();
}

describe("conversations watch arm-time baseline", () => {
  test("emits readiness without replaying pre-arm traffic, then emits post-arm traffic once", async () => {
    await getStore().createChannel(CHANNEL, "fixture");
    await getStore().subscribeToChannelNotifications(CHANNEL, WATCHER);
    await getStore().sendMessage({ from: "alice", to: WATCHER, content: PREARM_DM });
    await getStore().sendMessage({
      from: "bob",
      to: CHANNEL,
      channel: CHANNEL,
      session_id: `channel:${CHANNEL}`,
      content: PREARM_CHANNEL,
    });

    const proc = Bun.spawn({
      cmd: [...CLI, "watch", "--all", "--from", WATCHER, "--interval", "20"],
      cwd: process.cwd(),
      env: { ...fixture.env,
        FORCE_COLOR: "0",
        NO_COLOR: "1",
      },
      stdout: "pipe",
      stderr: "pipe",
    });

    let stdout = "";
    let stderr = "";
    const stdoutDone = capture(proc.stdout, (text) => {
      stdout += text;
    });
    const stderrDone = capture(proc.stderr, (text) => {
      stderr += text;
    });

    try {
      await waitForOutput(
        () => stdout,
        "Ctrl+C to stop",
        () => stderr,
      );

      await getStore().sendMessage({ from: "carol", to: WATCHER, content: LIVE_DM });
      await getStore().sendMessage({
        from: "dave",
        to: CHANNEL,
        channel: CHANNEL,
        session_id: `channel:${CHANNEL}`,
        content: LIVE_CHANNEL,
      });

      await waitForOutput(() => stdout, LIVE_DM, () => stderr);
      await waitForOutput(() => stdout, LIVE_CHANNEL, () => stderr);
      await Bun.sleep(120);

      expect(stdout).not.toContain(PREARM_DM);
      expect(stdout).not.toContain(PREARM_CHANNEL);
      expect(countOccurrences(stdout, LIVE_DM)).toBe(1);
      expect(countOccurrences(stdout, LIVE_CHANNEL)).toBe(1);
    } finally {
      proc.kill("SIGINT");
      await proc.exited;
      await Promise.all([stdoutDone, stderrDone]);
    }
  }, 10_000);
});
