/**
 * domains-mcp must FAIL CLOSED AT STARTUP (hasna/apps#1720 acceptance (c);
 * same class as mementos #1868): with no resolvable fleet credential and no
 * explicit local opt-in there is no store to serve, so the entry exits
 * non-zero BEFORE connecting a transport, names where the credential should
 * live on its first stderr line, and creates nothing under the app home.
 * Previously the server connected stdio, printed its banner and only refused
 * at the first tool call — a client saw a "healthy" server.
 *
 * Every child gets a constructed minimal env (the suite's DOMAINS_DIR
 * isolation is deliberately NOT inherited): a scratch HOME, HASNA_HOME
 * pointing at it so the disk tier and the app home both land in the scratch
 * dir, and HASNA_STATION pinned to a sentinel account so the ambient Keychain
 * tier misses deterministically on a provisioned station.
 */
import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const PACKAGE_ROOT = join(import.meta.dir, "..", "..");
const MCP_ENTRY = "src/mcp/index.ts";
const PROBE_TIMEOUT_MS = 20_000;

function baseEnv(home: string): Record<string, string> {
  return {
    PATH: process.env["PATH"] ?? "",
    HOME: home,
    HASNA_HOME: home,
    HASNA_STATION: "no-such-station",
    FORCE_COLOR: "0",
    NO_COLOR: "1",
  };
}

async function readStream(stream: ReadableStream<Uint8Array> | null): Promise<string> {
  if (!stream) return "";
  return new Response(stream).text();
}

async function runMcpStdio(env: Record<string, string>, keepStdinOpen: boolean): Promise<{
  exitCode: number;
  timedOut: boolean;
  stdout: string;
  stderr: string;
}> {
  const proc = Bun.spawn([process.execPath, "run", MCP_ENTRY, "--stdio"], {
    cwd: PACKAGE_ROOT,
    env,
    stdout: "pipe",
    stderr: "pipe",
    stdin: "pipe",
  });
  if (!keepStdinOpen) proc.stdin?.end();
  const settled = await Promise.race([
    proc.exited.then((exitCode) => ({ exitCode, timedOut: false })),
    new Promise<{ exitCode: number; timedOut: boolean }>((resolve) => {
      setTimeout(() => {
        proc.kill();
        resolve({ exitCode: -1, timedOut: true });
      }, PROBE_TIMEOUT_MS);
    }),
  ]);
  const [stdout, stderr] = await Promise.all([readStream(proc.stdout), readStream(proc.stderr)]);
  await proc.exited;
  return { ...settled, stdout, stderr };
}

function dbFilesUnder(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true, recursive: true })) {
    if (entry.isFile() && /\.db/.test(entry.name)) found.push(entry.name);
  }
  return found;
}

describe("domains-mcp fails closed at startup without a credential", () => {
  test(
    "NEGATIVE: env-less --stdio exits non-zero before serving, names the tiers, creates nothing",
    async () => {
      const home = mkdtempSync(join(tmpdir(), "domains-mcp-fail-closed-"));
      try {
        const result = await runMcpStdio(baseEnv(home), false);
        expect(result.timedOut).toBe(false);
        expect(result.exitCode).not.toBe(0);
        // Never served: no banner, no JSON-RPC on stdout.
        expect(result.stderr).not.toContain("domains MCP server running on stdio");
        expect(result.stdout).toBe("");
        // First stderr line is the actionable refusal naming where the
        // credential should live — not a stack dump.
        const firstLine = result.stderr.split("\n").find((line) => line.trim() !== "") ?? "";
        expect(firstLine).toStartWith("domains fails closed:");
        expect(result.stderr).toContain("HASNA_DOMAINS_API_KEY");
        expect(result.stderr).toContain("Keychain");
        expect(result.stderr).not.toContain("Fatal error:");
        // No local store, no app home: nothing was created under the scratch
        // HASNA_HOME.
        expect(existsSync(join(home, "domains"))).toBe(false);
        expect(existsSync(join(home, ".hasna", "domains"))).toBe(false);
        expect(dbFilesUnder(home)).toEqual([]);
      } finally {
        rmSync(home, { recursive: true, force: true });
      }
    },
    PROBE_TIMEOUT_MS + 5_000,
  );

  test(
    "a legacy local path is refused before stdio starts",
    async () => {
      const home = mkdtempSync(join(tmpdir(), "domains-mcp-local-optin-"));
      try {
        const result = await runMcpStdio(
          { ...baseEnv(home), DOMAINS_DB_PATH: join(home, "explicit.db") },
          true,
        );
        expect(result.timedOut).toBe(false);
        expect(result.exitCode).not.toBe(0);
        expect(dbFilesUnder(home)).toEqual([]);
        expect(result.stderr).toContain("no longer supported");
        expect(result.stderr).toContain("DOMAINS_DB_PATH");
        expect(result.stderr).not.toContain("domains MCP server running on stdio");
        expect(result.stderr).not.toContain("fails closed");
      } finally {
        rmSync(home, { recursive: true, force: true });
      }
    },
    PROBE_TIMEOUT_MS + 5_000,
  );

  test(
    "CONFLICT: a local path next to an env credential is refused at startup too",
    async () => {
      const home = mkdtempSync(join(tmpdir(), "domains-mcp-conflict-"));
      try {
        const result = await runMcpStdio(
          {
            ...baseEnv(home),
            DOMAINS_DB_PATH: join(home, "explicit.db"),
            HASNA_DOMAINS_API_URL: "https://domains.example.invalid",
            HASNA_DOMAINS_API_KEY: "not-a-real-key-fixture-only",
          },
          false,
        );
        expect(result.timedOut).toBe(false);
        expect(result.exitCode).not.toBe(0);
        expect(result.stderr).toContain("no longer supported");
        expect(result.stderr).toContain("DOMAINS_DB_PATH");
        expect(result.stderr).not.toContain("domains MCP server running on stdio");
        expect(dbFilesUnder(home)).toEqual([]);
      } finally {
        rmSync(home, { recursive: true, force: true });
      }
    },
    PROBE_TIMEOUT_MS + 5_000,
  );
});
