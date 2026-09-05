/**
 * Receipt honesty for the SQLite-store SES webhook mount (bug d4e956ce).
 *
 * receivers.ts documents the ledger invariant: the receipt is recorded ONLY
 * after the persistence side effect succeeded. `syncS3Inbox` swallows every
 * per-object and listing failure into `result.errors` and returns
 * `{ synced: 0 }` without throwing — so this mount must treat a sync result
 * that carries errors as a FAILED ingest: no receipt, non-acknowledging
 * outcome, and every SNS redelivery re-attempts the ingest instead of being
 * answered "duplicate". Otherwise mail notified during an outage (e.g. the
 * 07-28 AccessDenied freeze) is permanently receipted with zero rows stored.
 */
import { afterEach, beforeEach, describe, it, expect } from "bun:test";
import { EventsClient, type EmitOptions, type EmitResult, type EventInput } from "@hasna/events";
import { lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { handleInboundWebhook } from "./inbound-webhook.js";
import { setConfigValue } from "../../lib/config.js";
import { closeDatabase, getDatabase, type Database } from "../../db/database.js";
import { getWebhookReceipt } from "../../db/webhook-receipts.local.js";

let INHERITED_PROCESS_ENV: NodeJS.ProcessEnv;
function captureInheritedProcessEnv(): void {
  INHERITED_PROCESS_ENV = { ...process.env };
}
function restoreInheritedProcessEnv(): void {
  for (const key of Object.keys(process.env)) {
    if (!Object.prototype.hasOwnProperty.call(INHERITED_PROCESS_ENV, key)) delete process.env[key];
  }
  Object.assign(process.env, INHERITED_PROCESS_ENV);
}

const TOPIC_ARN = "arn:aws:sns:us-east-1:123456789012:emails-inbound";
let snsSequence = 0;
let root: string;
let serverConfig: string;
let clientRoots: string[];
let db: Database;
let emitDescriptor: PropertyDescriptor;
let emissions: Promise<unknown>[];
let eventDirectoryObstructed: boolean;
const EVENT_OBSTRUCTION = "synthetic fixture event-directory obstruction\n";

function safeEmissionErrorCode(reason: unknown): string {
  const code = reason && typeof reason === "object" && "code" in reason ? reason.code : undefined;
  return typeof code === "string" && /^[A-Z][A-Z0-9_]{0,31}$/.test(code) ? code : "CODE_UNAVAILABLE";
}

// Observe, never replace, real emission: retain this, arguments, promise identity,
// results and rejection. The handler deliberately does not await this side effect.
function observeEmissions(): void {
  emitDescriptor = Object.getOwnPropertyDescriptor(EventsClient.prototype, "emit")!;
  const originalEmit = EventsClient.prototype.emit;
  emissions = [];
  EventsClient.prototype.emit = function <TData extends Record<string, unknown>>(
    this: EventsClient,
    ...args: [input: EventInput<TData>, options?: EmitOptions]
  ): Promise<EmitResult<TData>> {
    const promise = Reflect.apply(originalEmit, this, args) as Promise<EmitResult<TData>>;
    emissions.push(promise);
    const emission = emissions.length;
    // Log every rejection safely, including one that precedes a lifetime timeout.
    // This is observation, not an allowed-error list or a successful emission.
    void promise.catch(reason => console.info("Legacy receipt fixture event rejection:",
      JSON.stringify({ emission, code: safeEmissionErrorCode(reason) })));
    return promise;
  };
}

async function settleEmissions(): Promise<PromiseSettledResult<unknown>[]> {
  const pending = [...emissions];
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const results = await Promise.race([
      Promise.allSettled(pending),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("Real fixture event emission did not settle")), 2_000);
      }),
    ]);
    // No detached, newly observed emission may escape this lifetime boundary.
    expect(emissions).toHaveLength(pending.length);
    return results;
  } finally {
    clearTimeout(timer);
  }
}

