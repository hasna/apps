import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const rootDir = join(import.meta.dir, "..");

let testDir: string;

beforeEach(() => {
  testDir = join(tmpdir(), `open-secrets-json-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(testDir, { recursive: true });
});

afterEach(() => {
  rmSync(testDir, { recursive: true, force: true });
});

// Force the local encrypted-SQLite vault: strip any cloud/self_hosted routing
// env inherited from the host so these CLI runs are hermetic and deterministic.
function env(): Record<string, string> {
  const base = { ...process.env } as Record<string, string>;
  delete base.HASNA_SECRETS_API_URL;
  delete base.HASNA_SECRETS_API_KEY;
  delete base.HASNA_SECRETS_STORAGE_MODE;
  return {
    ...base,
    OPEN_SECRETS_DB: join(testDir, "vault.db"),
    HASNA_SECRETS_KEY_DIR: join(testDir, "keys"),
    NO_COLOR: "1",
  };
}

function runSecrets(args: string[]) {
  const proc = Bun.spawnSync({
    cmd: ["bun", "src/index.ts", ...args],
    cwd: rootDir,
    env: env(),
  });
  return {
    exitCode: proc.exitCode,
    stdout: new TextDecoder().decode(proc.stdout),
    stderr: new TextDecoder().decode(proc.stderr),
  };
}

describe("CLI --json output", () => {
  it("secrets list --json emits parseable JSON", () => {
    expect(runSecrets(["set", "svc/token", "val-1", "--type", "token"]).exitCode).toBe(0);

    const res = runSecrets(["list", "--json"]);
    expect(res.exitCode).toBe(0);

    const parsed = JSON.parse(res.stdout);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed.some((e: any) => e.key === "svc/token")).toBe(true);
    // Redaction is preserved — no plaintext value leaks into the JSON.
    expect(res.stdout).not.toContain("val-1");
  });

  it("secrets search --json emits parseable JSON", () => {
    expect(runSecrets(["set", "svc/token", "val-1", "--type", "token"]).exitCode).toBe(0);

    const res = runSecrets(["search", "svc", "--json"]);
    expect(res.exitCode).toBe(0);

    const parsed = JSON.parse(res.stdout);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed.some((e: any) => e.key === "svc/token")).toBe(true);
  });

  it("secrets audit --json emits parseable JSON", () => {
    expect(runSecrets(["set", "svc/token", "val-1", "--type", "token"]).exitCode).toBe(0);

    const res = runSecrets(["audit", "--json"]);
    expect(res.exitCode).toBe(0);

    const parsed = JSON.parse(res.stdout);
    expect(Array.isArray(parsed)).toBe(true);
  });

  it("secrets items list --json emits parseable JSON", () => {
    expect(
      runSecrets([
        "items",
        "add-login",
        "--title",
        "Example",
        "--url",
        "https://example.com",
        "--username",
        "user@example.com",
        "--password",
        "hunter2",
      ]).exitCode,
    ).toBe(0);

    const res = runSecrets(["items", "list", "--json"]);
    expect(res.exitCode).toBe(0);

    const parsed = JSON.parse(res.stdout);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed.some((i: any) => i.title === "Example")).toBe(true);
    // metadata listing must not carry the login password
    expect(res.stdout).not.toContain("hunter2");
  });

  it("secrets users list --json emits parseable JSON", () => {
    expect(runSecrets(["users", "register", "agent-1", "Agent One", "--type", "agent"]).exitCode).toBe(0);

    const res = runSecrets(["users", "list", "--json"]);
    expect(res.exitCode).toBe(0);

    const parsed = JSON.parse(res.stdout);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed.some((u: any) => u.id === "agent-1")).toBe(true);
  });

  it("secrets list --json returns an empty array for an empty vault", () => {
    const res = runSecrets(["list", "--json"]);
    expect(res.exitCode).toBe(0);
    expect(JSON.parse(res.stdout)).toEqual([]);
  });
});
