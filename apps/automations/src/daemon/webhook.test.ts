import { describe, expect, test } from "bun:test";
import { createHmac } from "node:crypto";
import type { MaterializedWebhookRequest, WebhookRequestInput, WebhookRoute } from "../types.js";
import {
  handleWebhookRequest,
  verifyWebhookSignature,
  type WebhookServerStore,
} from "./index.js";

// agent-authored (SOL consult bounded: capacity refusal + wall-time exhaustion)

const SECRET = "test-webhook-secret";
const BASE_URL = "http://localhost:7391";

function activeRoute(overrides: Partial<WebhookRoute> = {}): WebhookRoute {
  return {
    id: "github-main",
    automationId: "webhook-scope",
    path: "/webhooks/github/main",
    status: "active",
    signature: {
      algorithm: "hmac-sha256",
      secretRef: "secret://automations/webhooks/github-main",
    },
    mapping: { source: "github", type: "push" },
    createdAt: "2026-08-11T00:00:00.000Z",
    updatedAt: "2026-08-11T00:00:00.000Z",
    ...overrides,
  };
}

function hexDigest(body: string | Uint8Array, secret = SECRET): string {
  return createHmac("sha256", secret).update(body).digest("hex");
}

function base64Digest(body: string | Uint8Array, secret = SECRET): string {
  return createHmac("sha256", secret).update(body).digest("base64");
}

function fakeStore(overrides: {
  routes?: Map<string, WebhookRoute>;
  materializeError?: unknown;
} = {}): WebhookServerStore & { materializeInputs: WebhookRequestInput[] } {
  const routes = overrides.routes ?? new Map([[activeRoute().path, activeRoute()]]);
  const materializeInputs: WebhookRequestInput[] = [];
  return {
    materializeInputs,
    async requireWebhookRoute(idOrPath: string): Promise<WebhookRoute> {
      const route = routes.get(idOrPath);
      if (!route) throw new Error(`webhook route not found: ${idOrPath}`);
      return route;
    },
    async materializeWebhookRequest(input: WebhookRequestInput): Promise<MaterializedWebhookRequest> {
      materializeInputs.push(input);
      if (overrides.materializeError !== undefined) throw overrides.materializeError;
      return {
        route: input.route,
        event: {
          id: "evt_github_push_1",
          source: "github",
          type: "push",
          dedupeKey: "gh-push-1",
        },
        materialized: [
          {
            automation: {
              id: input.route.automationId,
              spec: {
                schemaVersion: "1.0",
                id: input.route.automationId,
                name: input.route.automationId,
                version: "1.0.0",
                triggers: [],
                actions: [],
              },
              status: "active",
              createdAt: "2026-08-11T00:00:00.000Z",
              updatedAt: "2026-08-11T00:00:00.000Z",
            },
            run: {
              id: "run_webhook_1",
              automationId: input.route.automationId,
              status: "materialized",
              trigger: { kind: "webhook" },
              createdAt: "2026-08-11T00:00:00.000Z",
              updatedAt: "2026-08-11T00:00:00.000Z",
            },
            actions: [
              {
                id: "action_webhook_1",
                automationRunId: "run_webhook_1",
                stepId: "create-escalation-task",
                actionId: "todos.create",
                idempotencyKey: "evt_github_push_1",
                status: "admitted",
                attempt: 1,
                maxAttempts: 1,
                availableAt: "2026-08-11T00:00:00.000Z",
                createdAt: "2026-08-11T00:00:00.000Z",
                updatedAt: "2026-08-11T00:00:00.000Z",
                invocation: {
                  id: "inv_webhook_1",
                  actionId: "todos.create",
                  manifestVersion: "1.0.0",
                  input: {},
                  requestedAt: "2026-08-11T00:00:00.000Z",
                },
              },
            ],
          },
        ],
      };
    },
  };
}

