import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { startV1Stub, type V1Stub } from "../test-support/v1-stub.js";
import { buildServer } from "./server.js";

// Self-hosted-ONLY: there is no local SQLite. These guards prove that send routes
// through the /v1 stub and that local-state tools fail fast with the API-only guard
// message (the guards still live in src/mcp/tools/{email-ops,misc-ops}.ts).

let stub: V1Stub;

async function callTool(name: string, args: Record<string, unknown>) {
  const server = buildServer() as unknown as {
    _registeredTools: Record<string, { handler: (input: Record<string, unknown>) => Promise<{ isError?: boolean; content: Array<{ type: string; text: string }> }> }>;
  };
  return await server._registeredTools[name]!.handler(args);
}

function resultText(result: { content: Array<{ text: string }> }): string {
  return result.content[0]?.text ?? "";
}

beforeAll(async () => {
  stub = await startV1Stub();
});

afterAll(() => stub.stop());

beforeEach(async () => {
  await stub.reset();
  stub.applyEnv();
});

afterEach(() => {
  stub.clearEnv();
});

describe("MCP self_hosted guards", () => {
  it("routes send_email through the self-hosted API without touching a local DB", async () => {
    const result = await callTool("send_email", {
      from: "ops@example.com",
      to: ["user@example.com"],
      subject: "Self-hosted MCP send",
      text: "hello",
      idempotency_key: "mcp-self-hosted-send",
    });

    expect(result.isError).not.toBe(true);
    const payload = JSON.parse(resultText(result)) as { success: boolean; email_id: string; message_id: string };
    expect(payload.success).toBe(true);
    expect(payload.email_id.length).toBeGreaterThan(0);
    expect(payload.message_id.length).toBeGreaterThan(0);

    // The send persisted an outbound row on the /v1 store (not a local DB).
    const messages = await stub.list("messages");
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({
      id: payload.email_id,
      direction: "outbound",
      from_addr: "ops@example.com",
      to_addrs: ["user@example.com"],
      subject: "Self-hosted MCP send",
      body_text: "hello",
      status: "sent",
      send_state: "sent",
      provider_message_id: payload.message_id,
      message_id: "stub-1",
    });
  });

  it("refuses a provider selector when the API cannot advertise its send contract, and sends nothing", async () => {
    // This assertion inverted when the email-ops family collapsed to one
    // implementation. It used to check a guard in the deleted arm module whose
    // refusal text told the caller which deployment word to set to reach the other
    // arm's behaviour — a refusal that documented its own bypass. `provider_id` is
    // now carried all the way to the one send path, which refuses it because the
    // service selects the outbound provider itself.
    const result = await callTool("send_email", {
      from: "ops@example.com",
      to: ["user@example.com"],
      subject: "guarded",
      text: "hi",
      provider_id: "provider-1",
    });
    expect(result.isError).toBe(true);
    expect(resultText(result)).toContain("/openapi.json");
    // The discriminating half: refused BEFORE dispatch, so no mail and no row.
    expect(await stub.list("messages")).toHaveLength(0);
  });

  it("refuses metadata sends when API capability cannot be verified", async () => {
    // Accepted schema fields must either cross the API intact or refuse explicitly.
    const cases: Array<[string, unknown]> = [
      ["headers", { "X-Thing": "1" }],
      ["tags", { campaign: "spring" }],
    ];

    for (const [option, value] of cases) {
      const result = await callTool("send_email", {
        from: "ops@example.com",
        to: ["user@example.com"],
        subject: "uncarried",
        text: "hi",
        [option]: value,
      });
      expect(result.isError, `${option} must be refused`).toBe(true);
      const text = resultText(result);
      expect(text).toMatch(/openapi|API needs an update/);
      // A missing capability document must not cause a fallback to client adapters.
      expect(text).not.toMatch(/[A-Z][A-Z0-9]*_[A-Z0-9_]*=/);
      // ...and nothing may have been sent on the way to the refusal.
      expect(await stub.list("messages"), `${option} must not send`).toHaveLength(0);
    }
  });

  it("does not fabricate an HTML part for a plain-text send", async () => {
    // The two deleted arms disagreed about this and neither said so: the local one
    // sent the text as given, this one markdown-rendered it into an HTML body the
    // caller never wrote. One implementation cannot hold both, so the collapse
    // picks the first — explicitly, because this tool has a separate `html`
    // parameter for a caller who wants one. Asserted on BOTH sides of the seam
    // (the local half is in src/mcp/tools/email-ops.test.ts) so the choice is
    // pinned rather than incidental.
    const result = await callTool("send_email", {
      from: "ops@example.com",
      to: ["user@example.com"],
      subject: "text only",
      text: "line one\nline two",
    });

    expect(result.isError).not.toBe(true);
    const messages = await stub.list("messages");
    expect(messages).toHaveLength(1);
    expect(messages[0]?.["body_text"]).toBe("line one\nline two");
    expect(messages[0]?.["body_html"] ?? null).toBeNull();
  });

  it("carries a template through the collapsed send path rather than refusing it", async () => {
    // The deleted arm refused `template` and `template_vars` outright, on the
    // grounds that the service's send route does not render templates. It does not
    // have to: templates are read through their own family, so one implementation
    // renders them here and sends the rendered result. This is capability the API
    // configuration did not have before the collapse.
    await stub.seed({
      templates: [{
        id: "tpl-1",
        name: "welcome",
        subject_template: "Hello {{name}}",
        text_template: "Hi {{name}}, welcome.",
      }],
    });

    const result = await callTool("send_email", {
      from: "ops@example.com",
      to: ["user@example.com"],
      template: "welcome",
      template_vars: { name: "Ada" },
    });

    expect(result.isError).not.toBe(true);
    const messages = await stub.list("messages");
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({
      subject: "Hello Ada",
      body_text: "Hi Ada, welcome.",
    });
  });

  it("fails self-hosted-client-only tools without touching a local DB", async () => {
    // These read/write server-owned state; the self-hosted client refuses them.
    //
    // `get_stats` USED TO BE IN THIS LIST and has moved to its own case below, because
    // the refusal it asserted is no longer true rather than no longer checked. Delivery
    // statistics collapsed to one implementation that measures them by enumerating the
    // store the operator configured (src/lib/stats.ts), and every operation it needs —
    // the delivery-event list and the outbound message stream — is served over `/v1`. A
    // refusal here would now be a refusal of something this client demonstrably can do,
    // which is what the case below demonstrates.
    const cases: Array<[string, Record<string, unknown>]> = [
      ["sync_s3_inbox", { bucket: "inbound-bucket" }],
    ];

    for (const [name, args] of cases) {
      const result = await callTool(name, args);
      expect(result.isError).toBe(true);
      expect(resultText(result)).toContain("not available in the self-hosted client");
    }
  });

  it("REFUSES pull_events in the ingestion pipeline's own storage-derived words", async () => {
    // `pull_events` USED TO BE IN THE LIST ABOVE. It still refuses — provider
    // delivery-event ingestion writes ledgers that exist only beside a local database,
    // and pulls with credentials this client does not hold — but the refusal is no
    // longer the deleted client stub's sentence: the collapsed family derives it from
    // STORAGE configuration (src/lib/sync.ts) and names the setting to change, which
    // is strictly more actionable than "not available".
    const result = await callTool("pull_events", {});
    expect(result.isError).toBe(true);
    expect(resultText(result)).toContain("ingestion belongs to that service");
    expect(resultText(result)).toContain("Unset HASNA_EMAILS_API_URL");
  });

  it("MEASURES delivery statistics over /v1 instead of refusing them", async () => {
    // The positive control for the refusal that came off the list above. It seeds the
    // store through the API and requires real numbers back out of it — a case that
    // asserted only "no longer refuses" would pass against a tool that answered zeros.
    const day = 24 * 60 * 60 * 1000;
    const ago = (ms: number) => new Date(Date.now() - ms).toISOString();
    await stub.seed({
      events: [
        { id: "ev-1", provider_id: "provider-1", type: "delivered", occurred_at: ago(day) },
        { id: "ev-2", provider_id: "provider-1", type: "delivered", occurred_at: ago(2 * day) },
        { id: "ev-3", provider_id: "provider-1", type: "bounced", occurred_at: ago(3 * day) },
        // Outside a 30-day window, so "the window is applied" is measured rather than
        // assumed.
        { id: "ev-4", provider_id: "provider-1", type: "delivered", occurred_at: ago(90 * day) },
      ],
      messages: [
        {
          id: "msg-1",
          direction: "outbound",
          from_addr: "ops@example.com",
          to_addrs: ["user@example.com"],
          subject: "sent one",
          status: "sent",
          received_at: ago(day),
        },
        {
          id: "msg-2",
          direction: "outbound",
          from_addr: "ops@example.com",
          to_addrs: ["user@example.com"],
          subject: "sent two",
          status: "sent",
          received_at: ago(2 * day),
        },
        // Outside the window on the outbound side too.
        {
          id: "msg-3",
          direction: "outbound",
          from_addr: "ops@example.com",
          to_addrs: ["user@example.com"],
          subject: "sent long ago",
          status: "sent",
          received_at: ago(120 * day),
        },
      ],
    });

    const result = await callTool("get_stats", { period: "30d" });
    expect(result.isError).not.toBe(true);
    const payload = JSON.parse(resultText(result)) as {
      sent: number | null;
      delivered: number | null;
      bounced: number | null;
      delivery_rate: number | null;
      events_availability: { complete: boolean | null; source: string };
      gaps: Record<string, unknown>;
    };
    expect(payload.delivered).toBe(2);
    expect(payload.bounced).toBe(1);
    expect(payload.sent).toBe(2);
    expect(payload.delivery_rate).toBe(100);
    // Both inventories were fully enumerated over HTTP, so nothing is a bound and nothing
    // is refused.
    expect(payload.events_availability.complete).toBe(true);
    expect(payload.gaps).toEqual({});
  });

  it("reports address provisioning API incompatibility without using client cloud credentials", async () => {
    const result=await callTool("provision_address",{email:"ops@example.com",provider_id:"provider-1"});
    expect(result.isError).toBe(true);expect(resultText(result)).toContain("POST /v1/provision/address");expect(resultText(result)).toContain("HTTP 405");
  });

  it("reports domain provisioning API incompatibility without using client cloud credentials", async () => {
    const result = await callTool("provision_domain", { domain: "example.com", provider_id: "provider-1" });
    expect(result.isError).toBe(true);
    expect(resultText(result)).toContain("POST /v1/domains/provision failed: 405");
  });

  it("reads shared provisioning status and preserves empty and missing-domain semantics", async () => {
    const empty = await callTool("provision_status", {});
    expect(empty.isError).not.toBe(true);
    expect(JSON.parse(resultText(empty))).toMatchObject({ items: [] });
    await stub.seed({ domains: [{ id: "00000000-0000-4000-8000-000000000071", domain: "example.test", provider_id: null, provisioning_status: "ready" }], addresses: [{ id: "00000000-0000-4000-8000-000000000072", domain_id: "00000000-0000-4000-8000-000000000071", email: "ops@example.test", provisioning_status: "pending" }] });
    const result = await callTool("provision_status", { domain: "EXAMPLE.TEST", limit: 1 });
    expect(result.isError, resultText(result)).not.toBe(true);
    expect(JSON.parse(resultText(result)).cli_equivalent).toContain("emails provision status EXAMPLE.TEST --limit 1 --json");
    expect(JSON.parse(resultText(result))).toMatchObject({ items: [{ domain: "example.test", provisioning: { provisioning_status: "ready" }, addresses: [{ email: "ops@example.test", provisioning: { provisioning_status: "pending" } }] }] });
    expect((await callTool("provision_status", { domain: "missing.test" })).isError).toBe(true);
    expect((await callTool("provision_status", { domain: " " })).isError).toBe(true);
  });

  it("reports missing SES API capability without falling back to client cloud credentials", async () => {
    const result = await callTool("setup_ses_inbound", { domain: "example.test", bucket: "bound-inbound" });
    expect(result.isError).toBe(true);
    expect(resultText(result)).toContain("API needs an update");
    expect(resultText(result)).not.toContain("local-database configuration");
  });

  it("routes read tools through /v1 (empty store yields empty lists, no local DB)", async () => {
    for (const name of ["list_templates", "list_sandbox_emails", "export_emails"]) {
      const result = await callTool(name, {});
      expect(result.isError).not.toBe(true);
      const payload = JSON.parse(resultText(result)) as { items: unknown[] };
      expect(payload.items).toEqual([]);
    }
  });
});
