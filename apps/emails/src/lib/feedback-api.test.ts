import { afterAll, afterEach, beforeAll, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { saveApiFeedback } from "./feedback-api.js";
import { normalizeFeedback } from "../server/self-hosted/feedback.js";
let saved: NodeJS.ProcessEnv;
const home = mkdtempSync(join(tmpdir(), "emails-feedback-api-"));
let status = 201;
let receiptStatus = "saved";
let calls = 0;
let responseBody: Record<string, unknown> = {};
let server: ReturnType<typeof Bun.serve>;
beforeAll(() => { mkdirSync(join(home, "tmp"), { mode: 0o700 }); });
beforeEach(() => {
  saved = { ...process.env };
  for (const key of Object.keys(process.env)) if (/^(?:HASNA_EMAILS_|EMAILS_)/.test(key)) delete process.env[key];
  delete process.env.HASNA_CONFIG_HOME;
  delete process.env.HASNA_HOME;
  process.env.HOME = home;
  process.env.HASNA_STATION = `feedback-${crypto.randomUUID()}`;
  process.env.EMAILS_CLIENT_ENV_LOADED = "1";
  server = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(req) {
    calls++;
    expect(new URL(req.url).pathname).toBe("/v1/feedback");
    expect(req.method).toBe("POST");
    expect(req.headers.get("authorization")).toBe(`Bearer ${process.env.HASNA_EMAILS_API_KEY}`);
    responseBody = await req.json() as Record<string, unknown>;
    return status === 201 ? Response.json({ id: "feedback-id", tenant_id: "00000000-0000-4000-8000-000000000001", ...responseBody,
      email: null, category: "general", status: receiptStatus, created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    }, { status }) : Response.json({ error: "fixture failure" }, { status });
  } });
  process.env.HASNA_EMAILS_API_URL = `http://127.0.0.1:${server.port}`;
  process.env.HASNA_EMAILS_API_KEY = crypto.randomUUID();
});
afterEach(async () => {
  await server.stop(true);
  for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key];
  Object.assign(process.env, saved);
});
afterAll(() => rmSync(home, { recursive: true, force: true }));
test("feedback normalizes bounded input without accepting caller tenant/status", () => {
  expect(normalizeFeedback({ message: " hi ", tenant_id: "other", status: "sent" }, true)).toEqual({ message: "hi" });
  expect(normalizeFeedback({ email: null }, false)).toEqual({ email: null });
  for (const input of [{ message: null }, { message: " " }, { message: "x".repeat(10001) }, { message: "ok", email: "bad" }, { message: "ok", category: [] }]) expect(() => normalizeFeedback(input, true)).toThrow();
});
test("generated client confirms a saved row without claiming delivery", async () => {
  status = 201; receiptStatus = "saved";
  expect(await saveApiFeedback({ message: "feedback" })).toEqual({ id: "feedback-id", status: "saved", delivery: "not_sent" });
  expect(responseBody).toEqual({ message: "feedback" });
});
test("older APIs report an upgrade requirement without blind retry", async () => {
  for (const code of [404, 405]) {
    status = code; const before = calls;
    await expect(saveApiFeedback({ message: "feedback" })).rejects.toThrow("API needs an update");
    expect(calls - before).toBe(1);
  }
});
test("failed or unrecognized receipts never report saved", async () => {
  status = 500;
  await expect(saveApiFeedback({ message: "feedback" })).rejects.toThrow();
  status = 201; receiptStatus = "delivered";
  await expect(saveApiFeedback({ message: "feedback" })).rejects.toThrow();
});
