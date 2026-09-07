import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { closeDb, getDb } from "./db.js";
import { exportMessages, getMessageById, searchMessages, sendMessage } from "./messages.js";
import { redactMessagesById } from "./admin-redaction.js";
import { clearStoreEnv, pinStoreToDb, restoreStoreEnv } from "./store/isolated-test-env.js";
import { HERMETIC_STATION } from "../test/hermetic.js";

const TEST_ROOT = join(tmpdir(), `conversations-redaction-test-${Date.now()}`);
const TEST_DB = join(TEST_ROOT, "messages.db");
const ATTACHMENTS_DIR = join(TEST_ROOT, "attachments");
// The cloud-guard case below exports a synthetic API pair; on a fleet
// workstation the shared chain would read the station's REAL Keychain items
// above it and refuse on the authority disagreement instead of on the guard.
const SAVED_STATION = process.env.HASNA_STATION;

beforeEach(() => {
  pinStoreToDb(TEST_DB);
  process.env.CONVERSATIONS_ATTACHMENTS_DIR = ATTACHMENTS_DIR;
  process.env.HASNA_STATION = HERMETIC_STATION;
  mkdirSync(TEST_ROOT, { recursive: true });
  closeDb();
});

afterEach(() => {
  closeDb();
  restoreStoreEnv();
  delete process.env.CONVERSATIONS_ATTACHMENTS_DIR;
  if (SAVED_STATION === undefined) delete process.env.HASNA_STATION;
  else process.env.HASNA_STATION = SAVED_STATION;
  try { unlinkSync(TEST_DB); } catch {}
  try { unlinkSync(`${TEST_DB}-wal`); } catch {}
  try { unlinkSync(`${TEST_DB}-shm`); } catch {}
  try { rmSync(TEST_ROOT, { recursive: true, force: true }); } catch {}
});

function markerContent(): string {
  return ["-----BEGIN", "PRIVATE KEY-----", "placeholder"].join(" ");
}

function fileContains(path: string, needle: string): boolean {
  return existsSync(path) && readFileSync(path).includes(Buffer.from(needle));
}

// Seed a message that carries credential-shaped data, the way a historical leak
// left it in the DB. `sendMessage` now blocks secret content at write time
// (content-safety, 0.5.8), so we write a benign row and overwrite content/metadata
// directly through the DB — the same shape a pre-guard leak leaves behind for the
// redaction tool to clean. The direct UPDATE keeps the FTS index in sync via the
// messages update trigger, exactly as a real leaked row would be indexed.
function seedLeakedMessage(opts: {
  content?: string;
  metadata?: Record<string, unknown>;
  attachments?: { name: string; source_path: string }[];
} = {}): ReturnType<typeof sendMessage> {
  const msg = sendMessage({
    from: "alice",
    to: "bob",
    content: "benign seed content",
    attachments: opts.attachments,
  });
  if (opts.content !== undefined || opts.metadata !== undefined) {
    getDb().prepare("UPDATE messages SET content = ?, metadata = ? WHERE id = ?").run(
      opts.content ?? "benign seed content",
      opts.metadata ? JSON.stringify(opts.metadata) : null,
      msg.id,
    );
  }
  return getMessageById(msg.id)!;
}

