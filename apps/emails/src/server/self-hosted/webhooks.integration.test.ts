// Provider webhook receivers against a REAL Postgres (EMAILS_TEST_POSTGRES_URL).
//
// The unit suite (webhooks.test.ts) proves the routing, the security order and
// the tenant scoping against an in-memory double. This suite closes the only gap
// that double cannot: that the rows the receivers write are really there, in the
// operator's Postgres, under the real migrated schema and its real constraints —
// including the (tenant_id, provider, event_id) receipt uniqueness and the
// (tenant_id, source_id) message uniqueness the idempotency claims rest on.
//
// Every acceptance assertion is a READ back out of Postgres through the same
// tenant-scoped store `/v1` serves. A 200 from the handler proves nothing here.

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { randomUUID } from "node:crypto";
import { mintApiKey, verifyApiKey } from "@hasna/contracts/auth";
import { createPgPool, createQueryClient, MigrationLedger, type PoolQueryClient } from "../../storage-kit/index.js";
import { emailsSelfHostedMigrations } from "./migrations.js";
import { EmailsSelfHostedStore } from "./store.js";
import { handleSelfHostedRequest, type SelfHostedServiceDeps } from "./service.js";
import { AuthStore } from "./auth/store.js";
import { RateLimiter } from "./auth/rate-limit.js";
import { testAuthEnv } from "./auth/test-support.js";
import type { AuthMailerConfig } from "./auth/mailer.js";
import type { SelfHostedKeyStore } from "./keys.js";
import { resourceSpecForPath } from "./resources.js";

const SIGNING_SECRET = "test-signing-secret-do-not-use-in-prod-0123456789";
const databaseUrl = process.env["EMAILS_TEST_POSTGRES_URL"];
const pgClient: PoolQueryClient | null = databaseUrl
  ? createQueryClient(createPgPool({ connectionString: databaseUrl, env: { PGSSLMODE: "disable" } }))
  : null;

const TOPIC_ARN = "arn:aws:sns:us-east-1:123456789012:emails-inbound";
const BUCKET = "acme-operator-inbound";
const PREFIX = "inbound/";
const RESEND_SECRET = `whsec_${Buffer.from("resend-integration-secret").toString("base64")}`;

const EVENTS_SPEC = resourceSpecForPath("events")!;
const RECEIPTS_SPEC = resourceSpecForPath("webhook-receipts")!;

const stubKeyStore: SelfHostedKeyStore = {
  insertMinted: async () => {},
  list: async () => [],
  revoke: async () => false,
};

const MAILER: AuthMailerConfig = {
  from: "noreply@auth.example",
  verifyUrlBase: "https://app.test/verify",
  resetUrlBase: "https://app.test/reset",
  inviteUrlBase: "https://app.test/invite",
  productName: "Test Emails",
};

function rawEmail(subject: string): string {
  return [
    "From: Alice <alice@external.com>",
    "To: ops@acme-inbound.test",
    `Subject: ${subject}`,
    `Message-ID: <${randomUUID()}@external.com>`,
    "Date: Thu, 02 Jul 2026 09:59:00 +0000",
    "",
    "integration body",
    "",
  ].join("\r\n");
}

function makeDeps(options: {
  objects?: Map<string, string>;
  verifySns?: (body: Record<string, unknown>) => Promise<boolean>;
  resendSecret?: string | undefined;
} = {}): { deps: SelfHostedServiceDeps; fetched: string[] } {
  const fetched: string[] = [];
  const env: NodeJS.ProcessEnv = {
    ...testAuthEnv(),
    EMAILS_SNS_TOPIC_ARNS: TOPIC_ARN,
    EMAILS_AWS_ACCOUNT_IDS: "123456789012",
    EMAILS_INGEST_S3_BUCKET: BUCKET,
    EMAILS_INGEST_S3_PREFIX: PREFIX,
    AWS_REGION: "us-east-1",
  };
  if (options.resendSecret !== undefined) env["RESEND_WEBHOOK_SECRET"] = options.resendSecret;
  const deps: SelfHostedServiceDeps = {
    client: pgClient!,
    store: new EmailsSelfHostedStore(pgClient!),
    verifier: verifyApiKey({ app: "emails", signingSecret: SIGNING_SECRET, keyStatus: async () => "active" }),
    sender: { provider: "ses", send: async () => `mock-${randomUUID()}` },
    migrations: emailsSelfHostedMigrations(),
    version: "test",
    authStore: new AuthStore(pgClient!),
    keyStore: stubKeyStore,
    signingSecret: SIGNING_SECRET,
    rateLimiter: new RateLimiter(),
    mailer: MAILER,
    env,
    webhooks: {
      ...(options.verifySns ? { verifySns: options.verifySns } : {}),
      fetchObject: async (bucket, key) => {
        if (bucket !== BUCKET) throw new Error(`unexpected bucket ${bucket}`);
        const body = options.objects?.get(key);
        if (body === undefined) throw new Error(`no test object at ${key}`);
        return Buffer.from(body, "utf8");
      },
      fetchUrl: async (url: string) => { fetched.push(url); },
    },
  };
  return { deps, fetched };
}

