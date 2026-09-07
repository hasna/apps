// ============================================================================
// Credential-resolution tests for the @hasna/contracts client chain
// (hasna/apps#1720, checklist 6).
//
// Every surface of mementos — CLI transport (src/db/api-mode.ts), the MCP
// server, and the ./sdk client — resolves its credential and authority through
// the ONE resolver in `@hasna/contracts/client`, fresh on every call:
//
//   1. explicit args      — `credentials.apiKey` / `credentials.profile`
//   2. env pointers       — `HASNA_MEMENTOS_API_KEY_OVERRIDE`, `HASNA_PROFILE`,
//                           `HASNA_MEMENTOS_API_KEY_REF`
//   3. macOS Keychain     — `hasna.credentials.mementos.api-key`, account
//                           `HASNA_STATION` → hostname → USER
//   4. disk               — `~/.hasna/mementos/config/credentials` (0600)
//   5. `HASNA_MEMENTOS_API_KEY`
//
// These tests are hermetic: HOME / HASNA_CONFIG_HOME point at throwaway
// fixture directories (never the machine home — a fixture write there would
// destroy the operator's real credential file), and the Keychain tier is
// exercised through an INJECTED `security` runner, so no login keychain is
// ever opened and no real credential is read.
// ============================================================================

import { afterEach, describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  resolveCredential,
  type CredentialChainOptions,
  type KeychainCommandResult,
  type KeychainCommandRunner,
  type ResolvedCredential,
} from "@hasna/contracts/client";
import {
  MEMENTOS_LOCAL_OPT_IN_ENV_KEYS,
  MEMENTOS_DB_PATH_ENV_KEYS,
  mementosResolverEnv,
  mementosResolverInputs,
} from "../lib/local-opt-in.js";
import {
  API_KEY_ENV_KEYS,
  API_URL_ENV_KEYS,
  DATABASE_URL_ENV_KEYS,
  MementosStoreConfigError,
  assertClientStoreConfigured,
  getApiConfig,
  getResolvedApiModeReport,
} from "./api-mode.js";

const KEYCHAIN_KEY = "fixture-keychain-key";
const KEYCHAIN_SERVICE = "hasna.credentials.mementos.api-key";
const KEYCHAIN_ACCOUNT = "mementos-fixture-station";

type Env = Record<string, string | undefined>;

/** Every env name that can point a mementos resolution at a real tier. */
const CLEAN_KEYS = [
  ...API_URL_ENV_KEYS,
  ...API_KEY_ENV_KEYS,
  ...DATABASE_URL_ENV_KEYS,
  ...MEMENTOS_LOCAL_OPT_IN_ENV_KEYS,
  ...MEMENTOS_DB_PATH_ENV_KEYS,
  "HASNA_MEMENTOS_API_KEY_OVERRIDE",
  "HASNA_MEMENTOS_API_KEY_REF",
  "HASNA_PROFILE",
  "HASNA_STATION",
  "HASNA_CONFIG_HOME",
  "HASNA_HOME",
] as const;

const saved = new Map<string, string | undefined>();

afterEach(() => {
  for (const key of CLEAN_KEYS) {
    const previous = saved.get(key);
    if (previous === undefined) delete process.env[key];
    else process.env[key] = previous;
  }
  for (const dir of homes) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // best effort — a leaked temp dir must not fail the suite
    }
  }
  homes.clear();
});

/**
 * A hermetic env: every pointer to a real credential tier removed, the fixture
 * home applied, and nothing else that could route a resolution.
 */
function hermeticEnv(extra: Env = {}): Env {
  const env: Env = { ...process.env };
  for (const key of CLEAN_KEYS) delete env[key];
  for (const [key, value] of Object.entries(extra)) {
    if (value === undefined) delete env[key];
    else env[key] = value;
  }
  return env;
}

const homes = new Set<string>();

/** A throwaway fixture home, removed after the suite. Never the machine home. */
function tempHome(): string {
  const dir = mkdtempSync(join(process.env["TMPDIR"] ?? "/tmp", "mementos-cred-fixture-"));
  homes.add(dir);
  return dir;
}

