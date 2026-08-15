import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { unlinkSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { closeDb, getDb } from "../lib/db.js";
import { backfilledChannelIdForName } from "../lib/channel-id.js";

const TEST_DB = join(tmpdir(), `conversations-search-compact-${Date.now()}.db`);
const CLI = ["bun", "run", "./src/cli/index.tsx"];
const CHANNEL = "policy-search-compact";
const CUTOFF = "2026-08-02T12:00:00.000Z";

function runCli(args: string[]) {
  const result = Bun.spawnSync({
    cmd: [...CLI, ...args],
    cwd: process.cwd(),
    env: {
      ...process.env,
      CONVERSATIONS_DB_PATH: TEST_DB,
      CONVERSATIONS_AGENT_ID: "search-compact-test",
      FORCE_COLOR: "0",
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  return {
    exitCode: result.exitCode,
    stdout: new TextDecoder().decode(result.stdout),
    stderr: new TextDecoder().decode(result.stderr),
  };
}

describe("search --json compact policy-awareness envelope", () => {
  beforeAll(() => {
    process.env.CONVERSATIONS_DB_PATH = TEST_DB;
    closeDb();
    const db = getDb();
    db.prepare(`INSERT INTO channels (id, name, created_by) VALUES (?, ?, ?)`).run(backfilledChannelIdForName(CHANNEL), CHANNEL, "alice");
    const insert = db.prepare(
      `INSERT INTO messages
       (session_id, from_agent, to_agent, channel, content, metadata, attachments, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const body = (label: string) => `[POLICY] ${label} ${"bounded-preview ".repeat(400)}`;
    insert.run("policy-session", "alice", CHANNEL, CHANNEL, body("before"), '{"raw":"must-not-leak"}', '[{"name":"private.txt"}]', "2026-08-02T11:59:59.999Z");
    insert.run("policy-session", "alice", CHANNEL, CHANNEL, body("at-cutoff"), '{"raw":"must-not-leak"}', '[{"name":"private.txt"}]', CUTOFF);
    insert.run("policy-session", "alice", CHANNEL, CHANNEL, body("after"), '{"raw":"must-not-leak"}', '[{"name":"private.txt"}]', "2026-08-02T12:00:00.001Z");
    closeDb();
  });

  afterAll(() => {
    closeDb();
    for (const suffix of ["", "-wal", "-shm"]) {
      try { unlinkSync(`${TEST_DB}${suffix}`); } catch {}
    }
  });

  test("returns an inclusive, complete, preview-only page with in-band byte metadata", () => {
    const res = runCli([
      "search", "POLICY", "--channel", CHANNEL,
      "--since", CUTOFF, "--limit", "500", "--json",
    ]);

    expect(res.exitCode).toBe(0);
    const payload = JSON.parse(res.stdout) as {
      messages: Array<Record<string, unknown>>;
      count: number;
      has_more: boolean;
      next_cursor: number | null;
      max_bytes: number;
      byte_length: number;
      since: string;
      compact: boolean;
    };
    expect(payload.messages).toHaveLength(2);
    expect(payload.count).toBe(2);
    expect(payload.has_more).toBe(false);
    expect(payload.next_cursor).toBeNull();
    expect(payload.since).toBe(CUTOFF);
    expect(payload.compact).toBe(true);
    expect(payload.max_bytes).toBeGreaterThan(payload.byte_length);
    expect(payload.byte_length).toBe(Buffer.byteLength(JSON.stringify(payload), "utf8"));

    for (const message of payload.messages) {
      expect(message.content).toBeUndefined();
      expect(message.metadata).toBeUndefined();
      expect(message.attachments).toBeUndefined();
      expect(typeof message.preview).toBe("string");
      expect((message.preview as string).length).toBeGreaterThan(0);
      expect((message.preview as string).length).toBeLessThanOrEqual(160);
    }
    expect(payload.messages.some((message) => String(message.preview).includes("before"))).toBe(false);
  });

  test("rejects an invalid --since timestamp instead of silently comparing it", () => {
    const res = runCli(["search", "POLICY", "--channel", CHANNEL, "--since", "not-a-timestamp", "--json"]);
    expect(res.exitCode).not.toBe(0);
    expect(JSON.parse(res.stdout).error).toContain("Invalid --since timestamp");
    expect(res.stderr).toBe("");
  });
});