describe("redactMessagesById", () => {
  test("refuses to run when conversations is flipped to the HTTP API", () => {
    const msg = seedLeakedMessage({ content: markerContent() });

    // Simulate an API client-flip: remove the explicit local DB path override and
    // export API url + key so isCloudStore() resolves to the HTTP API.
    clearStoreEnv();
    process.env.HASNA_CONVERSATIONS_API_URL = "https://conversations.example.invalid";
    process.env.HASNA_CONVERSATIONS_API_KEY = ["fixture", "not", "a", "credential"].join("-");
    try {
      expect(() => redactMessagesById({
        ids: [msg.id],
        actor: "security",
        reason: "test cloud guard",
      })).toThrow("flipped to the HTTP API");
    } finally {
      pinStoreToDb(TEST_DB);
    }
  });

  test("dry-run reports ids, fields, classes, and hashes without mutating message data", () => {
    const originalContent = markerContent();
    const msg = seedLeakedMessage({
      content: originalContent,
      metadata: { token: "placeholder" },
    });

    const result = redactMessagesById({
      ids: [msg.id, 999],
      actor: "security",
      reason: "test review",
    });

    expect(result.dry_run).toBe(true);
    expect(result.applied).toBe(false);
    expect(result.matched_count).toBe(1);
    expect(result.missing_ids).toEqual([999]);
    expect(result.messages[0].fields).toContain("content");
    expect(result.messages[0].fields).toContain("metadata");
    expect(result.messages[0].secret_classes).toContain("private_key");
    expect(result.messages[0].secret_classes).toContain("sensitive_metadata_key");
    expect(JSON.stringify(result)).not.toContain("placeholder");
    // Dry-run must not mutate the stored row. Read the raw column directly:
    // getMessageById redacts sensitive content on read (0.5.8 export controls),
    // so it cannot distinguish "unchanged" from "redacted" here.
    const rawRow = getDb().get<{ content: string }>("SELECT content FROM messages WHERE id = ?", msg.id);
    expect(rawRow?.content).toBe(originalContent);
  });

  test("apply refuses to run without backup, dry-run, and authority gates", () => {
    const msg = seedLeakedMessage({ content: markerContent() });

    expect(() => redactMessagesById({
      ids: [msg.id],
      actor: "security",
      reason: "test apply",
      apply: true,
    })).toThrow("backup confirmation");

    expect(() => redactMessagesById({
      ids: [msg.id],
      actor: "security",
      reason: "test apply",
      apply: true,
      backupConfirmed: true,
    })).toThrow("dry-run confirmation");

    expect(() => redactMessagesById({
      ids: [msg.id],
      actor: "security",
      reason: "test apply",
      apply: true,
      backupConfirmed: true,
      dryRunConfirmed: true,
    })).toThrow("owner authority");
  });

  test("apply redacts content, metadata, attachments, export output, and FTS cache", () => {
    const sourceFile = join(TEST_ROOT, "evidence.txt");
    writeFileSync(sourceFile, "placeholder attachment");
    const originalContent = markerContent();
    const msg = seedLeakedMessage({
      content: originalContent,
      metadata: { api_key: "placeholder" },
      attachments: [{ name: "evidence.txt", source_path: sourceFile }],
    });
    const originalAttachmentPath = msg.attachments![0].path;
    expect(existsSync(originalAttachmentPath)).toBe(true);

    redactMessagesById({
      ids: [msg.id],
      actor: "security",
      reason: "test redaction",
      apply: true,
      authority: "ticket-123",
      backupConfirmed: true,
      dryRunConfirmed: true,
      now: "2026-07-06T00:00:00.000Z",
    });

    const updated = getMessageById(msg.id)!;
    expect(updated.content).toBe("[REDACTED by conversations admin redaction]");
    expect(updated.metadata?.redacted).toBe(true);
    expect(updated.metadata?.original_hashes).toBeDefined();
    expect(updated.attachments?.[0].path).toBe("[redacted]");
    expect(existsSync(originalAttachmentPath)).toBe(false);
    expect(exportMessages()).not.toContain("placeholder");
    expect(searchMessages({ query: "placeholder" })).toHaveLength(0);

    const auditRows = getDb().prepare("SELECT * FROM message_redaction_audit WHERE message_id = ?").all(msg.id);
    expect(auditRows).toHaveLength(1);
    expect(JSON.stringify(auditRows)).not.toContain("placeholder");
  });

  test("apply scrubs SQLite WAL and free-page storage before reporting success", () => {
    const marker = `redaction-marker-${Date.now()}`;
    const msg = sendMessage({ from: "alice", to: "bob", content: marker });

    redactMessagesById({
      ids: [msg.id],
      actor: "security",
      reason: "test storage scrub",
      apply: true,
      authority: "ticket-123",
      backupConfirmed: true,
      dryRunConfirmed: true,
    });
    closeDb();

    for (const path of [TEST_DB, `${TEST_DB}-wal`, `${TEST_DB}-shm`]) {
      expect(fileContains(path, marker)).toBe(false);
    }
  });

  test("does not delete attachment paths outside the managed attachment directory", () => {
    const outsideFile = join(TEST_ROOT, "outside.txt");
    writeFileSync(outsideFile, "placeholder outside");
    const msg = seedLeakedMessage({ content: markerContent() });
    getDb().prepare("UPDATE messages SET attachments = ? WHERE id = ?").run(JSON.stringify([{
      name: "outside.txt",
      path: outsideFile,
      size: readFileSync(outsideFile).byteLength,
      mime_type: "text/plain",
    }]), msg.id);

    const result = redactMessagesById({
      ids: [msg.id],
      actor: "security",
      reason: "test unsafe attachment",
      apply: true,
      authority: "ticket-123",
      backupConfirmed: true,
      dryRunConfirmed: true,
    });

    expect(existsSync(outsideFile)).toBe(true);
    expect(result.messages[0].unsafe_attachment_file_count).toBe(1);
    expect(result.messages[0].attachment_files_deleted).toBe(0);
  });
});