/** The disk tier: `$HOME/.hasna/mementos/config/credentials` at 0600. */
function writeDiskCredential(home: string, value: string, keyName = API_KEY_ENV_KEYS[0]): string {
  const file = join(home, ".hasna", "mementos", "config", "credentials");
  mkdirSync(join(home, ".hasna", "mementos", "config"), { recursive: true });
  writeFileSync(file, `${keyName}=${value}\n`, { mode: 0o600 });
  chmodSync(file, 0o600);
  return file;
}

/** An injected `security` runner answering item lookups from a fixture map. */
function fakeKeychain(
  items: Record<string, string>,
): { calls: string[][]; credentials: CredentialChainOptions } {
  const calls: string[][] = [];
  const run: KeychainCommandRunner = (argv: readonly string[]): KeychainCommandResult => {
    calls.push([...argv]);
    const serviceIndex = argv.indexOf("-s");
    const service = serviceIndex >= 0 ? argv[serviceIndex + 1] : undefined;
    const value = service ? items[service!] : undefined;
    if (value === undefined) return { status: 44, stdout: "", stderr: "" };
    return { status: 0, stdout: `${value}\n`, stderr: "" };
  };
  return {
    calls,
    credentials: { keychain: { platform: "darwin", run } },
  };
}

describe("credential resolution — the @hasna/contracts chain", () => {
  test("env tier: HASNA_MEMENTOS_API_KEY resolves with tier 'env'", () => {
    const env = hermeticEnv({ HASNA_MEMENTOS_API_KEY: "env-tier-key" });
    const credential = resolveCredential("mementos", env) as ResolvedCredential;
    expect(credential.apiKey).toBe("env-tier-key");
    expect(credential.tier).toBe("env");
    expect(credential.source).toBe("HASNA_MEMENTOS_API_KEY");
  });

  test("keychain tier wins above disk and env; the injected runner is called once", () => {
    const home = tempHome();
    const env = hermeticEnv({
      HOME: home,
      HASNA_STATION: KEYCHAIN_ACCOUNT,
      HASNA_MEMENTOS_API_KEY: "env-tier-key",
    });
    writeDiskCredential(home, "disk-tier-key");
    const keychain = fakeKeychain({ [KEYCHAIN_SERVICE]: KEYCHAIN_KEY });

    const config = getApiConfig(env, { credentials: keychain.credentials });
    expect(config).not.toBeNull();
    expect(config!.apiKey).toBe(KEYCHAIN_KEY);
    expect(config!.baseUrl).toBe("https://api.hasna.com/mementos/v1"); // fleet gateway

    const credential = resolveCredential("mementos", env, keychain.credentials) as ResolvedCredential;
    expect(credential.tier).toBe("keychain");
    expect(credential.source).toBe(`keychain:${KEYCHAIN_SERVICE}@${KEYCHAIN_ACCOUNT}`);
    // One api-key lookup per chain pass — the transport re-uses the tier-1
    // value within the pass instead of re-reading the item: getApiConfig()
    // above performed one pass, and this explicit resolveCredential() call a
    // second. (The api-url item is looked up once per pass for the authority,
    // and answers item-not-found.)
    const apiKeyLookups = keychain.calls.filter((call) => call.includes(KEYCHAIN_SERVICE));
    expect(apiKeyLookups.length).toBe(2);
    expect(keychain.calls[0]!).toEqual([
      "find-generic-password",
      "-a",
      KEYCHAIN_ACCOUNT,
      "-s",
      KEYCHAIN_SERVICE,
      "-w",
    ]);
  });

  test("disk tier: ~/.hasna/mementos/config/credentials supplies the key above env", () => {
    const home = tempHome();
    const env = hermeticEnv({ HOME: home, HASNA_MEMENTOS_API_KEY: "env-tier-key" });
    const file = writeDiskCredential(home, "disk-tier-key");

    const credential = resolveCredential("mementos", env) as ResolvedCredential;
    expect(credential.apiKey).toBe("disk-tier-key");
    expect(credential.tier).toBe("disk");
    expect(credential.source).toBe(file);
  });

  test("the legacy MEMENTOS_API_KEY alias is the resolver's silent fallback", () => {
    const env = hermeticEnv({ MEMENTOS_API_KEY: "legacy-alias-key" });
    const credential = resolveCredential("mementos", env) as ResolvedCredential;
    expect(credential.apiKey).toBe("legacy-alias-key");
    expect(credential.source).toBe("MEMENTOS_API_KEY");
  });

  test("nothing resolves on a scrubbed env: no key, no throw", () => {
    const env = hermeticEnv({ HOME: tempHome() });
    expect(resolveCredential("mementos", env)).toBeNull();
  });

  test("a key alone is a COMPLETE configuration: the fleet gateway authority applies", () => {
    const env = hermeticEnv({ HASNA_MEMENTOS_API_KEY: "gateway-key" });
    const config = getApiConfig(env);
    expect(config).not.toBeNull();
    expect(config!.apiKey).toBe("gateway-key");
    expect(config!.baseUrl).toBe("https://api.hasna.com/mementos/v1");
  });

  test("a URL alone refuses with the missing credential named", () => {
    const env = hermeticEnv({ HASNA_MEMENTOS_API_URL: "https://mementos.hasna.xyz" });
    expect(() => getApiConfig(env)).toThrow(/no API key could be resolved/);
  });

  test("disagreeing URL aliases refuse (fail closed, never precedence)", () => {
    const env = hermeticEnv({
      HASNA_MEMENTOS_API_URL: "https://api.hasna.com/mementos",
      MEMENTOS_API_URL: "https://other.example",
      HASNA_MEMENTOS_API_KEY: "k",
    });
    expect(() => getApiConfig(env)).toThrow(/disagree/);
  });

  test("an explicit local DB path outranks a resolved credential (precedence 1)", () => {
    const env = hermeticEnv({
      HASNA_MEMENTOS_API_KEY: "k",
      MEMENTOS_DB_PATH: "/tmp/scratch-mementos.db",
    });
    expect(getApiConfig(env)).toBeNull();
  });

  test("the deliberate local flag selects local only when nothing configures an authority", () => {
    const flagOnly = hermeticEnv({ HASNA_MEMENTOS_LOCAL: "1" });
    expect(getApiConfig(flagOnly)).toBeNull();

    const flagWithKey = hermeticEnv({ HASNA_MEMENTOS_LOCAL: "1", HASNA_MEMENTOS_API_KEY: "k" });
    // A configured environment outranks the flag opt-in: the resolver decides.
    expect(getApiConfig(flagWithKey)).not.toBeNull();
  });
});

