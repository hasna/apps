import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// Regression: incident 715558 (BUG b76e2d56-38bf-468e-a6f9-90ea107e1b0e).
// When the hosted API env vars are ABSENT (or only partially present) and the CLI
// falls back to the local vault, it must emit an explicit machine-readable notice
// naming the mode switch — the fallback path, the local vault's actual state, and
// the fact that hosted secrets are not visible. A silent rc=0 "Vault is empty."
// is the exact misdiagnosis surface: any agent in a non-systemd shell reads ALL
// hosted credentials as missing/deleted.

const rootDir = join(import.meta.dir, "..");

let testDir: string;

beforeEach(() => {
  testDir = join(tmpdir(), `secrets-fallback-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(testDir, { recursive: true });
});

afterEach(() => {
  rmSync(testDir, { recursive: true, force: true });
});

// Force the local encrypted-SQLite vault: strip every client-flip env key the
// transport consults, so the resolution lands on the UNSELECTED local fallback
// (no URL+key pair) — the exact incident shape.
function env(extra: Record<string, string> = {}): Record<string, string> {
  const base = { ...process.env } as Record<string, string>;
  for (const key of [
    "HASNA_SECRETS_API_URL",
    "HASNA_SECRETS_API_KEY",
    "HASNA_SECRETS_STORAGE_MODE",
    "HASNA_SECRETS_MODE",
    "SECRETS_API_URL",
    "SECRETS_API_KEY",
    "SECRETS_STORAGE_MODE",
    "SECRETS_MODE",
    "HASNA_SECRETS_DB_PATH",
  ]) {
    delete base[key];
  }
  return {
    ...base,
    OPEN_SECRETS_DB: join(testDir, "vault.db"),
    HASNA_SECRETS_KEY_DIR: join(testDir, "keys"),
    NO_COLOR: "1",
    ...extra,
  };
}

function runSecrets(args: string[], extraEnv: Record<string, string> = {}) {
  const proc = Bun.spawnSync({
    cmd: ["bun", "src/index.ts", ...args],
    cwd: rootDir,
    env: env(extraEnv),
  });
  return {
    exitCode: proc.exitCode,
    stdout: new TextDecoder().decode(proc.stdout),
    stderr: new TextDecoder().decode(proc.stderr),
  };
}

/** The last non-empty stderr line, parsed as the JSON notice. */
function parseNotice(stderr: string): Record<string, unknown> {
  const lines = stderr.trim().split("\n").filter(Boolean);
  return JSON.parse(lines[lines.length - 1]!) as Record<string, unknown>;
}

describe("CLI local-fallback notice (incident 715558)", () => {
  it("names the mode switch on an empty-vault silent fallback instead of emitting only 'Vault is empty.'", () => {
    const res = runSecrets(["list"]);

    expect(res.exitCode).toBe(0);
    // The local vault IS empty — the human line remains truthful.
    expect(res.stdout).toContain("Vault is empty.");
    // ...but the run must NOT be silent about the backing store: stderr carries a
    // machine-readable notice naming the mode switch.
    const notice = parseNotice(res.stderr);
    expect(notice.event).toBe("secrets-local-fallback");
    expect(notice.transport).toBe("local");
    expect(notice.hostedSecretsVisible).toBe(false);
    expect(notice.apiUrlPresent).toBe(false);
    expect(notice.apiKeyPresent).toBe(false);
    expect(notice.localSecretCount).toBe(0);
    // The fallback path is named: the exact local vault file that was read.
    expect(notice.localVaultPath).toBe(join(testDir, "vault.db"));
  });

  it("names the actual local state when the local vault is non-empty", () => {
    expect(runSecrets(["set", "svc/token", "val-1", "--type", "token"]).exitCode).toBe(0);

    const res = runSecrets(["list"]);
    expect(res.exitCode).toBe(0);
    expect(res.stdout).toContain("1 secret(s)");

    const notice = parseNotice(res.stderr);
    expect(notice.event).toBe("secrets-local-fallback");
    expect(notice.localSecretCount).toBe(1);
    expect(notice.hostedSecretsVisible).toBe(false);
  });

  it("fails closed on partial cloud intent (API URL present, key missing)", () => {
    // Control A of the incident: HASNA_SECRETS_API_URL alone is a HALF-APPLIED
    // flip. It must not silently read the local vault and say "Vault is empty"
    // — the resolver refuses the partial pair and the CLI exits non-zero
    // naming exactly which half is missing.
    const res = runSecrets(["list"], {
      HASNA_SECRETS_API_URL: "http://127.0.0.1:1",
    });

    expect(res.exitCode).not.toBe(0);
    expect(res.stderr).toContain("HASNA_SECRETS_API_KEY");
    expect(res.stderr).not.toContain("secrets-local-fallback");
    expect(res.stdout).not.toContain("Vault is empty.");
  });

  it("rejects a retired storage-mode variable instead of treating it as a local selector", () => {
    // Deployment modes no longer exist (owner directive 2026-07-29). The old
    // "explicitly selected local store" input (HASNA_SECRETS_STORAGE_MODE=local)
    // is now a hard error that names the variable, never a silent selector.
    const res = runSecrets(["list"], {
      HASNA_SECRETS_STORAGE_MODE: "local",
    });

    expect(res.exitCode).not.toBe(0);
    expect(res.stderr).toContain("HASNA_SECRETS_STORAGE_MODE was removed");
    expect(res.stderr).not.toContain("secrets-local-fallback");
  });

  it("emits no fallback notice when cloud is configured — the fail-closed path stays loud", () => {
    // Control B of the incident: URL + KEY both present => cloud-http resolution.
    // No fallback notice may appear; the run fails loudly instead (nothing listens
    // on the loopback port, and a test process must never reach a remote vault).
    const res = runSecrets(["list"], {
      HASNA_SECRETS_API_URL: "http://127.0.0.1:1",
      HASNA_SECRETS_API_KEY: "fixture-key",
    });

    expect(res.exitCode).not.toBe(0);
    expect(res.stderr).not.toContain("secrets-local-fallback");
  });
});
