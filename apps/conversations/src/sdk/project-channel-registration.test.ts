import { describe, expect, test } from "bun:test";
import { ConversationsClient } from "./index.js";

describe("generated SDK project-channel registration contract", () => {
  test("exposes capability, create, bounded lookup, exact readback, inverse, and verification routes", async () => {
    const calls: Array<{ url: string; method: string; body: unknown }> = [];
    const client = new ConversationsClient({
      baseUrl: "https://conversations.example.invalid",
      fetch: (async (input: string | URL | Request, init?: RequestInit) => {
        calls.push({
          url: String(input),
          method: String(init?.method),
          body: init?.body ? JSON.parse(String(init.body)) : null,
        });
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }) as typeof fetch,
    });

    const body = {
      operation_id: "operation-one",
      step_id: "conversations-channel",
      resource_kind: "channel",
      direction: "forward",
      target_digest: "path-digest",
    };
    await client.getProjectChannelRegistrationCapability();
    await client.registerProjectChannel(body);
    await client.lookupProjectChannelRegistrationReceipt({
      operation_id: "operation-one",
      step_id: "conversations-channel",
      resource_kind: "channel",
      direction: "forward",
      authority: "conversations",
      authority_route: "/v1/project-registration/channels",
      package_version: "0.5.33",
      authority_id: "conversations",
      tenant_id: "default",
      corpus_id: "cor_11111111111111111111111111111111",
      target_selector: "fleet-resources",
      idempotency_key: "operation-one:conversations-channel:forward",
      target_id: "chn_11111111111111111111111111111111",
      max_items: 1,
      response_byte_limit: 32_768,
      time_budget_ms: 5_000,
      call_limit: 1,
    });
    await client.readProjectChannelRegistrationExact(
      "chn_11111111111111111111111111111111",
      {
        resource_kind: "channel",
        target_selector: "fleet-resources",
        target_digest: "path-digest",
        response_byte_limit: 32_768,
        time_budget_ms: 5_000,
        call_limit: 1,
      },
    );
    await client.compensateProjectChannelRegistration({
      ...body,
      direction: "inverse",
    });
    await client.verifyProjectChannelRegistrationInverse({
      ...body,
      direction: "inverse",
    });

    expect(calls.map((call) => ({
      method: call.method,
      path: new URL(call.url).pathname,
    }))).toEqual([
      { method: "GET", path: "/v1/project-registration/channels/capability" },
      { method: "POST", path: "/v1/project-registration/channels" },
      { method: "GET", path: "/v1/project-registration/channels/receipts/terminal" },
      { method: "GET", path: "/v1/project-registration/channels/chn_11111111111111111111111111111111" },
      { method: "POST", path: "/v1/project-registration/channels/inverse" },
      { method: "POST", path: "/v1/project-registration/channels/inverse/verify" },
    ]);
    expect(calls[1].body).toEqual(body);
    const lookupUrl = new URL(calls[2].url);
    expect(lookupUrl.searchParams.get("max_items")).toBe("1");
    expect(lookupUrl.searchParams.get("call_limit")).toBe("1");
    expect(lookupUrl.searchParams.get("target_id")).toBe("chn_11111111111111111111111111111111");
    const readUrl = new URL(calls[3].url);
    expect(readUrl.searchParams.get("target_selector")).toBe("fleet-resources");
    expect(readUrl.searchParams.get("target_digest")).toBe("path-digest");
  });
});
