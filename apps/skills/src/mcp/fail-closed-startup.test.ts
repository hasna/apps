/**
 * The real `skills-mcp` binary, in a real subprocess, with every fleet
 * credential variable scrubbed, the Keychain tier pointed at an absent account
 * and the credentials file relocated to an empty HASNA_HOME — a coding agent
 * that registered `skills-mcp` on a station without the fleet credential.
 *
 * The MCP must fail closed at STARTUP (owner ruling 2026-09-04, hasna/apps#1720;
 * #1720 validation, round 1): exit non-zero BEFORE `initialize` is answered and
 * before any HTTP port is bound, naming where the credential should live. Before
 * this gate the process answered `initialize`, served the bundled catalog to
 * `list_skills`, and — on the default transport — bound 127.0.0.1:8836 and kept
 * serving; the CLI on the same machine exits 1.
 *
 * Two controls keep the gate honest: the explicit local opt-in starts the
 * server (initialize answered, "local mode" on stderr, exit 0 once stdin
 * closes), and an authority with no key is refused with the authority named.
 */
import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { useDefaultTestTimeout, withoutDataDirOverrideEnv } from "../test-preload.js";

useDefaultTestTimeout();

const MCP_PATH = join(import.meta.dir, "index.ts");
const INITIALIZE = JSON.stringify({
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "probe", version: "0" } },
});

function scrubbedEnv(scratch: string, extra: Record<string, string> = {}): Record<string, string> {
  // withoutDataDirOverrideEnv() strips every fleet credential variable, drops
  // the local opt-in, and blinds the Keychain (HASNA_STATION -> an absent
  // account). HOME and HASNA_HOME both point into the scratch dir, so the disk
  // tier finds no credentials file and no store can land in a real home.
  const env = withoutDataDirOverrideEnv({ ...process.env }) as Record<string, string>;
  return {
    ...env,
    HOME: join(scratch, "home"),
    HASNA_HOME: join(scratch, "hasna-home"),
    NO_COLOR: "1",
    ...extra,
  };
}

async function runMcp(
  args: string[],
  env: Record<string, string>,
  cwd: string,
  stdinText: string | null,
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const proc = Bun.spawn([process.execPath, "run", MCP_PATH, ...args], {
    env,
    cwd,
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });
  if (stdinText !== null) proc.stdin.write(stdinText);
  proc.stdin.end();
  // A server that STARTS (the control) waits for more stdin; a closed stdin ends
  // the session. The default HTTP transport never reads stdin, so a process that
  // bound a port would sit here forever: kill it, and let the assertions say so.
  const killer = setTimeout(() => proc.kill("SIGKILL"), 15_000);
  try {
    const [stdout, stderr] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
    const exitCode = await proc.exited;
    return { stdout: stdout.trim(), stderr: stderr.trim(), exitCode };
  } finally {
    clearTimeout(killer);
  }
}

function scratchDir(label: string): string {
  return mkdtempSync(join(tmpdir(), `skills-mcp-failclosed-${label}-`));
}

function walk(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]));
}

function nothingCreatedUnder(scratch: string): void {
  // The refusal touches nothing of the app's: no ~/.hasna, no HASNA_HOME, no
  // *.db anywhere. (Running from source, bun writes its own transpile cache to
  // ~/Library/Caches/bun under the scratch HOME; that is the runtime, not us.)
  expect(existsSync(join(scratch, "home", ".hasna"))).toBe(false);
  expect(existsSync(join(scratch, "hasna-home"))).toBe(false);
  expect(walk(scratch).filter((f) => /\.db/.test(f) || f.includes("/.hasna/"))).toEqual([]);
}

describe("skills-mcp fails closed at startup without a credential", () => {
  test("FAILING INPUT: `skills-mcp --stdio` with initialize on stdin exits non-zero before answering it", async () => {
    const scratch = scratchDir("stdio");
    try {
      const { stdout, stderr, exitCode } = await runMcp(["--stdio"], scrubbedEnv(scratch), scratch, `${INITIALIZE}\n`);
      expect(exitCode).not.toBe(0);
      // initialize was NOT answered: nothing on stdout at all.
      expect(stdout).toBe("");
      // One line naming the refusal, the way out, and where the credential should live.
      const [first] = stderr.split("\n");
      expect(first).toContain("failing closed");
      expect(first).toContain("HASNA_SKILLS_LOCAL=1");
      expect(first).toContain("hasna.credentials.skills.api-key");
      expect(first).toContain("HASNA_SKILLS_API_KEY");
      expect(first).toContain(join(scratch, "hasna-home", "skills", "config", "credentials"));
      nothingCreatedUnder(scratch);
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  });

  test("FAILING INPUT: the default HTTP transport exits non-zero without binding a port", async () => {
    const scratch = scratchDir("http");
    try {
      const port = String(40000 + ((process.pid * 7) % 20000));
      const { stdout, stderr, exitCode } = await runMcp([], scrubbedEnv(scratch, { MCP_HTTP_PORT: port }), scratch, null);
      expect(exitCode).not.toBe(0);
      expect(stdout).toBe("");
      expect(stderr).not.toContain("listening");
      expect(stderr).toContain("failing closed");
      nothingCreatedUnder(scratch);
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  });

  test("an authority with no key is refused at startup, naming the authority", async () => {
    const scratch = scratchDir("authority");
    try {
      const env = scrubbedEnv(scratch, { HASNA_SKILLS_API_URL: "https://skills.example.com" });
      const { stdout, stderr, exitCode } = await runMcp(["--stdio"], env, scratch, `${INITIALIZE}\n`);
      expect(exitCode).not.toBe(0);
      expect(stdout).toBe("");
      expect(stderr).toContain("HASNA_SKILLS_API_URL");
      expect(stderr).toContain("no API key resolved");
      nothingCreatedUnder(scratch);
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  });

  test("control: HASNA_SKILLS_LOCAL=1 starts the server, answers initialize, and says it is local", async () => {
    const scratch = scratchDir("local");
    try {
      const env = scrubbedEnv(scratch, { HASNA_SKILLS_LOCAL: "1" });
      const { stdout, stderr, exitCode } = await runMcp(["--stdio"], env, scratch, `${INITIALIZE}\n`);
      expect(exitCode).toBe(0);
      expect(stdout).toContain('"protocolVersion"');
      expect(stdout).toContain('"id":1');
      expect(stderr).toContain("local mode");
      expect(stderr).toContain("HASNA_SKILLS_LOCAL=1");
      // Local mode reads the bundled corpus; it still creates no database.
      expect(walk(scratch).filter((f) => /\.db/.test(f))).toEqual([]);
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  });
});
