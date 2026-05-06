import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let tempHome = "";
let dbPath = "";

function runCli(args: string[]) {
  return Bun.spawnSync({
    cmd: ["bun", "run", "src/cli/index.ts", "--db", dbPath, "--json", ...args],
    cwd: process.cwd(),
    env: {
      ...process.env,
      SHORTLINKS_HOME: tempHome,
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
});
