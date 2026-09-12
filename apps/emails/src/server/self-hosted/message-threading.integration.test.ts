// RFC 5322 threading integration tests (FR-0002). Runs the REAL request
// pipeline (handleSelfHostedRequest) and the REAL scoped store against a real
// Postgres (EMAILS_TEST_POSTGRES_URL) with the full migration history applied —
// 0044 adds `messages.thread_id`.
//
// Proves:
//   - a plain send carries a Message-ID and IS its own thread (thread_id equals
//     that Message-ID), so a conversation that starts here can be enumerated;
//   - a reply sent with `parent_message_id` persists message_id / in_reply_to /
//     references / thread_id, transmits the headers to the provider, and reports
//     them back on GET /v1/messages/{id};
//   - References accumulate the ancestor chain on a deeper reply;
//   - an idempotent replay re-derives the SAME Message-ID, so the retry is
//     recognised as a replay instead of being refused as a key conflict;
//   - a reply to a parent with no Message-ID does NOT forge an In-Reply-To, but
//     still groups under that parent's thread;
//   - the thread is enumerable through GET /v1/messages/threads;
//   - an unknown parent is refused 404 parent_message_not_found and a malformed
//     threading body is refused 400 — before anything is sent.
//
// Skipped entirely when EMAILS_TEST_POSTGRES_URL is not set.

import { afterAll, afterEach, beforeAll, describe, expect, it } from "bun:test";
import { createSerialIntegrationFixture, MIGRATION_CASE_TIMEOUT_MS, MIGRATION_DRAIN_TIMEOUT_MS } from "../../../scripts/serial-integration-fixture.js";
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
import type { SelfHostedSender } from "./sender.js";
import type { SendEmailOptions } from "../../types/index.js";

const SIGNING_SECRET = "test-signing-secret-do-not-use-in-prod-0123456789";
const databaseUrl = process.env["EMAILS_TEST_POSTGRES_URL"];
const pgClient: PoolQueryClient | null = databaseUrl
  ? createQueryClient(createPgPool({ connectionString: databaseUrl, env: { PGSSLMODE: "disable" } }))
  : null;

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

/** What the provider was actually asked to transmit. */
interface CapturedSend {
  options: SendEmailOptions;
}

const providerCalls: CapturedSend[] = [];

function makeDeps(): SelfHostedServiceDeps {
  const sender: SelfHostedSender = {
    provider: "ses",
    send: async (options: SendEmailOptions) => {
      providerCalls.push({ options });
      return `ses-${crypto.randomUUID()}`;
    },
  };
  return {
    client: pgClient!,
    store: new EmailsSelfHostedStore(pgClient!),
    verifier: verifyApiKey({ app: "emails", signingSecret: SIGNING_SECRET, keyStatus: async () => "active" }),
    sender,
    migrations: emailsSelfHostedMigrations(),
    version: "test",
    authStore: new AuthStore(pgClient!),
    keyStore: stubKeyStore,
    signingSecret: SIGNING_SECRET,
    rateLimiter: new RateLimiter({
      rules: {
        login: { limit: 100000, windowMs: 1000 },
        signup: { limit: 100000, windowMs: 1000 },
        forgot: { limit: 100000, windowMs: 1000 },
        "verify-resend": { limit: 100000, windowMs: 1000 },
        reset: { limit: 100000, windowMs: 1000 },
        invite: { limit: 100000, windowMs: 1000 },
      },
    }),
    mailer: MAILER,
    env: testAuthEnv(),
  };
}

async function call(
  deps: SelfHostedServiceDeps,
  method: string,
  path: string,
  opts: { token?: string; body?: unknown } = {},
): Promise<{ status: number; body: any }> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (opts.token) headers["x-api-key"] = opts.token;
  const res = await handleSelfHostedRequest(deps, new Request(`http://svc${path}`, {
    method,
    headers,
    ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}),
  }));
  return { status: res!.status, body: await res!.json().catch(() => ({})) };
}

