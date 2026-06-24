import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { resetDb } from "../src/db.js";
import { registerUser, setSecret } from "../src/store.js";

let testDir: string;
let dbPath: string;

beforeEach(() => {
  testDir = join(tmpdir(), `open-secrets-cli-output-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(testDir, { recursive: true });
  dbPath = join(testDir, "vault.db");
  process.env.OPEN_SECRETS_DB = dbPath;
  resetDb();
});

afterEach(() => {
  resetDb();
  delete process.env.OPEN_SECRETS_DB;
  rmSync(testDir, { recursive: true, force: true });
});

describe("compact CLI output", () => {
  it("caps default list output and never includes secret values", () => {
    seedSecrets(25);

    const result = runCli(["list"]);

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain("KEY");
    expect(result.stdout).toContain("Showing 1-20 of 25 secrets.");
    expect(result.stdout).toContain("Next: secrets list --cursor 20 --limit 20");
    expect(result.stdout).toContain("Details: secrets show <key>");
    expect(result.stdout).not.toContain("secret-value");
    expect(rowCount(result.stdout, "team/service/prod/token-")).toBe(20);
  });

  it("returns paginated metadata JSON for list", () => {
    seedSecrets(5);

    const result = runCli(["list", "--json", "--limit", "2", "--cursor", "1"]);

    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.stdout);
    expect(parsed.total).toBe(5);
    expect(parsed.limit).toBe(2);
    expect(parsed.cursor).toBe(1);
    expect(parsed.nextCursor).toBe(3);
    expect(parsed.items).toHaveLength(2);
    expect(parsed.items[0].key).toBe("team/service/prod/token-02");
    expect(parsed.items[0].value).toBeUndefined();
  });

  it("shows one secret's metadata without printing its value", () => {
    seedSecrets(1);

    const result = runCli(["show", "team/service/prod/token-01"]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("key: team/service/prod/token-01");
    expect(result.stdout).toContain("type: token");
    expect(result.stdout).toContain("value: not included");
    expect(result.stdout).toContain("Use: secrets get team/service/prod/token-01");
    expect(result.stdout).not.toContain("secret-value-01");
  });

  it("keeps long secret keys exact in compact output", () => {
    const longKey = "very-long-division-name/very-long-service-name/production/very-long-secret-name-for-progressive-disclosure";
    setSecret(longKey, "secret-value-long", "api_key", "A label that may be truncated safely");

    const result = runCli(["list"]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain(longKey);
    expect(result.stdout).not.toContain("very-long-division-name/very-long-service...progressive-disclosure");
    expect(result.stdout).not.toContain("secret-value-long");
  });

  it("handles cursor overflow and rejects malformed pagination flags", () => {
    seedSecrets(1);

    const overflow = runCli(["list", "--cursor", "999", "--limit", "1"]);
    expect(overflow.exitCode).toBe(0);
    expect(overflow.stdout).toContain("No secrets at cursor 999; total 1.");
    expect(overflow.stdout).not.toContain("Showing 0-999");

    const badLimit = runCli(["list", "--limit", "2x"]);
    expect(badLimit.exitCode).toBe(1);
    expect(badLimit.stderr).toContain("Invalid --limit");

    const badCursor = runCli(["list", "--cursor", "1.5"]);
    expect(badCursor.exitCode).toBe(1);
    expect(badCursor.stderr).toContain("Invalid --cursor");
  });

  it("caps search, audit history, and users list output by default", () => {
    seedSecrets(25);
    seedUsers(22);

    const search = runCli(["search", "service", "--limit", "3"]);
    expect(search.exitCode).toBe(0);
    expect(search.stdout).toContain("Showing 1-3 of 25 results.");
    expect(search.stdout).toContain("Next: secrets search service --cursor 3 --limit 3");
    expect(search.stdout).not.toContain("secret-value");

    const audit = runCli(["history", "--limit", "3"]);
    expect(audit.exitCode).toBe(0);
    expect(audit.stdout).toContain("Showing 1-3 of 50 audit entries.");
    expect(audit.stdout).toContain("Next: secrets history --cursor 3 --limit 3");

    const users = runCli(["users", "list"]);
    expect(users.exitCode).toBe(0);
    expect(users.stdout).toContain("Showing 1-20 of 22 users.");
    expect(users.stdout).toContain("Next: secrets users list --cursor 20 --limit 20");

    const usersJson = runCli(["users", "list", "--json", "--limit", "2"]);
    const parsedUsers = JSON.parse(usersJson.stdout);
    expect(parsedUsers.items).toHaveLength(2);
    expect(parsedUsers.items[0].type).toBe("agent");
  });

  it("honors flags on users subcommands", () => {
    const registered = runCli(["users", "register", "agent-cli", "CLI Agent", "--type", "agent"]);

    expect(registered.exitCode).toBe(0);
    expect(registered.stdout).toContain("agent-cli [agent]");
  });
});

function seedSecrets(count: number): void {
  for (let i = 1; i <= count; i++) {
    const suffix = String(i).padStart(2, "0");
    setSecret(
      `team/service/prod/token-${suffix}`,
      `secret-value-${suffix}`,
      "token",
      `Long production token label for service ${suffix}`
    );
  }
}

function seedUsers(count: number): void {
  for (let i = 1; i <= count; i++) {
    const suffix = String(i).padStart(2, "0");
    registerUser(`agent-${suffix}`, `Agent ${suffix}`, "agent");
  }
}

function runCli(args: string[]): { stdout: string; stderr: string; exitCode: number | null } {
  const proc = Bun.spawnSync({
    cmd: ["bun", "src/index.ts", ...args],
    cwd: join(import.meta.dir, ".."),
    env: { ...process.env, OPEN_SECRETS_DB: dbPath },
  });
  return {
    stdout: new TextDecoder().decode(proc.stdout),
    stderr: new TextDecoder().decode(proc.stderr),
    exitCode: proc.exitCode,
  };
}

function rowCount(output: string, marker: string): number {
  return output.split("\n").filter((line) => line.includes(marker)).length;
}
