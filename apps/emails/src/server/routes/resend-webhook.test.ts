import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { EventsClient, type EmitOptions, type EmitResult, type EventInput } from "@hasna/events";
import { lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { closeDatabase, getDatabase, type Database } from "../../db/database.js";
import { createSqliteEmailStore } from "../../store-sqlite/index.js";
import { listInboundEmails } from "../../db/inbound.local.js";
import { getWebhookReceipt } from "../../db/webhook-receipts.local.js";
import { loadConfig } from "../../lib/config.js";
import { handleResendWebhook } from "./resend-webhook.js";

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

const SECRET = `whsec_${Buffer.from("resend-route-test-secret").toString("base64")}`;

let root: string;
let serverRoot: string;
let clientRoots: string[];
let db: Database;
let providerId: string;
let emitDescriptor: PropertyDescriptor;
let emissions: Promise<unknown>[];

function safeEmissionErrorCode(reason: unknown): string {
  const code = reason && typeof reason === "object" && "code" in reason ? reason.code : undefined;
  return typeof code === "string" && /^[A-Z][A-Z0-9_]{0,31}$/.test(code) ? code : "CODE_UNAVAILABLE";
}

// Observe real best-effort telemetry without replacing its promise or outcome.
function observeEmissions(): void {
  emitDescriptor = Object.getOwnPropertyDescriptor(EventsClient.prototype, "emit")!;
  const originalEmit = EventsClient.prototype.emit;
  emissions = [];
  EventsClient.prototype.emit = function <TData extends Record<string, unknown>>(
    this: EventsClient, ...args: [input: EventInput<TData>, options?: EmitOptions]
  ): Promise<EmitResult<TData>> {
    const promise = Reflect.apply(originalEmit, this, args) as Promise<EmitResult<TData>>;
    emissions.push(promise);
    const emission = emissions.length;
    void promise.catch(reason => console.info("Resend fixture event rejection:",
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
        timer = setTimeout(() => reject(new Error("Real Resend fixture emission did not settle")), 2_000);
      }),
    ]);
    expect(emissions).toHaveLength(pending.length);
    return results;
  } finally {
    clearTimeout(timer);
  }
}

beforeEach(async () => {
  captureInheritedProcessEnv();
  root = mkdtempSync(join(tmpdir(), "emails-resend-fixture-"));
  clientRoots = [];
  const state: NodeJS.ProcessEnv = {};
  for (const [key, name] of Object.entries({ HOME: "home", XDG_CONFIG_HOME: "config", XDG_DATA_HOME: "data",
    XDG_CACHE_HOME: "cache", XDG_STATE_HOME: "state", HASNA_EMAILS_HOME: "app" })) {
    const path = join(root, name);
    mkdirSync(path, { mode: 0o700 });
    state[key] = path;
    clientRoots.push(path);
  }
  serverRoot = join(root, "legacy-server");
  for (const path of [serverRoot, join(root, "tmp"), join(root, "compiler")]) mkdirSync(path, { mode: 0o700 });
  for (const key of Object.keys(process.env)) delete process.env[key];
  Object.assign(process.env, state, {
    // These raw handler adapters own explicit SERVER scratch, never client state.
    HASNA_EMAILS_HOME: serverRoot, EMAILS_DB_PATH: ":memory:", RESEND_WEBHOOK_SECRET: SECRET,
    PATH: `${dirname(process.execPath)}:/usr/bin:/bin`, TMPDIR: join(root, "tmp"),
    BUN_RUNTIME_TRANSPILER_CACHE_PATH: join(root, "compiler"), AWS_EC2_METADATA_DISABLED: "true",
    NO_COLOR: "1", TZ: "UTC", GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1",
  });
  observeEmissions();
  closeDatabase();
  db = getDatabase(":memory:");
  const created = await createSqliteEmailStore({ database: db, detail: "Resend handler metadata fixture" })
    .providers.create({ name: "Resend", type: "resend", region: null, active: true });
  if (!created.ok) throw new Error(`Explicit provider metadata seed failed: ${created.code}`);
  providerId = String(created.value.id);
  expect(loadConfig()).toEqual({});
});
afterEach(async () => {
  let settled = false;
  try {
    const results = await settleEmissions();
    settled = true;
    console.info("Resend fixture event settlements:", JSON.stringify(results.map((result, index) => ({
      emission: index + 1, status: result.status,
      ...(result.status === "rejected" ? { code: safeEmissionErrorCode(result.reason) } : {}),
    }))));
    for (const path of clientRoots) expect(readdirSync(path)).toEqual([]);
    const hasEvents = emissions.length > 0;
    expect(readdirSync(serverRoot, { recursive: true }).map(String).sort()).toEqual(hasEvents
      ? ["events", "events/channels.json", "events/deliveries.json", "events/events.json"]
      : []);
    for (const path of [serverRoot, ...(hasEvents ? [join(serverRoot, "events")] : [])]) {
      expect(lstatSync(path).isDirectory()).toBe(true);
      expect(lstatSync(path).mode & 0o777).toBe(0o700);
    }
    for (const name of hasEvents ? ["events/channels.json", "events/deliveries.json", "events/events.json"] : []) {
      const stat = lstatSync(join(serverRoot, name));
      expect(stat.isFile()).toBe(true);
      expect(stat.mode & 0o777).toBe(0o600);
    }
    if (hasEvents) {
      for (const name of ["channels", "deliveries"]) {
        expect(JSON.parse(readFileSync(join(serverRoot, "events", `${name}.json`), "utf8"))).toEqual([]);
      }
      const events = JSON.parse(readFileSync(join(serverRoot, "events/events.json"), "utf8"));
      expect(Array.isArray(events)).toBe(true);
      for (const event of events) {
        expect(event).toMatchObject({ source: "emails", type: "emails.inbound.received",
          data: { source: "resend", provider_id: providerId } });
        expect(typeof event.data.email_id).toBe("string");
        expect(db.query("SELECT id FROM inbound_emails WHERE id = ?").get(event.data.email_id)).toBeTruthy();
      }
    }
  } finally {
    try {
      Object.defineProperty(EventsClient.prototype, "emit", emitDescriptor);
      closeDatabase();
    } finally {
      restoreInheritedProcessEnv();
      if (settled) rmSync(root, { recursive: true, force: true });
    }
  }
});

