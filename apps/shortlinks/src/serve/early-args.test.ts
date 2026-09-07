import { describe, expect, test } from "bun:test";
import { join } from "node:path";

/**
 * `shortlinks-serve` early arguments (hasna/apps#1720 validation, the
 * binds-before-help class): `--version` / `--help` used to fall through to the
 * PostgreSQL pool factory and die on the missing database URL. They must answer
 * rc=0 on stdout without resolving a backend or binding a port. The negative
 * probe keeps the start path honest: with no database URL a plain start still
 * fails closed naming HASNA_SHORTLINKS_DATABASE_URL.
 */

const SERVE_ENTRY = new URL("./index.ts", import.meta.url).pathname;

/** Env keys stripped so the child has no database and no version override. */
const STRIP_ENV_KEYS = [
  "HASNA_SHORTLINKS_DATABASE_URL",
  "SHORTLINKS_DATABASE_URL",
  "DATABASE_URL",
  "SHORTLINKS_VERSION",
  "HASNA_SHORTLINKS_API_SIGNING_KEY",
  "HASNA_API_SIGNING_KEY",
  "PORT",
];

function runServe(args: string[]): { stdout: string; stderr: string; code: number | null } {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && !STRIP_ENV_KEYS.includes(key)) env[key] = value;
  }
  const result = Bun.spawnSync({
    cmd: ["bun", "run", SERVE_ENTRY, ...args],
    cwd: join(import.meta.dir, "..", ".."),
    env,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
    timeout: 20_000,
  });
  return { stdout: result.stdout.toString(), stderr: result.stderr.toString(), code: result.exitCode };
}

describe("shortlinks-serve early arguments", () => {
  test("--version answers with the package version on stdout, rc=0, without a database", async () => {
    const packageJson = (await Bun.file(join(import.meta.dir, "..", "..", "package.json")).json()) as { version: string };
    const result = runServe(["--version"]);
    expect(result.code).toBe(0);
    expect(result.stdout.trim()).toBe(packageJson.version);
    expect(result.stderr).not.toContain("HASNA_SHORTLINKS_DATABASE_URL");
  });

  test("--help answers with usage on stdout, rc=0, without a database", () => {
    const result = runServe(["--help"]);
    expect(result.code).toBe(0);
    expect(result.stdout.toLowerCase()).toContain("usage");
    expect(result.stdout).toContain("shortlinks-serve");
    expect(result.stderr).not.toContain("HASNA_SHORTLINKS_DATABASE_URL");
  });

  test("a plain start without a database URL still fails closed (negative probe)", () => {
    const result = runServe([]);
    expect(result.code).not.toBe(0);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("HASNA_SHORTLINKS_DATABASE_URL");
  });
});
