import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { buildPrepublishTestEnv } from "../../../scripts/prepublish-local-test.mjs";
import { startV1Stub, type V1Stub } from "../../test-support/v1-stub.js";
let api: V1Stub;
const tempDirs: string[] = [];
const ids = ["00000000-0000-4000-8000-000000000071", "00000000-0000-4000-8000-000000000072"];
beforeAll(async () => { api = await startV1Stub({ openapi: true, apiKey: crypto.randomUUID(), seed: {
  providers: ids.map((id, i) => ({ id, name: `provider-${i}`, type: "ses", active: true })),
  messages: ids.map((provider_id, i) => ({ id: `00000000-0000-4000-8000-00000000008${i}`, provider_id,
    direction: "outbound", from_addr: "sender@example.com", to_addrs: ["recipient@example.com"], cc_addrs: [],
    subject: `provider-subject-${i}`, status: "sent", body_text: "fixture", is_read: true,
    created_at: "2026-09-01T00:00:00Z", updated_at: "2026-09-01T00:00:00Z" })),
} }); });
beforeEach(async () => { await api.reset(); });
afterEach(() => {
  for (const dir of tempDirs) {
    const mailFiles = readdirSync(dir, { recursive: true }).filter((name) => /\.(?:db|sqlite)(?:-|$)/.test(String(name)));
    expect(mailFiles).toEqual([]);
  }
});
function apiEnv(): NodeJS.ProcessEnv {
  const dir = mkdtempSync(join(tmpdir(), "emails-warming-"));
  tempDirs.push(dir);
  mkdirSync(join(dir, "tmp"), { mode: 0o700 });
  return {
    ...buildPrepublishTestEnv(process.env, dir),
    HASNA_STATION: `emails-warming-${crypto.randomUUID()}`,
    HASNA_EMAILS_API_URL: api.baseUrl,
    HASNA_EMAILS_API_KEY: api.apiKey,
    EMAILS_CLIENT_ENV_LOADED: "1",
    NO_COLOR: "1",
  };
}

interface CliRun {
  exitCode: number | null;
  stdout: string;
  stderr: string;
}

function runCli(args: string[], env: NodeJS.ProcessEnv): CliRun {
  const result = Bun.spawnSync({
    cmd: [process.execPath, "src/cli/index.tsx", ...args],
    cwd: process.cwd(),
    env,
    stdout: "pipe",
    stderr: "pipe",
  });
  const decoder = new TextDecoder();
  return {
    exitCode: result.exitCode,
    stdout: decoder.decode(result.stdout),
    stderr: decoder.decode(result.stderr),
  };
}

afterAll(async () => { await api.stop(); for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true }); });
describe("API sent ledger provider filtering", () => {
  for (const args of [["email", "list"], ["export", "emails"]]) {
    it(`${args.join(" ")} excludes the other provider`, () => {
      const env = apiEnv();
      for (let i = 0; i < ids.length; i++) {
        const result = runCli(["--json", ...args, "--provider", ids[i]!], env);
        expect(result.exitCode, result.stderr).toBe(0);
        expect(result.stdout).toContain(`provider-subject-${i}`);
        expect(result.stdout).not.toContain(`provider-subject-${1 - i}`);
      }
      const all = runCli(["--json", ...args], env);
      expect(all.exitCode, all.stderr).toBe(0);
      expect(all.stdout).toContain("provider-subject-0");
      expect(all.stdout).toContain("provider-subject-1");
    }, 120000);
    it(`${args.join(" ")} refuses blank provider selectors`, () => {
      const result = runCli(["--json", ...args, "--provider", "   "], apiEnv());
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("Provider ID must not be empty");
      expect(result.stdout).not.toContain("provider-subject");
    }, 120000);
  }
});
