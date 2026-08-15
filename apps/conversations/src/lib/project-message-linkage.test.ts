import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { unlinkSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { closeDb, getDb } from "./db.js";
import { createProject } from "./projects.js";
import { createChannel } from "./channels.js";
import { sendMessage } from "./messages.js";
import {
  applyChannelProjectMessageLinkage,
  planChannelProjectMessageLinkage,
  rollbackChannelProjectMessageLinkage,
} from "./project-message-linkage.js";
import { pinStoreToDb, restoreStoreEnv } from "./store/isolated-test-env.js";

const TEST_DB = join(tmpdir(), `conversations-project-linkage-${Date.now()}.db`);

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

function seedLinkedChannel() {
  const project = createProject({ name: "Dubai Fraud", created_by: "tester" });
  createChannel("dubai-fraud", "tester", { project_id: project.id });
  return project;
}

function insertLegacyChannelMessage(channel: string, uuid: string, content: string, projectId: string | null = null): Record<string, unknown> & { id: number; uuid: string } {
  return getDb().prepare(`
    INSERT INTO messages (
      uuid, session_id, from_agent, to_agent, channel, project_id, content,
      priority, working_dir, repository, branch, metadata, edited_at, pinned_at,
      blocking, attachments, created_at, read_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    RETURNING *
  `).get(
    uuid,
    `channel:${channel}`,
    "legacy-agent",
    channel,
    channel,
    projectId,
    content,
    "high",
    "/workspace/project",
    "hasna/example",
    "main",
    JSON.stringify({ preserved: true }),
    "2026-08-07T10:00:00.000Z",
    "2026-08-07T10:01:00.000Z",
    1,
    JSON.stringify([{ name: "evidence.txt", path: "/safe/evidence.txt", size: 8, mime_type: "text/plain" }]),
    "2026-08-07T09:00:00.000Z",
    "2026-08-07T10:02:00.000Z",
  ) as Record<string, unknown> & { id: number; uuid: string };
}

describe("project-linked channel sends", () => {
  test("inherits the channel project for posts and replies", () => {
    const project = seedLinkedChannel();

    const parent = sendMessage({
      from: "alice",
      to: "dubai-fraud",
      channel: "dubai-fraud",
      content: "parent",
    });
    const reply = sendMessage({
      from: "bob",
      to: "dubai-fraud",
      channel: "dubai-fraud",
      content: "reply",
      reply_to: parent.id,
      reply_to_uuid: parent.uuid,
    });

    expect(parent.project_id).toBe(project.id);
    expect(reply.project_id).toBe(project.id);
  });

  test("accepts an explicit matching project and rejects a conflicting project without writing", () => {
    const project = seedLinkedChannel();
    const other = createProject({ name: "Other", created_by: "tester" });

    expect(sendMessage({
      from: "alice",
      to: "dubai-fraud",
      channel: "dubai-fraud",
      content: "matching",
      project_id: project.id,
    }).project_id).toBe(project.id);

    expect(() => sendMessage({
      from: "alice",
      to: "dubai-fraud",
      channel: "dubai-fraud",
      content: "conflicting",
      project_id: other.id,
    })).toThrow("conflicts with channel project");
    expect(getDb().prepare("SELECT count(*) AS n FROM messages").get()).toEqual({ n: 1 });
  });

  test("rejects caller-supplied tenant routing and leaves unlinked channels null", () => {
    createChannel("unlinked", "tester");

    expect(() => sendMessage({
      from: "alice",
      to: "unlinked",
      channel: "unlinked",
      content: "tenant-conflict",
      tenant_id: "caller-tenant",
    })).toThrow("tenant_id is owned by the active storage context");

    const message = sendMessage({ from: "alice", to: "unlinked", channel: "unlinked", content: "plain" });
    expect(message.project_id).toBeNull();
  });
});

describe("guarded project-message linkage backfill", () => {
  test("rejects a concurrent legacy insert after dry-run without partially linking the prior membership", () => {
    const project = seedLinkedChannel();
    const first = insertLegacyChannelMessage("dubai-fraud", "66666666666646668666666666666666", "first");
    const plan = planChannelProjectMessageLinkage({ channel: "dubai-fraud", project_id: project.id });
    const concurrent = insertLegacyChannelMessage("dubai-fraud", "77777777777747778777777777777777", "concurrent");

    expect(() => applyChannelProjectMessageLinkage({
      channel: "dubai-fraud",
      project_id: project.id,
      expected_revision: plan.revision,
      idempotency_key: "concurrent-legacy-insert",
    })).toThrow("Stale project-message linkage revision");
    expect(getDb().prepare("SELECT id, project_id FROM messages ORDER BY id").all()).toEqual([
      { id: first.id, project_id: null },
      { id: concurrent.id, project_id: null },
    ]);
  });

  test("plans, applies, replays, rejects stale/inconsistent requests, and rolls back exact rows", () => {
    const project = seedLinkedChannel();
    const first = insertLegacyChannelMessage("dubai-fraud", "11111111111141118111111111111111", "first");
    const second = insertLegacyChannelMessage("dubai-fraud", "22222222222242228222222222222222", "second");
    const alreadyLinked = insertLegacyChannelMessage("dubai-fraud", "33333333333343338333333333333333", "third", project.id);

    const beforeRows = getDb().prepare("SELECT * FROM messages WHERE channel = ? ORDER BY id").all("dubai-fraud");
    const plan = planChannelProjectMessageLinkage({ channel: "dubai-fraud", project_id: project.id });
    expect(plan.dry_run).toBe(true);
    expect(plan.message_ids).toEqual([first.id, second.id, alreadyLinked.id]);
    expect(plan.message_uuids).toEqual([first.uuid, second.uuid, alreadyLinked.uuid]);
    expect(plan.count).toBe(3);
    expect(plan.target_count).toBe(2);
    expect(plan.before_hashes).toHaveLength(3);

    const receipt = applyChannelProjectMessageLinkage({
      channel: "dubai-fraud",
      project_id: project.id,
      expected_revision: plan.revision,
      idempotency_key: "dubai-linkage-apply-1",
    });
    expect(receipt.replayed).toBe(false);
    expect(receipt.message_ids).toEqual(plan.message_ids);
    expect(receipt.message_uuids).toEqual(plan.message_uuids);
    expect(receipt.count).toBe(3);
    expect(receipt.target_count).toBe(2);

    const replay = applyChannelProjectMessageLinkage({
      channel: "dubai-fraud",
      project_id: project.id,
      expected_revision: plan.revision,
      idempotency_key: "dubai-linkage-apply-1",
    });
    expect(replay.receipt_id).toBe(receipt.receipt_id);
    expect(replay.replayed).toBe(true);

    expect(() => applyChannelProjectMessageLinkage({
      channel: "dubai-fraud",
      project_id: project.id,
      expected_revision: "stale-revision",
      idempotency_key: "dubai-linkage-apply-1",
    })).toThrow("Idempotency key was already used with a different request");
    expect(() => applyChannelProjectMessageLinkage({
      channel: "dubai-fraud",
      project_id: project.id,
      expected_revision: plan.revision,
      idempotency_key: "dubai-linkage-apply-stale",
    })).toThrow("Stale project-message linkage revision");

    const linkedRows = getDb().prepare("SELECT * FROM messages WHERE channel = ? ORDER BY id").all("dubai-fraud") as Record<string, unknown>[];
    expect(linkedRows.map((row) => row.project_id)).toEqual([project.id, project.id, project.id]);
    expect(linkedRows.map(({ project_id: _projectId, ...row }) => row)).toEqual(
      (beforeRows as Record<string, unknown>[]).map(({ project_id: _projectId, ...row }) => row),
    );
    expect(() => getDb().prepare("UPDATE channel_project_linkage_receipts SET channel = ? WHERE id = ?").run("other", receipt.receipt_id))
      .toThrow("immutable");
    expect(() => getDb().prepare("DELETE FROM channel_project_linkage_receipts WHERE id = ?").run(receipt.receipt_id))
      .toThrow("immutable");

    const rollbackPlan = rollbackChannelProjectMessageLinkage({
      receipt_id: receipt.receipt_id,
      expected_revision: receipt.target_revision,
      idempotency_key: "dubai-linkage-rollback-1",
      apply: false,
    });
    expect(rollbackPlan.dry_run).toBe(true);
    expect(rollbackPlan.target_count).toBe(2);

    const rollback = rollbackChannelProjectMessageLinkage({
      receipt_id: receipt.receipt_id,
      expected_revision: receipt.target_revision,
      idempotency_key: "dubai-linkage-rollback-1",
      apply: true,
    });
    expect(rollback.dry_run).toBe(false);
    expect(rollback.restored_count).toBe(2);

    const restoredRows = getDb().prepare("SELECT * FROM messages WHERE channel = ? ORDER BY id").all("dubai-fraud");
    expect(restoredRows).toEqual(beforeRows);
  });

  test("rollback is all-or-nothing when an affected row changed after apply", () => {
    const project = seedLinkedChannel();
    const first = insertLegacyChannelMessage("dubai-fraud", "44444444444444448444444444444444", "first");
    const second = insertLegacyChannelMessage("dubai-fraud", "55555555555545558555555555555555", "second");
    const plan = planChannelProjectMessageLinkage({ channel: "dubai-fraud", project_id: project.id });
    const receipt = applyChannelProjectMessageLinkage({
      channel: "dubai-fraud",
      project_id: project.id,
      expected_revision: plan.revision,
      idempotency_key: "conditional-apply",
    });
    getDb().prepare("UPDATE messages SET content = ? WHERE id = ?").run("changed", first.id);

    expect(() => rollbackChannelProjectMessageLinkage({
      receipt_id: receipt.receipt_id,
      expected_revision: receipt.target_revision,
      idempotency_key: "conditional-rollback",
      apply: true,
    })).toThrow("Stale project-message linkage rollback revision");
    const rows = getDb().prepare("SELECT id, project_id FROM messages ORDER BY id").all() as Array<{ id: number; project_id: string | null }>;
    expect(rows).toEqual([
      { id: first.id, project_id: project.id },
      { id: second.id, project_id: project.id },
    ]);
  });
});
