import { expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";

test.each(["sent", "pending", "uncertain", "replayed", "old-api", "cancel-read", "cancel-preflight"])("real roundtrip CLI uses the account API and requires a confirmed send receipt (%s)", async outcome => {
  const confirmed = outcome === "sent" || outcome === "replayed";
  const token = crypto.randomUUID(), home = mkdtempSync(join(tmpdir(), "emails-roundtrip-cli-"));
  const received: Record<string, unknown>[] = [];
  const sends: Record<string, unknown>[] = [];
  const api = Bun.serve({ port: 0, fetch: async request => {
    if (request.headers.get("authorization") !== `Bearer ${token}`) return Response.json({ error: "fixture auth required" }, { status: 401 });
    const url = new URL(request.url), path = url.pathname.replace(/^\/emails/, "");
    if ((path === "/openapi.json" || path === "/v1/openapi.json") && outcome === "cancel-preflight") { queueMicrotask(() => child.kill("SIGINT")); return new Promise<Response>(() => {}); }
    if (path === "/openapi.json" || path === "/v1/openapi.json") return Response.json({ openapi: "3.1.0", info: { title: "fixture", version: "1" }, security: [], components: {}, paths: { "/v1/messages/send": { post: { requestBody: { content: { "application/json": { schema: { properties: outcome === "old-api" ? {} : { provider_id: { type: "string" } } } } } } } } } });
    if (path === "/v1/messages" && outcome === "cancel-read") { queueMicrotask(() => child.kill("SIGINT")); return new Promise<Response>(() => {}); }
    if (path === "/v1/messages" && request.method === "GET") return Response.json({ messages: received.filter(row => (!url.searchParams.get("to") || (row.to_addrs as string[]).includes(url.searchParams.get("to")!)) && (!url.searchParams.get("subject") || row.subject === url.searchParams.get("subject"))), next_cursor: null });
    if (path.startsWith("/v1/messages/") && request.method === "GET") return Response.json({ message: received.find(row => row.id === path.split("/").at(-1)) });
    if (path === "/v1/messages/send" && request.method === "POST") {
      const body = await request.json() as Record<string, unknown>; sends.push(body);
      const inbound = { id: `received-${sends.length}`, tenant_id: "11111111-1111-4111-8111-111111111111", direction: "inbound", from_addr: body.from, to_addrs: body.to, cc_addrs: [], subject: body.subject, snippet: body.text, attachment_count: 0, body_text: body.text, body_html: null, status: "received", received_at: "2026-09-07T00:00:00Z", is_read: false, is_starred: false, labels: [], headers: {}, attachments: [], provider_id: "provider-1", provider_message_id: null, message_id: null, in_reply_to: null, source_id: null, send_state: "none", send_started_at: null, created_at: "2026-09-07T00:00:00Z", updated_at: "2026-09-07T00:00:00Z" };
      if (confirmed) received.push(inbound);
      return Response.json({ ...(outcome === "pending" ? { in_progress: true } : { sent: true }), ...(outcome === "replayed" ? { idempotent_replay: true } : {}), provider: "ses", provider_message_id: `upstream-${sends.length}`, message: { ...inbound, id: `outbound-${sends.length}`, direction: "outbound", send_state: confirmed ? "sent" : outcome } }, { status: outcome === "replayed" ? 200 : 202 });
    }
    return Response.json({ error: "unexpected fixture request" }, { status: 404 });
  } });
  const env = { ...process.env };
  for (const name of Object.keys(env)) if (/^(?:HASNA_EMAILS_|EMAILS_|HASNA_STATION)/.test(name)) delete env[name];
  Object.assign(env, { HOME: home, HASNA_EMAILS_API_URL: `http://127.0.0.1:${api.port}/emails/v1`, HASNA_EMAILS_API_KEY: token, EMAILS_CLIENT_ENV_LOADED: "1", EMAILS_DB_PATH: join(home, "must-not-exist.db"), NO_COLOR: "1" });
  const child = Bun.spawn({ cmd: [process.execPath, "--no-env-file", resolve(import.meta.dir, "../index.tsx"), "provision", "roundtrip", "--domain", "example.com", "--provider", "provider-1", "--addresses", "one,two", "--count", "1", "--poll-attempts", "1", "--poll-interval", "0", "--throttle", "0", "--idempotency-key", "cli-fixture", "--json"], env, stdout: "pipe", stderr: "pipe" });
  try {
    const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
    expect(code, stderr + stdout).toBe(outcome.startsWith("cancel-") ? 130 : confirmed ? 0 : 1);
    if (outcome === "old-api") {
      expect(sends).toHaveLength(0); expect(stderr).toContain("provider-aware sending");
      expect(existsSync(join(home, "must-not-exist.db"))).toBe(false);
      return;
    }
    const result = JSON.parse(stdout);
    expect(result.run_id).toBe("cli-fixture");
    expect(result.complete).toBe(confirmed);
    expect(result.received).toBe(confirmed ? 2 : 0);
    expect(sends).toHaveLength(outcome.startsWith("cancel-") ? 0 : confirmed ? 2 : 1);
    if (outcome.startsWith("cancel-")) expect(result.errors[0]).toContain("interrupted");
    expect(sends.every(item => item.provider_id === "provider-1" && String(item.idempotency_key).startsWith("roundtrip:"))).toBe(true);
    expect(existsSync(join(home, "must-not-exist.db"))).toBe(false);
    expect(existsSync(join(home, ".hasna/emails/emails.db"))).toBe(false);
  } finally { child.kill(); await child.exited; api.stop(true); rmSync(home, { recursive: true, force: true }); }
}, 15000);
