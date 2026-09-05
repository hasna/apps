import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// Owner ruling 2026-09-04 (fail-closed campaign): a fleet CLI run with NO
// credential from ANY resolver tier must FAIL CLOSED — non-zero exit + an
// actionable error naming what was consulted (the Keychain item, the
// credentials file, HASNA_SECRETS_API_KEY) and the way out. It must NEVER
// silently serve the local SQLite vault, never emit a `secrets-local-fallback`
// event with exit 0, never default to local mode. Local mode survives only
// behind the explicit HASNA_SECRETS_LOCAL_VAULT=1 opt-in, and says so in one
// line.
//
// Since #1720 the credential chain has two AMBIENT tiers above the environment
// — the macOS Keychain and ~/.hasna/secrets/config/credentials — so deleting
// env variables is no longer enough to make a child credential-free. The env
// helper below redirects both at a throwaway location instead (an account no
// Keychain item exists under, and an empty HASNA_HOME), which is what makes
// this test deterministic on a station that DOES hold a hosted key.
//
// Regression: incident 715558 (BUG b76e2d56-38bf-468e-a6f9-90ea107e1b0e). An
// agent in a shell without the hosted env previously got a silent rc=0 local
// read that said "Vault is empty." and misdiagnosed ALL hosted credentials as
// missing.

const rootDir = join(import.meta.dir, "..");

let testDir: string;

