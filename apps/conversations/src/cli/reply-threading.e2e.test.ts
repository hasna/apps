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

/** Seed a channel with one root message and return both public identities. */
function seedRootMessage(channel: string): { id: number; uuid: string } {
  const create = runCli(["channel", "create", channel, "--from", "alice"], "alice");
  expect(create.exitCode).toBe(0);
  const join_ = runCli(["channel", "join", channel, "--from", "bob"], "bob");
  expect(join_.exitCode).toBe(0);
  const root = runCli(["channel", "send", channel, "incident opened", "--from", "alice", "--json"], "alice");
  expect(root.exitCode).toBe(0);
  const parsed = JSON.parse(root.stdout) as { id: number; uuid: string };
  expect(parsed.id).toBeGreaterThan(0);
  expect(parsed.uuid).toBeTruthy();
  return parsed;
}

function seedRoot(channel: string): number {
  return seedRootMessage(channel).id;
}

describe("reply threading persistence (e2e)", () => {
  afterAll(() => {
    for (const suffix of ["", "-wal", "-shm"]) {
      try { unlinkSync(`${TEST_DB}${suffix}`); } catch {}
    }
  });

  test("reply --to persists reply_to, and `show` reads the parent link back", () => {
    const rootId = seedRoot("thread-persist");

    const reply = runCli([
      "reply", "--to", String(rootId), "--channel", "thread-persist",
      "on it", "--from", "bob", "--json",
    ], "bob");
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

  test("plain `send --channel` output exposes the immutable UUID, not only the numeric id", () => {
    const sent = runCli([
      "send", "plain output reference", "--channel", "send-output-uuid", "--from", "alice",
    ], "alice");
    expect(sent.exitCode, sent.stderr).toBe(0);
    const match = sent.stdout.match(/uuid:\s*([0-9a-f-]{32,36})/i);
    expect(match?.[1]).toBeTruthy();

    const shown = runCli(["show", match![1], "--json"], "alice");
    expect(shown.exitCode, shown.stderr).toBe(0);
    expect(JSON.parse(shown.stdout).content).toBe("plain output reference");
  });

  test("immutable UUID is accepted by show and reply, while reply_to persists the exact numeric parent", () => {
    const root = seedRootMessage("thread-uuid");

    const shown = runCli(["show", root.uuid, "--json"], "bob");
    expect(shown.exitCode, shown.stderr).toBe(0);
    expect(JSON.parse(shown.stdout)).toMatchObject({ id: root.id, uuid: root.uuid });

    const reply = runCli(["reply", "--to", root.uuid, "uuid-bound reply", "--from", "bob", "--json"], "bob");
    expect(reply.exitCode, reply.stderr).toBe(0);
    const stored = JSON.parse(reply.stdout) as { reply_to: number | null };
    expect(stored.reply_to).toBe(root.id);
  });

  test("bare numeric reply target is rejected before writing because it has no independent scope", () => {
    const root = seedRootMessage("thread-numeric-ambiguous");

    const reply = runCli(["reply", "--to", String(root.id), "must not misroute", "--from", "bob", "--json"], "bob");
    expect(reply.exitCode).toBe(1);
    expect(`${reply.stdout}${reply.stderr}`).toContain("Numeric message IDs require");

    const all = runCli(["channel", "read", "thread-numeric-ambiguous", "--from", "bob", "--json"], "bob");
    expect(all.exitCode).toBe(0);
    expect(all.stdout).not.toContain("must not misroute");
  });

  test("numeric reply target succeeds only when an independently supplied channel matches", () => {
    const root = seedRootMessage("thread-numeric-scoped");

    const reply = runCli([
      "reply", "--to", String(root.id), "--channel", "thread-numeric-scoped",
      "scoped numeric reply", "--from", "bob", "--json",
    ], "bob");
    expect(reply.exitCode, reply.stderr).toBe(0);
    expect((JSON.parse(reply.stdout) as { reply_to: number | null }).reply_to).toBe(root.id);

    const mismatch = runCli([
      "reply", "--to", String(root.id), "--channel", "wrong-channel",
      "must not cross channel", "--from", "bob", "--json",
    ], "bob");
    expect(mismatch.exitCode).toBe(1);
    expect(`${mismatch.stdout}${mismatch.stderr}`).toContain("does not match");

    const all = runCli(["channel", "read", "thread-numeric-scoped", "--from", "bob", "--json"], "bob");
    expect(all.stdout).not.toContain("must not cross channel");
  });

  test("a consumer that groups by reply_to counts the replies (summary reply_count)", () => {
    const rootId = seedRoot("thread-group");

    const first = runCli([
      "reply", "--to", String(rootId), "--channel", "thread-group",
      "first response", "--from", "bob", "--json",
    ], "bob");
    expect(first.exitCode).toBe(0);
    const second = runCli([
      "reply", "--to", String(rootId), "--channel", "thread-group",
      "second response", "--from", "alice", "--json",
    ], "alice");
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

    const reply = runCli([
      "reply", "--to", String(rootId), "--channel", "thread-negative",
      "a real reply", "--from", "bob", "--json",
    ], "bob");
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
    const reply = runCli([
      "reply", "--to", "999999", "--channel", "thread-missing",
      "into the void", "--from", "bob", "--json",
    ], "bob");
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