describe("verifyWebhookSignature", () => {
  const body = new TextEncoder().encode('{"event":"push"}');

  test("accepts when the route has no signature configuration", () => {
    const route = activeRoute({ signature: undefined });
    expect(verifyWebhookSignature(route, body, new Headers(), () => SECRET)).toEqual({ ok: true });
  });

  test("rejects a missing signature header with 401 and the exact error", () => {
    const route = activeRoute();
    expect(verifyWebhookSignature(route, body, new Headers(), () => SECRET)).toEqual({
      ok: false,
      status: 401,
      error: "webhook_signature_missing",
    });
  });

  test("honors a custom signature header name", () => {
    const route = activeRoute({ signature: { algorithm: "hmac-sha256", secretRef: "s", header: "x-custom-sig" } });
    const ok = verifyWebhookSignature(
      route,
      body,
      new Headers({ "x-custom-sig": hexDigest(body) }),
      () => SECRET,
    );
    expect(ok).toEqual({ ok: true });
    // The default header must NOT be consulted when a custom one is configured.
    const missing = verifyWebhookSignature(
      route,
      body,
      new Headers({ "x-hasna-signature": hexDigest(body) }),
      () => SECRET,
    );
    expect(missing).toEqual({ ok: false, status: 401, error: "webhook_signature_missing" });
  });

  test("rejects an invalid digest with 401", () => {
    const route = activeRoute();
    const result = verifyWebhookSignature(
      route,
      body,
      new Headers({ "x-hasna-signature": "f".repeat(64) }),
      () => SECRET,
    );
    expect(result).toEqual({ ok: false, status: 401, error: "webhook_signature_invalid" });
  });

  test("rejects malformed observed digests instead of crashing: wrong length and non-hex", () => {
    const route = activeRoute();
    const short = verifyWebhookSignature(route, body, new Headers({ "x-hasna-signature": "abc123" }), () => SECRET);
    expect(short).toEqual({ ok: false, status: 401, error: "webhook_signature_invalid" });
    const nonHex = verifyWebhookSignature(route, body, new Headers({ "x-hasna-signature": "z".repeat(64) }), () => SECRET);
    expect(nonHex).toEqual({ ok: false, status: 401, error: "webhook_signature_invalid" });
  });

  test("accepts uppercase hex digests via canonicalization (case-insensitive compare)", () => {
    const route = activeRoute();
    const result = verifyWebhookSignature(
      route,
      body,
      new Headers({ "x-hasna-signature": hexDigest(body).toUpperCase() }),
      () => SECRET,
    );
    expect(result).toEqual({ ok: true });
  });

  test("strips a configured prefix from the observed header", () => {
    const route = activeRoute({
      signature: { algorithm: "hmac-sha256", secretRef: "s", prefix: "sha256=" },
    });
    const ok = verifyWebhookSignature(
      route,
      body,
      new Headers({ "x-hasna-signature": `sha256=${hexDigest(body)}` }),
      () => SECRET,
    );
    expect(ok).toEqual({ ok: true });
  });

  test("treats a wrong prefix as an invalid signature, not as a missing one", () => {
    const route = activeRoute({
      signature: { algorithm: "hmac-sha256", secretRef: "s", prefix: "sha256=" },
    });
    const wrong = verifyWebhookSignature(
      route,
      body,
      new Headers({ "x-hasna-signature": `md5=${hexDigest(body)}` }),
      () => SECRET,
    );
    expect(wrong).toEqual({ ok: false, status: 401, error: "webhook_signature_invalid" });
    // Prefix with nothing after it is empty -> invalid, and a bare prefix-only
    // header must not be treated as valid.
    const prefixOnly = verifyWebhookSignature(
      route,
      body,
      new Headers({ "x-hasna-signature": "sha256=" }),
      () => SECRET,
    );
    expect(prefixOnly).toEqual({ ok: false, status: 401, error: "webhook_signature_invalid" });
  });

  test("verifies base64-encoded digests with the exact base64 shape", () => {
    const route = activeRoute({ signature: { algorithm: "hmac-sha256", secretRef: "s", encoding: "base64" } });
    const ok = verifyWebhookSignature(
      route,
      body,
      new Headers({ "x-hasna-signature": base64Digest(body) }),
      () => SECRET,
    );
    expect(ok).toEqual({ ok: true });
    // A base64 digest of the wrong length/shape is rejected, not compared loosely.
    const bad = verifyWebhookSignature(
      route,
      body,
      new Headers({ "x-hasna-signature": base64Digest(body).slice(0, 43) }),
      () => SECRET,
    );
    expect(bad).toEqual({ ok: false, status: 401, error: "webhook_signature_invalid" });
  });

  test("returns 503 when the secret cannot be resolved", () => {
    const route = activeRoute();
    expect(verifyWebhookSignature(route, body, new Headers({ "x-hasna-signature": hexDigest(body) }), () => undefined)).toEqual({
      ok: false,
      status: 503,
      error: "webhook_secret_unavailable",
    });
  });

  test("rejects a digest computed with the wrong secret", () => {
    const route = activeRoute();
    const result = verifyWebhookSignature(
      route,
      body,
      new Headers({ "x-hasna-signature": hexDigest(body, "other-secret") }),
      () => SECRET,
    );
    expect(result).toEqual({ ok: false, status: 401, error: "webhook_signature_invalid" });
  });
});