async function makeTenant(slug: string): Promise<{ tenantId: string; token: string }> {
  const t = await pgClient!.one<{ id: string }>(
    `INSERT INTO tenants (slug, name) VALUES ($1, $2) RETURNING id`,
    [slug, slug],
  );
  const minted = mintApiKey({ app: "emails", scopes: ["emails:*"], signingSecret: SIGNING_SECRET });
  await pgClient!.execute(`INSERT INTO api_key_tenants (kid, tenant_id) VALUES ($1, $2)`, [minted.kid, t.id]);
  return { tenantId: t.id, token: minted.token };
}

async function registerSender(deps: SelfHostedServiceDeps, token: string, domain: string, email: string): Promise<void> {
  const dom = await call(deps, "POST", "/v1/domains", {
    token,
    body: { domain, status: "active", verified: true, provisioning_status: "ready" },
  });
  expect(dom.status).toBe(201);
  const addr = await call(deps, "POST", "/v1/addresses", {
    token,
    body: { email, status: "active", verified: true, domain_id: dom.body.domain.id, provisioning_status: "ready" },
  });
  expect(addr.status).toBe(201);
}

/** A tenant with one registered, verified sender — the prerequisite for a send. */
async function makeSenderTenant(
  deps: SelfHostedServiceDeps,
  slug: string,
): Promise<{ tenantId: string; token: string; from: string }> {
  const tenant = await makeTenant(slug);
  const from = `sender@${slug}.example`;
  await registerSender(deps, tenant.token, `${slug}.example`, from);
  return { ...tenant, from };
}

/**
 * Insert a message with a CONTROLLED id and NO Message-ID header — the shape of
 * mail that predates the threading column. Runs in a transaction that sets the
 * tenant GUC, so the row satisfies the FORCE-RLS policy (migration 0013) exactly
 * like the scoped store does.
 */
async function insertLegacyMessage(tenantId: string, id: string, subject: string): Promise<void> {
  await pgClient!.transaction(async (tx) => {
    await tx.execute(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);
    await tx.execute(
      `INSERT INTO messages (id, tenant_id, from_addr, to_addrs, direction, status, subject, received_at)
       VALUES ($1, $2, 'counterparty@kpmg.example', '["sender@legacy.example"]'::jsonb, 'inbound', 'received', $3, now())`,
      [id, tenantId, subject],
    );
  });
}

// Applying the full migration history is fixture setup, not a message latency
// assertion. Bun's hook timeout does not cancel SQL; drain before closing its pool.
const setupFixture = createSerialIntegrationFixture();
beforeAll(() => setupFixture.run(async () => {
  if (!pgClient) return;
  await pgClient.execute("DROP SCHEMA IF EXISTS public CASCADE");
  await pgClient.execute("CREATE SCHEMA public");
  await new MigrationLedger(pgClient, emailsSelfHostedMigrations()).migrate();
}), MIGRATION_CASE_TIMEOUT_MS);

afterAll(async () => {
  await setupFixture.drain();
  await pgClient?.close();
}, MIGRATION_DRAIN_TIMEOUT_MS + 1_000);

afterEach(() => { providerCalls.length = 0; });