let snsSequence = 0;

function snsEnvelope(overrides: Record<string, unknown>): Record<string, unknown> {
  return {
    MessageId: `sns-int-${randomUUID()}-${++snsSequence}`,
    TopicArn: TOPIC_ARN,
    Signature: "test-signature",
    SignatureVersion: "2",
    SigningCertURL: "https://sns.us-east-1.amazonaws.com/SimpleNotificationService-test.pem",
    Timestamp: new Date().toISOString(),
    ...overrides,
  };
}

function snsPost(body: unknown, path = "/v1/webhooks/ses-inbound"): Request {
  return new Request(`http://svc${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function resendPost(body: unknown, options: { id?: string; secret?: string; signature?: string } = {}): Promise<Request> {
  const raw = JSON.stringify(body);
  const id = options.id ?? randomUUID();
  const timestamp = String(Math.floor(Date.now() / 1000));
  let signature = options.signature;
  if (!signature) {
    const key = await crypto.subtle.importKey(
      "raw",
      Buffer.from((options.secret ?? RESEND_SECRET).replace(/^whsec_/, ""), "base64"),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    const signed = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${id}.${timestamp}.${raw}`));
    signature = `v1,${Buffer.from(signed).toString("base64")}`;
  }
  return new Request("http://svc/v1/webhooks/resend-inbound", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "svix-id": id,
      "svix-timestamp": timestamp,
      "svix-signature": signature,
    },
    body: raw,
  });
}

/** A tenant that owns an inbound domain claim (the only address→tenant map). */
async function makeRoutedTenant(slug: string, domain: string): Promise<string> {
  const tenant = await pgClient!.one<{ id: string }>(
    `INSERT INTO tenants (slug, name) VALUES ($1, $1) RETURNING id`,
    [slug],
  );
  await pgClient!.execute(
    `INSERT INTO inbound_domain_routes (domain, tenant_id) VALUES ($1, $2)`,
    [domain, tenant.id],
  );
  return tenant.id;
}

async function count(table: string, tenantId: string): Promise<number> {
  const row = await pgClient!.one<{ n: string }>(
    `SELECT count(*)::text AS n FROM ${table} WHERE tenant_id = $1`,
    [tenantId],
  );
  return Number(row.n);
}

async function json(response: Response | null): Promise<Record<string, unknown>> {
  expect(response).not.toBeNull();
  return await response!.json() as Record<string, unknown>;
}

const alwaysVerified = async () => true;

// A COLD schema rebuild plus the full migration ledger exceeds bun's DEFAULT 5s hook
// timeout on a loaded machine — measured at ~6s — which fails the whole file with an
// unnamed hook error rather than a test result. Stated explicitly so the suite is
// runnable on its own and not only after another suite has warmed the schema.
const BEFORE_ALL_TIMEOUT_MS = 120_000;

beforeAll(async () => {
  if (!pgClient) return;
  await pgClient.execute("DROP SCHEMA IF EXISTS public CASCADE");
  await pgClient.execute("CREATE SCHEMA public");
  await new MigrationLedger(pgClient, emailsSelfHostedMigrations()).migrate();
}, BEFORE_ALL_TIMEOUT_MS);

afterAll(async () => {
  await pgClient?.close();
});