beforeEach(() => {
  captureInheritedProcessEnv();
  root = mkdtempSync(join(tmpdir(), "emails-inbound-receipt-"));
  const stateEnv: NodeJS.ProcessEnv = {};
  clientRoots = [];
  for (const [key, name] of Object.entries({ HOME: "home", XDG_CONFIG_HOME: "config",
    XDG_DATA_HOME: "data", XDG_STATE_HOME: "state", XDG_CACHE_HOME: "cache", HASNA_EMAILS_HOME: "app" })) {
    const path = join(root, name);
    mkdirSync(path, { mode: 0o700 });
    stateEnv[key] = path;
    clientRoots.push(path);
  }
  // Deliberate legacy SERVER config/event scratch, not canonical client state.
  serverConfig = join(root, "legacy-server");
  eventDirectoryObstructed = false;
  for (const path of [serverConfig, join(root, "tmp"), join(root, "compiler")]) mkdirSync(path, { mode: 0o700 });
  for (const key of Object.keys(process.env)) delete process.env[key];
  Object.assign(process.env, stateEnv, {
    HASNA_EMAILS_HOME: serverConfig,
    PATH: `${dirname(process.execPath)}:/usr/bin:/bin:/usr/sbin:/sbin`,
    TMPDIR: join(root, "tmp"), BUN_RUNTIME_TRANSPILER_CACHE_PATH: join(root, "compiler"),
    EMAILS_DB_PATH: ":memory:", EMAILS_SNS_TOPIC_ARNS: TOPIC_ARN, EMAILS_AWS_ACCOUNT_IDS: "123456789012",
    AWS_EC2_METADATA_DISABLED: "true", NO_COLOR: "1", TZ: "UTC",
    GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1",
  });
  observeEmissions();
  closeDatabase();
  db = getDatabase(":memory:");
});

afterEach(async () => {
  let settled = false;
  try {
    const results = await settleEmissions();
    settled = true;
    console.info("Legacy receipt fixture event settlements:", JSON.stringify(results.map((result, index) => ({
      emission: index + 1, status: result.status,
      ...(result.status === "rejected" ? { code: safeEmissionErrorCode(result.reason) } : {}),
    }))));
    for (const path of clientRoots) expect(readdirSync(path)).toEqual([]);
    expect(readdirSync(serverConfig, { recursive: true }).map(String).sort()).toEqual(eventDirectoryObstructed
      ? ["config.json", "events"] : [
      "config.json", "events", "events/channels.json", "events/deliveries.json", "events/events.json",
    ]);
    for (const path of [serverConfig, ...(eventDirectoryObstructed ? [] : [join(serverConfig, "events")])]) {
      expect(lstatSync(path).isDirectory()).toBe(true);
      expect(lstatSync(path).mode & 0o777).toBe(0o700);
    }
    for (const name of ["config.json", ...(eventDirectoryObstructed
      ? ["events"] : ["events/channels.json", "events/deliveries.json", "events/events.json"])]) {
      const stat = lstatSync(join(serverConfig, name));
      expect(stat.isFile()).toBe(true);
      expect(stat.mode & 0o777).toBe(0o600);
    }
    expect(JSON.parse(readFileSync(join(serverConfig, "config.json"), "utf8"))).toEqual({});
    if (eventDirectoryObstructed) {
      // This one intentional negative fixture cannot initialize an event store.
      expect(readFileSync(join(serverConfig, "events"), "utf8")).toBe(EVENT_OBSTRUCTION);
      return;
    }
    expect(JSON.parse(readFileSync(join(serverConfig, "events/channels.json"), "utf8"))).toEqual([]);
    expect(JSON.parse(readFileSync(join(serverConfig, "events/deliveries.json"), "utf8"))).toEqual([]);
    const events = JSON.parse(readFileSync(join(serverConfig, "events/events.json"), "utf8")) as Array<{
      source: string; type: string; data: { bucket: string; prefix: string; object_key: string };
    }>;
    // Concurrent best-effort JSON emission promises no durable row count/dedupe.
    // Corrupt JSON, unexpected paths/modes, or invalid actual rows still fail.
    expect(Array.isArray(events)).toBe(true);
    for (const event of events) {
      expect(event.source).toBe("emails");
      expect(event.type).toBe("emails.inbound.sync.requested");
      expect(event.data.bucket).toBe("configured-inbound");
      expect(event.data.prefix).toBe("inbound/");
      expect(event.data.object_key).toBe("inbound/acme.com/msg-h");
    }
  } finally {
    try {
      Object.defineProperty(EventsClient.prototype, "emit", emitDescriptor);
      closeDatabase();
    } finally {
      restoreInheritedProcessEnv();
      // A timeout keeps its private scratch intact; never delete under active IO.
      if (settled) rmSync(root, { recursive: true, force: true });
    }
  }
});

