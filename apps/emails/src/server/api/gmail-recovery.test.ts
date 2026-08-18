import { afterEach, describe, expect, it } from "bun:test";
import { createHash } from "node:crypto";
import {
  GMAIL_SOURCE_BUCKET,
  classifyLegacyPayloadKey,
  createGmailRawMessageFetcher,
  finalizeGmailRecoveryReplay,
  gmailRecoveryReplaySucceeded,
  MAX_GMAIL_RECOVERY_REPLAY_MESSAGES,
  normalizeGmailRecoveryReplayMessageIds,
  reconcileLegacyInboundMissingPayloads,
  replayLegacyInboundAttachments,
  resolveGmailRecoveryConfig,
  type GmailRawMessageFetcher,
  type GmailRecoveryStore,
} from "./gmail-recovery.js";
import type { LegacyInboundPayloadPage, LegacyInboundPayloadRow } from "./store.js";

const rawWithAttachment = [
  `From: sender@example.com`,
  `To: andrei@example.com`,
  `Subject: with attachment`,
  `MIME-Version: 1.0`,
  `Content-Type: multipart/mixed; boundary="b0undary"`,
  ``,
  `--b0undary`,
  `Content-Type: text/plain; charset="utf-8"`,
  ``,
  `see attachment`,
  `--b0undary`,
  `Content-Type: text/plain; name="invoice.txt"`,
  `Content-Disposition: attachment; filename="invoice.txt"`,
  ``,
  `hello`,
  `--b0undary--`,
  ``,
].join("\r\n");

const parsedAttachment = {
  filename: "invoice.txt",
  content_type: "text/plain",
  size: 5,
  content_base64: Buffer.from("hello").toString("base64"),
};

const metadataOnly = {
  filename: "invoice.txt",
  content_type: "text/plain",
  size: 5,
};

const gmailId = "18f0c1a2b3c4d5e6";

function row(overrides: Partial<LegacyInboundPayloadRow> = {}): LegacyInboundPayloadRow {
  return {
    tenant_id: "tenant-a",
    message_id: "legacy-inbound:00000000-0000-0000-0000-000000000001",
    provider_message_id: gmailId,
    message_id_column: null,
    attachments: [metadataOnly],
    ...overrides,
  };
}

function fakeStore(overrides: {
  rows?: LegacyInboundPayloadRow[];
  byId?: Map<string, LegacyInboundPayloadRow[]>;
  replaceResult?: boolean;
} = {}) {
  const byId = overrides.byId ?? new Map<string, LegacyInboundPayloadRow[]>();
  if (overrides.rows) {
    for (const r of overrides.rows) {
      const existing = byId.get(r.message_id) ?? [];
      existing.push(r);
      byId.set(r.message_id, existing);
    }
  }
  const writes: Array<{ tenantId: string; messageId: string; payloadCount: number }> = [];
  const store: GmailRecoveryStore = {
    listLegacyInboundMissingPayloadBindings: async (
      cursor: { tenantId: string; messageId: string } | null,
      limit: number,
    ): Promise<LegacyInboundPayloadPage> => {
      const rows = overrides.rows ?? [];
      const start = cursor
        ? rows.findIndex((r) => r.tenant_id === cursor.tenantId && r.message_id === cursor.messageId) + 1
        : 0;
      const page = rows.slice(Math.max(0, start), Math.max(0, start) + limit);
      return { rows: page, has_more: start + limit < rows.length };
    },
    getLegacyInboundPayloadBindings: async (messageId: string) => byId.get(messageId) ?? [],
    replaceLegacyAttachmentPayloadAndProvenance: async (input) => {
      writes.push({
        tenantId: input.tenantId,
        messageId: input.messageId,
        payloadCount: input.replacementAttachments.length,
      });
      return overrides.replaceResult !== false;
    },
  };
  return { store, writes };
}

const okFetcher: GmailRawMessageFetcher = async () => Buffer.from(rawWithAttachment);

