import { afterEach, describe, expect, test } from "bun:test";
import { Connector } from "./index";

const realFetch = globalThis.fetch;

interface Recorded {
  url: string;
  method: string;
  body?: string;
  headers: Record<string, string>;
}

function installFetch(handler: (url: string) => unknown) {
  const recorded: Recorded[] = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    recorded.push({
      url,
      method: init?.method ?? "GET",
      body: init?.body as string | undefined,
      headers: (init?.headers as Record<string, string>) ?? {},
    });
    const json = handler(url);
    return {
      ok: true,
      status: 200,
      statusText: "OK",
      headers: { get: () => "application/json" },
      async text() {
        return JSON.stringify(json ?? {});
      },
    } as unknown as Response;
  }) as typeof fetch;
  return recorded;
}

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe("Stripe Identity connector", () => {
  test("requires an API key", () => {
    expect(() => new Connector({ apiKey: "" })).toThrow();
  });

  test("org API keys require an account ID", () => {
    expect(() => new Connector({ apiKey: "sk_org_abc" })).toThrow();
    expect(() => new Connector({ apiKey: "sk_org_abc", accountId: "acct_1" })).not.toThrow();
  });

  test("sends Bearer auth and Stripe-Version headers", async () => {
    const recorded = installFetch(() => ({ id: "vs_1", object: "identity.verification_session" }));
    const client = new Connector({ apiKey: "sk_test_123" });
    await client.verificationSessions.get("vs_1");
    expect(recorded[0].headers["Authorization"]).toBe("Bearer sk_test_123");
    expect(recorded[0].headers["Stripe-Version"]).toBeDefined();
  });

  test("create posts form-encoded nested options to the sessions endpoint", async () => {
    const recorded = installFetch(() => ({ id: "vs_1", object: "identity.verification_session", url: "https://verify.stripe.com/vs_1" }));
    const client = new Connector({ apiKey: "sk_test_123" });
    const result = await client.verificationSessions.create({
      type: "document",
      options: { document: { allowed_types: ["passport"], require_matching_selfie: true } },
    });
    expect(result.url).toBe("https://verify.stripe.com/vs_1");
    const call = recorded[0];
    expect(call.method).toBe("POST");
    expect(call.url).toBe("https://api.stripe.com/v1/identity/verification_sessions");
    const body = decodeURIComponent(call.body ?? "");
    expect(body).toContain("type=document");
    expect(body).toContain("options[document][allowed_types][0]=passport");
    expect(body).toContain("options[document][require_matching_selfie]=true");
  });

  test("cancel and redact hit the action sub-resources", async () => {
    const recorded = installFetch(() => ({ id: "vs_1", object: "identity.verification_session" }));
    const client = new Connector({ apiKey: "sk_test_123" });
    await client.verificationSessions.cancel("vs_1");
    await client.verificationSessions.redact("vs_1");
    expect(recorded[0].url).toBe("https://api.stripe.com/v1/identity/verification_sessions/vs_1/cancel");
    expect(recorded[0].method).toBe("POST");
    expect(recorded[1].url).toBe("https://api.stripe.com/v1/identity/verification_sessions/vs_1/redact");
  });

  test("reports list forwards query params and get retrieves by id", async () => {
    const recorded = installFetch(() => ({ object: "list", data: [], has_more: false, url: "/v1/identity/verification_reports" }));
    const client = new Connector({ apiKey: "sk_test_123" });
    await client.verificationReports.list({ limit: 5, type: "document" });
    await client.verificationReports.get("vr_9");
    expect(recorded[0].url).toContain("/v1/identity/verification_reports?");
    expect(recorded[0].url).toContain("limit=5");
    expect(recorded[0].url).toContain("type=document");
    expect(recorded[1].url).toBe("https://api.stripe.com/v1/identity/verification_reports/vr_9");
  });
});