describe.skipIf(!pgClient)("SES inbound webhook lands in the operator's Postgres", () => {
  it("stores a signed Received notification and reads it back through the tenant store", async () => {
    const domain = "ses-inbound-1.test";
    const tenantId = await makeRoutedTenant("wh-ses-1", domain);
    const key = `${PREFIX}${domain}/msg-1`;
    const objects = new Map([[key, rawEmail("SES integration inbound")]]);
    const { deps } = makeDeps({ objects, verifySns: alwaysVerified });

    const body = await json(await handleSelfHostedRequest(deps, snsPost(snsEnvelope({
      Type: "Notification",
      Message: JSON.stringify({
        notificationType: "Received",
        mail: { messageId: "msg-1", source: "alice@external.com", timestamp: "2026-07-02T10:00:00.000Z" },
        receipt: {
          recipients: [`ops@${domain}`],
          // A forged bucket in the payload must never be used.
          action: { type: "S3", bucketName: "attacker-bucket", objectKey: key },
        },
      }),
    }))));
    expect(body).toMatchObject({ ok: true, synced: 1, object_key: key });

    const scoped = deps.store.forTenant(tenantId);
    const messageId = await scoped.findMessageIdByKey(key);
    expect(messageId).not.toBeNull();
    const message = await scoped.getMessage(messageId!);
    expect(message!.subject).toBe("SES integration inbound");
    expect(message!.direction).toBe("inbound");
    expect(message!.to_addrs).toEqual([`ops@${domain}`]);
    // Provenance is bound to the OPERATOR-configured bucket, not the payload's.
    expect(await scoped.getInboundSourceProvenance(messageId!)).toMatchObject({
      bucket: BUCKET,
      object_key: key,
    });
    // The idempotency receipt is a real, tenant-scoped Postgres row.
    const receipts = await scoped.listResource(RECEIPTS_SPEC, { filters: { provider: "sns" } });
    expect(receipts).toHaveLength(1);
    expect(receipts[0]!["resource_id"]).toBe(messageId);
    expect(await count("messages", tenantId)).toBe(1);
  });

  it("replaying the same SNS MessageId leaves exactly one message and one receipt", async () => {
    const domain = "ses-inbound-2.test";
    const tenantId = await makeRoutedTenant("wh-ses-2", domain);
    const key = `${PREFIX}${domain}/msg-2`;
    const objects = new Map([[key, rawEmail("SES replay")]]);
    const { deps } = makeDeps({ objects, verifySns: alwaysVerified });
    const envelope = snsEnvelope({
      Type: "Notification",
      Message: JSON.stringify({
        notificationType: "Received",
        mail: { messageId: "msg-2" },
        receipt: { recipients: [`ops@${domain}`], action: { objectKey: key } },
      }),
    });

    const first = await json(await handleSelfHostedRequest(deps, snsPost(envelope)));
    const second = await json(await handleSelfHostedRequest(deps, snsPost(envelope)));
    expect(first["synced"]).toBe(1);
    expect(second["duplicate"]).toBe(true);
    expect(await count("messages", tenantId)).toBe(1);
    expect(await count("webhook_receipts", tenantId)).toBe(1);
  });

  it("an invalid SNS signature writes nothing at all", async () => {
    const domain = "ses-inbound-3.test";
    const tenantId = await makeRoutedTenant("wh-ses-3", domain);
    const key = `${PREFIX}${domain}/msg-3`;
    const { deps } = makeDeps({
      objects: new Map([[key, rawEmail("never stored")]]),
      verifySns: async () => false,
    });

    const response = await handleSelfHostedRequest(deps, snsPost(snsEnvelope({
      Type: "Notification",
      Message: JSON.stringify({
        notificationType: "Received",
        mail: { messageId: "msg-3" },
        receipt: { recipients: [`ops@${domain}`], action: { objectKey: key } },
      }),
    })));
    expect(response!.status).toBe(401);
    expect(await count("messages", tenantId)).toBe(0);
    expect(await count("webhook_receipts", tenantId)).toBe(0);
    expect(await count("events", tenantId)).toBe(0);
  });

  it("mail for an unclaimed domain is quarantined and never acknowledged", async () => {
    const key = `${PREFIX}unclaimed.test/msg-4`;
    const { deps } = makeDeps({
      objects: new Map([[key, rawEmail("unroutable")]]),
      verifySns: alwaysVerified,
    });
    const body = await json(await handleSelfHostedRequest(deps, snsPost(snsEnvelope({
      Type: "Notification",
      Message: JSON.stringify({
        notificationType: "Received",
        mail: { messageId: "msg-4" },
        receipt: { recipients: ["ops@unclaimed.test"], action: { objectKey: key } },
      }),
    }))));
    expect(body["ignored"]).toBe("no_tenant_route");
    const quarantined = await pgClient!.one<{ n: string }>(
      `SELECT count(*)::text AS n FROM inbound_quarantine WHERE source_id = $1`,
      [key],
    );
    expect(Number(quarantined.n)).toBe(1);
  });
});