describe("classifyLegacyPayloadKey", () => {
  it("classifies a Gmail-message-id-shaped provider id", () => {
    expect(classifyLegacyPayloadKey("18f0c1a2b3c4d5e6", "inbound/domain/whatever")).toBe("gmail_message_id");
    expect(classifyLegacyPayloadKey("AbCdEfGhIjKlMnOpQrStUv", "inbound/domain/whatever")).toBe("gmail_message_id");
  });

  it("classifies a numeric provider id as a Gmail history id", () => {
    expect(classifyLegacyPayloadKey("45770487", null)).toBe("gmail_history_id");
    expect(classifyLegacyPayloadKey("0", "legacy-message-id")).toBe("gmail_history_id");
  });

  it("classifies an S3-key-shaped stored message id when no provider id is usable", () => {
    expect(classifyLegacyPayloadKey(null, "inbound/example.com/abc123")).toBe("s3_key_candidate");
    expect(classifyLegacyPayloadKey("not-an-id", "inbound/example.com/abc123")).toBe("s3_key_candidate");
  });

  it("classifies everything else as unresolvable", () => {
    expect(classifyLegacyPayloadKey(null, null)).toBe("unresolvable");
    expect(classifyLegacyPayloadKey("", "plain-legacy-id")).toBe("unresolvable");
  });
});

describe("resolveGmailRecoveryConfig", () => {
  it("returns null when the credential is not configured", () => {
    expect(resolveGmailRecoveryConfig({})).toBeNull();
    expect(resolveGmailRecoveryConfig({ EMAILS_GMAIL_ACCESS_TOKEN: "  " })).toBeNull();
  });

  it("resolves the endpoint default and override", () => {
    const config = resolveGmailRecoveryConfig({ EMAILS_GMAIL_ACCESS_TOKEN: "tok" });
    expect(config?.accessToken).toBe("tok");
    expect(config?.endpoint).toBe("https://gmail.googleapis.com");
    const overridden = resolveGmailRecoveryConfig({
      EMAILS_GMAIL_ACCESS_TOKEN: "tok",
      EMAILS_GMAIL_API_ENDPOINT: "https://proxy.example/",
    });
    expect(overridden?.endpoint).toBe("https://proxy.example/");
  });
});

