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
});
