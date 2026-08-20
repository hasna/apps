import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { unlinkSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { closeDb, getDb } from "./db.js";
import { createProject } from "./projects.js";
import { createChannel, joinChannel } from "./channels.js";
import { sendMessage } from "./messages.js";
import { subscribeToChannelNotifications } from "./channel-notifications.js";
import { acquireLock, checkLock } from "./locks.js";
import { pinStoreToDb, restoreStoreEnv } from "./store/isolated-test-env.js";
import {
  applyChannelMerge,
  planChannelMerge,
  rollbackChannelMerge,
} from "./channel-merge.js";

const TEST_DB = join(tmpdir(), `conversations-channel-merge-${Date.now()}.db`);

beforeEach(() => {
  pinStoreToDb(TEST_DB);
  closeDb();
});

afterEach(() => {
  closeDb();
  for (const suffix of ["", "-wal", "-shm"]) {
    try { unlinkSync(TEST_DB + suffix); } catch {}
  }
  restoreStoreEnv();
});

function seedChannels(opts: { sourceProject?: string; destinationProject?: string } = {}) {
  // The creator auto-joins the channel; distinct creators keep the membership
  // sets disjoint so the overlap refusal only fires when the test seeds it.
  createChannel("src", "alice");
  createChannel("dst", "carol");
  const db = getDb();
  if (opts.sourceProject) {
    db.prepare("UPDATE channels SET project_id = ? WHERE name = 'src'").run(opts.sourceProject);
  }
  if (opts.destinationProject) {
    db.prepare("UPDATE channels SET project_id = ? WHERE name = 'dst'").run(opts.destinationProject);
  }
  return { source: "src", destination: "dst" };
}

function seedSourceMessages(source: string, count: number): Array<{ id: number; uuid: string }> {
  const rows: Array<{ id: number; uuid: string }> = [];
  for (let index = 0; index < count; index++) {
    const message = sendMessage({
      from: "alice",
      to: source,
      channel: source,
      session_id: `channel:${source}`,
      content: `src message ${index}`,
    });
    rows.push({ id: message.id, uuid: message.uuid });
  }
  return rows;
}

function insertCrossChannelReply(thirdChannel: string, parentId: number, parentChannel: string): void {
  // The reply-scope insert trigger forbids this state; create it directly so the
  // merge's defensive refusal has a fixture. The trigger is recreated on the next
  // database open.
  const db = getDb();
  db.exec("DROP TRIGGER IF EXISTS messages_reply_scope_insert");
  db.prepare(`
    INSERT INTO messages (uuid, session_id, from_agent, to_agent, channel, content, priority, reply_to, created_at)
    VALUES (?, ?, ?, ?, ?, ?, 'normal', ?, strftime('%Y-%m-%dT%H:%M:%f', 'now'))
  `).run(
    "legacy-cross-reply",
    `channel:${thirdChannel}`,
    "alice",
    thirdChannel,
    thirdChannel,
    `cross-channel reply to ${parentChannel}:${parentId}`,
    parentId,
  );
}

describe("planChannelMerge", () => {
  test("returns a dry-run plan with a revision and moves nothing", () => {
    const { source, destination } = seedChannels();
    const moved = seedSourceMessages(source, 3);
    joinChannel(source, "alice");
    joinChannel(source, "bob");
    joinChannel(destination, "carol");
    subscribeToChannelNotifications(source, "alice");

    const plan = planChannelMerge({ source_channel: source, destination_channel: destination });

    expect(plan.operation).toBe("merge");
    expect(plan.dry_run).toBe(true);
    expect(plan.source_channel).toBe(source);
    expect(plan.destination_channel).toBe(destination);
    expect(plan.archive_source).toBe(false);
    expect(plan.revision.length).toBe(64);
    expect(plan.source_message_count).toBe(3);
    expect(plan.moved_message_count).toBe(3);
    expect(plan.message_ids).toEqual(moved.map((row) => row.id));
    expect(plan.message_id_min).toBe(Math.min(...moved.map((row) => row.id)));
    expect(plan.message_id_max).toBe(Math.max(...moved.map((row) => row.id)));

    // Dry-run wrote nothing: messages, members, and subscriptions still live in the source.
    const db = getDb();
    expect(db.prepare("SELECT COUNT(*) AS n FROM messages WHERE channel = ?").get(source).n).toBe(3);
    expect(db.prepare("SELECT COUNT(*) AS n FROM messages WHERE channel = ?").get(destination).n).toBe(0);
    expect(db.prepare("SELECT COUNT(*) AS n FROM channel_members WHERE channel = ?").get(source).n).toBe(2);
    expect(db.prepare("SELECT COUNT(*) AS n FROM channel_members WHERE channel = ?").get(destination).n).toBe(1);
    expect(db.prepare("SELECT COUNT(*) AS n FROM channel_subscriptions WHERE channel = ?").get(source).n).toBe(1);
  });

  test("refuses when the source or destination channel is missing", () => {
    createChannel("src", "tester");
    expect(() => planChannelMerge({ source_channel: "missing", destination_channel: "src" }))
      .toThrow("Channel not found: missing");
    expect(() => planChannelMerge({ source_channel: "src", destination_channel: "missing" }))
      .toThrow("Channel not found: missing");
  });

  test("refuses when both names normalize to the same channel", () => {
    seedChannels();
    expect(() => planChannelMerge({ source_channel: "src", destination_channel: "src" }))
      .toThrow(/must differ/);
  });

  test("refuses when the destination is a reserved historical alias of a third channel", () => {
    seedChannels();
    createChannel("third", "tester");
    getDb().prepare(
      "INSERT INTO channel_rename_aliases (old_channel, current_channel) VALUES (?, ?)",
    ).run("dst", "third");
    expect(() => planChannelMerge({ source_channel: "src", destination_channel: "dst" }))
      .toThrow(/reserved historical alias for #third/);
  });

  test("refuses when another agent holds a lock on either channel", () => {
    const { source, destination } = seedChannels();
    const acquired = acquireLock("channel", source, "other-agent", "advisory");
    expect(acquired.acquired).toBe(true);
    expect(() => planChannelMerge({ source_channel: source, destination_channel: destination }))
      .toThrow(/locked by other-agent/);
  });

  test("refuses when both channels belong to different projects", () => {
    const projectA = createProject({ name: "Project A", created_by: "tester" });
    const projectB = createProject({ name: "Project B", created_by: "tester" });
    const { source, destination } = seedChannels({ sourceProject: projectA.id, destinationProject: projectB.id });
    expect(() => planChannelMerge({ source_channel: source, destination_channel: destination }))
      .toThrow(/different projects/);
  });

  test("refuses membership overlap and names the conflicting agents", () => {
    const { source, destination } = seedChannels();
    joinChannel(source, "alice");
    joinChannel(source, "bob");
    joinChannel(destination, "bob");
    joinChannel(destination, "carol");
    expect(() => planChannelMerge({ source_channel: source, destination_channel: destination }))
      .toThrow(/member.*bob/);
  });

  test("refuses subscription overlap and names the conflicting agents", () => {
    const { source, destination } = seedChannels();
    subscribeToChannelNotifications(source, "alice");
    subscribeToChannelNotifications(destination, "alice");
    expect(() => planChannelMerge({ source_channel: source, destination_channel: destination }))
      .toThrow(/subscription.*alice/);
  });

  test("refuses when a third channel contains a reply to a source message", () => {
    const { source, destination } = seedChannels();
    createChannel("third", "tester");
    const [parent] = seedSourceMessages(source, 1);
    insertCrossChannelReply("third", parent.id, source);
    expect(() => planChannelMerge({ source_channel: source, destination_channel: destination }))
      .toThrow(/third channel.*reply/);
  });
});

describe("applyChannelMerge", () => {
  test("moves messages with UNCHANGED ids and uuids inside one atomic transaction", () => {
    const { source, destination } = seedChannels();
    const moved = seedSourceMessages(source, 3);
    joinChannel(source, "alice");
    joinChannel(source, "bob");
    joinChannel(destination, "carol");
    subscribeToChannelNotifications(source, "alice");

    const plan = planChannelMerge({ source_channel: source, destination_channel: destination });
    const receipt = applyChannelMerge({
      source_channel: source,
      destination_channel: destination,
      expected_revision: plan.revision,
      idempotency_key: "apply-one",
    });

    expect(receipt.dry_run).toBe(false);
    expect(receipt.replayed).toBe(false);
    expect(receipt.receipt_id.length).toBeGreaterThan(0);
    expect(receipt.pre_revision).toBe(plan.revision);
    expect(receipt.message_ids).toEqual(moved.map((row) => row.id));
    expect(receipt.message_id_min).toBe(Math.min(...moved.map((row) => row.id)));
    expect(receipt.message_id_max).toBe(Math.max(...moved.map((row) => row.id)));

    const db = getDb();
    const rows = db.prepare(
      "SELECT id, uuid, channel, session_id, to_agent, content FROM messages WHERE channel = ? ORDER BY id",
    ).all(destination) as Array<{ id: number; uuid: string; channel: string; session_id: string; to_agent: string; content: string }>;
    expect(rows.length).toBe(3);
    expect(rows.map((row) => row.id)).toEqual(moved.map((row) => row.id));
    expect(rows.map((row) => row.uuid)).toEqual(moved.map((row) => row.uuid));
    expect(rows.every((row) => row.session_id === `channel:${destination}`)).toBe(true);
    expect(rows.every((row) => row.to_agent === destination)).toBe(true);
    // No message is copied: the source channel is empty afterwards.
    expect(db.prepare("SELECT COUNT(*) AS n FROM messages WHERE channel = ?").get(source).n).toBe(0);

    // Memberships, subscriptions, mentions, and read-state travel with the rows.
    expect(db.prepare("SELECT COUNT(*) AS n FROM channel_members WHERE channel = ?").get(destination).n).toBe(3);
    expect(db.prepare("SELECT COUNT(*) AS n FROM channel_members WHERE channel = ?").get(source).n).toBe(0);
    expect(db.prepare("SELECT COUNT(*) AS n FROM channel_subscriptions WHERE channel = ?").get(destination).n).toBe(1);
    expect(db.prepare("SELECT COUNT(*) AS n FROM channel_subscriptions WHERE channel = ?").get(source).n).toBe(0);
  });

  test("replaying the same idempotency key returns the stored receipt without touching state", () => {
    const { source, destination } = seedChannels();
    seedSourceMessages(source, 2);
    const plan = planChannelMerge({ source_channel: source, destination_channel: destination });
    const first = applyChannelMerge({
      source_channel: source,
      destination_channel: destination,
      expected_revision: plan.revision,
      idempotency_key: "replay-key",
    });
    const second = applyChannelMerge({
      source_channel: source,
      destination_channel: destination,
      expected_revision: plan.revision,
      idempotency_key: "replay-key",
    });
    expect(second.receipt_id).toBe(first.receipt_id);
    expect(second.replayed).toBe(true);

    const db = getDb();
    expect(db.prepare("SELECT COUNT(*) AS n FROM messages WHERE channel = ?").get(destination).n).toBe(2);
    expect(db.prepare("SELECT COUNT(*) AS n FROM messages WHERE channel = ?").get(source).n).toBe(0);
  });

  test("refuses an idempotency key already used with a different request", () => {
    const { source, destination } = seedChannels();
    seedSourceMessages(source, 1);
    const plan = planChannelMerge({ source_channel: source, destination_channel: destination });
    applyChannelMerge({
      source_channel: source,
      destination_channel: destination,
      expected_revision: plan.revision,
      idempotency_key: "shared-key",
    });
    expect(() => applyChannelMerge({
      source_channel: source,
      destination_channel: destination,
      expected_revision: "a-different-revision",
      idempotency_key: "shared-key",
    })).toThrow(/already used with a different request/);
  });

  test("rejects a stale expected revision instead of writing", () => {
    const { source, destination } = seedChannels();
    seedSourceMessages(source, 1);
    const plan = planChannelMerge({ source_channel: source, destination_channel: destination });
    // A message lands in the source after the plan.
    seedSourceMessages(source, 1);
    expect(() => applyChannelMerge({
      source_channel: source,
      destination_channel: destination,
      expected_revision: plan.revision,
      idempotency_key: "stale-key",
    })).toThrow(/stale/i);
    const db = getDb();
    expect(db.prepare("SELECT COUNT(*) AS n FROM messages WHERE channel = ?").get(source).n).toBe(2);
  });

  test("acquires and releases both channel locks around the apply", () => {
    const { source, destination } = seedChannels();
    seedSourceMessages(source, 1);
    const plan = planChannelMerge({ source_channel: source, destination_channel: destination });
    applyChannelMerge({
      source_channel: source,
      destination_channel: destination,
      expected_revision: plan.revision,
      idempotency_key: "locks-key",
      agent_id: "channel-merge-agent",
    });
    expect(checkLock("channel", source)).toBeNull();
    expect(checkLock("channel", destination)).toBeNull();
  });

  test("refuses apply with a named held_by when either channel is locked by another agent", () => {
    const { source, destination } = seedChannels();
    seedSourceMessages(source, 1);
    // The plan is taken while the channels are uncontended, then another agent
    // locks the destination before the apply — the apply must refuse at its
    // lock-acquisition step with the named holder instead of writing.
    const plan = planChannelMerge({ source_channel: source, destination_channel: destination });
    expect(() => planChannelMerge({ source_channel: source, destination_channel: destination }))
      .not.toThrow();
    acquireLock("channel", destination, "other-agent", "advisory");
    expect(() => planChannelMerge({ source_channel: source, destination_channel: destination }))
      .toThrow(/locked by other-agent/);
    expect(() => applyChannelMerge({
      source_channel: source,
      destination_channel: destination,
      expected_revision: plan.revision,
      idempotency_key: "held-key",
    })).toThrow(/locked by other-agent/);
  });

  test("preserves reply chains: children keep their reply_to parents with stable ids", () => {
    const { source, destination } = seedChannels();
    const parent = sendMessage({
      from: "alice", to: source, channel: source, session_id: `channel:${source}`, content: "parent",
    });
    sendMessage({
      from: "bob", to: source, channel: source, session_id: `channel:${source}`, content: "child",
      reply_to: parent.id,
      reply_to_uuid: parent.uuid,
    });
    const plan = planChannelMerge({ source_channel: source, destination_channel: destination });
    const receipt = applyChannelMerge({
      source_channel: source,
      destination_channel: destination,
      expected_revision: plan.revision,
      idempotency_key: "thread-key",
    });
    const db = getDb();
    const child = db.prepare("SELECT id, channel, session_id, reply_to FROM messages WHERE content = 'child'").get() as {
      id: number; channel: string; session_id: string; reply_to: number;
    };
    expect(child.channel).toBe(destination);
    expect(child.session_id).toBe(`channel:${destination}`);
    expect(child.reply_to).toBe(parent.id);
    expect(receipt.message_ids).toContain(parent.id);
    expect(receipt.message_ids).toContain(child.id);
  });

  test("with --archive-source archives the source and aliases it to the destination", () => {
    const { source, destination } = seedChannels();
    seedSourceMessages(source, 1);
    const plan = planChannelMerge({
      source_channel: source,
      destination_channel: destination,
      archive_source: true,
    });
    expect(plan.archive_source).toBe(true);
    applyChannelMerge({
      source_channel: source,
      destination_channel: destination,
      archive_source: true,
      expected_revision: plan.revision,
      idempotency_key: "archive-key",
    });
    const db = getDb();
    const sourceRow = db.prepare("SELECT archived_at FROM channels WHERE name = ?").get(source) as { archived_at: string | null };
    expect(sourceRow.archived_at).not.toBeNull();
    const alias = db.prepare(
      "SELECT current_channel FROM channel_rename_aliases WHERE old_channel = ?",
    ).get(source) as { current_channel: string } | null;
    expect(alias?.current_channel).toBe(destination);
    // Destination is untouched as a channel row.
    const destRow = db.prepare("SELECT archived_at FROM channels WHERE name = ?").get(destination) as { archived_at: string | null };
    expect(destRow.archived_at).toBeNull();
  });

  test("without --archive-source both channels stay live and no alias is written", () => {
    const { source, destination } = seedChannels();
    seedSourceMessages(source, 1);
    const plan = planChannelMerge({ source_channel: source, destination_channel: destination });
    applyChannelMerge({
      source_channel: source,
      destination_channel: destination,
      expected_revision: plan.revision,
      idempotency_key: "live-key",
    });
    const db = getDb();
    const sourceRow = db.prepare("SELECT archived_at FROM channels WHERE name = ?").get(source) as { archived_at: string | null };
    expect(sourceRow.archived_at).toBeNull();
    const alias = db.prepare(
      "SELECT COUNT(*) AS n FROM channel_rename_aliases WHERE old_channel = ?",
    ).get(source) as { n: number };
    expect(alias.n).toBe(0);
  });

  test("receipts are immutable: update and delete both fail", () => {
    const { source, destination } = seedChannels();
    seedSourceMessages(source, 1);
    const plan = planChannelMerge({ source_channel: source, destination_channel: destination });
    const receipt = applyChannelMerge({
      source_channel: source,
      destination_channel: destination,
      expected_revision: plan.revision,
      idempotency_key: "immutable-key",
    });
    const db = getDb();
    expect(() => db.prepare("UPDATE channel_merge_receipts SET source_channel = 'x' WHERE id = ?").run(receipt.receipt_id))
      .toThrow(/immutable/);
    expect(() => db.prepare("DELETE FROM channel_merge_receipts WHERE id = ?").run(receipt.receipt_id))
      .toThrow(/immutable/);
  });
});

describe("rollbackChannelMerge", () => {
  function appliedState() {
    const { source, destination } = seedChannels();
    seedSourceMessages(source, 2);
    joinChannel(source, "alice");
    subscribeToChannelNotifications(source, "alice");
    const plan = planChannelMerge({
      source_channel: source,
      destination_channel: destination,
      archive_source: true,
    });
    const receipt = applyChannelMerge({
      source_channel: source,
      destination_channel: destination,
      archive_source: true,
      expected_revision: plan.revision,
      idempotency_key: "apply-key",
    });
    return { source, destination, receipt };
  }

  test("rollback moves messages and memberships back with unchanged ids and never mutates the apply receipt", () => {
    const { source, destination, receipt } = appliedState();
    const dryRun = rollbackChannelMerge({
      receipt_id: receipt.receipt_id,
      expected_revision: receipt.post_revision,
      idempotency_key: "rollback-dry-key",
      apply: false,
    });
    expect(dryRun.dry_run).toBe(true);
    expect(dryRun.target_count).toBe(2);

    const result = rollbackChannelMerge({
      receipt_id: receipt.receipt_id,
      expected_revision: receipt.post_revision,
      idempotency_key: "rollback-apply-key",
      apply: true,
    });
    expect(result.restored_count).toBe(2);
    expect(result.receipt_id).not.toBe(receipt.receipt_id);
    expect(result.source_receipt_id).toBe(receipt.receipt_id);
    expect(result.replayed).toBe(false);

    const db = getDb();
    const rows = db.prepare("SELECT id, channel, session_id FROM messages WHERE channel = ? ORDER BY id").all(source) as Array<{
      id: number; channel: string; session_id: string;
    }>;
    expect(rows.length).toBe(2);
    expect(rows.map((row) => row.id)).toEqual(receipt.message_ids);
    expect(rows.every((row) => row.session_id === `channel:${source}`)).toBe(true);
    // Memberships and subscriptions move back with the content.
    expect(db.prepare("SELECT COUNT(*) AS n FROM channel_members WHERE channel = ?").get(source).n).toBe(1);
    expect(db.prepare("SELECT COUNT(*) AS n FROM channel_subscriptions WHERE channel = ?").get(source).n).toBe(1);
    // Archive and alias are reversed.
    const sourceRow = db.prepare("SELECT archived_at FROM channels WHERE name = ?").get(source) as { archived_at: string | null };
    expect(sourceRow.archived_at).toBeNull();
    expect(db.prepare("SELECT COUNT(*) AS n FROM channel_rename_aliases WHERE old_channel = ?").get(source).n).toBe(0);
    // The apply receipt is unchanged by the rollback.
    const stored = db.prepare("SELECT operation FROM channel_merge_receipts WHERE id = ?").get(receipt.receipt_id) as { operation: string };
    expect(stored.operation).toBe("apply");
    const rollbackReceipt = db.prepare(
      "SELECT operation, source_receipt_id FROM channel_merge_receipts WHERE id = ?",
    ).get(result.receipt_id!) as { operation: string; source_receipt_id: string };
    expect(rollbackReceipt.operation).toBe("rollback");
    expect(rollbackReceipt.source_receipt_id).toBe(receipt.receipt_id);
  });

  test("rollback replay by key returns the stored rollback receipt", () => {
    const { source, destination, receipt } = appliedState();
    rollbackChannelMerge({
      receipt_id: receipt.receipt_id,
      expected_revision: receipt.post_revision,
      idempotency_key: "rollback-replay-key",
      apply: true,
    });
    const replay = rollbackChannelMerge({
      receipt_id: receipt.receipt_id,
      expected_revision: receipt.post_revision,
      idempotency_key: "rollback-replay-key",
      apply: true,
    });
    expect(replay.replayed).toBe(true);
    expect(replay.restored_count).toBe(2);
  });

  test("rejects a stale rollback revision", () => {
    const { source, destination, receipt } = appliedState();
    // A new message lands in the destination after the merge, changing the target state.
    sendMessage({
      from: "carol", to: destination, channel: destination, session_id: `channel:${destination}`, content: "after",
    });
    expect(() => rollbackChannelMerge({
      receipt_id: receipt.receipt_id,
      expected_revision: receipt.post_revision,
      idempotency_key: "stale-rollback-key",
      apply: true,
    })).toThrow(/stale/i);
  });
});
