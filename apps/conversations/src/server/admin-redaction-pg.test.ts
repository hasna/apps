// Hermetic coverage for the hosted redaction path (`POST /v1/admin/redact-messages`).
// The module under test talks only to the TypedQueryClient seam, so a
// purpose-built in-memory shim exercises dry-run, apply, gates, and attachment
// purging without a live Postgres.

import { describe, expect, test } from "bun:test";
import { normalizeRedactMessagesBody, redactMessagesPg } from "./admin-redaction-pg.js";
import type { TypedQueryClient } from "../generated/storage-kit/query.js";

interface Row {
  id: number;
  uuid: string | null;
  session_id: string;
  from_agent: string;
  to_agent: string;
  channel: string | null;
  content: string;
  metadata: string | null;
  attachments: string | null;
  created_at: string;
}

function seededRow(overrides: Partial<Row> = {}): Row {
  return {
    id: 9001,
    uuid: "uuid-redact-seed",
    session_id: "channel:redaction",
    from_agent: "alice",
    to_agent: "redaction",
    channel: "redaction",
    content: ["-----BEGIN", "PRIVATE KEY----- placeholder"].join(" "),
    metadata: JSON.stringify({ token: "placeholder" }),
    attachments: JSON.stringify([{ name: "leak.txt", path: "/tmp/leak.txt", size: 4 }]),
    created_at: "2026-08-01T00:00:00.000Z",
    ...overrides,
  };
}

function makeClient(rows: Row[], attachmentCounts: Map<number, number> = new Map()) {
  const messages = new Map<number, Row>(rows.map((row) => [row.id, { ...row }]));
  const audit: Array<Record<string, unknown>> = [];
  const deleted: number[] = [];
  const outboxScrubbed = { count: 0 };
  const calls: string[] = [];

  const client = {
    async many<T>(sql: string, params: readonly unknown[] = []): Promise<T[]> {
      calls.push(sql);
      if (/SELECT id, uuid, session_id, from_agent, to_agent, channel, content, metadata, attachments, created_at/i.test(sql)) {
        const ids = new Set((params[0] as number[]) ?? []);
        return Array.from(messages.values())
          .filter((row) => ids.has(Number(row.id)))
          .map((row) => ({ ...row })) as T[];
      }
      if (/FROM message_attachments/i.test(sql)) {
        return Array.from(attachmentCounts.entries())
          .filter(([id]) => new Set((params[0] as number[]) ?? []).has(id))
          .map(([id, count]) => ({
            message_id: String(id),
            count: String(count),
            name_sizes: Array.from({ length: count }, (_, i) => `blob-${i}:12`).join(","),
          })) as T[];
      }
      return [] as T[];
    },
    async get<T>(sql: string): Promise<T | null> {
      return null as T | null;
    },
    async one<T>(sql: string): Promise<T> {
      return (await this.get<T>(sql)) as T;
    },
    async execute(sql: string, params: readonly unknown[] = []): Promise<void> {
      calls.push(sql);
      if (/UPDATE messages SET content = \$1/i.test(sql)) {
        const row = messages.get(Number(params[4]));
        if (row) {
          row.content = String(params[0]);
          row.metadata = String(params[1]);
          row.attachments = params[2] === null ? null : String(params[2]);
        }
        return;
      }
      if (/UPDATE conversations_event_outbox/i.test(sql)) {
        outboxScrubbed.count += 1;
        return;
      }
      if (/INSERT INTO message_redaction_audit/i.test(sql)) {
        audit.push({ id: params[0], message_id: params[1] });
        return;
      }
      if (/UPDATE message_redaction_audit SET attachment_files_deleted/i.test(sql)) {
        return;
      }
      throw new Error(`unexpected execute: ${sql.slice(0, 80)}`);
    },
    async query(sql: string, params: readonly unknown[] = []): Promise<{ rows: Row[]; rowCount: number | null }> {
      calls.push(sql);
      if (/DELETE FROM message_attachments/i.test(sql)) {
        const id = Number(params[0]);
        const count = attachmentCounts.get(id) ?? 0;
        deleted.push(id);
        return { rows: [], rowCount: count };
      }
      return { rows: [], rowCount: 0 };
    },
  };

  return {
    client: client as unknown as TypedQueryClient,
    debug: { messages, audit, deleted, outboxScrubbed, calls },
  };
}

