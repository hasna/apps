import { afterAll, describe, expect, test } from "bun:test";
import { unlinkSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

// Regression cover for HC-00148: `conversations reply --to <id>` accepted the
// flag, printed "Reply sent", exited 0 — and stored the row with reply_to NULL,
// so every reply was structurally unthreaded. The success line was what
// concealed it, so every assertion here is a READ-BACK of the stored row
// through a different command than the one that wrote it, never the exit code
// or the success message alone.
const TEST_DB = join(tmpdir(), `conversations-cli-reply-threading-${Date.now()}.db`);
const CLI = ["bun", "run", "./src/cli/index.tsx"];

function runCli(args: string[], agent: string) {
  const result = Bun.spawnSync({
    cmd: [...CLI, ...args],
    cwd: process.cwd(),
    env: {
      ...process.env,
      CONVERSATIONS_DB_PATH: TEST_DB,
      CONVERSATIONS_AGENT_ID: agent,
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

/** Seed a channel with one root message and return its id. */
function seedRoot(channel: string): number {
  const create = runCli(["channel", "create", channel, "--from", "alice"], "alice");
  expect(create.exitCode).toBe(0);
  const join_ = runCli(["channel", "join", channel, "--from", "bob"], "bob");
  expect(join_.exitCode).toBe(0);
  const root = runCli(["channel", "send", channel, "incident opened", "--from", "alice", "--json"], "alice");
  expect(root.exitCode).toBe(0);
  return JSON.parse(root.stdout).id as number;
}

describe("reply threading persistence (e2e)", () => {
  afterAll(() => {
    for (const suffix of ["", "-wal", "-shm"]) {
      try { unlinkSync(`${TEST_DB}${suffix}`); } catch {}
    }
  });

  test("reply --to persists reply_to, and `show` reads the parent link back", () => {
    const rootId = seedRoot("thread-persist");

    const reply = runCli(["reply", "--to", String(rootId), "on it", "--from", "bob", "--json"], "bob");
    expect(reply.exitCode).toBe(0);
    const replyId = JSON.parse(reply.stdout).id as number;

    // READ-BACK through a different command than the one that wrote the row.
    // This is the assertion the original defect would fail: reply_to was NULL.
    const shown = runCli(["show", String(replyId), "--json"], "bob");
    expect(shown.exitCode).toBe(0);
    const stored = JSON.parse(shown.stdout) as { id: number; reply_to: number | null };
    expect(stored.id).toBe(replyId);
    expect(stored.reply_to).toBe(rootId);
  });

  test("a consumer that groups by reply_to counts the replies (summary reply_count)", () => {
    const rootId = seedRoot("thread-group");

    const first = runCli(["reply", "--to", String(rootId), "first response", "--from", "bob", "--json"], "bob");
    expect(first.exitCode).toBe(0);
    const second = runCli(["reply", "--to", String(rootId), "second response", "--from", "alice", "--json"], "alice");
    expect(second.exitCode).toBe(0);

    // `summary` derives reply_count from reply_to (src/lib/summary.ts:139) — a
    // different read path than `show`, and exactly the kind of consumer the
    // defect broke: a digest/dashboard/audit asking "what was the response to
    // this". With reply_to NULL this stayed 0 while both sends reported success.
    const summary = runCli(["summary", "thread-group", "--json"], "bob");
    expect(summary.exitCode).toBe(0);
    const parsed = JSON.parse(summary.stdout) as { activity: { reply_count: number } };
    expect(parsed.activity.reply_count).toBe(2);
  });

  test("a plain channel send stays unthreaded — the fix must not thread everything", () => {
    const rootId = seedRoot("thread-negative");

    const reply = runCli(["reply", "--to", String(rootId), "a real reply", "--from", "bob", "--json"], "bob");
    expect(reply.exitCode).toBe(0);
    const plain = runCli(["channel", "send", "thread-negative", "unrelated post", "--from", "bob", "--json"], "bob");
    expect(plain.exitCode).toBe(0);
    const plainId = JSON.parse(plain.stdout).id as number;

    // The plain send must carry no parent link...
    const shown = runCli(["show", String(plainId), "--json"], "bob");
    expect(shown.exitCode).toBe(0);
    expect((JSON.parse(shown.stdout) as { reply_to: number | null }).reply_to).toBeNull();

    // ...so the grouping consumer counts exactly 1 reply, not 2. This is the
    // guard against "fixed" meaning "reply_to set on everything".
    const summary = runCli(["summary", "thread-negative", "--json"], "bob");
    expect(summary.exitCode).toBe(0);
    expect((JSON.parse(summary.stdout) as { activity: { reply_count: number } }).activity.reply_count).toBe(1);
  });

  test("--to a message id that does not exist fails loudly and writes nothing", () => {
    seedRoot("thread-missing");

    // 999999 is not a live id in this fresh temp DB.
    const reply = runCli(["reply", "--to", "999999", "into the void", "--from", "bob", "--json"], "bob");
    expect(reply.exitCode).toBe(1);
    expect(`${reply.stdout}${reply.stderr}`).toContain("not found");

    // "Reports success" is the defect class — prove no row was created either.
    const all = runCli(["channel", "read", "thread-missing", "--from", "bob", "--json"], "bob");
    expect(all.exitCode).toBe(0);
    expect(all.stdout).not.toContain("into the void");
  });

  test("--to a non-numeric value fails loudly instead of degrading to an unthreaded post", () => {
    seedRoot("thread-nan");

    const reply = runCli(["reply", "--to", "not-a-number", "bad target", "--from", "bob", "--json"], "bob");
    expect(reply.exitCode).toBe(1);

    const all = runCli(["channel", "read", "thread-nan", "--from", "bob", "--json"], "bob");
    expect(all.exitCode).toBe(0);
    expect(all.stdout).not.toContain("bad target");
  });
});