describe.skipIf(!pgClient)("Resend inbound webhook lands in the operator's Postgres", () => {
  it("stores a signed inbound payload and reads it back through the tenant store", async () => {
    const domain = "resend-inbound-1.test";
    const tenantId = await makeRoutedTenant("wh-resend-1", domain);
    const { deps } = makeDeps({ resendSecret: RESEND_SECRET });

    const body = await json(await handleSelfHostedRequest(deps, await resendPost({
      type: "inbound.email.received",
      created_at: "2026-06-03T10:00:00.000Z",
      data: {
        email_id: "re_int_1",
        from: "alice@ext.test",
        to: [`ops@${domain}`],
        subject: "Resend integration inbound",
        text: "hi there",
        html: "<p>hi there</p>",
        headers: {},
      },
    })));
    expect(body["ok"]).toBe(true);

    const scoped = deps.store.forTenant(tenantId);
    const message = await scoped.getMessage(String(body["id"]));
    expect(message).not.toBeNull();
    expect(message!.subject).toBe("Resend integration inbound");
    expect(message!.from_addr).toBe("alice@ext.test");
    expect(message!.direction).toBe("inbound");
    expect(message!.source_id).toBe("resend:re_int_1");
    expect(await count("messages", tenantId)).toBe(1);
    expect(await count("webhook_receipts", tenantId)).toBe(1);
  });

  it("replaying the same svix-id leaves exactly one message", async () => {
    const domain = "resend-inbound-2.test";
    const tenantId = await makeRoutedTenant("wh-resend-2", domain);
    const { deps } = makeDeps({ resendSecret: RESEND_SECRET });
    const payload = {
      type: "inbound.email.received",
      created_at: "2026-06-03T10:00:00.000Z",
      data: { email_id: "re_int_2", from: "alice@ext.test", to: [`ops@${domain}`], subject: "replay", text: "x", headers: {} },
    };

    const first = await json(await handleSelfHostedRequest(deps, await resendPost(payload, { id: "svix-replay" })));
    const second = await json(await handleSelfHostedRequest(deps, await resendPost(payload, { id: "svix-replay" })));
    expect(first["id"]).toBeTruthy();
    expect(second["duplicate"]).toBe(true);
    expect(second["id"]).toBe(first["id"]);
    expect(await count("messages", tenantId)).toBe(1);
    expect(await count("webhook_receipts", tenantId)).toBe(1);
  });

  it("a re-delivery under a NEW svix-id does not mark an already-read message unread", async () => {
    // The receipt ledger dedupes on (provider, event_id), so a provider that re-delivers
    // the same email under a different event id gets past it and reaches the message
    // upsert, which keys on `source_id`. That upsert used to write its whole column set,
    // so the replay reset the read flag, the star and the labels — and the ingest sink
    // made it worse by stating `is_read: false` explicitly, which counts as "given" even
    // under the conditional assignment list. This asserts the local state a reader set
    // survives a re-delivery, which is the property the whole idempotency claim rests on.
    const domain = "resend-inbound-reread.test";
    const tenantId = await makeRoutedTenant("wh-resend-reread", domain);
    const { deps } = makeDeps({ resendSecret: RESEND_SECRET });
    const payload = {
      type: "inbound.email.received",
      created_at: "2026-06-03T10:00:00.000Z",
      data: {
        email_id: "re_int_reread",
        from: "alice@ext.test",
        to: [`ops@${domain}`],
        subject: "first delivery",
        text: "x",
        headers: {},
      },
    };

    const first = await json(await handleSelfHostedRequest(deps, await resendPost(payload, { id: "svix-reread-1" })));
    const messageId = String(first["id"]);
    const scoped = deps.store.forTenant(tenantId);
    await scoped.updateMessageStatus(messageId, { is_read: true, is_starred: true });
    await scoped.updateMessageStatus(messageId, { add_label: "kept" });

    // A DIFFERENT event id, so the receipt ledger does not short-circuit it.
    const second = await json(await handleSelfHostedRequest(deps, await resendPost(payload, { id: "svix-reread-2" })));
    expect(second["id"], "the re-delivery must land on the same message row").toBe(messageId);
    expect(await count("messages", tenantId)).toBe(1);

    const reread = await scoped.getMessage(messageId);
    expect(reread).not.toBeNull();
    expect(reread!.is_read, "a re-delivery must not mark a read message unread").toBe(true);
    expect(reread!.is_starred, "a re-delivery must not clear the star").toBe(true);
    expect(reread!.labels).toContain("kept");
    // ...and the message is still inbound, and still the tenant's.
    expect(reread!.direction).toBe("inbound");
    expect(reread!.source_id).toBe("resend:re_int_reread");
  });

  it("a wrongly-signed payload writes nothing", async () => {
    const domain = "resend-inbound-3.test";
    const tenantId = await makeRoutedTenant("wh-resend-3", domain);
    const { deps } = makeDeps({ resendSecret: RESEND_SECRET });
    const response = await handleSelfHostedRequest(deps, await resendPost({
      type: "inbound.email.received",
      data: { email_id: "re_int_3", from: "a@ext.test", to: [`ops@${domain}`], subject: "nope", text: "x", headers: {} },
    }, { secret: `whsec_${Buffer.from("wrong-secret").toString("base64")}` }));
    expect(response!.status).toBe(401);
    expect(await count("messages", tenantId)).toBe(0);
  });

  it("an unconfigured Resend secret fails CLOSED with 503 and writes nothing", async () => {
    const domain = "resend-inbound-4.test";
    const tenantId = await makeRoutedTenant("wh-resend-4", domain);
    const { deps } = makeDeps({ resendSecret: undefined });
    const response = await handleSelfHostedRequest(deps, await resendPost({
      type: "inbound.email.received",
      data: { email_id: "re_int_4", from: "a@ext.test", to: [`ops@${domain}`], subject: "nope", text: "x", headers: {} },
    }));
    expect(response!.status).toBe(503);
    expect(await count("messages", tenantId)).toBe(0);
  });
});

