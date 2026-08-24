import { afterEach, beforeEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { unlinkSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { isolatedStoreChildEnv } from "../lib/store/isolated-test-env.js";

// Regression cover for HC-00148: `conversations reply --to <id>` accepted the
// flag, printed "Reply sent", exited 0 — and stored the row with reply_to NULL,
// so every reply was structurally unthreaded. The success line was what
// concealed it, so every assertion here is a READ-BACK of the stored row
// through a different command than the one that wrote it, never the exit code
// or the success message alone.
let testDbCounter = 0;
let testDb = "";
const CLI = ["bun", "run", "./src/cli/index.tsx"];

setDefaultTimeout(15_000);

function runCli(args: string[], agent: string) {
  const result = Bun.spawnSync({
    cmd: [...CLI, ...args],
    cwd: process.cwd(),
    env: isolatedStoreChildEnv(testDb, {
      CONVERSATIONS_AGENT_ID: agent,
      FORCE_COLOR: "0",
    }),
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
  beforeEach(() => {
    testDb = join(tmpdir(), `conversations-cli-reply-threading-${Date.now()}-${process.pid}-${++testDbCounter}.db`);
  });

  afterEach(() => {
    for (const suffix of ["", "-wal", "-shm"]) {
      try { unlinkSync(`${testDb}${suffix}`); } catch {}
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
    // `send` refuses a channel with no row rather than writing an orphan that
    // `channel list` cannot see and `channel archive` cannot remove (todos
    // 4cc80a4d). The sibling tests get this via seedRootMessage; this one sends
    // directly, so it creates the channel itself.
    const created = runCli(["channel", "create", "send-output-uuid", "--from", "alice"], "alice");
    expect(created.exitCode, created.stderr).toBe(0);

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
  }, 15_000);

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
  }, 15_000);

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

// ── Thread collection (task bf381fad / Fable verdict 2026-08-24) ─────────────
// Threads are the ROOT + every descendant reply (reply_to chains may nest). A
// root becomes a thread the moment it receives a reply; a plain top-level send
// with zero replies is a message, not a thread. All assertions read the
// COLLECTION back through the `threads` verb, never the write path that seeded
// it, so a "groups everything" or "groups nothing" regression surfaces here.
function seedThreadedChannel(channel: string): { root: number; uuid: string; reply1: number; reply2: number; nested: number } {
  const root = seedRootMessage(channel);
  const r1 = runCli(["reply", "--to", root.uuid, "first response", "--from", "bob", "--json"], "bob");
  expect(r1.exitCode, r1.stderr).toBe(0);
  const reply1 = JSON.parse(r1.stdout).id as number;
  const r2 = runCli(["reply", "--to", root.uuid, "second response", "--from", "alice", "--json"], "alice");
  expect(r2.exitCode, r2.stderr).toBe(0);
  const reply2 = JSON.parse(r2.stdout).id as number;
  const r3 = runCli(["reply", "--to", String(reply2), "--channel", channel, "nested under alice", "--from", "bob", "--json"], "bob");
  expect(r3.exitCode, r3.stderr).toBe(0);
  const nested = JSON.parse(r3.stdout).id as number;
  return { root: root.id, uuid: root.uuid, reply1, reply2, nested };
}

interface ThreadListEntry {
  root: { id: number; uuid: string; from_agent: string };
  reply_count: number;
  last_activity_at: string;
  thread_status: string;
  unread_count?: number;
}

describe("thread collection (e2e)", () => {
  beforeEach(() => {
    testDb = join(tmpdir(), `conversations-cli-thread-collection-${Date.now()}-${process.pid}-${++testDbCounter}.db`);
  });

  afterEach(() => {
    for (const suffix of ["", "-wal", "-shm"]) {
      try { unlinkSync(`${testDb}${suffix}`); } catch {}
    }
  });

  test("threads list groups a reply chain under its root with reply_count, last activity and thread_status", () => {
    const seeded = seedThreadedChannel("thread-list");

    // The regression: before thread collection landed, there was no verb that
    // grouped a reply chain back to its root — `threads list` did not exist.
    const listed = runCli(["threads", "list", "--channel", "thread-list", "--from", "bob", "--json"], "bob");
    expect(listed.exitCode, `${listed.stdout}\n${listed.stderr}`).toBe(0);
    const parsed = JSON.parse(listed.stdout) as { channel: string; count: number; threads: ThreadListEntry[] };
    expect(parsed.channel).toBe("thread-list");
    expect(parsed.count).toBe(1);

    const thread = parsed.threads[0];
    expect(thread.root.id).toBe(seeded.root);
    expect(thread.root.uuid).toBe(seeded.uuid);
    // root + reply1 + reply2 + nested — the full descendant chain, not just
    // direct children. With only reply_to this is what "grouping" must prove.
    expect(thread.reply_count).toBe(3);
    expect(thread.thread_status).toBe("open");
    expect(thread.last_activity_at.length).toBeGreaterThan(0);
  });

  test("threads list reports per-agent unread from the reader's read cursor", () => {
    const seeded = seedThreadedChannel("thread-unread");

    const before = runCli(["threads", "list", "--channel", "thread-unread", "--from", "bob", "--json"], "bob");
    expect(before.exitCode, before.stderr).toBe(0);
    const beforeParsed = JSON.parse(before.stdout) as { threads: ThreadListEntry[] };
    // Unread for bob = replies from OTHERS with no bob read cursor. Alice's
    // reply2 is the only foreign reply; bob's own two replies never count.
    expect(beforeParsed.threads[0].unread_count).toBe(1);

    // bob reads the channel → a per-message read cursor is recorded for bob.
    const read = runCli(["channel", "read", "thread-unread", "--from", "bob", "--json"], "bob");
    expect(read.exitCode, read.stderr).toBe(0);

    const after = runCli(["threads", "list", "--channel", "thread-unread", "--from", "bob", "--json"], "bob");
    expect(after.exitCode, after.stderr).toBe(0);
    const afterParsed = JSON.parse(after.stdout) as { threads: ThreadListEntry[] };
    expect(afterParsed.threads[0].unread_count).toBe(0);
  });

  test("threads expand returns the full nested reply tree", () => {
    const seeded = seedThreadedChannel("thread-expand");

    const expanded = runCli(["threads", "expand", String(seeded.root), "--from", "bob", "--json"], "bob");
    expect(expanded.exitCode, `${expanded.stdout}\n${expanded.stderr}`).toBe(0);
    const parsed = JSON.parse(expanded.stdout) as {
      root: { id: number; from_agent: string };
      thread_status: string;
      reply_count: number;
      replies: Array<{ message: { id: number; from_agent: string; reply_to: number | null }; depth: number }>;
    };
    expect(parsed.root.id).toBe(seeded.root);
    expect(parsed.thread_status).toBe("open");
    expect(parsed.reply_count).toBe(3);
    expect(parsed.replies.length).toBe(3);

    const byId = new Map(parsed.replies.map((r) => [r.message.id, r]));
    // Direct replies sit at depth 0 under the root...
    expect(byId.get(seeded.reply1)?.depth).toBe(0);
    expect(byId.get(seeded.reply1)?.message.reply_to).toBe(seeded.root);
    expect(byId.get(seeded.reply2)?.depth).toBe(0);
    // ...and the reply-to-a-reply nests one level deeper, keyed by its real parent.
    expect(byId.get(seeded.nested)?.depth).toBe(1);
    expect(byId.get(seeded.nested)?.message.reply_to).toBe(seeded.reply2);
  });

  test("threads close and reopen toggle thread_status on the root", () => {
    const seeded = seedThreadedChannel("thread-close");

    const closed = runCli(["threads", "close", seeded.uuid], "bob");
    expect(closed.exitCode, closed.stderr).toBe(0);

    const afterClose = runCli(["threads", "list", "--channel", "thread-close", "--from", "bob", "--json"], "bob");
    expect(afterClose.exitCode, afterClose.stderr).toBe(0);
    expect((JSON.parse(afterClose.stdout) as { threads: ThreadListEntry[] }).threads[0].thread_status).toBe("closed");

    const reopened = runCli(["threads", "reopen", seeded.uuid], "bob");
    expect(reopened.exitCode, reopened.stderr).toBe(0);

    const afterReopen = runCli(["threads", "list", "--channel", "thread-close", "--from", "bob", "--json"], "bob");
    expect(afterReopen.exitCode, afterReopen.stderr).toBe(0);
    expect((JSON.parse(afterReopen.stdout) as { threads: ThreadListEntry[] }).threads[0].thread_status).toBe("open");
  });

  test("a plain top-level send with no replies is not listed as a thread", () => {
    const channel = "thread-plain";
    const create = runCli(["channel", "create", channel, "--from", "alice"], "alice");
    expect(create.exitCode, create.stderr).toBe(0);
    const join_ = runCli(["channel", "join", channel, "--from", "bob"], "bob");
    expect(join_.exitCode, join_.stderr).toBe(0);
    // A plain root with NO replies is a message, not a thread...
    const plain = runCli(["channel", "send", channel, "plain note", "--from", "alice", "--json"], "alice");
    expect(plain.exitCode, plain.stderr).toBe(0);
    // ...while a second root WITH a reply is a thread.
    const rootSend = runCli(["channel", "send", channel, "threaded note", "--from", "alice", "--json"], "alice");
    expect(rootSend.exitCode, rootSend.stderr).toBe(0);
    const rootId = JSON.parse(rootSend.stdout).id as number;
    const reply = runCli(["reply", "--to", String(rootId), "--channel", channel, "only reply", "--from", "bob", "--json"], "bob");
    expect(reply.exitCode, reply.stderr).toBe(0);

    const listed = runCli(["threads", "list", "--channel", channel, "--from", "bob", "--json"], "bob");
    expect(listed.exitCode, listed.stderr).toBe(0);
    const parsed = JSON.parse(listed.stdout) as { count: number; threads: ThreadListEntry[] };
    // Only the root with a reply is a thread; the bare root stays a plain message.
    expect(parsed.count).toBe(1);
    expect(parsed.threads[0].root.id).toBe(rootId);
    expect(parsed.threads[0].reply_count).toBe(1);
  });

  test("threads close/reopen resolve a numeric root only with independent channel scope", () => {
    const seeded = seedThreadedChannel("thread-scoped");

    const bare = runCli(["threads", "close", String(seeded.root)], "bob");
    expect(bare.exitCode).toBe(1);
    expect(`${bare.stdout}${bare.stderr}`).toContain("--channel");

    const scoped = runCli(["threads", "close", String(seeded.root), "--channel", "thread-scoped"], "bob");
    expect(scoped.exitCode, scoped.stderr).toBe(0);
  });
});