describe.skipIf(!pgClient)("POST /v1/messages/send — RFC 5322 threading (FR-0002)", () => {
  it("a plain send carries a Message-ID and is the root of its own thread", async () => {
    const deps = makeDeps();
    const tenant = await makeSenderTenant(deps, "thread-root");

    const sent = await call(deps, "POST", "/v1/messages/send", {
      token: tenant.token,
      body: {
        from: tenant.from,
        to: ["counterparty@kpmg.example"],
        subject: "KPMG — FY2025 documents",
        text: "Attached.",
        idempotency_key: crypto.randomUUID(),
      },
    });
    expect(sent.status).toBe(202);
    const messageId = sent.body.message.message_id as string;
    // An RFC 5322 Message-ID, in angle brackets, of the shape RFC 5322 §3.6.1 asks for.
    expect(messageId).toMatch(/^<[^<>@\s]+@[^<>@\s]+>$/);
    expect(sent.body.message.in_reply_to).toBeNull();
    // The first message of a thread IS the thread: later replies inherit this id.
    expect(sent.body.message.thread_id).toBe(messageId);
    // And the provider was actually asked to transmit it — a header the transport
    // never sees would not thread anything in the recipient's mail client.
    expect(providerCalls.length).toBe(1);
    expect(providerCalls[0]!.options.headers?.["Message-ID"]).toBe(messageId);

    // It reads back the same way.
    const detail = await call(deps, "GET", `/v1/messages/${sent.body.message.id}`, { token: tenant.token });
    expect(detail.status).toBe(200);
    expect(detail.body.message.message_id).toBe(messageId);
    expect(detail.body.message.thread_id).toBe(messageId);
    expect(detail.body.message.references).toEqual([]);
  });

  it("a reply names its parent and round-trips in_reply_to / references / thread_id", async () => {
    const deps = makeDeps();
    const tenant = await makeSenderTenant(deps, "thread-reply");

    const root = await call(deps, "POST", "/v1/messages/send", {
      token: tenant.token,
      body: {
        from: tenant.from, to: ["counterparty@kpmg.example"],
        subject: "Question", text: "One?", idempotency_key: crypto.randomUUID(),
      },
    });
    expect(root.status).toBe(202);
    const rootMessageId = root.body.message.message_id as string;

    const reply = await call(deps, "POST", "/v1/messages/send", {
      token: tenant.token,
      body: {
        from: tenant.from, to: ["counterparty@kpmg.example"],
        subject: "Re: Question", text: "Two.", idempotency_key: crypto.randomUUID(),
        parent_message_id: root.body.message.id,
      },
    });
    expect(reply.status).toBe(202);
    expect(reply.body.message.in_reply_to).toBe(rootMessageId);
    expect(reply.body.message.references).toEqual([rootMessageId]);
    expect(reply.body.message.thread_id).toBe(rootMessageId);
    // The reply has its own Message-ID, distinct from its parent's.
    expect(reply.body.message.message_id).not.toBe(rootMessageId);

    // The provider transmits the full threading set on the reply.
    const replySend = providerCalls.at(-1)!.options;
    expect(replySend.headers?.["In-Reply-To"]).toBe(rootMessageId);
    expect(replySend.headers?.["References"]).toBe(rootMessageId);
    expect(replySend.headers?.["Message-ID"]).toBe(reply.body.message.message_id);

    // Requirement 2: the read-back row is the reply it is, not a bare new message.
    const detail = await call(deps, "GET", `/v1/messages/${reply.body.message.id}`, { token: tenant.token });
    expect(detail.status).toBe(200);
    expect(detail.body.message.in_reply_to).toBe(rootMessageId);
    expect(detail.body.message.references).toEqual([rootMessageId]);
    expect(detail.body.message.thread_id).toBe(rootMessageId);
  });

  it("References accumulate the ancestor chain across a deeper reply (§3.6.4)", async () => {
    const deps = makeDeps();
    const tenant = await makeSenderTenant(deps, "thread-chain");
    const common = { from: tenant.from, to: ["counterparty@kpmg.example"] };

    const first = await call(deps, "POST", "/v1/messages/send", {
      token: tenant.token,
      body: { ...common, subject: "1", text: "1", idempotency_key: crypto.randomUUID() },
    });
    const firstId = first.body.message.message_id as string;
    const second = await call(deps, "POST", "/v1/messages/send", {
      token: tenant.token,
      body: { ...common, subject: "Re: 1", text: "2", idempotency_key: crypto.randomUUID(), parent_message_id: first.body.message.id },
    });
    const secondId = second.body.message.message_id as string;
    const third = await call(deps, "POST", "/v1/messages/send", {
      token: tenant.token,
      body: { ...common, subject: "Re: 1", text: "3", idempotency_key: crypto.randomUUID(), parent_message_id: second.body.message.id },
    });

    // The parent's own chain, then the parent itself — never the parent twice.
    expect(third.body.message.in_reply_to).toBe(secondId);
    expect(third.body.message.references).toEqual([firstId, secondId]);
    // Every message in the chain reports the same thread.
    expect(third.body.message.thread_id).toBe(firstId);
    expect(second.body.message.thread_id).toBe(firstId);
    expect(providerCalls.at(-1)!.options.headers?.["References"]).toBe(`${firstId} ${secondId}`);
  });

  it("resolves the parent by RFC Message-ID, not only by hosted row id", async () => {
    const deps = makeDeps();
    const tenant = await makeSenderTenant(deps, "thread-by-messageid");

    const root = await call(deps, "POST", "/v1/messages/send", {
      token: tenant.token,
      body: {
        from: tenant.from, to: ["counterparty@kpmg.example"],
        subject: "Quote", text: "Q", idempotency_key: crypto.randomUUID(),
      },
    });
    const rootMessageId = root.body.message.message_id as string;

    // A caller that already holds the Message-ID (it read the detail, or an
    // inbound mail carried it in In-Reply-To) may name the parent that way.
    const reply = await call(deps, "POST", "/v1/messages/send", {
      token: tenant.token,
      body: {
        from: tenant.from, to: ["counterparty@kpmg.example"],
        subject: "Re: Quote", text: "A", idempotency_key: crypto.randomUUID(),
        in_reply_to: rootMessageId,
      },
    });
    expect(reply.status).toBe(202);
    expect(reply.body.message.in_reply_to).toBe(rootMessageId);
    expect(reply.body.message.thread_id).toBe(rootMessageId);
  });

  it("an idempotent replay re-derives the same Message-ID instead of conflicting", async () => {
    const deps = makeDeps();
    const tenant = await makeSenderTenant(deps, "thread-replay");

    const root = await call(deps, "POST", "/v1/messages/send", {
      token: tenant.token,
      body: { from: tenant.from, to: ["counterparty@kpmg.example"], subject: "R", text: "R", idempotency_key: crypto.randomUUID() },
    });
    const rootMessageId = root.body.message.message_id as string;

    const body = {
      from: tenant.from, to: ["counterparty@kpmg.example"],
      subject: "Re: R", text: "reply", idempotency_key: crypto.randomUUID(),
      parent_message_id: root.body.message.id,
    };
    const first = await call(deps, "POST", "/v1/messages/send", { token: tenant.token, body });
    const retry = await call(deps, "POST", "/v1/messages/send", { token: tenant.token, body });
    expect(first.status).toBe(202);
    // A retry with the same key must be recognised as the SAME send — the replay
    // answers 200 for the stored record, never 409. A random Message-ID would
    // change the payload hash and turn the retry into an idempotency conflict.
    expect(retry.status).toBe(200);
    expect(retry.body.message.id).toBe(first.body.message.id);
    expect(retry.body.message.message_id).toBe(first.body.message.message_id);
    expect(retry.body.message.thread_id).toBe(rootMessageId);
  });

  it("a reply to a parent with no Message-ID does not forge In-Reply-To, but still groups with it", async () => {
    const deps = makeDeps();
    const tenant = await makeSenderTenant(deps, "thread-legacy-parent");

    // Mail that predates the column: no Message-ID anywhere, so there is nothing
    // a valid In-Reply-To could name.
    const legacyId = "1e9ac000-0000-4000-8000-000000000001";
    await insertLegacyMessage(tenant.tenantId, legacyId, "FY2025 chase");

    const reply = await call(deps, "POST", "/v1/messages/send", {
      token: tenant.token,
      body: {
        from: tenant.from, to: ["counterparty@kpmg.example"],
        subject: "Re: FY2025 chase", text: "Answer", idempotency_key: crypto.randomUUID(),
        parent_message_id: legacyId,
      },
    });
    expect(reply.status).toBe(202);
    // A hosted uuid is not a Message-ID: emitting one would forge a header no
    // mail client can match.
    expect(reply.body.message.in_reply_to).toBeNull();
    expect(reply.body.message.references).toEqual([]);
    expect(providerCalls.at(-1)!.options.headers?.["In-Reply-To"]).toBeUndefined();
    // It still belongs to the parent's conversation, anchored on the parent's id.
    expect(reply.body.message.thread_id).toBe(legacyId);
    // ... and it still carries its own Message-ID.
    expect(reply.body.message.message_id).toMatch(/^<[^<>@\s]+@[^<>@\s]+>$/);
  });

  it("enumerates the whole conversation under one thread", async () => {
    const deps = makeDeps();
    const tenant = await makeSenderTenant(deps, "thread-enumerate");
    const common = { from: tenant.from, to: ["counterparty@kpmg.example"] };

    const root = await call(deps, "POST", "/v1/messages/send", {
      token: tenant.token, body: { ...common, subject: "Enumerate", text: "1", idempotency_key: crypto.randomUUID() },
    });
    const rootMessageId = root.body.message.message_id as string;
    await call(deps, "POST", "/v1/messages/send", {
      token: tenant.token,
      body: { ...common, subject: "Re: Enumerate", text: "2", idempotency_key: crypto.randomUUID(), parent_message_id: root.body.message.id },
    });
    await call(deps, "POST", "/v1/messages/send", {
      token: tenant.token,
      body: { ...common, subject: "Re: Enumerate", text: "3", idempotency_key: crypto.randomUUID(), parent_message_id: root.body.message.id },
    });

    const threads = await call(deps, "GET", "/v1/messages/threads", { token: tenant.token });
    expect(threads.status).toBe(200);
    const thread = (threads.body.threads as Array<Record<string, unknown>>).find((t) => t["thread_key"] === rootMessageId);
    expect(thread, "the thread is not enumerated under its Message-ID").toBeDefined();
    expect(Number(thread!["message_count"])).toBe(3);
  });

  it("refuses an unknown parent 404 rather than sending an unthreaded message", async () => {
    const deps = makeDeps();
    const tenant = await makeSenderTenant(deps, "thread-unknown-parent");

    const res = await call(deps, "POST", "/v1/messages/send", {
      token: tenant.token,
      body: {
        from: tenant.from, to: ["counterparty@kpmg.example"],
        subject: "Re: nothing", text: "?", idempotency_key: crypto.randomUUID(),
        parent_message_id: "deadbeef-dead-4ead-8ead-deaddeaddead",
      },
    });
    expect(res.status).toBe(404);
    expect(res.body.reason).toBe("parent_message_not_found");
    expect(res.body.retry_safe).toBe(false);
    // Nothing was sent — the provider was never called.
    expect(providerCalls.length).toBe(0);
  });

  it("refuses a malformed threading body 400 before anything is sent", async () => {
    const deps = makeDeps();
    const tenant = await makeSenderTenant(deps, "thread-malformed");
    const base = {
      from: tenant.from, to: ["counterparty@kpmg.example"],
      subject: "Re: x", text: "x", idempotency_key: crypto.randomUUID(),
    };

    for (const [field, value, reason] of [
      ["parent_message_id", 7, "invalid_parent_message_id"],
      ["in_reply_to", 7, "invalid_in_reply_to"],
      ["references", "not-an-array", "invalid_references"],
      ["references", [1, 2], "invalid_references"],
    ] as const) {
      const res = await call(deps, "POST", "/v1/messages/send", { token: tenant.token, body: { ...base, [field]: value } });
      expect(res.status, `${field} must be refused`).toBe(400);
      expect(res.body.reason).toBe(reason);
    }
    expect(providerCalls.length).toBe(0);
  });

  it("is tenant-scoped: another tenant's message cannot be named as a parent", async () => {
    const deps = makeDeps();
    const a = await makeTenant("thread-scope-a");
    const b = await makeSenderTenant(deps, "thread-scope-b");

    const foreign = "2e9ac000-0000-4000-8000-000000000002";
    await insertLegacyMessage(a.tenantId, foreign, "Other tenant's mail");

    const res = await call(deps, "POST", "/v1/messages/send", {
      token: b.token,
      body: {
        from: b.from, to: ["counterparty@kpmg.example"],
        subject: "Re: leaked", text: "?", idempotency_key: crypto.randomUUID(),
        parent_message_id: foreign,
      },
    });
    expect(res.status).toBe(404);
    expect(res.body.reason).toBe("parent_message_not_found");
    expect(providerCalls.length).toBe(0);
  });
});
