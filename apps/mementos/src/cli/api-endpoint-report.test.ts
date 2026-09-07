/**
 * The operator surfaces that REPORT the API endpoint: `status` and `doctor`.
 *
 * `mementos status` — the uniform fleet API line (hasna/apps#1588).
 *
 * The acceptance is that every fleet CLI prints
 * `API: https://api.hasna.com/<app>/v1` — the RESOLVED /v1 authority, never a
 * bare origin and never the raw configured base. hasna/apps#1755 added a
 * `MementosClient.apiUrl` getter for this but wired no production consumer
 * (the CLI routes through src/db/api-mode.ts, not the SDK client), so no
 * mementos surface printed the line. These drive the real CLI as a subprocess.
 */
import { describe, test, expect } from "bun:test";

const CLI_PATH = new URL("./index.tsx", import.meta.url).pathname;

/** A clean env: no inherited fleet selector may decide these outcomes. */
function cliEnv(extra: Record<string, string> = {}): Record<string, string> {
  const base: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (v === undefined) continue;
    if (/^(HASNA_)?MEMENTOS_/.test(k)) continue;
    base[k] = v;
  }
  return { ...base, ...extra };
}

async function runCli(
  env: Record<string, string>,
  ...args: string[]
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const proc = Bun.spawn(["bun", "run", CLI_PATH, ...args], {
    env,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { stdout, stderr, exitCode };
}

const runStatus = (
  env: Record<string, string>,
  ...args: string[]
): Promise<{ stdout: string; stderr: string; exitCode: number }> => runCli(env, "status", ...args);

const CONFIGURED = {
  HASNA_MEMENTOS_API_URL: "https://api.hasna.com/mementos",
  HASNA_MEMENTOS_API_KEY: "test-key-not-a-real-credential",
};

describe("mementos status", () => {
  test("prints the resolved /v1 authority as the API line", async () => {
    const { stdout, exitCode } = await runStatus(cliEnv(CONFIGURED));
    expect(exitCode).toBe(0);
    expect(stdout).toContain("API: https://api.hasna.com/mementos/v1");
    expect(stdout).toContain("transport: http");
    expect(stdout).toContain("api key: present");
  });

  test("a base already carrying /v1 is not doubled", async () => {
    const { stdout } = await runStatus(
      cliEnv({ ...CONFIGURED, HASNA_MEMENTOS_API_URL: "https://api.hasna.com/mementos/v1" }),
    );
    expect(stdout).toContain("API: https://api.hasna.com/mementos/v1");
    expect(stdout).not.toContain("/v1/v1");
  });

  test("a bare origin is reported with /v1, never as the bare origin", async () => {
    const { stdout } = await runStatus(
      cliEnv({ ...CONFIGURED, HASNA_MEMENTOS_API_URL: "https://mementos.hasna.xyz" }),
    );
    expect(stdout).toContain("API: https://mementos.hasna.xyz/v1");
  });

  test("--json reports the resolved authority and key presence, never the key", async () => {
    const { stdout, exitCode } = await runStatus(cliEnv(CONFIGURED), "--json");
    expect(exitCode).toBe(0);
    const parsed = JSON.parse(stdout) as Record<string, unknown>;
    expect(parsed.app).toBe("mementos");
    expect(parsed.transport).toBe("http");
    expect(parsed.api_url).toBe("https://api.hasna.com/mementos/v1");
    expect(parsed.api_base).toBe("https://api.hasna.com/mementos");
    expect(parsed.api_key_present).toBe(true);
    expect(stdout).not.toContain("test-key-not-a-real-credential");
  });

  test("runs with no env configured instead of being blocked by the store guard", async () => {
    // The whole point of a status command is answering "what am I pointed at?"
    // when the answer is "nothing" — it must not inherit the fail-closed
    // preAction hook that (correctly) stops the data commands.
    const { stdout, exitCode } = await runStatus(cliEnv());
    expect(exitCode).toBe(1);
    expect(stdout).toContain("API: (none)");
    expect(stdout).toContain("transport: unconfigured");
    expect(stdout).toContain("api key: absent");
  });

  test("a malformed base fails closed and never echoes credential material", async () => {
    const { stdout, stderr, exitCode } = await runStatus(
      cliEnv({ ...CONFIGURED, HASNA_MEMENTOS_API_URL: "https://user:sup3rsecret@api.hasna.com/mementos" }),
    );
    expect(exitCode).toBe(1);
    expect(stdout + stderr).not.toContain("sup3rsecret");
    expect(stderr).toContain("is not usable");
  });

  test("--json never serialises a refused base, so userinfo cannot reach a pasted sweep", async () => {
    // The text branch prints `API: (none)` for a refused base, but `--json`
    // used to copy the raw env value into `api_base` BEFORE validation, so
    // `https://user:sup3rsecret@…` came back verbatim, password included, on
    // exactly the surface (#1588 sweeps) that gets pasted into issues.
    const { stdout, stderr, exitCode } = await runStatus(
      cliEnv({ ...CONFIGURED, HASNA_MEMENTOS_API_URL: "https://user:sup3rsecret@api.hasna.com/mementos" }),
      "--json",
    );
    expect(exitCode).toBe(1);
    expect(stdout + stderr).not.toContain("sup3rsecret");
    const parsed = JSON.parse(stdout) as Record<string, unknown>;
    expect(parsed.api_base).toBeNull();
    expect(parsed.api_url).toBeNull();
    // A refused base is not a configured HTTP transport.
    expect(parsed.transport).toBe("unconfigured");
    // The resolver's refusal names the defect class, never the URL.
    expect(parsed.error).toContain("credentials");
  });

  test("creates no database file as a side effect", async () => {
    // `status` opts out of the startup DB access, so pointing HOME at an empty
    // directory must not leave a mementos store behind. (bun's own transpiler
    // cache does land under HOME/Library — hence a .db scan, not a bare
    // existsSync on the directory.)
    const { readdirSync, existsSync, rmSync } = await import("node:fs");
    const { join } = await import("node:path");
    const { tmpdir } = await import("node:os");
    const home = join(tmpdir(), `mementos-status-home-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    try {
      const { exitCode } = await runStatus(cliEnv({ ...CONFIGURED, HOME: home, XDG_DATA_HOME: home }));
      expect(exitCode).toBe(0);
      const found: string[] = [];
      const walk = (dir: string): void => {
        for (const entry of readdirSync(dir, { withFileTypes: true })) {
          const full = join(dir, entry.name);
          if (entry.isDirectory()) walk(full);
          else if (/\.db(-wal|-shm)?$/.test(entry.name)) found.push(full);
        }
      };
      if (existsSync(home)) walk(home);
      expect(found).toEqual([]);
    } finally {
      if (existsSync(home)) rmSync(home, { recursive: true, force: true });
    }
  });
});

describe("mementos doctor — malformed endpoint", () => {
  test("reports the misconfiguration as a failed check, not a stack trace", async () => {
    // Validating the base URL (hasna/apps#1601) makes a malformed endpoint
    // throw out of isApiMode(). Diagnosing that endpoint is exactly what the
    // operator ran `doctor` for, so it must be a rendered check.
    const { stdout, stderr, exitCode } = await runCli(
      cliEnv({ ...CONFIGURED, HASNA_MEMENTOS_API_URL: "https://user:sup3rsecret@api.hasna.com/mementos" }),
      "doctor",
    );
    const all = stdout + stderr;
    expect(exitCode).toBe(1);
    expect(all).toContain("API endpoint");
    expect(all).toContain("credentials");
    expect(all).not.toContain("sup3rsecret");
    expect(all).not.toContain("at resolveMementosApiBase");
  }, 30_000);
});
