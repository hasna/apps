import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createChannel } from "../lib/channels.js";
import { subscribeToChannelNotifications } from "../lib/channel-notifications.js";
import { closeDb } from "../lib/db.js";
import { sendMessage } from "../lib/messages.js";
import {
  isolatedStoreChildEnv,
  pinStoreToDb,
  restoreStoreEnv,
} from "../lib/store/isolated-test-env.js";

const TEST_DB = join(
  tmpdir(),
  `conversations-watch-baseline-${Date.now()}-${process.pid}.db`,
);
const CLI = ["bun", "run", "./src/cli/index.tsx"];
const WATCHER = "watch-baseline-agent";
const CHANNEL = "watch-baseline-channel";
const PREARM_DM = "PREARMDMTOKEN";
const PREARM_CHANNEL = "PREARMCHANNELTOKEN";
const LIVE_DM = "LIVEDMTOKEN";
const LIVE_CHANNEL = "LIVECHANNELTOKEN";

beforeEach(() => {
  pinStoreToDb(TEST_DB);
  closeDb();
});

afterEach(() => {
  closeDb();
  try {
    unlinkSync(TEST_DB);
  } catch {}
  try {
    unlinkSync(`${TEST_DB}-wal`);
  } catch {}
  try {
    unlinkSync(`${TEST_DB}-shm`);
  } catch {}
  restoreStoreEnv();
});

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
    createChannel(CHANNEL, "fixture");
    subscribeToChannelNotifications(CHANNEL, WATCHER);
    sendMessage({ from: "alice", to: WATCHER, content: PREARM_DM });
    sendMessage({
      from: "bob",
      to: CHANNEL,
      channel: CHANNEL,
      session_id: `channel:${CHANNEL}`,
      content: PREARM_CHANNEL,
    });
    closeDb();

    const proc = Bun.spawn({
      cmd: [...CLI, "watch", "--all", "--from", WATCHER, "--interval", "20"],
      cwd: process.cwd(),
      env: isolatedStoreChildEnv(TEST_DB, {
        FORCE_COLOR: "0",
        NO_COLOR: "1",
      }),
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

      sendMessage({ from: "carol", to: WATCHER, content: LIVE_DM });
      sendMessage({
        from: "dave",
        to: CHANNEL,
        channel: CHANNEL,
        session_id: `channel:${CHANNEL}`,
        content: LIVE_CHANNEL,
      });
      closeDb();

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
