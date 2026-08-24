/**
 * CLI surface smoke test — the CLI is an interface layer over the domain.
 * Exercises send + threads end-to-end against the local SQLite store via the
 * CLI's own module (HASNA_MESSAGES_SQLITE_PATH pointed at a temp file).
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { spawnSync } from "node:child_process";

let tmpDir: string;
let sqlitePath: string;

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "messages-cli-test-"));
  sqlitePath = path.join(tmpDir, "messages.db");
});

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function runCli(args: string[]): { stdout: string; status: number } {
  const res = spawnSync("bun", ["run", "src/cli/index.ts", ...args], {
    cwd: path.resolve(import.meta.dir, "..", ".."),
    env: { ...process.env, HASNA_MESSAGES_SQLITE_PATH: sqlitePath },
    encoding: "utf8",
  });
  return { stdout: res.stdout, status: res.status ?? -1 };
}

describe("messages CLI", () => {
  test("send writes a message; threads lists it with an unread count", async () => {
    const send = runCli(["send", "--from", "augustus", "--to", "silvanus", "--content", "cli hello"]);
    expect(send.status).toBe(0);
    const sent = JSON.parse(send.stdout) as { message: { id: string; thread_id: string } };
    expect(sent.message.thread_id).toBeTruthy();

    const threads = runCli(["threads", "--agent", "silvanus"]);
    expect(threads.status).toBe(0);
    const listed = JSON.parse(threads.stdout) as Array<{ id: string; unread_count: number; last_message_preview: string | null }>;
    expect(listed).toHaveLength(1);
    expect(listed[0]!.id).toBe(sent.message.thread_id);
    expect(listed[0]!.unread_count).toBe(1);
    expect(listed[0]!.last_message_preview).toBe("cli hello");
  });

  test("send refuses missing required flags", async () => {
    const res = runCli(["send", "--from", "augustus"]);
    expect(res.status).not.toBe(0);
  });

  test("delivery state machine over the CLI: stored -> delivered via receive -> read", async () => {
    // Distinct agents isolate this test from the shared temp DB.
    const sender = "caius";
    const recipient = "titus";
    const send = runCli(["send", "--from", sender, "--to", recipient, "--content", "delivery probe"]);
    expect(send.status).toBe(0);
    const sent = JSON.parse(send.stdout) as { message: { id: string; thread_id: string } };

    // Before receive: per-recipient state 'stored'.
    const before = JSON.parse(runCli(["delivery", "--id", sent.message.thread_id]).stdout) as Array<{ deliveries: Array<{ recipient: string; state: string }> }>;
    expect(before[0]!.deliveries[0]!.state).toBe("stored");

    // Receive drains -> delivered.
    const received = JSON.parse(runCli(["receive", "--agent", recipient]).stdout) as Array<{ delivery: { state: string } }>;
    expect(received).toHaveLength(1);
    expect(received[0]!.delivery.state).toBe("delivered");

    const after = JSON.parse(runCli(["delivery", "--id", sent.message.thread_id]).stdout) as Array<{ deliveries: Array<{ state: string }> }>;
    expect(after[0]!.deliveries[0]!.state).toBe("delivered");

    // Read -> unread clears.
    expect(JSON.parse(runCli(["read", "--id", sent.message.thread_id, "--agent", recipient]).stdout).ok).toBe(true);
    const unread = JSON.parse(runCli(["unread", "--agent", recipient]).stdout) as { total: number };
    expect(unread.total).toBe(0);
  });

  test("thread close/reopen over the CLI", async () => {
    const send = runCli(["send", "--from", "augustus", "--to", "silvanus", "--content", "close me"]);
    const sent = JSON.parse(send.stdout) as { message: { thread_id: string } };
    expect(runCli(["close", "--id", sent.message.thread_id, "--agent", "silvanus"]).status).toBe(0);
    const open = JSON.parse(runCli(["threads", "--agent", "silvanus"]).stdout) as Array<{ id: string }>;
    expect(open.map((t) => t.id)).not.toContain(sent.message.thread_id);
    expect(runCli(["reopen", "--id", sent.message.thread_id, "--agent", "silvanus"]).status).toBe(0);
    const reopened = JSON.parse(runCli(["threads", "--agent", "silvanus"]).stdout) as Array<{ id: string }>;
    expect(reopened.map((t) => t.id)).toContain(sent.message.thread_id);
  });
});
