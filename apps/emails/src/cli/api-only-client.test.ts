import { afterEach, expect, test } from "bun:test";
import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { startV1Stub, type V1Stub } from "../test-support/v1-stub.js";
let api: V1Stub | undefined;
const homes: string[] = [];
afterEach(() => { api?.stop(); api = undefined; for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true }); });
function fixture() {
  const home = mkdtempSync(join(tmpdir(), "emails-api-only-")); homes.push(home);
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (key.startsWith("EMAILS_") || key.startsWith("HASNA_EMAILS_")) delete env[key];
  for (const key of ["HASNA_CONFIG_HOME", "HASNA_HOME", "HASNA_DATA_HOME", "HASNA_STATE_HOME", "HASNA_CACHE_HOME", "XDG_CONFIG_HOME", "XDG_DATA_HOME", "XDG_STATE_HOME", "XDG_CACHE_HOME"]) delete env[key];
  Object.assign(env, { HASNA_STATION: `emails-api-only-${randomUUID()}`, HOME: home, HASNA_HOME: join(home, ".hasna"), EMAILS_HOME: join(home, "mail"), PATH: "/usr/bin:/bin", NO_COLOR: "1" });
  return { home, env };
}
async function run(env: NodeJS.ProcessEnv, entry: string, args: string[]) {
  const child = Bun.spawn({ cmd: [process.execPath, ...(entry === "-e" ? [] : ["run"]), entry, ...args], env, stdout: "pipe", stderr: "pipe" });
  const timeout = setTimeout(() => child.kill(), 8000);
  try { const [code, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]); return { code, stdout, stderr }; }
  finally { clearTimeout(timeout); }
}
for (const setting of ["EMAILS_DB_PATH", "HASNA_EMAILS_DB_PATH"]) {
  test(`${setting} cannot open a local mailbox from CLI or MCP`, async () => {
    const { home, env } = fixture(); const file = join(home, "mail.db"); env[setting] = file;
    for (const [entry, args] of [["src/cli/index.tsx", ["stats", "--json"]], ["src/cli/index.tsx", ["ui"]], ["src/mcp/index.ts", ["--stdio"]]] as const) {
      const result = await run(env, entry, [...args]);
      expect(result.code).not.toBe(0);
      expect(result.stdout + result.stderr).toContain("authenticated Emails API");
      expect(existsSync(file)).toBe(false);
    }
  }, 30000);
}
test("fresh CLI reads saved API credentials without URL or key flags and creates no mail database", async () => {
  api = await startV1Stub({ openapi: true });
  const { home, env } = fixture();
  const config = join(home, ".hasna", "emails", "config"); mkdirSync(config, { recursive: true });
  writeFileSync(join(config, "credentials"), `HASNA_EMAILS_API_URL=${api.baseUrl}\nHASNA_EMAILS_API_KEY=${api.apiKey}\n`, { mode: 0o600 });
  const result = await run(env, "src/cli/index.tsx", ["stats", "--json"]);
  expect(result.stderr).toBe(""); expect(result.code).toBe(0);
  expect(JSON.parse(result.stdout)).toMatchObject({ sent: 0 });
  expect(existsSync(join(home, "mail", "emails.db"))).toBe(false);
}, 15000);
test("API plus DB settings reject without exposing the configured path", async () => {
  api = await startV1Stub({ openapi: true });
  const { env } = fixture();
  env.HASNA_EMAILS_API_URL = api.baseUrl; env.HASNA_EMAILS_API_KEY = api.apiKey;
  const privatePath = "/private/credential-valued-path-that-must-not-be-printed.db";
  env.EMAILS_DB_PATH = privatePath;
  const result = await run(env, "src/cli/index.tsx", ["inbox", "list", "--json"]);
  expect(result.code).not.toBe(0);
  expect(result.stdout + result.stderr).toContain("Unset EMAILS_DB_PATH");
  expect(result.stdout + result.stderr).not.toContain(privatePath);
}, 15000);
test("explicit storage override cannot reopen the ordinary mail client factory", async () => {
  const { env } = fixture();
  const result = await run(env, "-e", ['import { resolveMailDataSource } from "./src/lib/mail-data-source.ts"; resolveMailDataSource({ mode: "local" });']);
  expect(result.code).not.toBe(0);
  expect(result.stdout + result.stderr).toContain("authenticated Emails API");
}, 15000);
for (const command of ["db", "server", "serve"]) {
  test(`explicit ${command} server administration retains its help path`, async () => {
    const { home, env } = fixture(); env.EMAILS_DB_PATH = join(home, "server.db");
    const result = await run(env, "src/cli/index.tsx", [command, "--help"]);
    expect(result.code).toBe(0);
    expect(result.stdout + result.stderr).not.toContain("authenticated Emails API");
    expect(existsSync(env.EMAILS_DB_PATH)).toBe(false);
  }, 15000);
}

test("missing API credentials suggest API setup without a local database alternative", async () => {
  const { home, env } = fixture();
  const result = await run(env, "src/cli/index.tsx", ["stats", "--json"]);
  expect(result.code).not.toBe(0);
  const output = result.stdout + result.stderr;
  expect(output).toContain("HASNA_EMAILS_API_KEY");
  expect(output).not.toContain("local database instead");
  expect(output).not.toContain("DB_PATH");
  expect(existsSync(join(home, "mail", "emails.db"))).toBe(false);
}, 15000);
