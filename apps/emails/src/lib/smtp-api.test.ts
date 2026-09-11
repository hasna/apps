import { expect, test } from "bun:test";
import { connect } from "node:net";
import { createSmtpSession } from "./smtp-receiver.js";
import { persistSmtpDelivery, startApiSmtpListener } from "./smtp-api.js";
const capability = { available: true, durable_receipts: true, max_raw_bytes: 10485760, provider_id: null };
const wire = "EHLO fixture\r\nMAIL FROM:<sender@example.net>\r\nRCPT TO:<inbox@example.com>\r\nDATA\r\nSubject: Fixture\r\n\r\nhello\r\n.\r\n";
test("API transport retries identical raw DATA and transaction after uncertainty, and only durable storage earns 250", async () => {
  const bodies: unknown[] = [];
  const session = createSmtpSession({ persist: delivery => persistSmtpDelivery(delivery, "provider", async (_path, body) => {
    bodies.push(structuredClone(body)); if (bodies.length === 1) throw new Error("connection lost after commit"); return { stored: true, id: "durable", duplicate: true };
  }) });
  const replies = (await session.receive(Buffer.from(wire))).join("");
  expect(replies).toContain("250 2.0.0"); expect(bodies).toHaveLength(2); expect(bodies[0]).toEqual(bodies[1]);
  expect(bodies[0]).toMatchObject({ provider_id: "provider", raw_base64: Buffer.from("Subject: Fixture\r\n\r\nhello\r\n").toString("base64") });
});
test("unknown or absent durable receipt yields 451, never DATA acceptance", async () => {
  for (const receipt of [{}, { stored: false, id: "pending", duplicate: false }, { stored: true, id: "", duplicate: false }]) {
    const session = createSmtpSession({ persist: delivery => persistSmtpDelivery(delivery, undefined, async () => receipt) });
    const replies = await session.receive(Buffer.from(wire)); expect(replies.at(-1)).toContain("451");
  }
});
test("preflight fails closed before binding on missing API capability and blank provider", async () => {
  await expect(startApiSmtpListener(0, undefined, async () => ({}))).rejects.toThrow("needs SMTP");
  let calls = 0;
  await expect(startApiSmtpListener(0, "", async () => { calls++; return capability; })).rejects.toThrow("selector"); expect(calls).toBe(0);
});
test("real loopback listener binds an actual port and does not acknowledge DATA before durable API receipt", async () => {
  let accept!: () => void, entered!: () => void;
  const called = new Promise<void>(resolve => { entered = resolve; }), blocked = new Promise<void>(resolve => { accept = resolve; });
  const listener = await startApiSmtpListener(0, undefined, async (_path, body) => { if (!body) return capability; entered(); await blocked; return { stored: true, id: "real-durable", duplicate: false }; });
  expect(listener.port).toBeGreaterThan(0);
  const socket = connect(listener.port, "127.0.0.1"); let output = "";
  socket.on("data", data => { output += data.toString(); });
  try {
    await new Promise<void>((resolve, reject) => { socket.once("connect", resolve); socket.once("error", reject); });
    socket.write(wire); await called;
    expect(output).not.toContain("250 2.0.0");
    const receipt = new Promise<void>(resolve => { socket.on("data", () => { if (output.includes("250 2.0.0")) resolve(); }); });
    accept(); await receipt; expect(output).toContain("250 2.0.0");
  } finally { accept(); socket.destroy(); await listener.stop(); }
});
