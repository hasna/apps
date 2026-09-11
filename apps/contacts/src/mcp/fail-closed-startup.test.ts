import { afterEach, describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * End-to-end: the real `contacts-mcp` entry in a real subprocess with NO
 * credential resolvable (hermetic against the station: an absent Keychain
 * account, an empty HASNA_HOME, every env name the chain consults cleared).
 * The server must fail closed at STARTUP — non-zero exit before the stdio
 * transport is connected or the HTTP port is bound, an `initialize` request
 * never answered, nothing created under the app home — not merely refuse
 * individual tool calls (hasna/apps#1720 validation, round 2; the MCP
 * negative control that failed the round-2 review of #1865).
 */

const MCP_ENTRY = new URL("./index.ts", import.meta.url).pathname;
const STDIO_MARKER = "Contacts MCP server running on stdio";
const HTTP_MARKER = "HTTP listening on";
const INITIALIZE = JSON.stringify({
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "fail-closed-test", version: "0" } },
});
const tempHomes: string[] = [];

const CHAIN_ENV_KEYS = [
  "MCP_HTTP",
  "MCP_HTTP_PORT",
  "HASNA_CONTACTS_API_URL",
  "CONTACTS_API_URL",
  "HASNA_CONTACTS_API_KEY",
  "CONTACTS_API_KEY",
  "HASNA_CONTACTS_API_KEY_OVERRIDE",
  "HASNA_CONTACTS_API_KEY_REF",
  "HASNA_PROFILE",
  "HASNA_CONFIG_HOME",
  "HASNA_CONTACTS_STORAGE_MODE",
  "CONTACTS_STORAGE_MODE",
  "HASNA_CONTACTS_DB_PATH",
  "CONTACTS_DB_PATH",
  "HASNA_CONTACTS_DATABASE_URL",
  "CONTACTS_DATABASE_URL",
];

interface RunOptions {
  args?: string[];
  overrides?: Record<string, string>;
  stdinText?: string;
  prepare?: (tempHome: string) => void;
  killAfterMs?: number;
}

async function runMcp(options: RunOptions = {}) {
  const env: Record<string, string> = { ...(process.env as Record<string, string>) };
  for (const key of CHAIN_ENV_KEYS) delete env[key];
  const tempHome = mkdtempSync(join(tmpdir(), "contacts-mcp-failclosed-"));
  tempHomes.push(tempHome);
  env.HASNA_HOME = tempHome;
  env.HASNA_STATION = "no-such-station";
  Object.assign(env, options.overrides ?? {});
  options.prepare?.(tempHome);

  const proc = Bun.spawn(["bun", "run", MCP_ENTRY, ...(options.args ?? [])], {
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
    env,
  });
  try {
    if (options.stdinText) proc.stdin.write(`${options.stdinText}\n`);
    // A closed stdin ends a stdio MCP session that DID start; a server that
    // refused at startup is already gone and the write is simply lost.
    proc.stdin.end();
  } catch {
    /* the child exited before stdin was written — the refusal under test */
  }
  const timedOut = await Promise.race([
    proc.exited.then(() => false),
    new Promise<boolean>((resolve) => {
      setTimeout(() => {
        proc.kill();
        resolve(true);
      }, options.killAfterMs ?? 15_000);
    }),
  ]);
  const [stdout, stderr] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
  return { stdout, stderr, code: proc.exitCode ?? -1, timedOut, tempHome };
}

afterEach(() => {
  for (const tempHome of tempHomes.splice(0)) rmSync(tempHome, { recursive: true, force: true });
});

