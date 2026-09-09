import { describe, expect, it } from "bun:test";
import { executeIngestBatch, ingestBindings, type IngestBinding, type IngestCloud } from "./ingest-api.js";
import type { EmailsSelfHostedStore, TenantScopedStore, MessageInput } from "./store.js";

const binding: IngestBinding = { tenant_id: "tenant-a", source_id: "source-a", bucket: "fixture-mail", prefix: "inbound/example.com/", domain: "example.com", region: "us-east-1", provider_id: "provider-a", queue_url: "https://sqs.us-east-1.amazonaws.com/123456789012/mail-a" };
const env = { EMAILS_INGEST_BINDINGS: JSON.stringify([binding]) };
function event(keys: string[]) { return JSON.stringify({ Records: keys.map(key => ({ s3: { bucket: { name: binding.bucket }, object: { key } } })) }); }
function fixture() {
  const writes: MessageInput[] = [], fetched: string[] = [], acknowledgements: string[] = [], signals: AbortSignal[] = [];
  let updates = 0;
  const scoped = {
    getResource: async (_spec: unknown, id: string) => id === binding.source_id ? { type: "ses_s3", status: "active" } : id === binding.provider_id ? { type: "ses" } : null,
    updateResource: async () => { updates++; },
    findMessageIdByKey: async () => null,
    getInboundSourceProvenance: async () => null,
    createInboundMessageWithProvenance: async (input: MessageInput) => { writes.push(input); return { record: { ...input, id: `row-${writes.length}` }, inserted: true, provenance: "recorded" }; },
  } as unknown as TenantScopedStore;
  scoped.withInboundPersistenceFence = () => scoped as any;
  const store = {
    resolveInboundRecipients: async (recipients: string[]) => ({ groups: recipients.map(recipient => ({ tenantId: recipient.endsWith("@example.com") ? "tenant-a" : "tenant-b", recipients: [recipient] })), unresolved: [] }),
  } as unknown as EmailsSelfHostedStore;
  const cloud: IngestCloud = {
    list: async () => ({ keys: [binding.prefix + "one"], next: "next-page" }),
    fetch: async key => { fetched.push(key); return Buffer.from("From: sender@external.test\r\nTo: untrusted@other.test\r\nSubject: Fixture\r\nMessage-ID: <fixture@example.test>\r\n\r\nhello\r\n"); },
    receive: async () => [{ body: event([binding.prefix + "one", binding.prefix + "two"]), receipt: "receipt" }],
    acknowledge: async receipt => { acknowledgements.push(receipt); },
    queueState: async () => ({ visible: 0, in_flight: 0 }), close: () => {},
  };
  const run = (operation: "sync-s3" | "watch", input = {}) => executeIngestBatch(store, scoped, "tenant-a", operation, input, env, (_binding, signal) => { signals.push(signal); return cloud; });
  return { run, cloud, writes, fetched, acknowledgements, signals, scoped, store, updates: () => updates };
}
describe("tenant-bound inbox ingestion", () => {
  it("imports S3 objects using server routing and provider provenance, with continuation", async () => {
    const f = fixture(); const report = await f.run("sync-s3");
    expect(report.ok).toBe(true); expect(report.sources[0]).toMatchObject({ ingested: 1, scanned: 1, complete: false, next_cursor: "next-page" });
    expect(f.writes[0]!.provider_id).toBe("provider-a"); expect(f.writes[0]!.to_addrs).toEqual(["catchall@example.com"]);
    expect(f.updates()).toBe(1);
  });
  it("processes every S3 record before acknowledging its queue message", async () => {
    const f = fixture(); const report = await f.run("watch");
    expect(report.sources[0]).toMatchObject({ ingested: 2, acknowledged: 1, notifications: 1, queue_drained: true });
    expect(f.writes).toHaveLength(2); expect(f.acknowledgements).toEqual(["receipt"]);
  });
  it("does not acknowledge partial failures, and never fetches outside the bound prefix", async () => {
    const f = fixture(); f.cloud.receive = async () => [{ body: event([binding.prefix + "one", "other/private"]), receipt: "receipt" }];
    expect((await f.run("watch")).sources[0]).toMatchObject({ ingested: 1, error: 1, acknowledged: 0 });
    expect(f.fetched).toEqual([binding.prefix + "one"]); expect(f.acknowledgements).toEqual([]); expect(f.updates()).toBe(0);
  });
  it("retains the starting cursor after a partial S3 page", async () => {
    const f = fixture(); f.cloud.list = async () => ({ keys: [binding.prefix + "one", "outside/"], next: "unsafe-to-skip-to" });
    const report = await f.run("sync-s3", { cursor: "page-start" });
    expect(report.sources[0]).toMatchObject({ ingested: 1, error: 1, next_cursor: "page-start", complete: false });
  });
  it("retains a resumed page cursor when listing fails before returning any keys", async () => {
    const f = fixture();
    f.cloud.list = async () => { throw new Error("temporary listing failure"); };
    const report = await f.run("sync-s3", { cursor: "resume-page" });
    expect(report.ok).toBe(false);
    expect(report.sources[0]).toMatchObject({ scanned: 0, error: 1, next_cursor: "resume-page", complete: false, retry_from_start: false });
    expect(f.writes).toEqual([]);
    expect(f.updates()).toBe(0);
  });
  it("rejects mixed-tenant SES envelopes before fetching or storing MIME", async () => {
    const f = fixture(); f.cloud.receive = async () => [{ receipt: "receipt", body: JSON.stringify({ notificationType: "Received", mail: { messageId: "one" }, receipt: { recipients: ["ok@example.com", "foreign@other.test"], action: { type: "S3", bucketName: binding.bucket, objectKey: binding.prefix + "one" } } }) }];
    const report = await f.run("watch"); expect(report.ok).toBe(false); expect(f.fetched).toEqual([]); expect(f.writes).toEqual([]); expect(f.acknowledgements).toEqual([]);
  });
  it("reports missing receipts and unknown queue state honestly", async () => {
    const f = fixture(); f.cloud.receive = async () => [{ body: event([binding.prefix + "one"]) }]; f.cloud.queueState = async () => ({ visible: null, in_flight: null });
    expect((await f.run("watch")).sources[0]).toMatchObject({ error: 1, acknowledged: 0, complete: false, queue: { visible: null, in_flight: null }, queue_drained: false });
  });
  it("keeps cloud errors redacted and does not advance successful sync metadata", async () => {
    const f = fixture(); f.cloud.list = async () => { throw new Error("private credentials error"); };
    const report = await f.run("sync-s3"); expect(report.ok).toBe(false); expect(JSON.stringify(report)).not.toContain("private"); expect(f.updates()).toBe(0);
  });
  it("honors a disabled live-sync preference without polling the queue", async () => {
    const f = fixture(); f.scoped.getResource = async () => ({ type: "ses_s3", status: "active", settings_json: { live_sync_enabled: false } });
    await expect(f.run("watch")).rejects.toThrow("Live sync is disabled");
    expect(f.signals).toHaveLength(0);
    expect((await f.run("sync-s3")).ok).toBe(true);
  });
  it("validates configuration selectors before any cloud call", async () => {
    for (const input of [{ bucket: "another-mail" }, { region: "eu-west-1" }, { provider_id: "foreign" }, { profile: "local" }, { prefix: "elsewhere/" }, { source_id: "foreign" }]) {
      const f = fixture(); await expect(f.run("sync-s3", input)).rejects.toThrow(); expect(f.signals).toHaveLength(0);
    }
  });
  it("prevalidates all queues and shares a single total request deadline", async () => {
    const f = fixture(); const other = { ...binding, source_id: "source-b", prefix: "inbound/second/", queue_url: binding.queue_url + "-b" };
    f.scoped.getResource = async () => ({ type: "ses_s3", status: "active" });
    f.cloud.receive = async () => [];
    const signals: AbortSignal[] = [];
    await executeIngestBatch(f.store, f.scoped, "tenant-a", "watch", { all_buckets: true }, { EMAILS_INGEST_BINDINGS: JSON.stringify([binding, other]) }, (_b, signal) => { signals.push(signal); return f.cloud; });
    expect(signals).toHaveLength(2); expect(signals[0]).toBe(signals[1]);
  });
  it("rejects overlapping tenant prefixes and shared queues", () => {
    for (const other of [{ ...binding, tenant_id: "tenant-b" }, { ...binding, tenant_id: "tenant-b", prefix: "another/" }]) expect(() => ingestBindings({ EMAILS_INGEST_BINDINGS: JSON.stringify([binding, other]) })).toThrow();
  });
});

it("propagates the parent deadline to actual S3 I/O and stops the page after cancellation", async () => {
  const f = fixture(), controller = new AbortController();
  let cloudSignal: AbortSignal | undefined;
  f.cloud.list = async () => {
    controller.abort(new DOMException("fixture interrupted", "AbortError"));
    return { keys: [binding.prefix + "one"] };
  };
  const report = await executeIngestBatch(f.store, f.scoped, "tenant-a", "sync-s3", {}, env, (_binding, signal) => { cloudSignal = signal; return f.cloud; }, controller.signal);
  expect(cloudSignal?.aborted).toBe(true);
  expect(report.ok).toBe(false);
  expect(f.fetched).toEqual([]);
  expect(f.writes).toEqual([]);
  expect(f.updates()).toBe(0);
});
it("refuses an already cancelled parent before opening a cloud adapter", async () => {
  const f = fixture(), controller = new AbortController();
  controller.abort(new DOMException("fixture interrupted", "AbortError"));
  let opened = false;
  await expect(executeIngestBatch(f.store, f.scoped, "tenant-a", "sync-s3", {}, env, () => { opened = true; return f.cloud; }, controller.signal)).rejects.toThrow();
  expect(opened).toBe(false);
});
