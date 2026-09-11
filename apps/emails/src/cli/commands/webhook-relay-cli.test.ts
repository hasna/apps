import { expect, test } from "bun:test";
import { resolve } from "node:path";
test.each([200, 202])("actual webhook CLI preserves signed bytes, waits for receipt (%i), and stops on SIGINT", async status => {
  const token = crypto.randomUUID(), raw = Buffer.concat([Buffer.from('{ "type": "email.received", "data": {} }'), Buffer.from([255, 0, 13, 10])]); let requests = 0;
  const api = Bun.serve({ port: 0, fetch: async request => {
    if (request.headers.get("authorization") !== `Bearer ${token}`) return Response.json({}, { status: 401 });
    if (request.method === "GET") return Response.json({ available: true, signature_verification: true, durable_receipts: true, provider_id: "provider", type: "resend" });
    requests++; const envelope = await request.json(); expect(Buffer.from(envelope.raw_body_base64, "base64")).toEqual(raw); expect(envelope.signature_headers["svix-signature"]).toBe("synthetic-signature"); expect(envelope.signature_headers["x-api-key"]).toBeUndefined(); expect(request.headers.get("x-api-key")).toBeNull();
    return Response.json({ ok: true, completed: true, provider_id: "provider" }, { status });
  } });
  const env = { ...process.env };
  for (const name of Object.keys(env)) if (/^(?:HASNA_EMAILS_|EMAILS_|HASNA_STATION)/.test(name)) delete env[name];
  Object.assign(env, { HASNA_EMAILS_API_URL: `http://127.0.0.1:${api.port}/v1`, HASNA_EMAILS_API_KEY: token, EMAILS_CLIENT_ENV_LOADED: "1", NO_COLOR: "1" });
  const child = Bun.spawn({ cmd: [process.execPath, "--no-env-file", resolve(import.meta.dir, "../index.tsx"), "--json", "webhook", "listen", "--port", "0", "--provider", "provider"], env, stdout: "pipe", stderr: "pipe" });
  try {
    const reader = child.stdout.getReader(); let out = "", announced: any;
    while (!announced) { const part = await reader.read(); if (part.done) throw new Error("CLI exited before binding"); out += Buffer.from(part.value).toString(); try { announced = JSON.parse(out.trim()); } catch {} }
    expect(announced).toMatchObject({ listening: true, host: "127.0.0.1", provider_id: "provider", foreground: true });
    const response = await fetch(`http://127.0.0.1:${announced.port}/webhook/resend`, { method: "POST", headers: { "content-type": "application/json", "svix-signature": "synthetic-signature", "x-api-key": "must-not-forward" }, body: raw });
    expect(response.status).toBe(status === 200 ? 200 : 502); expect(requests).toBe(1);
    expect((await fetch(`http://127.0.0.1:${announced.port}/webhook/ses`, { method: "POST", body: raw })).status).toBe(404); expect(requests).toBe(1);
    child.kill("SIGINT"); expect(await child.exited).toBe(0);
  } finally { child.kill(); await child.exited; api.stop(true); }
}, 15000);
