import { expect, test } from "bun:test";
import { connect } from "node:net";
import { resolve } from "node:path";

test.each([201, 202])("actual CLI binds, requires a durable HTTP receipt (%i), and exits on SIGINT", async status => {
  const token = crypto.randomUUID(); let imports = 0;
  const api = Bun.serve({ port: 0, fetch: async request => {
    if (request.headers.get("authorization") !== `Bearer ${token}`) return Response.json({ error: "fixture auth required" }, { status: 401 });
    const url = new URL(request.url);
    if (url.pathname !== "/v1/inbox/smtp") return Response.json({}, { status: 404 });
    if (request.method === "GET") return Response.json({ available: true, durable_receipts: true, max_raw_bytes: 10485760, provider_id: url.searchParams.get("provider_id") });
    const body = await request.json();
    expect(body.provider_id).toBe("fixture-provider"); expect(body.raw_base64).toBeTruthy(); imports++;
    return Response.json({ stored: true, id: "fixture-durable", duplicate: false }, { status });
  } });
  const env = { ...process.env };
  for (const name of Object.keys(env)) if (/^(?:HASNA_EMAILS_|EMAILS_|HASNA_STATION)/.test(name)) delete env[name];
  Object.assign(env, { HASNA_EMAILS_API_URL: `http://127.0.0.1:${api.port}/v1`, HASNA_EMAILS_API_KEY: token, EMAILS_CLIENT_ENV_LOADED: "1", NO_COLOR: "1" });
  const child = Bun.spawn({ cmd: [process.execPath, "--no-env-file", resolve(import.meta.dir, "../index.tsx"), "inbox", "listen", "--port", "0", "--provider", "fixture-provider", "--json"], env, stdout: "pipe", stderr: "pipe" });
  let socket: ReturnType<typeof connect> | undefined;
  try {
    const reader = child.stdout.getReader(); let out = "";
    while (!out.includes("\n")) { const part = await reader.read(); if (part.done) break; out += Buffer.from(part.value).toString(); }
    const announced = JSON.parse(out.trim());
    expect(announced).toMatchObject({ listening: true, host: "127.0.0.1", storage: "api", foreground: true }); expect(announced.port).toBeGreaterThan(0);
    socket = connect(announced.port, "127.0.0.1"); let received = "";
    const done = new Promise<void>((resolve, reject) => { socket!.on("error", reject); socket!.on("data", data => { received += data; if (received.includes(status === 201 ? "250 2.0.0" : "451")) resolve(); }); });
    socket.write("EHLO fixture\r\nMAIL FROM:<sender@example.net>\r\nRCPT TO:<inbox@example.com>\r\nDATA\r\nSubject: CLI fixture\r\n\r\nSynthetic\r\n.\r\n");
    await done; expect(imports).toBe(status === 201 ? 1 : 2);
    if (status === 202) expect(received).not.toContain("250 2.0.0");
    child.kill("SIGINT"); expect(await child.exited).toBe(0);
  } finally { socket?.destroy(); child.kill(); await child.exited; api.stop(true); }
}, 15000);