beforeEach(() => {
  testDir = join(tmpdir(), `secrets-fail-closed-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(testDir, { recursive: true });
});

afterEach(() => {
  rmSync(testDir, { recursive: true, force: true });
});

// Strip every transport selector AND the local-vault opt-in, so the resolution
// lands on the fail-closed default: no hosted API pair, no explicit local
// choice — the exact incident shape.
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
    "HASNA_SECRETS_LOCAL_VAULT",
    "HASNA_SECRETS_API_KEY_OVERRIDE",
    "HASNA_SECRETS_API_KEY_REF",
    "HASNA_PROFILE",
  ]) {
    delete base[key];
  }
  return {
    ...base,
    OPEN_SECRETS_DB: join(testDir, "vault.db"),
    HASNA_SECRETS_KEY_DIR: join(testDir, "keys"),
    // The two ambient tiers, aimed at nothing: an empty ~/.hasna root and a
    // Keychain ACCOUNT no item is stored under (a missing item is an absent
    // tier, so the lookup simply falls through).
    HASNA_HOME: join(testDir, "hasna-home"),
    HASNA_CONFIG_HOME: join(testDir, "hasna-home", "config"),
    HASNA_STATION: `hasna-secrets-fail-closed-${process.pid}`,
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

describe("CLI fail-closed default (owner ruling 2026-09-04)", () => {
  it("fails closed when the hosted API env is absent: non-zero, names the required env, no local db created", () => {
    // Point the local vault at a file we own; if the CLI so much as opened it,
    // the test sees the file. Fail-closed must precede any local file I/O.
    const localDb = join(testDir, "must-not-exist.db");
    const res = runSecrets(["list"], { HASNA_SECRETS_DB_PATH: localDb });

    expect(res.exitCode).not.toBe(0);
    // Actionable error naming every tier that was consulted.
    expect(res.stderr).toContain("HASNA_SECRETS_API_URL");
    expect(res.stderr).toContain("HASNA_SECRETS_API_KEY");
    expect(res.stderr).toContain("Keychain");
    expect(res.stderr).toContain("credentials");
    // The explicit opt-in is named, so a local-only operator knows the way out.
    expect(res.stderr).toContain("HASNA_SECRETS_LOCAL_VAULT");
    // The old false-green shapes are gone.
    expect(res.stderr).not.toContain("secrets-local-fallback");
    expect(res.stdout).not.toContain("Vault is empty.");
    // No local SQLite file was created or touched.
    expect(existsSync(localDb)).toBe(false);
    expect(existsSync(join(testDir, "vault.db"))).toBe(false);
  });

  it("fails closed the same way for a write command", () => {
    const res = runSecrets(["set", "svc/token", "val-1", "--type", "token"]);

    expect(res.exitCode).not.toBe(0);
    expect(res.stderr).toContain("HASNA_SECRETS_API_URL");
    expect(res.stderr).toContain("HASNA_SECRETS_API_KEY");
    expect(res.stderr).toContain("HASNA_SECRETS_LOCAL_VAULT");
    expect(res.stderr).not.toContain("secrets-local-fallback");
    expect(existsSync(join(testDir, "vault.db"))).toBe(false);
  });

  it("explicit HASNA_SECRETS_LOCAL_VAULT=1 opts into the local vault: set/list work at exit 0 with no fallback event", () => {
    const set = runSecrets(["set", "svc/token", "val-1", "--type", "token"], {
      HASNA_SECRETS_LOCAL_VAULT: "1",
    });
    expect(set.exitCode).toBe(0);
    expect(set.stderr).not.toContain("secrets-local-fallback");

    const res = runSecrets(["list"], { HASNA_SECRETS_LOCAL_VAULT: "1" });
    expect(res.exitCode).toBe(0);
    expect(res.stdout).toContain("1 secret(s)");
    // An opted-in local run says, in ONE line on stderr, that it is local — the
    // ruling's replacement for the old silent fallback. stdout stays clean, so
    // `--json` consumers are unaffected.
    expect(res.stderr).toContain("local vault mode");
    expect(res.stderr).not.toContain("secrets-local-fallback");
    expect(set.stdout).not.toContain("local vault mode");
  });

  it("leaves utility surfaces available without any env", () => {
    const version = runSecrets(["--version"]);
    expect(version.exitCode).toBe(0);
    const docs = runSecrets(["docs"]);
    expect(docs.exitCode).toBe(0);
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

  it("treats a retired storage-mode variable as inert, not as a local selector", () => {
    // Deployment modes no longer exist (owner directive 2026-07-29, reaffirmed
    // by #1720: route on URL + key only). HASNA_SECRETS_STORAGE_MODE=local is
    // not a way to reach the local vault and not a mode: with no credential the
    // run still fails closed, and the way out is still the explicit opt-in.
    const res = runSecrets(["list"], {
      HASNA_SECRETS_STORAGE_MODE: "local",
    });

    expect(res.exitCode).not.toBe(0);
    expect(res.stderr).toContain("HASNA_SECRETS_LOCAL_VAULT");
    expect(res.stderr).not.toContain("secrets-local-fallback");
    expect(existsSync(join(testDir, "vault.db"))).toBe(false);
  });

  it("resolves the credential from a 0600 ~/.hasna/secrets/config/credentials file", () => {
    // The disk tier, end to end through the CLI: nothing in the environment
    // carries a key, and the run still reaches the hosted vault (loopback here,
    // so the request fails loudly at connect time rather than reading local
    // data). What is proven is the ROUTE — no local db file is created.
    const hasnaHome = join(testDir, "credential-home");
    const configDir = join(hasnaHome, "secrets", "config");
    mkdirSync(configDir, { recursive: true, mode: 0o700 });
    writeFileSync(
      join(configDir, "credentials"),
      'HASNA_SECRETS_API_URL="http://127.0.0.1:1"\nHASNA_SECRETS_API_KEY="hasna_secrets_fixture_key"\n',
      { mode: 0o600 },
    );

    // HASNA_CONFIG_HOME is cleared so HASNA_HOME anchors the default layout
    // (`<HASNA_HOME>/<app>/config/credentials`); a blank override is unset.
    const res = runSecrets(["list"], { HASNA_HOME: hasnaHome, HASNA_CONFIG_HOME: "" });

    expect(res.exitCode).not.toBe(0);
    expect(res.stderr).not.toContain("HASNA_SECRETS_LOCAL_VAULT");
    expect(res.stdout).not.toContain("Vault is empty.");
    expect(existsSync(join(testDir, "vault.db"))).toBe(false);
  });

  it("emits no fallback event when cloud is configured — the fail-closed path stays loud", () => {
    // Control B of the incident: URL + KEY both present => cloud-http resolution.
    // No fallback event may appear; the run fails loudly instead (nothing listens
    // on the loopback port, and a test process must never reach a remote vault).
    const res = runSecrets(["list"], {
      HASNA_SECRETS_API_URL: "http://127.0.0.1:1",
      HASNA_SECRETS_API_KEY: "fixture-key",
    });

    expect(res.exitCode).not.toBe(0);
    expect(res.stderr).not.toContain("secrets-local-fallback");
  });
});