describe("fail-closed store gate", () => {
  test("hosted intent without a credential refuses with code MEMENTOS_STORE_CONFIG", () => {
    const env = hermeticEnv({ HOME: tempHome() });
    let message = "";
    let code = "";
    try {
      assertClientStoreConfigured(env);
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
      code = (error as { code?: string }).code ?? "";
    }
    expect(code).toBe("MEMENTOS_STORE_CONFIG");
    expect(message).toContain("will NOT fall back");
    expect(message).toContain("hasna.credentials.mementos.api-key");
    expect(message).toContain("HASNA_MEMENTOS_API_KEY");
  });

  test("the gate passes with a disk credential present (no env, no keychain)", () => {
    const home = tempHome();
    writeDiskCredential(home, "disk-tier-key");
    const env = hermeticEnv({ HOME: home });
    expect(() => assertClientStoreConfigured(env)).not.toThrow();
    const config = getApiConfig(env);
    expect(config?.baseUrl).toBe("https://api.hasna.com/mementos/v1");
  });

  test("the gate passes under the deliberate local opt-ins without any credential", () => {
    expect(() => assertClientStoreConfigured(hermeticEnv({ MEMENTOS_DB_PATH: "/tmp/x.db" }))).not.toThrow();
    expect(() => assertClientStoreConfigured(hermeticEnv({ HASNA_MEMENTOS_LOCAL: "1" }))).not.toThrow();
  });

  test("half a configuration refuses instead of serving a different dataset", () => {
    const env = hermeticEnv({ HASNA_MEMENTOS_API_URL: "https://mementos.hasna.xyz" });
    expect(() => assertClientStoreConfigured(env)).toThrow(MementosStoreConfigError);
  });
});

