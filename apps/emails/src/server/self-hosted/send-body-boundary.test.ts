import { describe, expect, test } from "bun:test";
import { mintApiKey, verifyApiKey } from "@hasna/contracts/auth";
import type { TypedQueryClient } from "../../storage-kit/index.js";
import { selfScopedStore, testAuthDeps } from "./auth/test-support.js";
import { emailsSelfHostedMigrations } from "./migrations.js";
import { handleSelfHostedRequest, type SelfHostedServiceDeps } from "./service.js";

const signingSecret = "test-signing-secret-do-not-use-in-prod";
function harness() {
  const client: TypedQueryClient = {
    async query() { return { rows: [], rowCount: 0 }; },
    async many() { return []; }, async get() { return null; },
    async one<T>() { return {} as T; }, async execute() {},
  };
  const effects = { intents: [] as any[], queue: [] as any[], provider: [] as any[] };
  let record: any;
  const store = selfScopedStore(client);
  Object.assign(store, {
    reserveSendIntent: async (input: unknown) => {
      effects.intents.push(input);
      record = { ...(input as object), id: "11111111-1111-4111-8111-111111111111", status: "queued", send_state: "pending", headers: {}, attachments: [], labels: [] };
      return { created: true, record };
    },
    enqueueScheduled: async (input: unknown) => {
      effects.queue.push(input);
      return { created: true, id: "queued-fixture", status: "pending", scheduled_at: "2030-01-01T00:00:00.000Z" };
    },
    evaluateOutboundPolicy: async () => ({ allowed: true }),
    claimSendIntent: async () => ({ ...record, send_state: "sending" }),
    completeSendIntent: async (_id: string, providerId: string) => ({ ...record, status: "sent", send_state: "sent", provider_message_id: providerId }),
  });
  const deps: SelfHostedServiceDeps = {
    client, store,
    verifier: verifyApiKey({ app: "emails", signingSecret, keyStatus: async () => "active" }),
    sender: { provider: "ses", send: async (input) => { effects.provider.push(input); return "fixture-provider-id"; } },
    migrations: emailsSelfHostedMigrations(), version: "9.9.9", ...testAuthDeps(client, signingSecret),
  };
  const token = mintApiKey({ app: "emails", signingSecret, scopes: ["emails:*"] }).token;
  async function request(path: string, body: Record<string, unknown>) {
    return handleSelfHostedRequest(deps, new Request(`http://fixture.test/v1/${path}`, {
      method: "POST", headers: { "x-api-key": token, "content-type": "application/json" },
      body: JSON.stringify({ from: "sender@example.com", to: ["recipient@example.com"], subject: "Fixture",
        idempotency_key: "fixture-send-key", ...(path === "scheduled/enqueue" ? { scheduled_at: "2030-01-01T00:00:00Z" } : {}), ...body }),
    }));
  }
  return { effects, request };
}

describe("send body URL boundary escapes at the authenticated server", () => {
  for (const path of ["messages/send", "scheduled/enqueue"]) {
    for (const field of ["text", "html"]) {
      test(`${path} rejects malformed ${field} before intent, queue or provider`, async () => {
        const { effects, request } = harness();
        const response = await request(path, { [field]: String.raw`PRIVATE_BODY HTTPS://example.test/private-link\r\nRegards` });
        expect(response.status).toBe(400);
        const result = await response.json() as { reason: string; error: string };
        expect(result.reason).toBe("invalid_body_url_boundary");
        expect(result.error).toContain("--body-file");
        expect(JSON.stringify(result)).not.toContain("PRIVATE_BODY");
        expect(JSON.stringify(result)).not.toContain("private-link");
        expect(effects).toEqual({ intents: [], queue: [], provider: [] });
      });
    }
    test(`${path} preserves real newlines and legitimate URL/prose escapes`, async () => {
      const { effects, request } = harness();
      const text = "Hello\nhttps://example.test/a/%5Cn\n\n" + String.raw`C:\notes\new.txt and prose \n`;
      const html = '<a href="https://example.test/a/%5Cr">Download</a>\n<p>' + String.raw`literal \n` + '</p>';
      const response = await request(path, { text, html });
      expect(response.status).toBe(path === "messages/send" ? 202 : 201);
      if (path === "messages/send") {
        expect(effects.intents).toHaveLength(1);
        expect(effects.intents[0]).toMatchObject({ body_text: text, body_html: html });
        expect(effects.provider).toHaveLength(1);
        expect(effects.provider[0]).toMatchObject({ text, html });
        expect(effects.queue).toHaveLength(0);
      } else {
        expect(effects.queue).toHaveLength(1);
        expect(effects.queue[0].payload).toMatchObject({ text, html });
        expect(effects.intents).toHaveLength(0);
        expect(effects.provider).toHaveLength(0);
      }
    });
  }
});
