import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let tempHome = "";
let dbPath = "";

function runCli(args: string[], extraEnv: Record<string, string> = {}) {
  return Bun.spawnSync({
    cmd: ["bun", "run", "src/cli/index.ts", "--db", dbPath, "--json", ...args],
    cwd: process.cwd(),
    env: {
      ...process.env,
      SHORTLINKS_HOME: tempHome,
      HASNA_SHORTLINKS_STORE: "",
      HASNA_SHORTLINKS_DATABASE_URL: "",
      HASNA_SHORTLINKS_DATABASE_SSL: "",
      SHORTLINKS_STORE: "",
      SHORTLINKS_DATABASE_URL: "",
      SHORTLINKS_DATABASE_SSL: "",
      ...extraEnv,
    },
    stdout: "pipe",
    stderr: "pipe",
  });
}

beforeEach(() => {
  tempHome = mkdtempSync(join(tmpdir(), "shortlinks-cli-"));
  dbPath = join(tempHome, "shortlinks.db");
});

afterEach(() => {
  rmSync(tempHome, { recursive: true, force: true });
});

describe("CLI JSON workflow", () => {
  test("initializes has.na and creates a shortlink", () => {
    const init = runCli(["init", "--domain", "has.na"]);
    expect(init.exitCode).toBe(0);
    const initJson = JSON.parse(init.stdout.toString());
    expect(initJson.config.defaultDomain).toBe("has.na");

    const created = runCli(["create", "https://example.com", "--slug", "home"]);
    expect(created.exitCode).toBe(0);
    const link = JSON.parse(created.stdout.toString());
    expect(link.short_url).toBe("https://has.na/home");

    const stats = runCli(["stats"]);
    expect(stats.exitCode).toBe(0);
    expect(JSON.parse(stats.stdout.toString())).toEqual({ domains: 1, links: 1, clicks: 0 });
  });

  test("doctor reports the local Store without any DSN surface", () => {
    runCli(["init", "--domain", "has.na"]);
    const doctor = runCli(["doctor"]);
    expect(doctor.exitCode).toBe(0);
    const payload = JSON.parse(doctor.stdout.toString());
    expect(payload.ok).toBe(true);
    expect(payload.store).toBe("local");
    expect(payload.stats).toEqual({ domains: 1, links: 0, clicks: 0 });
    // No legacy DSN/runtime reporting leaks through.
    expect(payload.runtime).toBeUndefined();
    expect(payload.environment.api_url_present).toBe(false);
    expect(payload.environment.api_key_present).toBe(false);
    expect(JSON.stringify(payload)).not.toContain("DATABASE_URL");
  });

  test("the removed postgres command group and --store flag are gone", () => {
    const status = runCli(["postgres", "status"]);
    expect(status.exitCode).not.toBe(0);

    const store = runCli(["--store", "postgres", "doctor"]);
    expect(store.exitCode).not.toBe(0);
  });
});