describe("createGmailRawMessageFetcher", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("fetches and base64url-decodes the raw RFC822 message", async () => {
    const raw = Buffer.from(rawWithAttachment).toString("base64url");
    let seenUrl = "";
    let seenAuth = "";
    globalThis.fetch = async (url: string | URL | Request, init?: RequestInit) => {
      seenUrl = String(url);
      const headers = init?.headers as Headers | Record<string, string> | undefined;
      seenAuth = headers && typeof (headers as Headers).get === "function"
        ? (headers as Headers).get("authorization") ?? ""
        : ((headers as Record<string, string>)["authorization"]
          ?? (headers as Record<string, string>)["Authorization"]
          ?? "");
      return new Response(JSON.stringify({ id: gmailId, raw }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };
    const fetcher = createGmailRawMessageFetcher({
      accessToken: "tok",
      endpoint: "https://gmail.googleapis.com",
    });
    const bytes = await fetcher(gmailId);
    expect(bytes.toString()).toBe(rawWithAttachment);
    expect(seenUrl).toContain("/gmail/v1/users/me/messages/18f0c1a2b3c4d5e6?format=raw");
    expect(seenAuth).toContain("tok");
    expect(seenAuth).not.toContain("content_base64");
  });

  it("classifies HTTP 429 as retryable and 404 as terminal", async () => {
    globalThis.fetch = async () => new Response("{}", { status: 429 });
    const fetcher = createGmailRawMessageFetcher({
      accessToken: "tok",
      endpoint: "https://gmail.googleapis.com",
    });
    await expect(fetcher(gmailId)).rejects.toMatchObject({ statusCode: 429, retryable: true });
    globalThis.fetch = async () => new Response("{}", { status: 404 });
    await expect(fetcher(gmailId)).rejects.toMatchObject({ statusCode: 404, retryable: false });
  });

  it("rejects a response with no raw payload", async () => {
    globalThis.fetch = async () => new Response(JSON.stringify({ id: gmailId }), { status: 200 });
    const fetcher = createGmailRawMessageFetcher({
      accessToken: "tok",
      endpoint: "https://gmail.googleapis.com",
    });
    await expect(fetcher(gmailId)).rejects.toThrow("no raw RFC822 payload");
  });
});

describe("reconcileLegacyInboundMissingPayloads", () => {
  const rows = [
    row({ tenant_id: "tenant-a", provider_message_id: gmailId }),
    row({
      tenant_id: "tenant-a",
      message_id: "legacy-inbound:00000000-0000-0000-0000-000000000002",
      provider_message_id: "45770487",
    }),
    row({
      tenant_id: "tenant-b",
      message_id: "legacy-inbound:00000000-0000-0000-0000-000000000003",
      provider_message_id: null,
      message_id_column: "inbound/example.com/key",
    }),
    row({
      tenant_id: "tenant-b",
      message_id: "legacy-inbound:00000000-0000-0000-0000-000000000004",
      provider_message_id: null,
      message_id_column: null,
      attachments: [{ filename: "a.pdf", content_type: "application/pdf", size: 3 }, metadataOnly],
    }),
  ];

  it("aggregates by resolvability class without emitting ids by default", async () => {
    const { store } = fakeStore({ rows });
    const result = await reconcileLegacyInboundMissingPayloads(store, { emitIds: false, limit: 500 });
    expect(result.scanned_messages).toBe(4);
    expect(result.missing_payload_attachments).toBe(5);
    expect(result.by_key_class).toEqual({
      gmail_message_id: 1,
      gmail_history_id: 1,
      s3_key_candidate: 1,
      unresolvable: 1,
    });
    expect(result.manifest).toEqual([]);
    expect(result.manifest_emitted).toBe(0);
  });

  it("emits a bounded exact-id manifest with --ids", async () => {
    const { store } = fakeStore({ rows });
    const result = await reconcileLegacyInboundMissingPayloads(store, { emitIds: true, limit: 2 });
    expect(result.manifest_emitted).toBe(2);
    expect(result.manifest).toHaveLength(2);
    expect(result.manifest[0]).toMatchObject({
      tenant_id: "tenant-a",
      message_id: rows[0]!.message_id,
      key_class: "gmail_message_id",
      attachments: 1,
    });
    const json = JSON.stringify(result.manifest);
    expect(json).not.toContain("content_base64");
    expect(json).not.toContain("hello");
  });

  it("rejects an out-of-range manifest limit", async () => {
    const { store } = fakeStore({ rows: [] });
    await expect(reconcileLegacyInboundMissingPayloads(store, { emitIds: true, limit: 5001 }))
      .rejects.toThrow("between 1 and 5000");
  });
});

describe("normalizeGmailRecoveryReplayMessageIds", () => {
  it("trims and rejects duplicate normalized values", () => {
    expect(normalizeGmailRecoveryReplayMessageIds([" a ", "b", " "])).toEqual(["a", "b"]);
    expect(() => normalizeGmailRecoveryReplayMessageIds(["a", "a"])).toThrow("duplicate");
  });
});

describe("replayLegacyInboundAttachments", () => {
  it("reports would_replay on a metadata match in dry-run and never writes", async () => {
    const { store, writes } = fakeStore({ byId: new Map([[row().message_id, [row()]]]) });
    const report = await replayLegacyInboundAttachments(store, {
      messageIds: [row().message_id],
      apply: false,
      limit: 25,
      fetchRawMessage: okFetcher,
    });
    expect(report.mode).toBe("dry-run");
    expect(report.items).toHaveLength(1);
    expect(report.items[0]).toMatchObject({ status: "would_replay", message_id: row().message_id });
    expect(writes).toHaveLength(0);
    expect(report.result_sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it("reports already_complete and never fetches when payloads exist", async () => {
    let fetched = 0;
    const { store } = fakeStore({
      byId: new Map([[row().message_id, [row({ attachments: [{ ...parsedAttachment }] })]]]),
    });
    const report = await replayLegacyInboundAttachments(store, {
      messageIds: [row().message_id],
      apply: false,
      limit: 25,
      fetchRawMessage: async () => {
        fetched += 1;
        return Buffer.from(rawWithAttachment);
      },
    });
    expect(report.items[0]?.status).toBe("already_complete");
    expect(fetched).toBe(0);
  });

  it("reports history_id_only for numeric provider ids and never fabricates", async () => {
    const { store, writes } = fakeStore({
      byId: new Map([[row().message_id, [row({ provider_message_id: "45770487" })]]]),
    });
    const dryRun = await replayLegacyInboundAttachments(store, {
      messageIds: [row().message_id],
      apply: false,
      limit: 25,
      fetchRawMessage: okFetcher,
    });
    expect(dryRun.items[0]?.status).toBe("history_id_only");
    const report = await replayLegacyInboundAttachments(store, {
      messageIds: [row().message_id],
      apply: true,
      reviewedDryRunSha256: dryRun.result_sha256,
      limit: 25,
      fetchRawMessage: okFetcher,
    });
    expect(report.items[0]?.status).toBe("history_id_only");
    expect(writes).toHaveLength(0);
  });

  it("reports metadata_mismatch when fetched attachments do not match", async () => {
    const { store, writes } = fakeStore({
      byId: new Map([[row().message_id, [row({
        attachments: [{ filename: "other.bin", content_type: "application/octet-stream", size: 9 }],
      })]]]),
    });
    const report = await replayLegacyInboundAttachments(store, {
      messageIds: [row().message_id],
      apply: false,
      limit: 25,
      fetchRawMessage: okFetcher,
    });
    expect(report.items[0]?.status).toBe("metadata_mismatch");
    expect(writes).toHaveLength(0);
  });

  it("reports not_found and ambiguous for unknown and duplicate ids", async () => {
    const byId = new Map<string, LegacyInboundPayloadRow[]>([
      [row().message_id, [row(), row({ tenant_id: "tenant-b" })]],
    ]);
    const { store } = fakeStore({ byId });
    const report = await replayLegacyInboundAttachments(store, {
      messageIds: ["legacy-inbound:missing", row().message_id],
      apply: false,
      limit: 25,
      fetchRawMessage: okFetcher,
    });
    expect(report.items.map((item) => item.status)).toContain("not_found");
    expect(report.items.map((item) => item.status)).toContain("ambiguous");
  });

  it("classifies fetch failures as retryable and terminal", async () => {
    const { store } = fakeStore({ byId: new Map([[row().message_id, [row()]]]) });
    const retryable = await replayLegacyInboundAttachments(store, {
      messageIds: [row().message_id],
      apply: false,
      limit: 25,
      fetchRawMessage: async () => {
        throw Object.assign(new Error("gmail fetch failed with HTTP 429"), { statusCode: 429, retryable: true });
      },
    });
    expect(retryable.items[0]).toMatchObject({ status: "fetch_failed", retryable: true });
  });

  it("refuses apply when the reviewed dry-run sha256 does not match", async () => {
    const { store } = fakeStore({ byId: new Map([[row().message_id, [row()]]]) });
    await expect(replayLegacyInboundAttachments(store, {
      messageIds: [row().message_id],
      apply: true,
      reviewedDryRunSha256: "0".repeat(64),
      limit: 25,
      fetchRawMessage: okFetcher,
    })).rejects.toThrow("does not match");
  });

  it("applies with the reviewed dry-run sha256 and records the provenance-bound CAS", async () => {
    const { store, writes } = fakeStore({ byId: new Map([[row().message_id, [row()]]]) });
    const dryRun = await replayLegacyInboundAttachments(store, {
      messageIds: [row().message_id],
      apply: false,
      limit: 25,
      fetchRawMessage: okFetcher,
    });
    const report = await replayLegacyInboundAttachments(store, {
      messageIds: [row().message_id],
      apply: true,
      reviewedDryRunSha256: dryRun.result_sha256,
      limit: 25,
      fetchRawMessage: okFetcher,
    });
    expect(report.mode).toBe("apply");
    expect(report.items[0]?.status).toBe("replayed");
    expect(writes).toHaveLength(1);
    expect(writes[0]).toMatchObject({ tenantId: "tenant-a", messageId: row().message_id });
    expect(JSON.stringify(report.items)).not.toContain("content_base64");
  });

  it("reports concurrent_change when the CAS fails", async () => {
    const { store } = fakeStore({
      byId: new Map([[row().message_id, [row()]]]),
      replaceResult: false,
    });
    const dryRun = await replayLegacyInboundAttachments(store, {
      messageIds: [row().message_id],
      apply: false,
      limit: 25,
      fetchRawMessage: okFetcher,
    });
    const report = await replayLegacyInboundAttachments(store, {
      messageIds: [row().message_id],
      apply: true,
      reviewedDryRunSha256: dryRun.result_sha256,
      limit: 25,
      fetchRawMessage: okFetcher,
    });
    expect(report.items[0]?.status).toBe("concurrent_change");
  });

  it("bounds processing to --limit", async () => {
    const ids = Array.from({ length: 5 }, (_, i) => `legacy-inbound:00000000-0000-0000-0000-00000000000${i + 1}`);
    const byId = new Map<string, LegacyInboundPayloadRow[]>();
    for (const id of ids) byId.set(id, [row({ message_id: id })]);
    const { store } = fakeStore({ byId });
    const report = await replayLegacyInboundAttachments(store, {
      messageIds: ids,
      apply: false,
      limit: 2,
      fetchRawMessage: okFetcher,
    });
    expect(report.items).toHaveLength(2);
  });

  it("rejects an out-of-range replay limit", async () => {
    const { store } = fakeStore({ byId: new Map() });
    await expect(replayLegacyInboundAttachments(store, {
      messageIds: ["a"],
      apply: false,
      limit: MAX_GMAIL_RECOVERY_REPLAY_MESSAGES + 1,
      fetchRawMessage: okFetcher,
    })).rejects.toThrow("between 1 and 200");
  });
});

describe("gmailRecoveryReplaySucceeded / finalize", () => {
  it("accepts a fully would_replay dry-run and rejects a partial one", () => {
    const good = {
      mode: "dry-run" as const,
      limit: 1,
      result_sha256: "0".repeat(64),
      items: [{ tenant_id: "t", message_id: "m", status: "would_replay" as const, attachments: 1 }],
    };
    expect(gmailRecoveryReplaySucceeded(good)).toBe(true);
    expect(() => finalizeGmailRecoveryReplay(good, () => {})).not.toThrow();
    const partial = {
      ...good,
      items: [
        { tenant_id: "t", message_id: "m", status: "would_replay" as const, attachments: 1 },
        { tenant_id: "t", message_id: "m2", status: "history_id_only" as const, attachments: 1 },
      ],
    };
    expect(gmailRecoveryReplaySucceeded(partial)).toBe(false);
    expect(() => finalizeGmailRecoveryReplay(partial, () => {})).toThrow("did not complete successfully");
  });

  it("redacts payload bytes from the report", () => {
    const report = {
      mode: "dry-run" as const,
      limit: 1,
      result_sha256: "0".repeat(64),
      items: [{ tenant_id: "t", message_id: "m", status: "would_replay" as const, attachments: 1 }],
    };
    const json = JSON.stringify(finalizeGmailRecoveryReplay(report, () => {}));
    expect(json).not.toContain("content_base64");
    expect(json).not.toContain("hello");
  });

  it("uses the gmail source bucket constant for provenance", () => {
    expect(GMAIL_SOURCE_BUCKET).toBe("gmail");
  });
});