describe("handleWebhookRequest", () => {
  test("answers GET /healthz with 200", async () => {
    const response = await handleWebhookRequest(
      new Request(`${BASE_URL}/healthz`),
      { store: fakeStore() },
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, service: "automations", mode: "webhooks" });
  });

  test("rejects non-POST methods with 405 and the Allow header", async () => {
    const response = await handleWebhookRequest(
      new Request(`${BASE_URL}/webhooks/github/main`, { method: "GET" }),
      { store: fakeStore() },
    );
    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("POST");
    expect(await response.json()).toEqual({ ok: false, error: "method_not_allowed" });
  });

  test("answers 404 for an unknown webhook route", async () => {
    const store = fakeStore();
    const response = await handleWebhookRequest(
      new Request(`${BASE_URL}/webhooks/unknown`, { method: "POST", body: "{}" }),
      { store },
    );
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ ok: false, error: "webhook_route_not_found" });
  });

  test("answers 403 for an inactive route, naming the route id", async () => {
    const routes = new Map([
      ["/webhooks/github/main", activeRoute({ status: "disabled" })],
    ]);
    const response = await handleWebhookRequest(
      new Request(`${BASE_URL}/webhooks/github/main`, { method: "POST", body: "{}" }),
      { store: fakeStore({ routes }) },
    );
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      ok: false,
      error: "webhook_route_inactive",
      routeId: "github-main",
    });
  });

  test("rejects a payload above the declared limit via content-length with 413", async () => {
    const store = fakeStore();
    const response = await handleWebhookRequest(
      new Request(`${BASE_URL}/webhooks/github/main`, {
        method: "POST",
        headers: { "content-length": "99999" },
      }),
      { store, maxBodyBytes: 16 },
    );
    expect(response.status).toBe(413);
    expect(await response.json()).toEqual({
      ok: false,
      error: "webhook_payload_too_large",
      maxBodyBytes: 16,
    });
  });

  test("rejects a malformed content-length header with 400 instead of crashing", async () => {
    const store = fakeStore();
    const response = await handleWebhookRequest(
      new Request(`${BASE_URL}/webhooks/github/main`, {
        method: "POST",
        headers: { "content-length": "not-a-number" },
      }),
      { store },
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      ok: false,
      error: "invalid_content_length",
      maxBodyBytes: 1024 * 1024,
    });
  });

  test("cancels a streamed body that exceeds the limit mid-read with 413", async () => {
    const store = fakeStore();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("hello world"));
        controller.close();
      },
    });
    const response = await handleWebhookRequest(
      new Request(`${BASE_URL}/webhooks/github/main`, { method: "POST", body: stream }),
      { store, maxBodyBytes: 4 },
    );
    expect(response.status).toBe(413);
    expect(await response.json()).toEqual({
      ok: false,
      error: "webhook_payload_too_large",
      maxBodyBytes: 4,
    });
  });

  test("rejects an invalid signature on the request path with 401", async () => {
    const store = fakeStore();
    const response = await handleWebhookRequest(
      new Request(`${BASE_URL}/webhooks/github/main`, {
        method: "POST",
        headers: { "x-hasna-signature": "f".repeat(64) },
        body: '{"event":"push"}',
      }),
      { store, resolveSecret: () => SECRET },
    );
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({
      ok: false,
      error: "webhook_signature_invalid",
      routeId: "github-main",
    });
  });

  test("returns 503 when the signature secret is unavailable", async () => {
    const store = fakeStore();
    const response = await handleWebhookRequest(
      new Request(`${BASE_URL}/webhooks/github/main`, {
        method: "POST",
        headers: { "x-hasna-signature": hexDigest('{"event":"push"}') },
        body: '{"event":"push"}',
      }),
      { store, resolveSecret: () => undefined },
    );
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      ok: false,
      error: "webhook_secret_unavailable",
      routeId: "github-main",
    });
  });

  test("materializes a verified webhook into 202 with event and action ids", async () => {
    const store = fakeStore();
    const rawBody = '{"event":"push"}';
    const response = await handleWebhookRequest(
      new Request(`${BASE_URL}/webhooks/github/main`, {
        method: "POST",
        headers: { "x-hasna-signature": hexDigest(rawBody) },
        body: rawBody,
      }),
      { store, resolveSecret: () => SECRET },
    );
    expect(response.status).toBe(202);
    const body = (await response.json()) as {
      ok: boolean;
      routeId: string;
      automationId: string;
      eventId: string;
      dedupeKey: string;
      materialized: Array<{ automationId: string; runId: string; actionIds: string[] }>;
    };
    expect(body).toMatchObject({
      ok: true,
      routeId: "github-main",
      automationId: "webhook-scope",
      eventId: "evt_github_push_1",
      dedupeKey: "gh-push-1",
    });
    expect(body.materialized).toEqual([
      { automationId: "webhook-scope", runId: "run_webhook_1", actionIds: ["action_webhook_1"] },
    ]);
    // The raw body and headers must reach the materializer untouched.
    expect(store.materializeInputs).toHaveLength(1);
    const materializedBody = store.materializeInputs[0].rawBody;
    const decodedBody = typeof materializedBody === "string" ? materializedBody : new TextDecoder().decode(materializedBody);
    expect(decodedBody).toBe(rawBody);
    expect(store.materializeInputs[0].headers?.["x-hasna-signature"]).toBe(hexDigest(rawBody));
  });

  test("maps a malformed JSON body to 400 malformed_json", async () => {
    const unsigned = new Map([
      ["/webhooks/github/main", activeRoute({ signature: undefined })],
    ]);
    const store = fakeStore({ routes: unsigned, materializeError: new SyntaxError("Unexpected token") });
    const response = await handleWebhookRequest(
      new Request(`${BASE_URL}/webhooks/github/main`, { method: "POST", body: "{not json" }),
      { store },
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      ok: false,
      error: "malformed_json",
      routeId: "github-main",
    });
  });

  test("maps a materialization failure to 422 webhook_materialization_failed", async () => {
    const unsigned = new Map([
      ["/webhooks/github/main", activeRoute({ signature: undefined })],
    ]);
    const store = fakeStore({ routes: unsigned, materializeError: new Error("automation not found") });
    const response = await handleWebhookRequest(
      new Request(`${BASE_URL}/webhooks/github/main`, { method: "POST", body: "{}" }),
      { store },
    );
    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({
      ok: false,
      error: "webhook_materialization_failed",
      routeId: "github-main",
    });
  });
});
