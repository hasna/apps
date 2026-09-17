import { expect, test } from "bun:test";
import { createInferenceGateway } from "../src/inference-gateway";
import { compileModelPolicy } from "../src/model-policy";

for (const [protocol, path] of [
  ["openai-responses", "/responses"],
  ["openai-chat", "/chat/completions"],
  ["anthropic-messages", "/messages"],
] as const) test(`${protocol} explains billing refusal, never falls back, and recovers after funding`, async () => {
  const credential = "private-provider-credential-fixture";
  const models = [{ id: "main", name: "Main" }, { id: "fallback", name: "Fallback" }];
  const events: any[] = [], requested: string[] = [];
  let funded = false;
  const upstream = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(request) {
    const body = await request.json(); requested.push(body.model);
    return funded ? Response.json({ model: "main", output: "recovered" })
      : Response.json({ error: { message: `${credential} private prompt text https://untrusted.invalid/pay`, code: 402 } }, { status: 402 });
  } });
  const gateway = createInferenceGateway({
    harness: "codex", protocol, baseUrl: upstream.url.origin + "/v1", providerId: "fixture", credential,
    model: "main", models, stateDir: "/tmp/switcher-billing-state", cwd: "/tmp", catalogPath: "/tmp/switcher-billing-catalog.json",
    compiledPolicy: compileModelPolicy("main", models, { version: 1, allowedModels: ["fallback"], fallbacks: { main: ["fallback"] } }),
    onRoutingEvent: event => events.push(event),
  });
  const request = () => fetch(gateway.baseUrl + path, {
    method: "POST", headers: { authorization: `Bearer ${gateway.token}`, "content-type": "application/json" },
    body: JSON.stringify({ model: "main", input: "hello", messages: [] }),
  });
  try {
    const rejected = await request();
    expect(rejected.status).toBe(402);
    const failure = await rejected.json();
    expect(failure.error.code).toBe("provider_payment_required");
    expect(failure.error.message).toContain("account balance");
    expect(failure.error.message).toContain("spending limit");
    expect(failure.error.message).toContain("output-token budget");
    expect(requested).toEqual(["main"]);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ reason: "provider_payment_required", upstreamStatus: 402 });
    for (const secret of [credential, "private prompt text", "untrusted.invalid"]) {
      expect(JSON.stringify(failure)).not.toContain(secret);
      expect(JSON.stringify(events)).not.toContain(secret);
    }
    funded = true;
    const recovered = await request();
    expect(recovered.status).toBe(200);
    expect((await recovered.json()).output).toBe("recovered");
    expect(requested).toEqual(["main", "main"]);
    expect(events.at(-1).upstreamStatus).toBe(200);
  } finally { await gateway.cleanup(); await upstream.stop(true); }
});
