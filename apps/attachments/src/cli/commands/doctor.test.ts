import { describe, test, expect, beforeEach, afterEach, spyOn } from "bun:test";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { Command } from "commander";
import { registerDoctor } from "./doctor";
const saved = { ...process.env };
const originalFetch = globalThis.fetch;
let scratchHome: string;
beforeEach(() => {
  scratchHome = mkdtempSync(join(tmpdir(), "attachments-diagnostic-"));
  // Hermetic: the shared seam's disk tier anchors here, never to a station home.
  process.env.HASNA_HOME = scratchHome;
  // Hermetic: the ambient Keychain tier is keyed by HASNA_STATION; a sentinel
  // account owns no fleet items, so a station's real items never leak in.
  process.env.HASNA_STATION = "attachments-hermetic-test";
  for (const name of Object.keys(process.env)) if (name.includes("ATTACHMENTS")) delete process.env[name];
  process.env.HASNA_ATTACHMENTS_API_URL = "https://attachments.example.test";
  process.env.HASNA_ATTACHMENTS_API_KEY = "diagnostic-test-key";
});
afterEach(() => { process.env = { ...saved }; globalThis.fetch = originalFetch; process.exitCode = 0; rmSync(scratchHome, { recursive: true, force: true }); });
async function run() {
  let stdout = "", stderr = "";
  const out = spyOn(process.stdout, "write").mockImplementation(chunk => { stdout += String(chunk); return true; });
  const err = spyOn(process.stderr, "write").mockImplementation(chunk => { stderr += String(chunk); return true; });
  try { const p = new Command(); registerDoctor(p); await p.parseAsync(["node", "test", "doctor"]); return { stdout, stderr }; }
  finally { out.mockRestore(); err.mockRestore(); }
}
describe("doctor canonical diagnostic", () => {
  test("requires authenticated service response; does not probe local DB or S3", async () => {
    let calls = 0;
    globalThis.fetch = (async (url, init) => { calls++; expect(String(url)).toContain("https://attachments.example.test/v1/attachments"); expect(new Headers(init?.headers).get("authorization")).toBe("Bearer diagnostic-test-key"); expect(init?.redirect).toBe("error"); return Response.json([]); }) as typeof fetch;
    const { stdout, stderr } = await run(); expect(stdout).toContain("authorized and reachable"); expect(stdout).not.toContain("diagnostic-test-key"); expect(stderr).toBe(""); expect(calls).toBe(1);
  });
  for (const status of [401, 403, 500]) test("reports blocked for HTTP " + status, async () => {
    globalThis.fetch = (async () => new Response("sensitive-response", { status })) as typeof fetch;
    const { stdout, stderr } = await run(); expect(stderr).toContain("BLOCKED"); expect(stdout).toBe(""); expect(stderr).not.toContain("sensitive-response"); expect(process.exitCode).toBe(1);
  });
  test("missing config makes zero network calls and does not fabricate identity", async () => {
    delete process.env.HASNA_ATTACHMENTS_API_URL;
    delete process.env.HASNA_ATTACHMENTS_API_KEY;
    globalThis.fetch = (() => { throw new Error("must not call"); }) as typeof fetch;
    const { stdout, stderr } = await run();
    expect(stdout).toBe("");
    expect(stderr).toContain("BLOCKED");
    expect(stderr).toMatch(/no API key could be resolved/i);
    expect(process.exitCode).toBe(1);
  });
});
