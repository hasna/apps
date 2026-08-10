import { describe, expect, test } from "bun:test";
import { ConversationsClient } from "./index.js";

describe("generated SDK project-channel registration contract", () => {
  test("exposes capability, paged collections, create, bounded lookup, exact readback, inverse, and verification routes", async () => {
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
    if (false) {
      // @ts-expect-error create surface statically rejects bind-existing intent
      void client.registerProjectChannel({ operation_intent: "bind_existing" });
      void client.bindExistingProjectChannel({
        // @ts-expect-error bind-existing surface statically rejects create intent
        operation_intent: "create",
        bind_existing: {},
      });
    }

    const body = {
      operation_intent: "create" as const,
      operation_id: "operation-one",
      step_id: "conversations-channel",
      resource_kind: "channel",
      direction: "forward",
      target_digest: "path-digest",
    };
    await client.getProjectChannelRegistrationCapability();
    await client.listProjectChannelRegistrations({
      project_id: "wks_ys8tzpsZJMNtx0ORZtLsA",
      cursor: "chn_00000000000000000000000000000001",
      max_items: 100,
      response_byte_limit: 32_768,
      time_budget_ms: 5_000,
      call_limit: 1,
    });
    await client.listProjectChannelMessages(
      "chn_11111111111111111111111111111111",
      {
        project_id: "wks_ys8tzpsZJMNtx0ORZtLsA",
        cursor: 42,
        max_items: 100,
        response_byte_limit: 32_768,
        time_budget_ms: 5_000,
        call_limit: 1,
      },
    );
    await client.registerProjectChannel(body);
    await client.bindExistingProjectChannel({
      ...body,
      operation_intent: "bind_existing",
      bind_existing: {
        target_id: "chn_11111111111111111111111111111111",
        expected_project_id: "legacy-project",
        expected_revision: "prior-revision",
        expected_digest: "prior-digest",
      },
    });
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
      request_digest: "request-digest",
      precondition_digest: "precondition-digest",
      precondition_kind: "bind_existing",
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
      { method: "GET", path: "/v1/project-registration/channels" },
      { method: "GET", path: "/v1/project-registration/channels/chn_11111111111111111111111111111111/messages" },
      { method: "POST", path: "/v1/project-registration/channels" },
      { method: "POST", path: "/v1/project-registration/channels/bind-existing" },
      { method: "GET", path: "/v1/project-registration/channels/receipts/terminal" },
      { method: "GET", path: "/v1/project-registration/channels/chn_11111111111111111111111111111111" },
      { method: "POST", path: "/v1/project-registration/channels/inverse" },
      { method: "POST", path: "/v1/project-registration/channels/inverse/verify" },
    ]);
    const channelPageUrl = new URL(calls[1].url);
    expect(channelPageUrl.searchParams.get("project_id")).toBe("wks_ys8tzpsZJMNtx0ORZtLsA");
    expect(channelPageUrl.searchParams.get("cursor")).toBe("chn_00000000000000000000000000000001");
    expect(channelPageUrl.searchParams.get("max_items")).toBe("100");
    const messagePageUrl = new URL(calls[2].url);
    expect(messagePageUrl.searchParams.get("project_id")).toBe("wks_ys8tzpsZJMNtx0ORZtLsA");
    expect(messagePageUrl.searchParams.get("cursor")).toBe("42");
    expect(calls[3].body).toEqual(body);
    expect(calls[4].body).toMatchObject({
      operation_intent: "bind_existing",
      bind_existing: {
        target_id: "chn_11111111111111111111111111111111",
        expected_project_id: "legacy-project",
      },
    });
    const lookupUrl = new URL(calls[5].url);
    expect(lookupUrl.searchParams.get("max_items")).toBe("1");
    expect(lookupUrl.searchParams.get("call_limit")).toBe("1");
    expect(lookupUrl.searchParams.get("target_id")).toBe("chn_11111111111111111111111111111111");
    expect(lookupUrl.searchParams.get("precondition_kind")).toBe("bind_existing");
    expect(lookupUrl.searchParams.get("request_digest")).toBe("request-digest");
    expect(lookupUrl.searchParams.get("precondition_digest")).toBe("precondition-digest");
    const readUrl = new URL(calls[6].url);
    expect(readUrl.searchParams.get("target_selector")).toBe("fleet-resources");
    expect(readUrl.searchParams.get("target_digest")).toBe("path-digest");
  });
});