describe.skipIf(!pgClient)("delivery outcomes land in the operator's Postgres", () => {
  it("a signed SES bounce is persisted in the sending tenant's scope and joined to the send", async () => {
    const domain = "bounce-1.test";
    const tenantId = await makeRoutedTenant("wh-bounce-1", domain);
    const sent = await new EmailsSelfHostedStore(pgClient!).forTenant(tenantId).createMessage({
      from_addr: `noreply@${domain}`,
      to_addrs: ["dead@external.test"],
      direction: "outbound",
      status: "sent",
      message_id: "ses-bounced-1",
      subject: "campaign",
    });

    const { deps } = makeDeps({ verifySns: alwaysVerified });
    const body = await json(await handleSelfHostedRequest(deps, snsPost(snsEnvelope({
      Type: "Notification",
      Message: JSON.stringify({
        notificationType: "Bounce",
        mail: {
          messageId: "ses-bounced-1",
          source: `noreply@${domain}`,
          destination: ["dead@external.test"],
          timestamp: "2026-07-02T11:00:00.000Z",
        },
        bounce: { bounceType: "Permanent", bouncedRecipients: [{ emailAddress: "dead@external.test" }] },
      }),
    }))));
    expect(body).toMatchObject({ ok: true, type: "bounced", message_id: "ses-bounced-1" });

    const events = await deps.store.forTenant(tenantId).listResource(EVENTS_SPEC, { filters: { type: "bounced" } });
    expect(events).toHaveLength(1);
    expect(events[0]!["recipient"]).toBe("dead@external.test");
    // The bounce is joined to the outbound row a suppression pass would act on.
    expect(events[0]!["email_id"]).toBe(sent.id);
    expect(await count("events", tenantId)).toBe(1);
  });

  it("replaying the same bounce leaves exactly one event row", async () => {
    const domain = "bounce-2.test";
    const tenantId = await makeRoutedTenant("wh-bounce-2", domain);
    const { deps } = makeDeps({ verifySns: alwaysVerified });
    const envelope = snsEnvelope({
      Type: "Notification",
      Message: JSON.stringify({
        notificationType: "Complaint",
        mail: {
          messageId: "ses-complained-1",
          source: `noreply@${domain}`,
          destination: ["angry@external.test"],
          timestamp: "2026-07-02T11:00:00.000Z",
        },
        complaint: { complainedRecipients: [{ emailAddress: "angry@external.test" }] },
      }),
    });

    const first = await json(await handleSelfHostedRequest(deps, snsPost(envelope)));
    const second = await json(await handleSelfHostedRequest(deps, snsPost(envelope)));
    expect(first["event_id"]).toBeTruthy();
    expect(second["duplicate"]).toBe(true);
    expect(await count("events", tenantId)).toBe(1);
  });

  it("enforces provider-event uniqueness within a tenant but not across tenants", async () => {
    const tenantA = await makeRoutedTenant("wh-event-unique-a", "event-unique-a.test");
    const tenantB = await makeRoutedTenant("wh-event-unique-b", "event-unique-b.test");
    const providerEventId = `provider-event-${randomUUID()}`;
    const eventBody = {
      provider_event_id: providerEventId,
      type: "delivered",
      occurred_at: "2026-07-02T11:00:00.000Z",
    };

    await new EmailsSelfHostedStore(pgClient!).forTenant(tenantA).createResource(EVENTS_SPEC, eventBody);
    await expect(
      new EmailsSelfHostedStore(pgClient!).forTenant(tenantA).createResource(EVENTS_SPEC, eventBody),
    ).rejects.toThrow();
    await expect(
      new EmailsSelfHostedStore(pgClient!).forTenant(tenantB).createResource(EVENTS_SPEC, eventBody),
    ).resolves.toBeDefined();
  });

  it("a Resend delivery event is persisted in the sending tenant's scope", async () => {
    const domain = "bounce-3.test";
    const tenantId = await makeRoutedTenant("wh-bounce-3", domain);
    const { deps } = makeDeps({ resendSecret: RESEND_SECRET });
    const body = await json(await handleSelfHostedRequest(deps, await resendPost({
      type: "email.bounced",
      data: {
        email_id: "re_bounced_1",
        from: `noreply@${domain}`,
        to: ["dead@external.test"],
        created_at: "2026-07-02T11:00:00.000Z",
      },
    })));
    expect(body).toMatchObject({ ok: true, type: "bounced" });
    expect(await count("events", tenantId)).toBe(1);
  });

  it("a delivery outcome from an unclaimed sending domain writes nothing", async () => {
    const { deps } = makeDeps({ verifySns: alwaysVerified });
    const before = await pgClient!.one<{ n: string }>(`SELECT count(*)::text AS n FROM events`);
    const body = await json(await handleSelfHostedRequest(deps, snsPost(snsEnvelope({
      Type: "Notification",
      Message: JSON.stringify({
        notificationType: "Bounce",
        mail: { messageId: "orphan-1", source: "noreply@unclaimed-sender.test", destination: ["x@external.test"] },
        bounce: { bounceType: "Permanent" },
      }),
    }))));
    expect(body["ignored"]).toBe("no destination scope for delivery notification");
    const after = await pgClient!.one<{ n: string }>(`SELECT count(*)::text AS n FROM events`);
    expect(after.n).toBe(before.n);
  });
});

