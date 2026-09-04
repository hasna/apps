import { describe, it, expect } from "bun:test";
import { createHash } from "node:crypto";
import {
  INGEST_RECEIVE_DEADLINE_MS,
  attachmentRepairResultSucceeded,
  createIngestWorkerStatus,
  deriveKeyPathRecipients,
  evaluateIngestLiveness,
  finalizeInboundProvenanceAudit,
  finalizeAttachmentRepairCanary,
  formatQueueAgeAlarmEvent,
  ingestProgressBody,
  ingestS3Object,
  inboundProvenanceAuditSucceeded,
  parseInboundPrefixDomainMap,
  processInboundNotification,
  redactedInboundProvenanceAuditReport,
  redactedInboundProvenanceFenceReport,
  redactedAttachmentRepairReport,
  parseIngestHealthPort,
  parseIngestProgressStaleMs,
  parseIngestQueueAgeAlarmSeconds,
  parseIngestQueueAgePollSeconds,
  sampleQueueAgeOnce,
  shouldDeleteIngestResult,
  shouldEmitQueueAgeAlarm,
  startIngestProgressHealthServer,
  validateAttachmentRepairCanaryOptions,
  validateInboundProvenanceAuditOptions,
  validateIngestWorkerConfig,
  type IngestDeps,
  type IngestLivenessOptions,
  type IngestWorkerStatus,
} from "./ingest-worker.js";
import type { InboundSourceProvenance, MessageInput, MessageRecord } from "./store.js";

const OBJECT_KEY = "inbound/example.com/msgkey123";
const BUCKET = "emails-inbound-123456789012";

const sesNotification = JSON.stringify({
  notificationType: "Received",
  mail: { messageId: "msgkey123", source: "alice@external.com", timestamp: "2026-07-02T10:00:00.000Z" },
  receipt: {
    recipients: ["andrei@example.com"],
    action: { type: "S3", bucketName: BUCKET, objectKey: OBJECT_KEY },
  },
});

const rawEmail = [
  `From: Alice <alice@external.com>`,
  `To: andrei@example.com`,
  `Subject: Hello there`,
  `Message-ID: <real-rfc-id@external.com>`,
  `Date: Thu, 02 Jul 2026 09:59:00 +0000`,
  ``,
  `body text`,
  ``,
].join("\r\n");

// A raw S3 ObjectCreated event (what the shared inbound plane delivers) — it has
// the object key but NO envelope recipients, unlike an SES "Received" notification.
function s3Event(key: string): string {
  return JSON.stringify({ Records: [{ s3: { bucket: { name: BUCKET }, object: { key } } }] });
}

function makeDeps(overrides: Partial<IngestDeps> & {
  existing?: string | null;
  provenance?: InboundSourceProvenance | null;
} = {}): {
  deps: IngestDeps;
  upserts: MessageInput[];
  fetched: string[];
  quarantines: Array<{ sourceId: string; reason: string; envelopeRecipients: string[] }>;
  provenances: Array<{ messageId: string; bucket: string; objectKey: string; rawSha256: string }>;
} {
  const upserts: MessageInput[] = [];
  const fetched: string[] = [];
  const quarantines: Array<{ sourceId: string; reason: string; envelopeRecipients: string[] }> = [];
  const provenances: Array<{ messageId: string; bucket: string; objectKey: string; rawSha256: string }> = [];
  const deps: IngestDeps = {
    store: {
      resolveInboundRecipients: async (recipients) => ({
        groups: recipients.length > 0 ? [{ tenantId: "tenant-a", recipients }] : [],
        unresolved: recipients.length > 0 ? [] : recipients,
      }),
      quarantineInbound: async (input) => { quarantines.push(input); },
      forTenant: () => ({
        findMessageIdByKey: async () => overrides.existing ?? null,
        getInboundSourceProvenance: async () => overrides.provenance ?? null,
        recordInboundSourceProvenance: async (input) => {
          provenances.push(input);
          return "recorded" as const;
        },
        createInboundMessageWithProvenance: async (input: MessageInput, provenance) => {
          upserts.push(input);
          provenances.push({ messageId: "row-1", ...provenance });
          return {
            record: { id: "row-1", ...input } as unknown as MessageRecord,
            inserted: true,
            provenance: "recorded" as const,
          };
        },
        upsertMessage: async (input: MessageInput) => {
          upserts.push(input);
          return {
            record: { id: "row-1", ...input } as unknown as MessageRecord,
            inserted: true,
          };
        },
      }),
    },
    fetchObject: async (bucket: string, key: string) => {
      fetched.push(`${bucket}/${key}`);
      return Buffer.from(rawEmail);
    },
    now: () => "2026-07-02T12:00:00.000Z",
    ...(overrides.store ? { store: overrides.store } : {}),
    ...(overrides.fetchObject ? { fetchObject: overrides.fetchObject } : {}),
    ...(overrides.prefixDomainMappings
      ? { prefixDomainMappings: overrides.prefixDomainMappings }
      : {}),
  };
  return { deps, upserts, fetched, quarantines, provenances };
}

