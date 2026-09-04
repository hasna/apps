import { describe, test, expect, beforeEach, afterEach, spyOn } from "bun:test";
import { Command } from "commander";
import { registerStatus } from "./status";
const saved = { ...process.env };
const originalFetch = globalThis.fetch;
beforeEach(() => {
  for (const name of Object.keys(process.env)) if (name.includes("ATTACHMENTS")) delete process.env[name];
  process.env.HASNA_ATTACHMENTS_API_URL = "https://attachments.example.test";
  process.env.HASNA_ATTACHMENTS_API_KEY = "diagnostic-test-key";
});
afterEach(() => { process.env = { ...saved }; globalThis.fetch = originalFetch; process.exitCode = 0; });
async function run() {
  let text = "";
  const output = spyOn(process.stdout, "write").mockImplementation(chunk => { text += String(chunk); return true; });
  try { const p = new Command(); registerStatus(p); await p.parseAsync(["node", "test", "status"]); return text; }
  finally { output.mockRestore(); }
}
describe("status canonical diagnostic", () => {
  test("requires authenticated service response; does not probe local DB or S3", async () => {
    let calls = 0;
    globalThis.fetch = (async (url, init) => { calls++; expect(String(url)).toContain("https://attachments.example.test/v1/attachments"); expect(new Headers(init?.headers).get("authorization")).toBe("Bearer diagnostic-test-key"); expect(init?.redirect).toBe("error"); return Response.json([]); }) as typeof fetch;
    const output = await run(); expect(output).toContain("authorized and reachable"); expect(output).not.toContain("diagnostic-test-key"); expect(calls).toBe(1);
  });
  for (const status of [401, 403, 500]) test("reports blocked for HTTP " + status, async () => {
    globalThis.fetch = (async () => new Response("sensitive-response", { status })) as typeof fetch;
    const output = await run(); expect(output).toContain("BLOCKED"); expect(output).not.toContain("sensitive-response"); expect(process.exitCode).toBe(1);
  });
  test("missing config makes zero network calls and does not fabricate identity", async () => {
    delete process.env.HASNA_ATTACHMENTS_API_URL;
    globalThis.fetch = (() => { throw new Error("must not call"); }) as typeof fetch;
    expect(await run()).toContain("BLOCKED");
  });
});
