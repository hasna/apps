import { describe, expect, test } from "bun:test";
import { join } from "node:path";

/**
 * Regression tests for the serve control-surface refusal (todos row O15-04143,
 * gate O15-04113 NO_GO, T-00101 class).
 *
 * `emails serve --help` / `emails serve --version` previously exited rc=1 with
 * "EMAILS_MODE asks for the postgresql store while EMAILS_DATABASE_URL is
 * unset... DELETE IT" whenever the legacy deployment word was present in the
 * environment. Root cause: `src/cli/commands/serve.ts` resolved the server
 * storage backend at REGISTRATION time, and `resolveServerStorageBackend()`
 * throws on a retired-mode contradiction — so the throw landed before
 * commander ever got to answer the control surface.
 *
 * The gate environment is exactly the legacy one: EMAILS_MODE set (the
 * legacy deployment-mode environment), EMAILS_DATABASE_URL unset. Control
 * surfaces must answer rc=0 in that environment; an ACTUAL serve invocation
 * must still refuse.
 */

const EMAILS_ROOT = join(import.meta.dir, "../../..");

async function runCli(args: string[]): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  // Gate env: legacy EMAILS_MODE present, database URL blank (blank counts as
  // absent in storage-backend's `configured()`). The other spellings are
  // pinned to blank so the test is deterministic regardless of the machine
  // that runs it.
  const env = {
    ...process.env,
    EMAILS_MODE: "self_hosted",
    HASNA_EMAILS_MODE: "",
    EMAILS_DATABASE_URL: "",
  };
  const proc = Bun.spawn([process.execPath, "run", "src/cli/index.tsx", ...args], {
    cwd: EMAILS_ROOT,
    env,
    stdout: "pipe",
    stderr: "pipe",
    stdin: "pipe",
  });
  proc.stdin?.end(); // close stdin so nothing can wait on it
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { stdout, stderr, exitCode };
}

describe("emails serve answers --help/--version before config validation (O15-04143)", () => {
  test("serve --version answers rc=0 with the legacy EMAILS_MODE set", async () => {
    const result = await runCli(["serve", "--version"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toMatch(/^\d+\.\d+\.\d+$/);
    expect(result.stderr).not.toContain("EMAILS_MODE");
  });

  test("serve --help answers rc=0 with the legacy EMAILS_MODE set", async () => {
    const result = await runCli(["serve", "--help"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Usage:");
    expect(result.stderr).not.toContain("EMAILS_MODE");
  });

  test("an actual serve invocation still refuses the contradictory store config", async () => {
    const result = await runCli(["serve", "--port", "0"]);
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("EMAILS_MODE");
    expect(result.stderr).toContain("are retired. Remove them.");
    expect(result.stderr).toContain("the service requires server-side PostgreSQL.");
    expect(result.stderr).toContain("No local fallback exists.");
    expect(result.stdout.trim()).toBe("");
  });
});
