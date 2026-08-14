import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const rootDir = join(import.meta.dir, "..");

let testDir: string;

beforeEach(() => {
  testDir = join(tmpdir(), `open-secrets-cli-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(testDir, { recursive: true });
});

afterEach(() => {
  rmSync(testDir, { recursive: true, force: true });
});

function env(): Record<string, string> {
  return {
    ...process.env,
    OPEN_SECRETS_DB: join(testDir, "vault.db"),
    HASNA_SECRETS_KEY_DIR: join(testDir, "keys"),
    NO_COLOR: "1",
  };
}

function runSecrets(args: string[]) {
  return Bun.spawnSync({
    cmd: ["bun", "src/index.ts", ...args],
    cwd: rootDir,
    env: env(),
  });
}

describe("CLI export safety", () => {
  it("exports compact redacted JSON by default", () => {
    const value = "runtime-secret-value";
    const set = runSecrets(["set", "safe/export", value, "--type", "token"]);
    expect(set.exitCode).toBe(0);

    const exported = runSecrets(["export"]);
    const stdout = new TextDecoder().decode(exported.stdout);

    expect(exported.exitCode).toBe(0);
    expect(stdout).not.toContain(value);
    expect(stdout).not.toContain('\n  "');

    const parsed = JSON.parse(stdout);
    expect(parsed.redacted).toBe(true);
    expect(parsed.secrets["safe/export"].value).toBe("***REDACTED***");
  });

  it("requires an explicit plaintext flag for restorable export values", () => {
    const value = "runtime-secret-value";
    const set = runSecrets(["set", "safe/export", value, "--type", "token"]);
    expect(set.exitCode).toBe(0);

    const exported = runSecrets(["export", "--show"]);
    const parsed = JSON.parse(new TextDecoder().decode(exported.stdout));

    expect(exported.exitCode).toBe(0);
    expect(parsed.redacted).toBe(false);
    expect(parsed.secrets["safe/export"].value).toBe(value);
  });

  it("refuses to import redacted export bundles", () => {
    const file = join(testDir, "redacted-export.json");
    writeFileSync(file, JSON.stringify({
      version: 2,
      redacted: true,
      secrets: {
        "safe/export": {
          key: "safe/export",
          value: "***REDACTED***",
          type: "token",
          created_at: "2026-01-01T00:00:00.000Z",
          updated_at: "2026-01-01T00:00:00.000Z",
        },
      },
    }));

    const imported = runSecrets(["import", file]);
    const stderr = new TextDecoder().decode(imported.stderr);

    expect(imported.exitCode).toBe(1);
    expect(stderr).toContain("Import refused");
  });
});