describe.skipIf(!pgClient)("cross-tenant isolation of the receivers", () => {
  it("one provider event never leaks into another tenant's scope", async () => {
    const domainA = "iso-a.test";
    const domainB = "iso-b.test";
    const tenantA = await makeRoutedTenant("wh-iso-a", domainA);
    const tenantB = await makeRoutedTenant("wh-iso-b", domainB);
    const { deps } = makeDeps({ resendSecret: RESEND_SECRET });

    const body = await json(await handleSelfHostedRequest(deps, await resendPost({
      type: "inbound.email.received",
      created_at: "2026-06-03T10:00:00.000Z",
      data: {
        email_id: "re_iso_1",
        from: "alice@ext.test",
        to: [`ops@${domainA}`],
        subject: "isolation",
        text: "x",
        headers: {},
        // A payload field must never select the tenant.
        tenant_id: tenantB,
      },
    })));

    expect(await deps.store.forTenant(tenantA).getMessage(String(body["id"]))).not.toBeNull();
    expect(await deps.store.forTenant(tenantB).getMessage(String(body["id"]))).toBeNull();
    expect(await count("messages", tenantB)).toBe(0);
    expect(await count("webhook_receipts", tenantB)).toBe(0);
  });
});

describe.skipIf(!pgClient)("authenticated relay persistence", () => {
  it("concurrent inbound receipts preserve the first message, edits and deletion", async () => {
    const tenant = await makeRoutedTenant("relay-inbound", "relay-inbound.test");
    const store = new EmailsSelfHostedStore(pgClient!).forTenant(tenant);
    const provider = await store.createResource(resourceSpecForPath("providers")!, { name: "relay-provider", type: "resend" });
    const providerId = String(provider.id), namespace = `relay:resend:${providerId}`;
    const input = { from_addr: "sender@example.net", to_addrs: ["inbox@relay-inbound.test"], provider_id: providerId, source_id: "relay-source", status: "received", direction: "inbound" as const, body_html: "<p>full</p>", attachments: [{ filename: "fixture.txt", size: 3, content_type: "text/plain", content_base64: "YWJj" }] };
    const replies = await Promise.all(Array.from({ length: 8 }, () => store.createRelayInbound(namespace, "event", input)));
    expect(new Set(replies.map(reply => reply.id)).size).toBe(1);
    expect(await count("messages", tenant)).toBe(1); expect(await count("webhook_receipts", tenant)).toBe(1);
    const id = replies[0]!.id;
    expect((await store.getMessage(id))!.attachments).toMatchObject([{ content_available: true }]);
    expect(await pgClient!.one("SELECT attachments->0->>'content_base64' AS content FROM messages WHERE id=$1", [id])).toEqual({ content: "YWJj" });
    await pgClient!.execute("UPDATE messages SET body_html='User edited' WHERE id=$1", [id]);
    await store.createRelayInbound(namespace, "event", input);
    expect((await store.getMessage(id))!.body_html).toBe("User edited");
    await pgClient!.execute("DELETE FROM messages WHERE id=$1", [id]);
    expect(await store.createRelayInbound(namespace, "event", input)).toMatchObject({ id });
    expect(await count("messages", tenant)).toBe(0);
    await expect(store.createRelayInbound(namespace, "broken", { ...input, received_at: "invalid" })).rejects.toThrow();
    expect(await store.findRelayReceipt(namespace, "broken")).toBeNull();
  });
  it("delivery receipts require the exact tenant/provider message and record once atomically", async () => {
    const tenant = await makeRoutedTenant("relay-delivery", "relay-delivery.test");
    const store = new EmailsSelfHostedStore(pgClient!).forTenant(tenant);
    const provider = await store.createResource(resourceSpecForPath("providers")!, { name: "delivery-provider", type: "resend" });
    const id = String(provider.id), namespace = `relay:resend:${id}`;
    const message = await store.createMessage({ from_addr: "sender@relay-delivery.test", to_addrs: ["recipient@example.com"], direction: "outbound", provider_id: id, provider_message_id: "upstream", status: "sent", send_state: "sent" });
    const event = { email_id: null, type: "delivered", recipient: "recipient@example.com", metadata: {}, occurred_at: new Date().toISOString() };
    await expect(store.createRelayDelivery(namespace, "event", "foreign-provider", "upstream", event)).rejects.toThrow("selected tenant/provider");
    const replies = await Promise.all(Array.from({ length: 8 }, () => store.createRelayDelivery(namespace, "event", id, "upstream", event)));
    expect(new Set(replies.map(reply => reply.id)).size).toBe(1); expect(await count("events", tenant)).toBe(1); expect(await count("webhook_receipts", tenant)).toBe(1);
    const row = await pgClient!.one("SELECT email_id,provider_id FROM events WHERE id=$1", [replies[0]!.id]); expect(row).toEqual({ email_id: message.id, provider_id: id });
  });
});