describe("transport report (storage mode sources)", () => {
  test("reports WHERE the authority and credential came from — never the value", () => {
    const home = tempHome();
    const env = hermeticEnv({
      HOME: home,
      HASNA_MEMENTOS_API_URL: "https://api.hasna.com/mementos",
    });
    const file = writeDiskCredential(home, "disk-tier-key");

    const report = getResolvedApiModeReport(env);
    expect(report).not.toBeNull();
    expect(report!.baseUrl).toBe("https://api.hasna.com/mementos/v1");
    expect(report!.apiUrlSource).toBe("HASNA_MEMENTOS_API_URL");
    expect(report!.apiKeySource).toBe(file);
    expect(report!.apiKeyTier).toBe("disk");
    expect(JSON.stringify(report)).not.toContain("disk-tier-key");
  });

  test("a credential alone reports the fleet gateway as the authority source", () => {
    const env = hermeticEnv({ HASNA_MEMENTOS_API_KEY: "k" });
    const report = getResolvedApiModeReport(env);
    expect(report!.apiUrlSource).toBe("default");
    expect(report!.baseUrl).toBe("https://api.hasna.com/mementos/v1");
  });

  test("local opt-in reports no transport", () => {
    expect(getResolvedApiModeReport(hermeticEnv({ HASNA_MEMENTOS_LOCAL: "1" }))).toBeNull();
  });

  test("nothing configured reports no transport (the gate owns the refusal)", () => {
    expect(getResolvedApiModeReport(hermeticEnv({ HOME: tempHome() }))).toBeNull();
  });
});

describe("blank normalisation never hands the resolver a silent copy (hasna/apps#1788)", () => {
  test("declared-but-blank authority variables are removed before the resolver sees the env", () => {
    const env = hermeticEnv({
      HASNA_MEMENTOS_API_URL: "",
      HASNA_MEMENTOS_API_KEY: "  ",
    });
    const normalised = mementosResolverEnv(env);
    expect(normalised).not.toBe(env); // a copy was needed
    expect(normalised["HASNA_MEMENTOS_API_URL"]).toBeUndefined();
    expect(normalised["HASNA_MEMENTOS_API_KEY"]).toBeUndefined();
  });

  test("no blanks: the inputs pass through BY IDENTITY, keeping the ambient Keychain gate", () => {
    const env = hermeticEnv({ HASNA_MEMENTOS_API_KEY: "k" });
    const inputs = mementosResolverInputs(env);
    expect(inputs.env).toBe(env); // identity preserved — no copy, no gate loss
    expect(inputs.credentials.keychain?.enabled).toBeUndefined();
  });

  test("a blank forces a copy: the ambient gate travels as keychain.enabled, never silently drops", () => {
    // The ambient-env half: process.env (the live environment, whose Keychain
    // tier is ambient) carries one declared-but-blank authority variable. The
    // normaliser must copy (it cannot delete from process.env), and the copy
    // must carry the ambient gate explicitly — otherwise the Keychain tier
    // silently turns itself off on a machine whose Keychain holds the key.
    for (const key of CLEAN_KEYS) {
      saved.set(key, process.env[key]);
      delete process.env[key];
    }
    try {
      process.env["HASNA_MEMENTOS_API_URL"] = "";
      const inputs = mementosResolverInputs(process.env);
      expect(inputs.env).not.toBe(process.env); // blank forced a copy
      // The copy is NOT ambient by identity, so the gate must have travelled.
      expect(inputs.credentials.keychain?.enabled).toBe(true);
    } finally {
      for (const key of CLEAN_KEYS) {
        const value = saved.get(key);
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  });

  test("an explicit keychain.enabled=false survives the normaliser untouched", () => {
    const env = hermeticEnv({ HASNA_MEMENTOS_API_URL: "" });
    const inputs = mementosResolverInputs(env, { keychain: { enabled: false } });
    expect(inputs.credentials.keychain?.enabled).toBe(false);
  });
});