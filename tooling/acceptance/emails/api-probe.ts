/** Black-box requests to the actual API process and inspection of captured provider wire data. */
import { assertSendSuccess, assertApiReady, assertNoProviderReplay, assertProviderAttempt, assertProviderRequest } from "./probe-assertions.ts";
const input = await Bun.stdin.json();
const check = (ok: unknown, code: string) => { if (!ok) throw new Error(code); };
async function request(path: string, token = input.tenants[0].token, body?: unknown) {
  const response = await fetch(`http://pair-api:8080${path}`, { method: body === undefined ? "GET" : "POST",
    headers: { "x-api-key": token, "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(15000) });
  return { status: response.status, body: await response.json() as any };
}
async function control(path: string, body?: unknown) {
  const response = await fetch(`http://127.0.0.1:9000/control/${path}`, { method: body === undefined ? "GET" : "POST",
    headers: { authorization: `Bearer ${input.control_token}`, "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(5000) });
  check(response.ok, "FIXTURE_CONTROL"); return await response.json() as any;
}
async function run() {
  assertApiReady(await request("/ready"), input.version);
  const a = await request("/v1/domains"); const b = await request("/v1/domains", input.tenants[1].token);
  check(a.status === 200 && b.status === 200 && a.body.domains.length === 1 && b.body.domains.length === 1
    && a.body.domains[0].domain === "a.example.test" && b.body.domains[0].domain === "b.example.test", "API_TENANT_LIST");
  check((await request(`/v1/domains/${a.body.domains[0].id}`, input.tenants[1].token)).status === 404, "API_TENANT_GET");
  check((await request("/v1/domains", "invalid")).status === 401, "API_AUTH_REQUIRED");
  for (const path of ["/v1/addresses", "/v1/messages", "/v1/me"]) check((await request(path)).status === 200, "API_ROUTE");
  const parent = await request("/v1/messages", undefined, { from: "recipient@external.test", to: [input.tenants[0].email],
    subject: "Synthetic thread", direction: "inbound", message_id: "<parent@external.test>",
    headers: { References: "<root@external.test>" }, source_id: `parent-${input.provider}`, received_at: new Date().toISOString() });
  check(parent.status === 201 && parent.body.message?.id, "API_REPLY_PARENT");
  const body = { from: input.tenants[0].email, to: ["recipient@external.test"], subject: "Re: Synthetic thread", text: "Synthetic acceptance only",
    reply_to: '"Reply Desk" <reply@a.example.test>', reply_to_message_id: parent.body.message.id, idempotency_key: crypto.randomUUID() };
  const beforeSend = await control("state");
  const sent = await request("/v1/messages/send", undefined, body);
  assertSendSuccess(sent);
  const afterSend = await control("state");
  assertProviderAttempt(beforeSend, afterSend, input.provider, 200);
  const captured = afterSend.sends.filter((s: any) => s.id === sent.body.provider_message_id);
  check(captured.length === 1 && captured[0].provider === input.provider, "PROVIDER_CAPTURE");
  const wire = captured[0].body;
  assertProviderRequest(input.provider, wire);
  const beforeReplay = await control("state");
  const repeat = await request("/v1/messages/send", undefined, body);
  check(repeat.status === 200 && repeat.body.idempotent_replay === true && repeat.body.message?.id === sent.body.message.id
    && repeat.body.sent === true && repeat.body.provider_message_id === sent.body.provider_message_id, "API_SEND_IDEMPOTENCY");
  const afterReplay = await control("state");
  assertNoProviderReplay(beforeReplay, afterReplay);
  const modes = [["reject", 422, false], ["uncertain", 502, null], ...(input.provider === "resend" ? [["unproven", 502, null], ["missing-receipt", 502, null]] : [])] as const;
  for (const [mode, status, outcome] of modes) {
    await control("mode", { send: mode });
    const beforeFailure = await control("state");
    const result = await request("/v1/messages/send", undefined, { ...body, idempotency_key: crypto.randomUUID() });
    check(result.status === status && result.body.sent === outcome && result.body.retry_safe === (mode === "reject"), "API_PROVIDER_FAILURE_CONTRACT");
    assertProviderAttempt(beforeFailure, await control("state"), input.provider, mode === "uncertain" ? 503 : mode === "missing-receipt" ? 200 : 400);
    if (mode === "missing-receipt") check(!result.body.provider_message_id && result.body.reconciliation_required === true, "API_MISSING_RECEIPT_UNCERTAIN");
  }
  await control("mode", { send: "normal" });
  return { provider: input.provider, checks: ["readiness", "version", "routes", "tenant_rls", "reply_headers", "from_name", "provider_contracts"],
    tested_routes: ["GET /ready", "GET /v1/domains", "GET /v1/domains/:id", "GET /v1/addresses", "GET /v1/messages", "GET /v1/me", "POST /v1/messages", "POST /v1/messages/send"],
    captured_request_sha256: `sha256:${new Bun.CryptoHasher("sha256").update(JSON.stringify(wire)).digest("hex")}` };
}
try { console.log(JSON.stringify(await run())); }
catch (error) { console.log(JSON.stringify({ error: error instanceof Error && /^[A-Z][A-Z0-9_]{0,100}$/.test(error.message) ? error.message : "API_PROBE_FAILED" })); process.exitCode = 1; }
