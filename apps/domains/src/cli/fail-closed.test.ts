/**
 * Fail-closed regression for the fleet ruling (2026-09-04): a domains CLI run
 * WITHOUT a resolvable credential must exit non-zero with an actionable error —
 * it must never silently fall back to a default local SQLite database, never
 * print a success-shaped answer against the wrong dataset.
 *
 * These tests spawn the real CLI entry as a subprocess with a constructed
 * minimal env (parent test vars — including the suite's DOMAINS_DIR isolation
 * dir — are deliberately NOT inherited), so the assertion is on the observed
 * process outcome: exit code, stderr, and the absence of any local database
 * under a scratch $HOME.
 */
import { describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CLI_ENTRY = new URL("./index.ts", import.meta.url).pathname;
const APP_DIR = new URL("../../", import.meta.url).pathname;

function runCli(args: string[], env: Record<string, string>): { exitCode: number | null; stdout: string; stderr: string } {
  const result = Bun.spawnSync({
    cmd: [process.execPath, CLI_ENTRY, ...args],
    cwd: APP_DIR,
    env,
    stdout: "pipe",
    stderr: "pipe",
  });
  return {
    exitCode: result.exitCode,
    stdout: result.stdout.toString(),
    stderr: result.stderr.toString(),
  };
}

describe("fail closed without a resolvable credential", () => {
  test("a data command exits non-zero, names the required env, and creates no local database", () => {
    const home = mkdtempSync(join(tmpdir(), "domains-fail-closed-home-"));
    try {
      const env: Record<string, string> = {
        PATH: process.env["PATH"] ?? "",
        HOME: home,
        FORCE_COLOR: "0",
        NO_COLOR: "1",
      };
      const result = runCli(["domain", "list"], env);

      expect(result.exitCode).not.toBe(0);
      // The error must name the canonical env pair so an operator knows what
      // to set (the shared resolver's fail-closed error, wrapped as
      // "domains fails closed: …").
      expect(result.stderr).toContain("fails closed");
      expect(result.stderr).toContain("HASNA_DOMAINS_API_URL");
      expect(result.stderr).toContain("HASNA_DOMAINS_API_KEY");
      // The refusal is reported at the CLI boundary as ONE actionable line —
      // the FIRST stderr line names the failure, and no Bun source-context
      // stack dump precedes or follows it.
      const stderrLines = result.stderr.split("\n").filter((line) => line.trim() !== "");
      expect(stderrLines[0]).toStartWith("domains fails closed:");
      expect(result.stderr).not.toContain("at resolveDomainsHttpClient");
      expect(result.stderr).not.toContain("Bun v");
      // Never a false green: no success-shaped portfolio output, no silent
      // fallback event pretending local storage was the answer.
      expect(result.stdout).not.toContain("No domains found.");
      expect(result.stderr).not.toContain("LOCAL mode");
      // And no local SQLite anywhere under the scratch home — the default
      // ~/.hasna/domains/domains.db was never opened.
      expect(existsSync(join(home, ".hasna", "domains"))).toBe(false);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  test("legacy local path is rejected without creating a database", () => {
    const dir = mkdtempSync(join(tmpdir(), "domains-fail-closed-optin-"));
    const dbPath = join(dir, "explicit.db");
    try {
      const env: Record<string, string> = {
        PATH: process.env["PATH"] ?? "",
        HOME: dir,
        DOMAINS_DB_PATH: dbPath,
        FORCE_COLOR: "0",
        NO_COLOR: "1",
      };
      const result = runCli(["domain", "list"], env);

      expect(result.exitCode).not.toBe(0);
      expect(result.stdout).toBe("");
      expect(result.stderr).toContain("no longer supported");
      expect(existsSync(dbPath)).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("hosted env pair selects the remote client — a dead API never falls back to local", () => {
    const home = mkdtempSync(join(tmpdir(), "domains-fail-closed-hosted-"));
    try {
      const env: Record<string, string> = {
        PATH: process.env["PATH"] ?? "",
        HOME: home,
        // .invalid is RFC 2606 unresolvable; the fixture key is not a
        // credential. The transport resolves to http and the request fails —
        // which must NOT downgrade the run to local sqlite.
        HASNA_DOMAINS_API_URL: "https://domains.example.invalid",
        HASNA_DOMAINS_API_KEY: "not-a-real-key-fixture-only",
        FORCE_COLOR: "0",
        NO_COLOR: "1",
      };
      const result = runCli(["domain", "list"], env);

      // Non-zero because the hosted API is unreachable — but the failure is
      // the network request, NOT the fail-closed resolution error, and never
      // a silent local success.
      expect(result.exitCode).not.toBe(0);
      expect(result.stdout).not.toContain("No domains found.");
      expect(result.stderr).not.toContain("no API key could be resolved");
      expect(result.stderr).not.toContain("fails closed");
      expect(result.stderr).not.toContain("LOCAL mode");
      expect(existsSync(join(home, ".hasna", "domains"))).toBe(false);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  test("credentials FILE tier (fake HOME, no env vars) resolves hosted — never a local fallback", () => {
    // The canonical station layout: ~/.hasna/domains/config/credentials with
    // URL+key lines and owner-only permissions, and NOTHING set in the env.
    // The resolver's disk tier must find it through the real CLI subprocess.
    const home = mkdtempSync(join(tmpdir(), "domains-fail-closed-file-"));
    try {
      const configDir = join(home, ".hasna", "domains", "config");
      mkdirSync(configDir, { recursive: true });
      const credPath = join(configDir, "credentials");
      writeFileSync(
        credPath,
        "HASNA_DOMAINS_API_URL=https://domains.example.invalid\nHASNA_DOMAINS_API_KEY=not-a-real-key-fixture-only\n",
        "utf-8",
      );
      chmodSync(credPath, 0o600);

      const env: Record<string, string> = {
        PATH: process.env["PATH"] ?? "",
        HOME: home,
        FORCE_COLOR: "0",
        NO_COLOR: "1",
      };
      const result = runCli(["domain", "list"], env);

      // A credential resolved from the file, so the run went hosted: the
      // failure is the dead network request, not "fails closed", and there is
      // no silent local store and no default local database anywhere.
      expect(result.exitCode).not.toBe(0);
      expect(result.stdout).not.toContain("No domains found.");
      expect(result.stderr).not.toContain("no API key could be resolved");
      expect(result.stderr).not.toContain("fails closed");
      expect(result.stderr).not.toContain("LOCAL mode");
      expect(existsSync(join(home, ".hasna", "domains", "domains.db"))).toBe(false);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });
});