describe("redactMessagesPg", () => {
  test("non-boolean apply and confirmation flags cannot reach a destructive write", async () => {
    const { client, debug } = makeClient([seededRow()]);
    for (const field of ["apply", "backup_confirmed", "dry_run_confirmed", "purge_attachments"]) {
      for (const value of ["false", "true", 0, 1, null, [], {}]) {
        await expect((async () => redactMessagesPg(client, normalizeRedactMessagesBody({
          ids: [9001], actor: "security", apply: true,
          authority: "owner", backup_confirmed: true, dry_run_confirmed: true,
          [field]: value,
        })))()).rejects.toThrow(`${field} must be a JSON boolean`);
      }
    }
    expect(debug.calls).toEqual([]);
    expect(debug.audit).toEqual([]);
    expect(debug.deleted).toEqual([]);
    expect(normalizeRedactMessagesBody({ apply: false, purge_attachments: false }))
      .toMatchObject({ apply: false, purgeAttachments: false });
    expect(() => normalizeRedactMessagesBody(null as never)).toThrow("JSON object");
    expect(() => normalizeRedactMessagesBody([] as never)).toThrow("JSON object");
  });
  test("dry-run reports ids, fields, classes and hashes without mutating data", async () => {
    const { client, debug } = makeClient([seededRow({ attachments: null, metadata: null })]);
    const result = await redactMessagesPg(client, normalizeRedactMessagesBody({
      ids: [9001],
      actor: "security",
      reason: "credential-shaped message remediation",
    }));

    expect(result.dry_run).toBe(true);
    expect(result.applied).toBe(false);
    expect(result.matched_count).toBe(1);
    expect(result.missing_ids).toEqual([]);
    expect(result.surfaces).toContain("messages.content");
    const report = result.messages[0];
    expect(report).toMatchObject({ id: 9001, exists: true, applied: false });
    expect(report.secret_classes).toContain("private_key");
    expect(report.before_hashes.content_sha256).toMatch(/^[0-9a-f]{64}$/);
    // Nothing was written.
    expect(debug.messages.get(9001)!.content).toContain("PRIVATE KEY");
    expect(debug.audit).toHaveLength(0);
    expect(debug.calls.some((sql) => /UPDATE messages/.test(sql))).toBe(false);
  });

  test("missing ids are reported without failing the run", async () => {
    const { client } = makeClient([seededRow()]);
    const result = await redactMessagesPg(client, normalizeRedactMessagesBody({ ids: [9001, 99999] }));
    expect(result.matched_count).toBe(1);
    expect(result.missing_ids).toEqual([99999]);
    expect(result.messages.find((report) => report.id === 99999)!.exists).toBe(false);
  });

  test("apply with the owner gates redacts the row, scrubs the outbox envelope, audits, and purges blobs", async () => {
    const { client, debug } = makeClient([seededRow()], new Map([[9001, 2]]));
    const result = await redactMessagesPg(client, normalizeRedactMessagesBody({
      ids: [9001],
      actor: "security",
      reason: "credential-shaped message remediation",
      apply: true,
      authority: "owner-ref",
      backup_confirmed: true,
      dry_run_confirmed: true,
    }));

    expect(result.applied).toBe(true);
    expect(result.redacted_count).toBe(1);
    const row = debug.messages.get(9001)!;
    expect(row.content).toContain("[REDACTED");
    expect(row.metadata).toContain('"redacted":true');
    expect(debug.audit).toHaveLength(1);
    expect(debug.audit[0]).toMatchObject({ message_id: 9001 });
    expect(debug.deleted).toEqual([9001]);
    expect(debug.outboxScrubbed.count).toBe(1);
  });

  test("apply refuses without the owner gates", async () => {
    const { client } = makeClient([seededRow()]);
    await expect(redactMessagesPg(client, normalizeRedactMessagesBody({
      ids: [9001],
      actor: "security",
      reason: "credential-shaped message remediation",
      apply: true,
    }))).rejects.toThrow(/backup confirmation/);
  });

  test("no ids is a hard error", async () => {
    const { client } = makeClient([seededRow()]);
    await expect(redactMessagesPg(client, normalizeRedactMessagesBody({ ids: [] })))
      .rejects.toThrow(/At least one message id/);
  });
});
