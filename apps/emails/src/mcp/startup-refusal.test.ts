// HERMETIC startup controls for the `emails-mcp` bin (hasna/apps#1720 validation).
//
// A hosted run with no credential must FAIL LOUD before the server answers
// `initialize`: non-zero exit, nothing on stdout, no local store created, and a
// FIRST stderr line that names where the credential should live — never a Bun
// source frame (the 1.5.0 release review measured `MCP server error: 3890 | ...`
// as the first line). A DELIBERATE tier the resolver cannot honour is the same
// refusal, naming that tier.
//
// Every spawn runs under a fake HOME/HASNA_HOME, with `HASNA_STATION` pinned to
// an account that exists in no Keychain, and with every hosted/credential
// variable scrubbed — so a populated station Keychain never leaks in.

import { describe, expect, it } from "bun:test";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const PACKAGE_ROOT = join(import.meta.dir, "..", "..");
const MCP_ENTRY = join(PACKAGE_ROOT, "src", "mcp", "index.ts");
const KEYCHAIN_ITEM = `${["hasna", "credentials"].join(".")}.emails.api-key`;
const INITIALIZE =
  '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05",' +
  '"capabilities":{},"clientInfo":{"name":"startup-refusal-test","version":"0"}}}\n';

function hermeticEnv(home: string, extra: Record<string, string> = {}): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value === undefined) continue;
    if (/^(?:HASNA_|EMAILS_|MCP_)/.test(key)) continue;
    if (key === "HOME" || key === "USER") continue;
    env[key] = value;
  }
  return {
    ...env,
    HOME: home,
    HASNA_HOME: join(home, "hasna-home"),
    HASNA_STATION: "no-such-station",
    NO_COLOR: "1",
    // Bun's own transpiler cache would otherwise land under the fake HOME and
    // read as "the app wrote something"; it is the runtime's, not the app's.
    BUN_RUNTIME_TRANSPILER_CACHE_PATH: "0",
    ...extra,
  };
}

function spawnMcp(
  env: Record<string, string>,
  stdin: string | null,
): { exitCode: number | null; stdout: string; stderr: string } {
  const result = Bun.spawnSync({
    cmd: [process.execPath, "--no-env-file", MCP_ENTRY],
    cwd: PACKAGE_ROOT,
    env,
    stdin: stdin === null ? "ignore" : Buffer.from(stdin),
    stdout: "pipe",
    stderr: "pipe",
    timeout: 20_000,
  });
  return {
    exitCode: result.exitCode,
    stdout: new TextDecoder().decode(result.stdout),
    stderr: new TextDecoder().decode(result.stderr),
  };
}

function withFakeHome<T>(run: (home: string) => T): T {
  const home = mkdtempSync(join(tmpdir(), "emails-mcp-startup-"));
  try {
    return run(home);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
}

/**
 * Everything the run left under the fake home — an empty list is the fail-closed
 * proof. The runtime's own caches (`~/Library/Caches`, `~/.cache`) are not the
 * app's doing and are excluded; a database anywhere under the home is not.
 */
function filesUnder(home: string): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else out.push(path);
    }
  };
  walk(home);
  return out.filter((path) => !/\/(?:Library\/Caches|\.cache)\//.test(path) || /\.db/.test(path));
}

describe("emails-mcp startup refusal (fail-closed, #1720)", () => {
  it("refuses before serving when no credential resolves — first stderr line names the Keychain item", () => {
    withFakeHome((home) => {
      const result = spawnMcp(hermeticEnv(home), null);
      expect(result.exitCode).toBe(1);
      expect(result.stdout).toBe("");
      const [first = ""] = result.stderr.split("\n");
      expect(first.startsWith("emails-mcp: ")).toBe(true);
      expect(first).toContain(KEYCHAIN_ITEM);
      expect(first).toContain("config/credentials");
      expect(first).toContain("HASNA_EMAILS_API_KEY");
      // No source frame, no stack, no local-fallback event anywhere on stderr.
      expect(result.stderr).not.toMatch(/^\s*\d+ \|/m);
      expect(result.stderr).not.toMatch(/^\s+at /m);
      expect(result.stderr).not.toContain("local-fallback");
      expect(filesUnder(home)).toEqual([]);
    });
  }, 30_000);

  it("does not answer initialize when it refuses", () => {
    withFakeHome((home) => {
      const result = spawnMcp(hermeticEnv(home), INITIALIZE);
      expect(result.exitCode).toBe(1);
      expect(result.stdout).toBe("");
      expect(result.stdout).not.toContain('"serverInfo"');
      expect(filesUnder(home)).toEqual([]);
    });
  }, 30_000);

  it("a deliberate tier the resolver cannot honour is the same loud refusal, naming that tier", () => {
    const cases: Array<{ env: Record<string, string>; names: string }> = [
      { env: { HASNA_EMAILS_API_KEY_OVERRIDE: "" }, names: "HASNA_EMAILS_API_KEY_OVERRIDE" },
      { env: { HASNA_PROFILE: "no-such-profile" }, names: "HASNA_PROFILE" },
      { env: { HASNA_EMAILS_API_KEY_REF: "no/such/vault/item" }, names: "HASNA_EMAILS_API_KEY_REF" },
    ];
    for (const { env, names } of cases) {
      withFakeHome((home) => {
        const result = spawnMcp(hermeticEnv(home, env), INITIALIZE);
        expect(result.exitCode).toBe(1);
        expect(result.stdout).toBe("");
        const [first = ""] = result.stderr.split("\n");
        expect(first.startsWith("emails-mcp: ")).toBe(true);
        expect(first).toContain(names);
        expect(result.stderr).not.toMatch(/^\s*\d+ \|/m);
        expect(filesUnder(home)).toEqual([]);
      });
    }
  }, 90_000);
});