async function post(body: unknown, id: string = crypto.randomUUID()): Promise<Request> {
  const raw = JSON.stringify(body);
  const timestamp = String(Math.floor(Date.now() / 1000));
  const key = await crypto.subtle.importKey(
    "raw",
    Buffer.from(SECRET.replace(/^whsec_/, ""), "base64"),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${id}.${timestamp}.${raw}`));
  return new Request("http://x/webhook/resend-inbound", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "svix-id": id,
      "svix-timestamp": timestamp,
      "svix-signature": `v1,${Buffer.from(signature).toString("base64")}`,
    },
    body: raw,
  });
}
const inboundEvent = {
  type: "inbound.email.received",
  created_at: "2026-06-03T10:00:00.000Z",
  data: { email_id: "re_123", from: "alice@ext.com", to: ["ops@mine.com"], subject: "Hello via Resend", text: "hi there", html: "<p>hi there</p>", headers: {} },
};

describe("resend inbound webhook", () => {
  it("returns null for other paths", async () => {
    expect(await handleResendWebhook(new Request("http://x/api/x", { method: "POST" }), "/api/x", "POST")).toBeNull();
  });

  it("rejects oversized bodies before signature processing", async () => {
    const res = (await handleResendWebhook(new Request("http://x/webhook/resend-inbound", {
      method: "POST",
      headers: { "content-length": String(1024 * 1024 + 1) },
      body: "{}",
    }), "/webhook/resend-inbound", "POST"))!;
    expect(res.status).toBe(413);
  });

  it("stores an inbound Resend email", async () => {
    const res = (await handleResendWebhook(await post(inboundEvent), "/webhook/resend-inbound", "POST"))!;
    expect(res.status).toBe(200);
    expect((await res.json()).id).toBeTruthy();
    const inbox = listInboundEmails({}, getDatabase());
    expect(inbox).toHaveLength(1);
    expect(inbox[0]!.subject).toBe("Hello via Resend");
    expect(inbox[0]!.from_address).toBe("alice@ext.com");
  });

  it("ignores non-inbound events", async () => {
    const res = (await handleResendWebhook(await post({ type: "email.sent", data: {} }), "/webhook/resend-inbound", "POST"))!;
    expect((await res.json()).ignored).toBeTruthy();
    expect(listInboundEmails({}, getDatabase())).toHaveLength(0);
  });

  it("rejects a bad signature", async () => {
    const res = (await handleResendWebhook(new Request("http://x/webhook/resend-inbound", {
      method: "POST",
      headers: { "Content-Type": "application/json", "svix-id": "bad", "svix-timestamp": String(Math.floor(Date.now() / 1000)), "svix-signature": "v1,bad" },
      body: JSON.stringify(inboundEvent),
    }), "/webhook/resend-inbound", "POST"))!;
    expect(res.status).toBe(401);
    expect(listInboundEmails({}, getDatabase())).toHaveLength(0);
  });

  it("returns 200 for a duplicate without storing twice", async () => {
    const first = (await handleResendWebhook(await post(inboundEvent, "evt-duplicate"), "/webhook/resend-inbound", "POST"))!;
    const second = (await handleResendWebhook(await post(inboundEvent, "evt-duplicate"), "/webhook/resend-inbound", "POST"))!;
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect((await second.json()).duplicate).toBe(true);
    expect(listInboundEmails({}, getDatabase())).toHaveLength(1);
  });

  it("fails closed when the signature secret is missing", async () => {
    delete process.env["RESEND_WEBHOOK_SECRET"];
    const res = (await handleResendWebhook(await post(inboundEvent), "/webhook/resend-inbound", "POST"))!;
    expect(res.status).toBe(503);
  });

  it("persists real provider, body, receipt and uncontended telemetry values", async () => {
    const eventId = "evt-content-proof";
    const response = (await handleResendWebhook(await post(inboundEvent, eventId), "/webhook/resend-inbound", "POST"))!;
    expect(response.status).toBe(200);
    const body = await response.json() as { id: string };
    const rows = listInboundEmails({}, db);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: body.id, provider_id: providerId,
      message_id: "re_123", from_address: "alice@ext.com", to_addresses: ["ops@mine.com"],
      subject: "Hello via Resend", text_body: "hi there", html_body: "<p>hi there</p>", headers: {} });
    expect(getWebhookReceipt("resend", eventId, db)).toMatchObject({
      provider: "resend", event_id: eventId, resource_id: body.id,
    });
    const outcomes = await settleEmissions();
    expect(outcomes).toHaveLength(1);
    expect(outcomes[0]!.status).toBe("fulfilled");
    if (outcomes[0]!.status !== "fulfilled") throw outcomes[0]!.reason;
    const emitted = outcomes[0]!.value as EmitResult;
    expect(emitted.event).toMatchObject({ source: "emails", type: "emails.inbound.received",
      data: { email_id: body.id, provider_id: providerId, source: "resend" } });
    expect(emitted.deliveries).toEqual([]);
    expect(JSON.parse(readFileSync(join(serverRoot, "events/events.json"), "utf8")))
      .toEqual([JSON.parse(JSON.stringify(emitted.event))]);
  });

  it("rejects tampered signed content and a wrong or missing verifier key without writes", async () => {
    const signed = await post(inboundEvent, "evt-tampered");
    const altered = { ...inboundEvent, data: { ...inboundEvent.data, subject: "tampered content" } };
    const tampered = new Request(signed.url, { method: "POST", headers: signed.headers, body: JSON.stringify(altered) });
    expect((await handleResendWebhook(tampered, "/webhook/resend-inbound", "POST"))!.status).toBe(401);
    process.env["RESEND_WEBHOOK_SECRET"] = `whsec_${Buffer.from("other-resend-fixture-key").toString("base64")}`;
    expect((await handleResendWebhook(await post(inboundEvent, "evt-wrong-key"), "/webhook/resend-inbound", "POST"))!.status).toBe(401);
    delete process.env["RESEND_WEBHOOK_SECRET"];
    expect((await handleResendWebhook(await post(inboundEvent, "evt-no-key"), "/webhook/resend-inbound", "POST"))!.status).toBe(503);
    expect(listInboundEmails({}, db)).toEqual([]);
    for (const id of ["evt-tampered", "evt-wrong-key", "evt-no-key"]) expect(getWebhookReceipt("resend", id, db)).toBeNull();
    expect(emissions).toEqual([]);
  });

  it("keeps the first real row and receipt when a signed duplicate changes its content", async () => {
    const eventId = "evt-changed-duplicate";
    const first = (await handleResendWebhook(await post(inboundEvent, eventId), "/webhook/resend-inbound", "POST"))!;
    expect(first.status).toBe(200);
    const original = listInboundEmails({}, db);
    expect(original).toHaveLength(1);
    const receipt = getWebhookReceipt("resend", eventId, db);
    expect(receipt?.resource_id).toBe(original[0]!.id);
    const changed = { ...inboundEvent, data: { ...inboundEvent.data, subject: "must not overwrite", text: "different body" } };
    const second = (await handleResendWebhook(await post(changed, eventId), "/webhook/resend-inbound", "POST"))!;
    expect(second.status).toBe(200);
    expect(await second.json()).toMatchObject({ duplicate: true, id: original[0]!.id });
    expect(listInboundEmails({}, db)).toEqual(original);
    expect(getWebhookReceipt("resend", eventId, db)).toEqual(receipt);
    expect(emissions).toHaveLength(1);
  });

  it("rolls back the inbound row when receipt insertion fails, then accepts the same signed event", async () => {
    const eventId = "evt-receipt-rollback";
    db.run(`CREATE TRIGGER reject_resend_fixture_receipt BEFORE INSERT ON webhook_receipts
      WHEN NEW.provider = 'resend' BEGIN SELECT RAISE(ABORT, 'synthetic receipt write failure'); END`);
    try {
      await expect(handleResendWebhook(await post(inboundEvent, eventId), "/webhook/resend-inbound", "POST"))
        .rejects.toThrow("synthetic receipt write failure");
      expect(listInboundEmails({}, db)).toEqual([]);
      expect(getWebhookReceipt("resend", eventId, db)).toBeNull();
      expect(emissions).toEqual([]);
    } finally {
      db.run("DROP TRIGGER reject_resend_fixture_receipt");
    }
    const retry = (await handleResendWebhook(await post(inboundEvent, eventId), "/webhook/resend-inbound", "POST"))!;
    expect(retry.status).toBe(200);
    const body = await retry.json() as { id: string };
    expect(listInboundEmails({}, db)).toHaveLength(1);
    expect(getWebhookReceipt("resend", eventId, db)?.resource_id).toBe(body.id);
    expect(emissions).toHaveLength(1);
  });
});