describe("contacts-mcp without a credential fails closed at startup", () => {
  test("FAILING INPUT: a plain start exits non-zero before serving, names the tiers on the first stderr line, creates nothing", async () => {
    const result = await runMcp();
    expect(result.timedOut).toBe(false);
    expect(result.code).not.toBe(0);
    expect(result.stdout).toBe("");
    const [firstLine] = result.stderr.split("\n");
    expect(firstLine).toContain("contacts-mcp");
    expect(firstLine).toContain("Keychain");
    expect(firstLine).toContain(join(result.tempHome, "contacts", "config", "credentials"));
    expect(firstLine).toContain("HASNA_CONTACTS_API_KEY");
    expect(result.stderr).not.toContain(STDIO_MARKER);
    expect(result.stderr).not.toContain("local-fallback");
    expect(readdirSync(result.tempHome)).toEqual([]);
  }, 20_000);

  test("an initialize request over stdio is NOT answered without a credential", async () => {
    const result = await runMcp({ stdinText: INITIALIZE });
    expect(result.timedOut).toBe(false);
    expect(result.code).not.toBe(0);
    expect(result.stdout).toBe("");
    expect(result.stdout).not.toContain('"result"');
    expect(result.stderr).not.toContain(STDIO_MARKER);
    expect(readdirSync(result.tempHome)).toEqual([]);
  }, 20_000);

  test("--http exits non-zero without binding a port", async () => {
    const result = await runMcp({ args: ["--http", "--port", "0"] });
    expect(result.timedOut).toBe(false);
    expect(result.code).not.toBe(0);
    expect(result.stdout).toBe("");
    expect(result.stderr).not.toContain(HTTP_MARKER);
    expect(result.stderr.split("\n")[0]).toContain("HASNA_CONTACTS_API_KEY");
    expect(readdirSync(result.tempHome)).toEqual([]);
  }, 20_000);

  test("control: an env credential starts the stdio server and answers initialize, creating no store", async () => {
    const result = await runMcp({
      overrides: {
        HASNA_CONTACTS_API_URL: "https://contacts.example.invalid",
        HASNA_CONTACTS_API_KEY: "test-key-not-a-real-secret",
      },
      stdinText: INITIALIZE,
    });
    expect(result.timedOut).toBe(false);
    expect(result.stderr).toContain(STDIO_MARKER);
    expect(result.stdout).toContain('"result"');
    expect(result.stdout).toContain('"name":"contacts"');
    expect(result.stdout).not.toContain("test-key-not-a-real-secret");
    expect(result.stderr).not.toContain("test-key-not-a-real-secret");
    expect(readdirSync(result.tempHome)).toEqual([]);
  }, 20_000);

  test("control: the disk tier under HASNA_HOME starts the server through the same chain", async () => {
    const result = await runMcp({
      prepare: (tempHome) => {
        const dir = join(tempHome, "contacts", "config");
        mkdirSync(dir, { recursive: true });
        writeFileSync(join(dir, "credentials"), "HASNA_CONTACTS_API_KEY=disk-key-not-a-real-secret\n");
        chmodSync(join(dir, "credentials"), 0o600);
      },
    });
    expect(result.timedOut).toBe(false);
    expect(result.code).toBe(0);
    expect(result.stderr).toContain(STDIO_MARKER);
    expect(result.stderr).not.toContain("disk-key-not-a-real-secret");
    expect(readdirSync(result.tempHome)).toEqual(["contacts"]);
    expect(readdirSync(join(result.tempHome, "contacts"))).toEqual(["config"]);
  }, 20_000);
});

describe("contacts-mcp refuses a deliberate tier it cannot honour, at startup", () => {
  test("FAILING INPUT: a vault pointer that cannot be dereferenced exits non-zero before serving; initialize is NOT answered; first stderr line names HASNA_CONTACTS_API_KEY_REF", async () => {
    // The chain validates the pointer's shape only; the gate dereferences it.
    // Previously: rc=0, "running on stdio", initialize answered, every tool
    // call then failing (the round-3 major).
    const result = await runMcp({ overrides: { HASNA_CONTACTS_API_KEY_REF: "no/such/vault/item" }, stdinText: INITIALIZE });
    expect(result.timedOut).toBe(false);
    expect(result.code).not.toBe(0);
    expect(result.stdout).toBe("");
    const [firstLine] = result.stderr.split("\n");
    expect(firstLine).toContain("contacts-mcp");
    expect(firstLine).toContain("HASNA_CONTACTS_API_KEY_REF");
    expect(result.stderr).not.toContain(STDIO_MARKER);
    expect(result.stderr).not.toContain("Fatal error");
    expect(result.stderr).not.toContain("local-fallback");
    expect(readdirSync(result.tempHome)).toEqual([]);
  }, 20_000);

  test("HASNA_PROFILE naming a missing profile file exits non-zero on one line naming that file, never a stack trace", async () => {
    const result = await runMcp({ overrides: { HASNA_PROFILE: "no-such-profile" }, stdinText: INITIALIZE });
    expect(result.timedOut).toBe(false);
    expect(result.code).not.toBe(0);
    expect(result.stdout).toBe("");
    const [firstLine] = result.stderr.split("\n");
    expect(firstLine).toContain("contacts-mcp");
    expect(firstLine).toContain(join(result.tempHome, "contacts", "config", "credentials-no-such-profile"));
    expect(result.stderr).not.toContain("Fatal error");
    expect(result.stderr).not.toContain(STDIO_MARKER);
    expect(readdirSync(result.tempHome)).toEqual([]);
  }, 20_000);

  test("an unsafe (0644) credentials file under HASNA_HOME is a one-line refusal naming the file, never a stack trace or a value", async () => {
    let path = "";
    const result = await runMcp({
      stdinText: INITIALIZE,
      prepare: (tempHome) => {
        const dir = join(tempHome, "contacts", "config");
        mkdirSync(dir, { recursive: true });
        path = join(dir, "credentials");
        writeFileSync(path, "HASNA_CONTACTS_API_KEY=disk-key-not-a-real-secret\n");
        chmodSync(path, 0o644);
      },
    });
    expect(result.timedOut).toBe(false);
    expect(result.code).not.toBe(0);
    expect(result.stdout).toBe("");
    const [firstLine] = result.stderr.split("\n");
    expect(firstLine).toContain("contacts-mcp");
    expect(firstLine).toContain("Refusing unsafe credential/config file");
    expect(firstLine).toContain(path);
    expect(result.stderr).not.toContain("disk-key-not-a-real-secret");
    expect(result.stderr).not.toContain("Fatal error");
    expect(result.stderr).not.toContain(STDIO_MARKER);
    // Only the file the test wrote exists; nothing else was created.
    expect(readdirSync(join(result.tempHome, "contacts"))).toEqual(["config"]);
    expect(readdirSync(join(result.tempHome, "contacts", "config"))).toEqual(["credentials"]);
  }, 20_000);
});
