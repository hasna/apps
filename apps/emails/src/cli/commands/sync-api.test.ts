import { afterEach, describe, expect, it } from "bun:test";
import { startV1Stub, type V1Stub } from "../../test-support/v1-stub.js";

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let api: V1Stub | undefined;
let testHome: string | undefined;
afterEach(() => { api?.stop(); api = undefined; if (testHome) rmSync(testHome, { recursive: true, force: true }); });

function fixtureEnv(api: V1Stub): Record<string, string | undefined> {
  testHome = mkdtempSync(join(tmpdir(), "emails-stats-cli-"));
  const env: Record<string, string | undefined> = { ...process.env, HOME: testHome, HASNA_HOME: testHome, EMAILS_HOME: testHome, HASNA_EMAILS_HOME: testHome, EMAILS_SESSION_TOKEN: api.apiKey, HASNA_EMAILS_API_URL: api.baseUrl, HASNA_EMAILS_API_KEY: api.apiKey, NO_COLOR: "1" };
  for (const key of ["EMAILS_MODE", "HASNA_EMAILS_MODE", "EMAILS_DB_PATH", "HASNA_EMAILS_DB_PATH", "EMAILS_SELF_HOSTED_URL", "EMAILS_SELF_HOSTED_API_KEY", "EMAILS_IDP_TOKEN"]) delete env[key];
  return env;
}

describe("statistics CLI against the Emails API", () => {
  for (const args of [["stats"], ["analytics"], ["stats", "--inbox"], ["monitor", "--once", "--interval", "0.1"]]) {
    it(`reads API data for ${args.join(" ")} without a database`, async () => {
      const now = new Date().toISOString();
      api = await startV1Stub({ openapi: true, seed: {
        messages: [
          { id: "out-one", direction: "outbound", from_addr: "me@example.test", to_addrs: ["you@example.test"], received_at: now, created_at: now, status: "sent" },
          { id: "in-one", direction: "inbound", from_addr: "you@example.test", to_addrs: ["me@example.test"], received_at: now, created_at: now, attachments: [{ filename: "sample.txt", size: 3 }], attachment_count: 1 },
        ],
        events: [{ id: "delivery-one", type: "delivered", occurred_at: now, email_id: "out-one" }],
      } });
      const env = fixtureEnv(api);
      const child = Bun.spawn({ cmd: [process.execPath, "run", "src/cli/index.tsx", ...args, "--json"], env, stdout: "pipe", stderr: "pipe" });
      const [code, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
      expect(stderr).toBe("");
      expect(code).toBe(0);
      const report = JSON.parse(stdout);
      if (args.includes("--inbox")) expect(report).toMatchObject({ total: 1, with_attachments: 1, complete: true, top_senders: [{ from_address: "you@example.test", cnt: 1 }] });
      else if (args[0] === "stats" || args[0] === "monitor") expect(report).toMatchObject({ sent: 1, delivered: 1 });
      else expect(JSON.stringify(report)).toContain("you@example.test");
    }, 20_000);
  }
});

// A long configured interval must not keep the process alive after Ctrl+C.
it("monitor exits promptly on SIGINT between API refreshes", async () => {
  api = await startV1Stub({ openapi: true });
  const child = Bun.spawn({ cmd: [process.execPath, "run", "src/cli/index.tsx", "monitor", "--json", "--interval", "3600"], env: fixtureEnv(api), stdout: "pipe", stderr: "pipe" });
  const reader = child.stdout.getReader();
  const timeout = setTimeout(() => child.kill("SIGKILL"), 5000);
  try {
    const first = await reader.read();
    expect(new TextDecoder().decode(first.value)).toContain('"period"');
    child.kill("SIGINT");
    expect(await child.exited).toBe(0);
    expect(await new Response(child.stderr).text()).toBe("");
  } finally {
    clearTimeout(timeout);
    reader.releaseLock();
    child.kill();
  }
}, 10_000);