const sesNotification = JSON.stringify({
  notificationType: "Received",
  mail: { messageId: "msg-h", destination: ["ops@acme.com"] },
  receipt: { recipients: ["ops@acme.com"], action: { type: "S3", bucketName: "acme-inbound", objectKey: "inbound/acme.com/msg-h" } },
});

function post(body: unknown): Request {
  return new Request("http://x/webhook/ses-inbound", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function sns(body: Record<string, unknown>): Record<string, unknown> {
  return {
    MessageId: `sns-honesty-${++snsSequence}`,
    TopicArn: TOPIC_ARN,
    Signature: "test-signature",
    SignatureVersion: "2",
    SigningCertURL: "https://sns.us-east-1.amazonaws.com/SimpleNotificationService-test.pem",
    Timestamp: new Date().toISOString(),
    ...body,
  };
}

const verified = { verifySns: async () => true };

describe("inbound webhook — swallowed sync errors are a FAILED ingest", () => {
  it("does not receipt a sync that lost every object, so redelivery re-attempts", async () => {
    setConfigValue("inbound_s3_bucket", "configured-inbound");
    setConfigValue("inbound_s3_prefix", "inbound/");
    try {
      const notification = sns({ Type: "Notification", Message: sesNotification });
      let attempts = 0;
      const deps = {
        ...verified,
        sync: async () => {
          attempts++;
          return { synced: 0, errors: ["inbound/acme.com/msg-h: AccessDenied"] };
        },
      };
      // The failure must NOT be 200-acknowledged (that would write the receipt).
      await expect(handleInboundWebhook(post(notification), "/webhook/ses-inbound", "POST", deps))
        .rejects.toThrow(/AccessDenied/);
      // Redelivery of the SAME MessageId must re-run the sync — not answer "duplicate".
      await expect(handleInboundWebhook(post(notification), "/webhook/ses-inbound", "POST", deps))
        .rejects.toThrow(/AccessDenied/);
      expect(attempts).toBe(2);
    } finally {
      setConfigValue("inbound_s3_bucket", undefined);
      setConfigValue("inbound_s3_prefix", undefined);
    }
  });

  it("does not receipt a partially failed ingest either", async () => {
    setConfigValue("inbound_s3_bucket", "configured-inbound");
    setConfigValue("inbound_s3_prefix", "inbound/");
    try {
      const notification = sns({ Type: "Notification", Message: sesNotification });
      let attempts = 0;
      const deps = {
        ...verified,
        sync: async () => {
          attempts++;
          // One object landed, one was lost. Re-ingest is dedup-safe, so the
          // receipt must wait until a run with zero errors.
          return { synced: 1, errors: ["inbound/acme.com/other: read timed out"] };
        },
      };
      await expect(handleInboundWebhook(post(notification), "/webhook/ses-inbound", "POST", deps))
        .rejects.toThrow(/read timed out/);
      await expect(handleInboundWebhook(post(notification), "/webhook/ses-inbound", "POST", deps))
        .rejects.toThrow(/read timed out/);
      expect(attempts).toBe(2);
    } finally {
      setConfigValue("inbound_s3_bucket", undefined);
      setConfigValue("inbound_s3_prefix", undefined);
    }
  });

  it("still acknowledges and receipts a clean sync (errors empty)", async () => {
    setConfigValue("inbound_s3_bucket", "configured-inbound");
    setConfigValue("inbound_s3_prefix", "inbound/");
    try {
      const notification = sns({ Type: "Notification", Message: sesNotification });
      let attempts = 0;
      const deps = {
        ...verified,
        sync: async () => { attempts++; return { synced: 1, errors: [] }; },
      };
      const first = await handleInboundWebhook(post(notification), "/webhook/ses-inbound", "POST", deps);
      expect(first!.status).toBe(200);
      const second = await handleInboundWebhook(post(notification), "/webhook/ses-inbound", "POST", deps);
      expect((await second!.json()).duplicate).toBe(true);
      expect(attempts).toBe(1);
    } finally {
      setConfigValue("inbound_s3_bucket", undefined);
      setConfigValue("inbound_s3_prefix", undefined);
    }
  });

  it("passes the configured bucket and prefix to real ingest, recording only the successful retry", async () => {
    setConfigValue("inbound_s3_bucket", "configured-inbound");
    setConfigValue("inbound_s3_prefix", "inbound/");
    try {
      const notification = sns({ Type: "Notification", Message: sesNotification });
      const eventId = String(notification.MessageId);
      let attempts = 0;
      const deps = { ...verified, sync: async (bucket: string, prefix: string | undefined,
        region: string | undefined, options?: { keys?: string[]; providerId?: string }) => {
        expect({ bucket, prefix, region, options }).toEqual({
          bucket: "configured-inbound", prefix: "inbound/", region: "us-east-1",
          options: { keys: ["inbound/acme.com/msg-h"], providerId: undefined },
        });
        expect(getWebhookReceipt("sns", eventId, db)).toBeNull();
        attempts++;
        return attempts === 1 ? { synced: 1, errors: ["synthetic partial ingest failure"] } : { synced: 1, errors: [] };
      } };
      await expect(handleInboundWebhook(post(notification), "/webhook/ses-inbound", "POST", deps))
        .rejects.toThrow("synthetic partial ingest failure");
      expect(getWebhookReceipt("sns", eventId, db)).toBeNull();
      const response = await handleInboundWebhook(post(notification), "/webhook/ses-inbound", "POST", deps);
      expect(response!.status).toBe(200);
      const receipt = getWebhookReceipt("sns", eventId, db);
      expect(receipt).toMatchObject({ provider: "sns", event_id: eventId, resource_id: "msg-h" });
      expect(receipt!.completed_at).toMatch(/^\d{4}-\d{2}-\d{2} /);
      const duplicate = await handleInboundWebhook(post(notification), "/webhook/ses-inbound", "POST", deps);
      expect((await duplicate!.json()).duplicate).toBe(true);
      expect(attempts).toBe(2);
      expect(getWebhookReceipt("sns", eventId, db)).toEqual(receipt);
      const outcomes = await settleEmissions();
      expect(outcomes).toHaveLength(2);
    } finally {
      setConfigValue("inbound_s3_bucket", undefined);
      setConfigValue("inbound_s3_prefix", undefined);
    }
  });

  it("observes the unchanged real emission promise and rejection without hiding successful ledger writes", async () => {
    setConfigValue("inbound_s3_bucket", "configured-inbound");
    setConfigValue("inbound_s3_prefix", "inbound/");
    try {
      // A real file cannot become an event-store directory: no fake response or
      // mocked store. The observer must return and retain this very rejection.
      const client = new EventsClient({ dataDir: join(serverConfig, "config.json") });
      const promise = client.emit({ source: "emails", type: "fixture.rejection" }, { deliver: false });
      expect(emissions.at(-1)).toBe(promise);
      const failure = await promise.then(() => { throw new Error("Expected real store rejection"); }, error => error);
      expect(failure).toBeInstanceOf(Error);
      expect(String(failure.code)).toMatch(/^(EEXIST|ENOTDIR)$/);
      const observed = await settleEmissions();
      expect(observed).toEqual([{ status: "rejected", reason: failure }]);
      expect(observed[0]!.status).toBe("rejected");
      if (observed[0]!.status !== "rejected") throw new Error("Expected observed real rejection");
      expect(observed[0]!.reason).toBe(failure);
      const notification = sns({ Type: "Notification", Message: sesNotification });
      const response = await handleInboundWebhook(post(notification), "/webhook/ses-inbound", "POST", {
        ...verified, sync: async () => ({ synced: 1, errors: [] }),
      });
      expect(response!.status).toBe(200);
      expect(getWebhookReceipt("sns", String(notification.MessageId), db)?.resource_id).toBe("msg-h");
      // One uncontended real emission must persist its actual returned content.
      const outcomes = await settleEmissions();
      expect(outcomes).toHaveLength(2);
      const successful = outcomes[1]!;
      expect(successful.status).toBe("fulfilled");
      if (successful.status !== "fulfilled") throw successful.reason;
      const result = successful.value as EmitResult;
      expect(result.event).toMatchObject({ source: "emails", type: "emails.inbound.sync.requested",
        data: { bucket: "configured-inbound", prefix: "inbound/", object_key: "inbound/acme.com/msg-h" } });
      expect(result.deliveries).toEqual([]);
      expect(JSON.parse(readFileSync(join(serverConfig, "events/events.json"), "utf8")))
        .toEqual([JSON.parse(JSON.stringify(result.event))]);
    } finally {
      setConfigValue("inbound_s3_bucket", undefined);
      setConfigValue("inbound_s3_prefix", undefined);
    }
  });

  it("keeps actual telemetry failure nonfatal while ingestion records and deduplicates its receipt", async () => {
    setConfigValue("inbound_s3_bucket", "configured-inbound");
    setConfigValue("inbound_s3_prefix", "inbound/");
    writeFileSync(join(serverConfig, "events"), EVENT_OBSTRUCTION, { mode: 0o600 });
    eventDirectoryObstructed = true;
    try {
      const notification = sns({ Type: "Notification", Message: sesNotification });
      const eventId = String(notification.MessageId);
      let attempts = 0;
      const deps = { ...verified, sync: async () => {
        expect(getWebhookReceipt("sns", eventId, db)).toBeNull();
        attempts++;
        return { synced: 1, errors: [] };
      } };
      const response = await handleInboundWebhook(post(notification), "/webhook/ses-inbound", "POST", deps);
      expect(response!.status).toBe(200);
      expect((await response!.json()).synced).toBe(1);
      const receipt = getWebhookReceipt("sns", eventId, db);
      expect(receipt).toMatchObject({ provider: "sns", event_id: eventId, resource_id: "msg-h" });
      const outcomes = await settleEmissions();
      expect(outcomes).toHaveLength(1);
      const failure = outcomes[0]!;
      expect(failure.status).toBe("rejected");
      if (failure.status !== "rejected") throw new Error("Expected obstructed real telemetry to reject");
      expect(safeEmissionErrorCode(failure.reason)).toMatch(/^(EEXIST|ENOTDIR)$/);
      await expect(emissions[0]!).rejects.toBe(failure.reason);
      const duplicate = await handleInboundWebhook(post(notification), "/webhook/ses-inbound", "POST", deps);
      expect((await duplicate!.json()).duplicate).toBe(true);
      expect(attempts).toBe(1);
      expect(emissions).toHaveLength(1);
      expect(getWebhookReceipt("sns", eventId, db)).toEqual(receipt);
    } finally {
      setConfigValue("inbound_s3_bucket", undefined);
      setConfigValue("inbound_s3_prefix", undefined);
    }
  });
});