async function relayRequest(tenant: string, provider: string, kind: "ses" | "resend", body: unknown, id = randomUUID()): Promise<Request> {
  const minted = mintApiKey({ app: "emails", scopes: ["emails:*"], signingSecret: SIGNING_SECRET });
  await pgClient!.execute("INSERT INTO api_key_tenants(kid,tenant_id) VALUES($1,$2)", [minted.kid, tenant]);
  const signed = kind === "resend" ? await resendPost(body, { id }) : snsPost(body);
  return new Request(`http://svc/v1/webhooks/relay/${kind}?provider_id=${provider}`, {
    method: "POST", headers: { "x-api-key": minted.token, "content-type": "application/json" },
    body: JSON.stringify({ raw_body_base64: Buffer.from(await signed.arrayBuffer()).toString("base64"), signature_headers: Object.fromEntries(signed.headers) }),
  });
}

describe.skipIf(!pgClient)("relay authorization and atomic lifecycle regressions", () => {
  it("the actual signed handler accepts send-only outcomes once without any inbound domain route", async () => {
    for (const kind of ["resend", "ses"] as const) {
      const domain = `relay-send-only-${kind}.test`, tenant = await makeRoutedTenant(`relay-send-only-${kind}`, domain);
      await pgClient!.execute("DELETE FROM inbound_domain_routes WHERE tenant_id=$1", [tenant]);
      const { deps } = makeDeps(); const store = deps.store.forTenant(tenant);
      const provider = String((await store.createResource(resourceSpecForPath("providers")!, { name: "send-only", type: kind })).id);
      const message = await store.createMessage({ direction: "outbound", from_addr: `sender@${domain}`, to_addrs: ["recipient@example.net"], provider_id: provider, provider_message_id: "outbound-only", status: "sent", send_state: "sent" });
      deps.env = { ...deps.env, FIXTURE_RELAY_SECRET: RESEND_SECRET, FIXTURE_RECEIVING_KEY: "fixture-only", EMAILS_WEBHOOK_BINDINGS: JSON.stringify([{ tenant_id: tenant, provider_id: provider, type: kind, ...(kind === "resend" ? { secret_env: "FIXTURE_RELAY_SECRET", api_key_env: "FIXTURE_RECEIVING_KEY" } : { topic_arn: TOPIC_ARN }) }]) };
      deps.webhookRelay = { verifySns: alwaysVerified, fetch: async () => { throw new Error("Delivery must not fetch Receiving content"); } };
      const body = kind === "resend" ? { type: "email.delivered", data: { email_id: "outbound-only", from: `sender@${domain}`, to: ["recipient@example.net"] } }
        : snsEnvelope({ Type: "Notification", Message: JSON.stringify({ notificationType: "Delivery", mail: { messageId: "outbound-only", source: `sender@${domain}` }, delivery: { recipients: ["recipient@example.net"], timestamp: new Date().toISOString() } }) });
      const eventId = randomUUID();
      for (let i = 0; i < 2; i++) {
        const result = await handleSelfHostedRequest(deps, await relayRequest(tenant, provider, kind, body, eventId));
        expect(result!.status).toBe(200); expect(await json(result)).toMatchObject({ completed: true });
      }
      expect(await count("events", tenant)).toBe(1); expect(await count("webhook_receipts", tenant)).toBe(1);
      expect(await pgClient!.one("SELECT email_id FROM events WHERE tenant_id=$1", [tenant])).toEqual({ email_id: message.id });
      // An already recorded event still needs a currently owned outbound identity.
      await pgClient!.execute("UPDATE messages SET provider_message_id='other' WHERE id=$1", [message.id]);
      expect((await handleSelfHostedRequest(deps, await relayRequest(tenant, provider, kind, body, eventId)))!.status).toBe(403);
      expect(await count("events", tenant)).toBe(1);
    }
  });
  it("SES persistence accepts a sending-disabled provider but fences route, tenant and receive lifecycle changes", async () => {
    for (const mutation of ["none", "route", "tenant", "source-status", "source-type", "source-provider", "provider-type"] as const) {
      const domain = `relay-fence-${mutation}.test`, tenant = await makeRoutedTenant(`relay-fence-${mutation}`, domain);
      const foreign = await makeRoutedTenant(`relay-foreign-${mutation}`, `foreign-${mutation}.test`);
      const { deps } = makeDeps(); const store = deps.store.forTenant(tenant);
      const provider = String((await store.createResource(resourceSpecForPath("providers")!, { name: "SES receive", type: "ses", active: false })).id);
      const source = String((await store.createResource(resourceSpecForPath("sources")!, { name: "bound", mailbox_id: "inbox", type: "s3", status: "active", provider_id: provider })).id);
      await store.createDomain({ domain });
      deps.env = { ...deps.env, EMAILS_WEBHOOK_BINDINGS: JSON.stringify([{ tenant_id: tenant, provider_id: provider, type: "ses", topic_arn: TOPIC_ARN, source_id: source }]), EMAILS_INGEST_BINDINGS: JSON.stringify([{ tenant_id: tenant, source_id: source, provider_id: provider, domain, bucket: BUCKET, prefix: PREFIX, region: "us-east-1", topic_arn: TOPIC_ARN }]) };
      let fetched = 0;
      deps.webhookRelay = { verifySns: alwaysVerified, fetchObject: async () => {
        fetched++;
        if (mutation === "route") await pgClient!.execute("UPDATE inbound_domain_routes SET tenant_id=$1 WHERE domain=$2", [foreign, domain]);
        if (mutation === "tenant") await pgClient!.execute("UPDATE tenants SET status='suspended' WHERE id=$1", [tenant]);
        if (mutation === "source-status") await pgClient!.execute("UPDATE mailbox_sources SET status='retired' WHERE id=$1", [source]);
        if (mutation === "source-type") await pgClient!.execute("UPDATE mailbox_sources SET type='imap' WHERE id=$1", [source]);
        if (mutation === "source-provider") await pgClient!.execute("UPDATE mailbox_sources SET provider_id='changed' WHERE id=$1", [source]);
        if (mutation === "provider-type") await pgClient!.execute("UPDATE self_hosted_providers SET type='resend' WHERE id=$1", [provider]);
        return Buffer.from(rawEmail("must not persist"));
      } };
      const body = snsEnvelope({ Type: "Notification", Message: JSON.stringify({ notificationType: "Received", mail: { messageId: `upstream-${mutation}`, destination: [`inbox@${domain}`] }, receipt: { recipients: [`inbox@${domain}`], action: { type: "S3", bucketName: BUCKET, objectKey: `${PREFIX}${mutation}` } } }) });
      const response = await handleSelfHostedRequest(deps, await relayRequest(tenant, provider, "ses", body));
      expect(fetched).toBe(1);
      if (mutation === "none") { expect(response!.status).toBe(200); expect(await json(response)).toMatchObject({ completed: true }); }
      else expect(response!.status).toBeGreaterThanOrEqual(400);
      const expected = mutation === "none" ? 1 : 0;
      expect(await count("messages", tenant)).toBe(expected); expect(await count("inbound_message_sources", tenant)).toBe(expected); expect(await count("webhook_receipts", tenant)).toBe(expected);
    }
  });
  it("Resend provider type changes during raw content fetch are fenced before persistence", async () => {
    const domain = "relay-resend-fence.test", tenant = await makeRoutedTenant("relay-resend-fence", domain);
    const { deps } = makeDeps(); const store = deps.store.forTenant(tenant);
    const provider = String((await store.createResource(resourceSpecForPath("providers")!, { name: "receive", type: "resend" })).id);
    deps.env = { ...deps.env, FIXTURE_RELAY_SECRET: RESEND_SECRET, FIXTURE_RECEIVING_KEY: "fixture-only", EMAILS_WEBHOOK_BINDINGS: JSON.stringify([{ tenant_id: tenant, provider_id: provider, type: "resend", secret_env: "FIXTURE_RELAY_SECRET", api_key_env: "FIXTURE_RECEIVING_KEY" }]) };
    deps.webhookRelay = { fetch: async (url: any) => {
      if (String(url).startsWith("https://api.resend.com/")) return Response.json({ id: "inbound", raw: { download_url: "https://cdn.resend.com/raw" } });
      await pgClient!.execute("UPDATE self_hosted_providers SET type='ses' WHERE id=$1", [provider]);
      return new Response(rawEmail("must not persist"));
    } };
    const body = { type: "email.received", data: { email_id: "inbound", from: "sender@example.net", to: [`inbox@${domain}`] } };
    const response = await handleSelfHostedRequest(deps, await relayRequest(tenant, provider, "resend", body));
    expect(response!.status).toBeGreaterThanOrEqual(400);
    expect(await count("messages", tenant)).toBe(0); expect(await count("webhook_receipts", tenant)).toBe(0);
  });
});