describe("processInboundNotification", () => {
  it("keeps the database-clock fence report aggregate and identity-free", () => {
    const fenceAt = "2026-07-15T13:00:00.123Z";
    const report = redactedInboundProvenanceFenceReport(fenceAt);
    expect(report).toEqual({ fence_at: fenceAt });
    expect(Object.keys(report)).toEqual(["fence_at"]);
  });

  it("requires all durable worker configuration before startup", () => {
    expect(() => validateIngestWorkerConfig({ bucket: BUCKET, databaseUrl: "postgres://example" })).toThrow(/QUEUE_URL/);
    expect(() => validateIngestWorkerConfig({ queueUrl: "https://sqs.example/q", databaseUrl: "postgres://example" })).toThrow(/S3_BUCKET/);
    expect(() => validateIngestWorkerConfig({ queueUrl: "https://sqs.example/q", bucket: BUCKET })).toThrow(/DATABASE_URL/);
    expect(() => validateIngestWorkerConfig({ queueUrl: "https://sqs.example/q", bucket: BUCKET, databaseUrl: "postgres://example" })).not.toThrow();
  });

  it("deletes only terminal success and duplicate results", () => {
    expect(shouldDeleteIngestResult({ status: "ingested" })).toBe(true);
    expect(shouldDeleteIngestResult({ status: "duplicate" })).toBe(true);
    expect(shouldDeleteIngestResult({ status: "quarantined" })).toBe(true);
    expect(shouldDeleteIngestResult({ status: "error" })).toBe(false);
  });

  it("ingests a new inbound message keyed on the S3 object key", async () => {
    const { deps, upserts, fetched, provenances } = makeDeps();
    const r = await processInboundNotification(deps, sesNotification, BUCKET);

    expect(r.status).toBe("ingested");
    expect(r.key).toBe(OBJECT_KEY);
    expect(fetched).toEqual([`${BUCKET}/${OBJECT_KEY}`]);
    expect(upserts).toHaveLength(1);
    expect(provenances).toHaveLength(1);
    expect(provenances[0]).toMatchObject({
      messageId: "row-1",
      bucket: BUCKET,
      objectKey: OBJECT_KEY,
      rawSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
    });

    const w = upserts[0]!;
    // Dedup identity: both source_id and message_id are the object key so the
    // live drain never duplicates the history backfill (which stored the key in
    // message_id).
    expect(w.source_id).toBe(OBJECT_KEY);
    expect(w.message_id).toBe(OBJECT_KEY);
    expect(w.direction).toBe("inbound");
    expect(w.status).toBe("received");
    expect(w.to_addrs).toEqual(["andrei@example.com"]);
    expect(w.cc_addrs).toEqual([]);
    expect(w.from_addr).toContain("alice@external.com");
    // The Date header wins over the SES timestamp for received_at.
    expect(w.received_at).toBe("2026-07-02T09:59:00.000Z");
    // The real RFC Message-ID is retained in headers, not lost.
    expect(w.headers?.["message-id"]).toContain("real-rfc-id@external.com");
  });

  it("ingests a listed S3 object directly for one-shot backfills", async () => {
    const { deps, upserts, fetched } = makeDeps();
    const r = await ingestS3Object(deps, BUCKET, OBJECT_KEY, { recipients: ["andrei@example.com"] });

    expect(r.status).toBe("ingested");
    expect(fetched).toEqual([`${BUCKET}/${OBJECT_KEY}`]);
    expect(upserts[0]).toMatchObject({
      source_id: OBJECT_KEY,
      message_id: OBJECT_KEY,
      direction: "inbound",
      status: "received",
    });
  });

  it("routes a recipient-less S3 event only through a validated prefix/domain mapping", async () => {
    const { deps, upserts, quarantines } = makeDeps({
      prefixDomainMappings: parseInboundPrefixDomainMap(
        JSON.stringify({ "inbound/": "adweb.com" }),
      ),
    });
    const r = await processInboundNotification(deps, s3Event("inbound/msgkey-1"), BUCKET);

    expect(r.status).toBe("ingested");
    expect(quarantines).toEqual([]);
    expect(upserts).toHaveLength(1);
    // Recipient/tenant came from deployment-owned prefix configuration — NOT
    // the S3 key or MIME To header.
    expect(upserts[0]!.to_addrs).toEqual(["catchall@adweb.com"]);
  });

  it("fails closed for the default inbound/<id> key when no prefix/domain mapping is configured", async () => {
    const { deps, upserts, quarantines } = makeDeps();
    const routeCalls: string[][] = [];
    deps.store.resolveInboundRecipients = async (recipients) => {
      routeCalls.push([...recipients]);
      return { groups: [], unresolved: recipients };
    };

    const r = await processInboundNotification(deps, s3Event("inbound/msgkey-no-map"), BUCKET);

    expect(r).toMatchObject({ status: "quarantined", reason: "no_tenant_route" });
    expect(routeCalls).toEqual([[]]);
    expect(upserts).toEqual([]);
    expect(quarantines).toEqual([
      expect.objectContaining({
        sourceId: "inbound/msgkey-no-map",
        envelopeRecipients: [],
        reason: "no_tenant_route",
      }),
    ]);
  });

  it("does not replace explicit unroutable envelope recipients with a key-path catch-all", async () => {
    const { deps, upserts, quarantines } = makeDeps();
    const routeCalls: string[][] = [];
    deps.store.resolveInboundRecipients = async (recipients) => {
      routeCalls.push([...recipients]);
      if (recipients.length === 1 && recipients[0] === "catchall@adweb.com") {
        return {
          groups: [{ tenantId: "tenant-a", recipients }],
          unresolved: [],
        };
      }
      return { groups: [], unresolved: recipients };
    };
    const explicitEvent = JSON.stringify({
      notificationType: "Received",
      mail: { messageId: "msgkey-explicit" },
      receipt: {
        recipients: ["nobody@unrouted.example"],
        action: {
          type: "S3",
          bucketName: BUCKET,
          objectKey: "inbound/adweb.com/msgkey-explicit",
        },
      },
    });

    const r = await processInboundNotification(deps, explicitEvent, BUCKET);

    expect(r.status).toBe("quarantined");
    expect(r.reason).toBe("no_tenant_route");
    expect(routeCalls).toEqual([["nobody@unrouted.example"]]);
    expect(quarantines).toHaveLength(1);
    expect(quarantines[0]).toMatchObject({
      sourceId: "inbound/adweb.com/msgkey-explicit",
      reason: "no_tenant_route",
      envelopeRecipients: ["nobody@unrouted.example"],
    });
    expect(upserts).toEqual([]);
  });

  it("quarantines a recipient-less S3 event when the configured domain has no route", async () => {
    const { deps, upserts } = makeDeps({
      prefixDomainMappings: parseInboundPrefixDomainMap(
        JSON.stringify({ "inbound/": "no-route.com" }),
      ),
      store: {
        resolveInboundRecipients: async (recipients: string[]) => {
          const matched = recipients.filter((rcpt) => rcpt.endsWith("@adweb.com"));
          return {
            groups: matched.map((rcpt) => ({ tenantId: "tenant-a", recipients: [rcpt] })),
            unresolved: matched.length ? [] : recipients,
          };
        },
        quarantineInbound: async () => {},
        forTenant: () => ({
          findMessageIdByKey: async () => null,
          getInboundSourceProvenance: async () => null,
          recordInboundSourceProvenance: async () => "recorded" as const,
          createInboundMessageWithProvenance: async () => { throw new Error("must not create for an unrouted domain"); },
        }),
      } as unknown as IngestDeps["store"],
    });

    const r = await processInboundNotification(deps, s3Event("inbound/msgkey-2"), BUCKET);
    expect(r.status).toBe("quarantined");
    expect(r.reason).toBe("no_tenant_route");
    expect(upserts).toEqual([]);
  });

  it("quarantines when the object key is outside every configured prefix", async () => {
    const { deps, upserts, quarantines } = makeDeps({
      prefixDomainMappings: parseInboundPrefixDomainMap(
        JSON.stringify({ "trusted/": "adweb.com" }),
      ),
    });
    const r = await processInboundNotification(deps, s3Event("inbound/msgkey-outside-prefix"), BUCKET);
    expect(r.status).toBe("quarantined");
    expect(r.reason).toBe("no_tenant_route");
    expect(upserts).toEqual([]);
    expect(quarantines).toHaveLength(1);
  });

  it("derives a catch-all recipient only from an exact configured prefix/domain mapping", () => {
    const mappings = parseInboundPrefixDomainMap(JSON.stringify({
      "inbound/": "adweb.com",
      "partner/": "partner.example",
    }));
    expect(deriveKeyPathRecipients("inbound/abc123", mappings)).toEqual(["catchall@adweb.com"]);
    expect(deriveKeyPathRecipients("partner/abc123", mappings)).toEqual(["catchall@partner.example"]);
    expect(deriveKeyPathRecipients("other/adweb.com/abc123", mappings)).toEqual([]);
    expect(deriveKeyPathRecipients("inbound/", mappings)).toEqual([]);
    expect(deriveKeyPathRecipients("inbound/abc123", [])).toEqual([]);
  });

  it("rejects malformed, ambiguous, or non-canonical prefix/domain configuration", () => {
    expect(parseInboundPrefixDomainMap(undefined)).toEqual([]);
    expect(() => parseInboundPrefixDomainMap("[]")).toThrow(/JSON object/i);
    expect(() => parseInboundPrefixDomainMap(" ".repeat(16_385))).toThrow(/bounded size/i);
    expect(() => parseInboundPrefixDomainMap(JSON.stringify({ "inbound": "adweb.com" })))
      .toThrow(/prefix/i);
    expect(() => parseInboundPrefixDomainMap(JSON.stringify({ "inbound/\u0001": "adweb.com" })))
      .toThrow(/prefix/i);
    expect(() => parseInboundPrefixDomainMap(JSON.stringify({ "inbound/": "Adweb.COM" })))
      .toThrow(/domain/i);
    expect(() => parseInboundPrefixDomainMap(JSON.stringify({
      "inbound/": "adweb.com",
      "inbound/special/": "special.example",
    }))).toThrow(/overlap|ambiguous/i);
  });

  it("persists a new message and its immutable provenance through one atomic store operation", async () => {
    let atomicCalls = 0;
    const { deps } = makeDeps({
      store: {
        resolveInboundRecipients: async (recipients) => ({
          groups: [{ tenantId: "tenant-a", recipients }],
          unresolved: [],
        }),
        quarantineInbound: async () => {},
        forTenant: () => ({
          findMessageIdByKey: async () => null,
          getInboundSourceProvenance: async () => null,
          recordInboundSourceProvenance: async () => { throw new Error("new-message provenance must be atomic"); },
          upsertMessage: async () => { throw new Error("new-message upsert must not precede provenance"); },
          createInboundMessageWithProvenance: async (input: MessageInput) => {
            atomicCalls++;
            return {
              record: { id: "atomic-row", ...input } as unknown as MessageRecord,
              inserted: true,
              provenance: "recorded" as const,
            };
          },
        }),
      } as unknown as IngestDeps["store"],
    });

    const result = await ingestS3Object(deps, BUCKET, OBJECT_KEY, { recipients: ["andrei@example.com"] });
    expect(result).toMatchObject({ status: "ingested", id: "atomic-row", inserted: true });
    expect(atomicCalls).toBe(1);
  });

  it("bootstraps missing legacy provenance only through the configured ingestion bucket", async () => {
    const { deps, upserts, fetched, provenances } = makeDeps({ existing: "existing-row" });
    const r = await processInboundNotification(deps, sesNotification, BUCKET);
    expect(r.status).toBe("duplicate");
    expect(fetched).toEqual([`${BUCKET}/${OBJECT_KEY}`]);
    expect(upserts).toEqual([]);
    expect(provenances).toHaveLength(1);
    expect(provenances[0]).toMatchObject({
      messageId: "existing-row",
      bucket: BUCKET,
      objectKey: OBJECT_KEY,
      rawSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
  });

  it("fails before fetch when existing provenance names another bucket", async () => {
    const { deps, fetched, upserts, provenances } = makeDeps({
      existing: "existing-row",
      provenance: {
        tenant_id: "tenant-a",
        message_id: "existing-row",
        bucket: "wrong-bucket",
        object_key: OBJECT_KEY,
        raw_sha256: "a".repeat(64),
        established_via: "normal_ingest",
      },
    });
    const result = await processInboundNotification(deps, sesNotification, BUCKET);
    expect(result).toMatchObject({ status: "error", reason: "provenance_conflict" });
    expect(fetched).toEqual([]);
    expect(upserts).toEqual([]);
    expect(provenances).toEqual([]);
    expect(shouldDeleteIngestResult(result)).toBe(false);
  });

  it("fetches and hash-validates an exact existing provenance binding before a terminal duplicate", async () => {
    const rawSha256 = createHash("sha256").update(rawEmail).digest("hex");
    const { deps, fetched, upserts, provenances } = makeDeps({
      existing: "existing-row",
      provenance: {
        tenant_id: "tenant-a",
        message_id: "existing-row",
        bucket: BUCKET,
        object_key: OBJECT_KEY,
        raw_sha256: rawSha256,
        established_via: "normal_ingest",
      },
    });
    const result = await processInboundNotification(deps, sesNotification, BUCKET);
    expect(result).toMatchObject({ status: "duplicate", id: "existing-row", inserted: false });
    expect(fetched).toEqual([`${BUCKET}/${OBJECT_KEY}`]);
    expect(upserts).toEqual([]);
    expect(provenances).toEqual([]);
    expect(shouldDeleteIngestResult(result)).toBe(true);
  });

  it("leaves a fully provenanced duplicate for redelivery when canonical bytes changed", async () => {
    const { deps, fetched, upserts, provenances } = makeDeps({
      existing: "existing-row",
      provenance: {
        tenant_id: "tenant-a",
        message_id: "existing-row",
        bucket: BUCKET,
        object_key: OBJECT_KEY,
        raw_sha256: "a".repeat(64),
        established_via: "normal_ingest",
      },
    });
    const result = await processInboundNotification(deps, sesNotification, BUCKET);
    expect(result).toMatchObject({ status: "error", reason: "provenance_hash_mismatch" });
    expect(fetched).toEqual([`${BUCKET}/${OBJECT_KEY}`]);
    expect(upserts).toEqual([]);
    expect(provenances).toEqual([]);
    expect(shouldDeleteIngestResult(result)).toBe(false);
  });

  it("leaves a fully provenanced duplicate for redelivery when canonical fetch fails", async () => {
    let fetches = 0;
    const { deps, upserts, provenances } = makeDeps({
      existing: "existing-row",
      provenance: {
        tenant_id: "tenant-a",
        message_id: "existing-row",
        bucket: BUCKET,
        object_key: OBJECT_KEY,
        raw_sha256: createHash("sha256").update(rawEmail).digest("hex"),
        established_via: "normal_ingest",
      },
      fetchObject: async () => {
        fetches++;
        throw new Error("AccessDenied");
      },
    });
    const result = await processInboundNotification(deps, sesNotification, BUCKET);
    expect(result).toMatchObject({ status: "error", error: expect.stringContaining("AccessDenied") });
    expect(fetches).toBe(1);
    expect(upserts).toEqual([]);
    expect(provenances).toEqual([]);
    expect(shouldDeleteIngestResult(result)).toBe(false);
  });

  it("routes only from the SES envelope and ignores spoofed MIME recipients", async () => {
    const spoofed = [
      "From: attacker@external.com",
      "To: victim@other-tenant.example",
      "Cc: hidden@other-tenant.example",
      "Subject: spoof",
      "",
      "body",
    ].join("\r\n");
    const { deps, upserts } = makeDeps({ fetchObject: async () => Buffer.from(spoofed) });
    const result = await processInboundNotification(deps, sesNotification, BUCKET);
    expect(result.status).toBe("ingested");
    expect(upserts[0]!.to_addrs).toEqual(["andrei@example.com"]);
    expect(upserts[0]!.cc_addrs).toEqual([]);
  });

  it("splits one object into tenant-scoped writes and deduplicates within each tenant", async () => {
    const writes = new Map<string, MessageInput[]>();
    const { deps, fetched } = makeDeps({
      store: {
        resolveInboundRecipients: async () => ({
          groups: [
            { tenantId: "tenant-a", recipients: ["a@one.example"] },
            { tenantId: "tenant-b", recipients: ["b@two.example"] },
          ],
          unresolved: [],
        }),
        quarantineInbound: async () => {},
        forTenant: (tenantId) => ({
          findMessageIdByKey: async () => null,
          getInboundSourceProvenance: async () => null,
          recordInboundSourceProvenance: async () => "recorded" as const,
          createInboundMessageWithProvenance: async (input) => {
            const rows = writes.get(tenantId) ?? [];
            rows.push(input);
            writes.set(tenantId, rows);
            return {
              record: { id: `${tenantId}-row`, ...input } as unknown as MessageRecord,
              inserted: true,
              provenance: "recorded" as const,
            };
          },
          upsertMessage: async (input) => {
            const rows = writes.get(tenantId) ?? [];
            rows.push(input);
            writes.set(tenantId, rows);
            return { record: { id: `${tenantId}-row`, ...input } as unknown as MessageRecord, inserted: true };
          },
        }),
      },
    });
    const result = await ingestS3Object(deps, BUCKET, OBJECT_KEY, {
      recipients: ["a@one.example", "b@two.example"],
    });
    expect(result).toMatchObject({ status: "ingested", tenant_ids: ["tenant-a", "tenant-b"] });
    expect(fetched).toEqual([`${BUCKET}/${OBJECT_KEY}`]);
    expect(writes.get("tenant-a")?.[0]?.to_addrs).toEqual(["a@one.example"]);
    expect(writes.get("tenant-b")?.[0]?.to_addrs).toEqual(["b@two.example"]);
  });

  it("quarantines an event with no route and never fetches or writes raw mail", async () => {
    const captured: Array<{ sourceId: string; reason: string; envelopeRecipients: string[] }> = [];
    const { deps, fetched, upserts } = makeDeps({
      store: {
        resolveInboundRecipients: async (recipients) => ({ groups: [], unresolved: recipients }),
        quarantineInbound: async (input) => { captured.push(input); },
        forTenant: () => { throw new Error("must not enter a tenant"); },
      },
    });
    const result = await processInboundNotification(deps, sesNotification, BUCKET);
    expect(result).toMatchObject({ status: "quarantined", reason: "no_tenant_route" });
    expect(fetched).toEqual([]);
    expect(upserts).toEqual([]);
    expect(captured).toHaveLength(1);
    expect(captured[0]!.envelopeRecipients).toEqual(["andrei@example.com"]);
  });

  it("leaves notifications with no object key for redrive/DLQ", async () => {
    const { deps } = makeDeps();
    const r = await processInboundNotification(deps, JSON.stringify({ hello: "world" }), BUCKET);
    expect(r.status).toBe("error");
    expect(r.reason).toBe("no_object_key");
    expect(shouldDeleteIngestResult(r)).toBe(false);
  });

  it("does not trust a notification bucket and fails when worker bucket is missing", async () => {
    const { deps, fetched } = makeDeps();
    const r = await processInboundNotification(deps, sesNotification, undefined);
    expect(r).toMatchObject({ status: "error", reason: "no_bucket" });
    expect(fetched).toEqual([]);
    expect(shouldDeleteIngestResult(r)).toBe(false);
  });

  it("falls back to the SES timestamp when the mail has no Date header", async () => {
    const noDate = [`From: a@b.com`, `To: andrei@example.com`, `Subject: x`, ``, `hi`, ``].join("\r\n");
    const { deps, upserts } = makeDeps({ fetchObject: async () => Buffer.from(noDate) });
    const r = await processInboundNotification(deps, sesNotification, BUCKET);
    expect(r.status).toBe("ingested");
    expect(upserts[0]!.received_at).toBe("2026-07-02T10:00:00.000Z"); // mail.timestamp
  });

  it("returns error (leaves message for redelivery) when S3 fetch fails", async () => {
    const { deps } = makeDeps({
      fetchObject: async () => {
        throw new Error("AccessDenied");
      },
    });
    const r = await processInboundNotification(deps, sesNotification, BUCKET);
    expect(r.status).toBe("error");
    expect(r.error).toContain("AccessDenied");
    expect(shouldDeleteIngestResult(r)).toBe(false);
  });
});

describe("attachment repair runner boundary", () => {
  const options = {
    objectKeys: [OBJECT_KEY],
    recipients: ["andrei@example.com"],
    canaryMessageIds: ["message-1"],
  };
  const successful = {
    key: OBJECT_KEY,
    apply: false,
    items: [{ tenant_id: "tenant-a", message_id: "message-1", status: "would_repair" as const, attachments: 1 }],
  };

  it("rejects multiple keys and duplicate normalized IDs but preserves a complete unique same-object message set", () => {
    expect(() => validateAttachmentRepairCanaryOptions({ ...options, objectKeys: ["one", "two"], apply: true }))
      .toThrow(/exactly one --object-key/);
    expect(() => validateAttachmentRepairCanaryOptions({ ...options, objectKeys: ["one", "one"], apply: true }))
      .toThrow(/exactly one --object-key/);
    expect(() => validateAttachmentRepairCanaryOptions({ ...options, canaryMessageIds: ["one", "two", " one "], apply: true }))
      .toThrow(/duplicate.*message-id/i);
    expect(validateAttachmentRepairCanaryOptions({ ...options, canaryMessageIds: ["two", " one "], apply: true }))
      .toEqual({ objectKey: OBJECT_KEY, messageIds: ["two", "one"] });
    expect(() => validateAttachmentRepairCanaryOptions({ ...options, canaryMessageIds: [], apply: true }))
      .toThrow(/at least one --message-id/);
  });

  it("emits item-level redacted output and throws for every non-success result", () => {
    const emitted: string[] = [];
    expect(finalizeAttachmentRepairCanary(successful, (line) => emitted.push(line))).toEqual([successful]);
    const report = JSON.parse(emitted[0]!) as Record<string, unknown>;
    expect(report).not.toHaveProperty("key");
    expect(JSON.stringify(report)).not.toContain(OBJECT_KEY);
    expect(report).toHaveProperty("object_key_sha256");
    expect(report).toHaveProperty("items");

    for (const status of ["not_found", "not_in_canary", "ambiguous_binding", "metadata_mismatch", "concurrent_change", "error"] as const) {
      const failure = { ...successful, items: [{ tenant_id: "tenant-a", status }] };
      expect(attachmentRepairResultSucceeded(failure)).toBe(false);
      expect(() => finalizeAttachmentRepairCanary(failure, () => {})).toThrow(/did not complete/);
    }
  });

  it("server entrypoints reject bucket overrides and multi-key apply with nonzero exits before DB/AWS", () => {
    const run = (extra: string[]) => Bun.spawnSync({
      cmd: [process.execPath, "run", "src/server/index.ts", "attachment-repair-canary", ...extra],
      cwd: process.cwd(),
      env: { ...process.env, EMAILS_DATABASE_URL: "" },
      stdout: "pipe",
      stderr: "pipe",
    });
    const common = ["--message-id", "message-1", "--recipient", "andrei@example.com", "--apply"];
    const multiple = run(["--object-key", "one", "--object-key", "two", ...common]);
    expect(multiple.exitCode).not.toBe(0);
    expect(multiple.stderr.toString()).toContain("exactly one --object-key");
    const bucket = run(["--object-key", "one", "--bucket", "wrong", ...common]);
    expect(bucket.exitCode).not.toBe(0);
    expect(bucket.stderr.toString()).toContain("does not accept --bucket");
    const duplicateIds = run([
      "--object-key", "one",
      "--message-id", "message-1",
      "--message-id", " message-1 ",
      "--recipient", "andrei@example.com",
      "--apply",
    ]);
    expect(duplicateIds.exitCode).not.toBe(0);
    expect(duplicateIds.stderr.toString()).toMatch(/duplicate.*message-id/i);

    for (const command of ["ingest-worker", "ingest-s3-backfill"]) {
      const canonicalOnly = Bun.spawnSync({
        cmd: [process.execPath, "run", "src/server/index.ts", command, "--bucket", "wrong"],
        cwd: process.cwd(),
        env: { ...process.env, EMAILS_DATABASE_URL: "", EMAILS_INGEST_S3_BUCKET: "" },
        stdout: "pipe",
        stderr: "pipe",
      });
      expect(canonicalOnly.exitCode).not.toBe(0);
      expect(canonicalOnly.stderr.toString()).toContain("does not accept --bucket");
    }
  });
});

describe("post-fence inbound provenance audit boundary", () => {
  const clean = {
    since: "2026-07-15T11:00:00.000Z",
    tenants_scanned: 3,
    candidate_messages: 12,
    valid_provenance: 12,
    missing_provenance: 0,
    invalid_provenance: 0,
  };

  it("requires one explicit valid ISO cutoff before any database access", () => {
    expect(validateInboundProvenanceAuditOptions({ since: "2026-07-15T11:00:00Z" }))
      .toEqual({ since: "2026-07-15T11:00:00.000Z" });
    expect(validateInboundProvenanceAuditOptions({ since: "2026-07-15T13:00:00+02:00" }))
      .toEqual({ since: "2026-07-15T11:00:00.000Z" });
    expect(() => validateInboundProvenanceAuditOptions({ since: "" })).toThrow(/--since/);
    expect(() => validateInboundProvenanceAuditOptions({ since: "not-a-date" })).toThrow(/ISO 8601/);
    expect(() => validateInboundProvenanceAuditOptions({ since: "07/15/2026 11:00:00" })).toThrow(/ISO 8601/);
    expect(() => validateInboundProvenanceAuditOptions({ since: "2026-07-15" })).toThrow(/ISO 8601/);
    expect(() => validateInboundProvenanceAuditOptions({ since: "2026-02-30T11:00:00Z" })).toThrow(/ISO 8601/);
    expect(() => validateInboundProvenanceAuditOptions({ since: "2026-07-15T24:00:00Z" })).toThrow(/ISO 8601/);
  });

  it("emits aggregate-only output and fails nonzero semantics for every gap", () => {
    const emitted: string[] = [];
    expect(inboundProvenanceAuditSucceeded(clean)).toBe(true);
    expect(finalizeInboundProvenanceAudit(clean, (line) => emitted.push(line))).toEqual(clean);
    expect(JSON.parse(emitted[0]!)).toEqual({
      status: "pass",
      ...clean,
      gaps: 0,
    });

    const gap = { ...clean, valid_provenance: 10, missing_provenance: 1, invalid_provenance: 1 };
    expect(inboundProvenanceAuditSucceeded(gap)).toBe(false);
    expect(redactedInboundProvenanceAuditReport(gap)).toEqual({
      status: "fail",
      ...gap,
      gaps: 2,
    });
    expect(() => finalizeInboundProvenanceAudit(gap, () => {})).toThrow(/provenance audit found 2 gap/i);
    expect(JSON.stringify(redactedInboundProvenanceAuditReport(gap))).not.toMatch(/tenant-[a-z]|object[_-]?key|message[_-]?id|recipient|subject|content/i);
  });
});

// ── Progress-based liveness (incident 2026-08-31) ─────────────────────────────

describe("ingest worker progress liveness", () => {
  describe("INGEST_RECEIVE_DEADLINE_MS", () => {
    it("bounds the SQS long poll so a dead connection errors instead of hanging", () => {
      expect(INGEST_RECEIVE_DEADLINE_MS).toBeGreaterThanOrEqual(30_000);
      expect(INGEST_RECEIVE_DEADLINE_MS).toBeLessThan(60_000);
    });
  });

  describe("parseIngestHealthPort", () => {
    it("defaults to the documented endpoint port when unset/blank", () => {
      expect(parseIngestHealthPort(undefined)).toBe(9487);
      expect(parseIngestHealthPort("")).toBe(9487);
      expect(parseIngestHealthPort("   ")).toBe(9487);
    });

    it("accepts an explicit port and 0 disables the endpoint", () => {
      expect(parseIngestHealthPort("9001")).toBe(9001);
      expect(parseIngestHealthPort("0")).toBe(0);
    });

    it("fails closed to disabled for non-numeric or out-of-range values", () => {
      expect(parseIngestHealthPort("abc")).toBe(0);
      expect(parseIngestHealthPort("99999")).toBe(0);
      expect(parseIngestHealthPort("-1")).toBe(0);
      expect(parseIngestHealthPort("1.5")).toBe(0);
    });
  });

  describe("parseIngestProgressStaleMs", () => {
    it("defaults to five minutes when unset/blank", () => {
      expect(parseIngestProgressStaleMs(undefined)).toBe(300_000);
      expect(parseIngestProgressStaleMs("")).toBe(300_000);
    });

    it("parses an explicit window and rejects nonsense values back to the default", () => {
      expect(parseIngestProgressStaleMs("60000")).toBe(60_000);
      expect(parseIngestProgressStaleMs("abc")).toBe(300_000);
      expect(parseIngestProgressStaleMs("0")).toBe(300_000);
    });
  });

  describe("startIngestProgressHealthServer", () => {
    it("reports 200 while a receive/ack cycle completed within the stale window", async () => {
      let lastProgressAt = Date.now();
      const health = startIngestProgressHealthServer({
        port: 0,
        staleMs: 60_000,
        lastProgressAt: () => lastProgressAt,
      });
      try {
        const res = await fetch(`${health.url}/ready`);
        expect(res.status).toBe(200);
        expect(await res.text()).toBe("ok");
      } finally {
        health.stop();
      }
    });

    it("reports 503 once the loop stopped completing cycles past the stale window", async () => {
      let lastProgressAt = Date.now() - 120_000;
      const health = startIngestProgressHealthServer({
        port: 0,
        staleMs: 60_000,
        lastProgressAt: () => lastProgressAt,
      });
      try {
        const res = await fetch(`${health.url}/ready`);
        expect(res.status).toBe(503);
        expect(await res.text()).toBe("stale");
      } finally {
        health.stop();
      }
    });

    it("answers only the /ready probe and serves nothing else", async () => {
      const health = startIngestProgressHealthServer({
        port: 0,
        staleMs: 60_000,
        lastProgressAt: () => Date.now(),
      });
      try {
        const res = await fetch(`${health.url}/`);
        expect(res.status).toBe(404);
      } finally {
        health.stop();
      }
    });
  });
});

describe("ingest worker queue-age alarm hook and queue-aware liveness", () => {
  const T0 = 1_752_340_000_000;

  const STALE_MS = 300_000;

  function staleLiveness(queueState?: IngestLivenessOptions["queueState"]): IngestLivenessOptions {
    return {
      staleMs: STALE_MS,
      lastProgressAt: () => T0 - 600_000,
      queueState,
    };
  }

  function freshQueueState(visible: number, sampleAtMs = T0 - 5_000): IngestLivenessOptions["queueState"] {
    return {
      lastSampleAt: () => sampleAtMs,
      visible: () => visible,
      sampleStaleAfterMs: 180_000,
    };
  }

  it("reports starting until the first receive cycle completes", () => {
    const decision = evaluateIngestLiveness({ staleMs: STALE_MS, lastProgressAt: () => 0 }, T0);
    expect(decision.ok).toBe(false);
    expect(decision.reason).toBe("starting");
    expect(decision.progressAgeSeconds).toBeNull();
  });

  it("reports current while the poll loop keeps completing receive cycles", () => {
    const options = {
      staleMs: STALE_MS,
      lastProgressAt: () => T0 - 3_000,
      queueState: freshQueueState(42), // even with work present, fresh progress is healthy
    };
    const decision = evaluateIngestLiveness(options, T0);
    expect(decision.ok).toBe(true);
    expect(decision.reason).toBe("current");
    expect(decision.progressAgeSeconds).toBe(3);
  });

  it("fails progress-only liveness once stale (the milestone /ready contract)", () => {
    const decision = evaluateIngestLiveness({ staleMs: STALE_MS, lastProgressAt: () => T0 - 600_000 }, T0);
    expect(decision.ok).toBe(false);
    expect(decision.reason).toBe("stale");
  });

  it("fails when the poll loop stalls while the queue is non-empty", () => {
    const decision = evaluateIngestLiveness(staleLiveness(freshQueueState(42)), T0);
    expect(decision.ok).toBe(false);
    expect(decision.reason).toBe("stale_with_work");
    expect(decision.progressAgeSeconds).toBe(600);
  });

  it("stays healthy when the loop stalls while the queue is provably empty", () => {
    const decision = evaluateIngestLiveness(staleLiveness(freshQueueState(0)), T0);
    expect(decision.ok).toBe(true);
    expect(decision.reason).toBe("stale_idle");
  });

  it("fails closed when the queue state is unknown or the sample is stale", () => {
    const neverSampled = staleLiveness({ lastSampleAt: () => null, visible: () => null, sampleStaleAfterMs: 180_000 });
    expect(evaluateIngestLiveness(neverSampled, T0).reason).toBe("queue_state_unknown");

    const staleSample = staleLiveness(freshQueueState(3, T0 - 900_000));
    const decision = evaluateIngestLiveness(staleSample, T0);
    expect(decision.ok).toBe(false);
    expect(decision.reason).toBe("queue_state_unknown");
    expect(decision.queueStateAgeSeconds).toBe(900);
  });

  it("exposes progress age through the /health body without credentials", () => {
    const status = createIngestWorkerStatus(T0);
    status.lastCycleMs = T0 - 600_000;
    status.cycles = 12;
    status.counts.ingested = 7;
    status.lastQueueSampleMs = T0 - 5_000;
    status.queueVisible = 42;
    status.oldestMessageAgeSeconds = 600;

    const decision = evaluateIngestLiveness(staleLiveness(freshQueueState(42)), T0);
    const body = ingestProgressBody(
      {
        staleMs: STALE_MS,
        lastProgressAt: () => status.lastCycleMs ?? 0,
        status,
        queueState: {
          lastSampleAt: () => status.lastQueueSampleMs,
          visible: () => status.queueVisible,
          sampleStaleAfterMs: 180_000,
        },
        queueAgeAlarmThresholdSeconds: 900,
      },
      decision,
    );
    expect(body.ok).toBe(false);
    expect(body.service).toBe("ingest-worker");
    expect(body.status).toBe("stale_with_work");
    expect(body.progress).toMatchObject({ last_cycle_age_seconds: 600, cycles: 12, ingested: 7 });
    expect(body.queue).toMatchObject({ visible: 42, oldest_age_seconds: 600 });
    expect(body.thresholds).toEqual({
      liveness_ms: 300_000,
      queue_sample_stale_ms: 180_000,
      queue_age_alarm_seconds: 900,
    });
    expect(JSON.stringify(body)).not.toMatch(/https?:\/\/|arn:|access[_-]?key|secret|token/i);
  });

  it("serves /ready and /health consistently for a wedged and a current worker", async () => {
    const status = createIngestWorkerStatus();
    const health = startIngestProgressHealthServer({
      port: 0,
      staleMs: STALE_MS,
      lastProgressAt: () => status.lastCycleMs ?? 0,
      status,
      queueState: {
        lastSampleAt: () => status.lastQueueSampleMs,
        visible: () => status.queueVisible,
        sampleStaleAfterMs: 180_000,
      },
      queueAgeAlarmThresholdSeconds: 900,
    });
    try {
      // Starting: no cycle yet — /ready 503, /health 503 with starting status.
      const startingReady = await fetch(`${health.url}/ready`);
      expect(startingReady.status).toBe(503);
      const startingHealth = await fetch(`${health.url}/health`);
      expect(startingHealth.status).toBe(503);
      expect(((await startingHealth.json()) as { status: string }).status).toBe("starting");

      // Wedged with work: stale progress + non-empty queue.
      status.lastCycleMs = Date.now() - 600_000;
      status.lastQueueSampleMs = Date.now();
      status.queueVisible = 3;
      const wedgedReady = await fetch(`${health.url}/ready`);
      expect(wedgedReady.status).toBe(503);
      expect(await wedgedReady.text()).toBe("stale");

      // A fresh cycle returns 200 on both endpoints even while work waits.
      status.lastCycleMs = Date.now();
      const currentReady = await fetch(`${health.url}/ready`);
      expect(currentReady.status).toBe(200);
      expect(await currentReady.text()).toBe("ok");
      const currentHealth = await fetch(`${health.url}/health`);
      expect(currentHealth.status).toBe(200);
      const body = (await currentHealth.json()) as { ok: boolean; progress: { last_cycle_age_seconds: number } };
      expect(body.ok).toBe(true);
      expect(body.progress.last_cycle_age_seconds).toBeLessThanOrEqual(3);

      const other = await fetch(`${health.url}/other`);
      expect(other.status).toBe(404);
    } finally {
      health.stop();
    }
  });

  it("emits a queue-age alarm event only when the oldest message crosses the threshold", () => {
    expect(shouldEmitQueueAgeAlarm(null, 900)).toBe(false);
    expect(shouldEmitQueueAgeAlarm(899, 900)).toBe(false);
    expect(shouldEmitQueueAgeAlarm(900, 900)).toBe(true);
    expect(shouldEmitQueueAgeAlarm(2_730, 900)).toBe(true);
    const line = formatQueueAgeAlarmEvent({ ageSeconds: 2_730, thresholdSeconds: 900, visible: 42 });
    expect(line).toContain("[ingest] queue-age-alarm");
    expect(line).toContain("event=queue_age_exceeded");
    expect(line).toContain("age_seconds=2730");
    expect(line).toContain("threshold_seconds=900");
    expect(line).toContain("visible=42");
  });

  it("updates queue state from each sample pass and survives fetch failures", async () => {
    const status = createIngestWorkerStatus(T0);
    const emitted: string[] = [];
    let failNext = false;

    await sampleQueueAgeOnce(
      {
        fetchAttributes: async () => {
          if (failNext) throw new Error("connection reset");
          return {
            ApproximateAgeOfOldestMessage: "340",
            ApproximateNumberOfMessagesVisible: "17",
          };
        },
      },
      status,
      900,
      (line) => emitted.push(line),
      T0 + 1_000,
    );
    expect(status.oldestMessageAgeSeconds).toBe(340);
    expect(status.queueVisible).toBe(17);
    expect(status.lastQueueSampleMs).toBe(T0 + 1_000);
    expect(status.queueSampleFailures).toBe(0);
    expect(emitted).toEqual([]);

    // Crossing the 15-minute threshold emits exactly one alarm event.
    await sampleQueueAgeOnce(
      {
        fetchAttributes: async () => ({
          ApproximateAgeOfOldestMessage: "2000",
          ApproximateNumberOfMessagesVisible: "5",
        }),
      },
      status,
      900,
      (line) => emitted.push(line),
      T0 + 2_000,
    );
    expect(emitted).toHaveLength(1);
    expect(emitted[0]).toContain("age_seconds=2000");

    // A failed fetch is recorded, never thrown, and the last good state stays.
    failNext = true;
    await expect(
      sampleQueueAgeOnce(
        { fetchAttributes: async () => { throw new Error("connection reset"); } },
        status,
        900,
        (line) => emitted.push(line),
        T0 + 3_000,
      ),
    ).resolves.toBeUndefined();
    expect(status.queueSampleFailures).toBe(1);
    expect(status.oldestMessageAgeSeconds).toBe(2000);
    expect(status.queueVisible).toBe(5);
  });

  it("applies sane defaults and falls back to them on garbage queue-age settings", () => {
    expect(parseIngestQueueAgeAlarmSeconds(undefined)).toBe(900);
    expect(parseIngestQueueAgeAlarmSeconds("")).toBe(900);
    expect(parseIngestQueueAgeAlarmSeconds("600")).toBe(600);
    expect(parseIngestQueueAgeAlarmSeconds("soon")).toBe(900);
    expect(parseIngestQueueAgeAlarmSeconds("0")).toBe(900);

    expect(parseIngestQueueAgePollSeconds(undefined)).toBe(60);
    expect(parseIngestQueueAgePollSeconds("")).toBe(60);
    expect(parseIngestQueueAgePollSeconds("120")).toBe(120);
    expect(parseIngestQueueAgePollSeconds("1.5")).toBe(1);
    expect(parseIngestQueueAgePollSeconds("-1")).toBe(60);
  });
});
