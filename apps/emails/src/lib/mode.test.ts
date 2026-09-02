// The retained source adapter reports the sole API transport. Retired selectors
// fail before credential delivery; they can never shadow an existing mailbox.
import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { resetSelfHostedConfigCache } from "../db/self-hosted-store.js";
import {
  EMAILS_CLIENT_ENV_SECRET_ENV, EMAILS_MODE_ENV, HASNA_EMAILS_MODE_ENV,
  assertNoLegacyHostedEnvironment, clientEnvCredentialOverrideWarning,
  clientEnvPointerOverrideWarning, getEmailsMode, labelForEmailsMode,
  normalizeEmailsMode, resolveEmailsMode, resolveEmailsModeSelection,
} from "./mode.js";
import {
  CLIENT_DATABASE_SETTINGS, EMAILS_API_KEY_ENV, EMAILS_API_KEY_SETTINGS,
  EMAILS_API_URL_ENV, EMAILS_API_URL_SETTINGS, RETIRED_EMAILS_SELECTOR_SETTINGS,
  StoreConfigurationError,
} from "./client-settings.js";
import { CLIENT_ENV_CREDENTIAL_SELECTION_KEYS } from "./client-env.js";

const API_URL = "https://emails.example.invalid";
const FIXTURE_VALUE = "fixture-primary";
const POINTER = "fixture/emails/client-env";
const ENV_KEYS = [...new Set([
  ...RETIRED_EMAILS_SELECTOR_SETTINGS, ...CLIENT_DATABASE_SETTINGS,
  ...EMAILS_API_URL_SETTINGS, ...CLIENT_ENV_CREDENTIAL_SELECTION_KEYS,
  EMAILS_CLIENT_ENV_SECRET_ENV, "HASNA_EMAILS_HOME", "EMAILS_HOME",
  "HASNA_DATA_HOME", "HASNA_HOME", "CODEWITH_HOME",
])];
let inherited: NodeJS.ProcessEnv;
let fixtureRoot: string;
let stateRoots: string[];
let fetchSpy: ReturnType<typeof spyOn<typeof globalThis, "fetch">>;

function setApi(): void {
  process.env[EMAILS_API_URL_ENV] = API_URL;
  process.env[EMAILS_API_KEY_ENV] = FIXTURE_VALUE;
}

function refusal(action: () => unknown, settings?: readonly string[]): StoreConfigurationError {
  let thrown: unknown;
  try { action(); } catch (error) { thrown = error; }
  expect(thrown instanceof StoreConfigurationError).toBe(true);
  const error = thrown as StoreConfigurationError;
  if (settings) expect([...error.settings].sort()).toEqual([...settings].sort());
  expect(error.message.includes(FIXTURE_VALUE)).toBe(false);
  return error;
}

// Only this private executable can satisfy a credential-pointer fixture. It
// records invocation, not credentials, and never connects to a vault or service.
function installSecretsFixture(payload: Record<string, string> | null): string {
  const bin = join(fixtureRoot, "bin");
  const marker = join(fixtureRoot, "loader-called");
  mkdirSync(bin, { mode: 0o700 });
  const result = payload === null
    ? `printf '%s\\n' '${FIXTURE_VALUE}' >&2\nexit 42`
    : `printf '%s\\n' '${JSON.stringify(payload).replaceAll("'", "'\"'\"'")}'`;
  writeFileSync(join(bin, "secrets"), `#!/bin/sh
if [ "$1" != "get" ] || [ "$2" != "${POINTER}" ] || [ "$3" != "--show" ]; then exit 2; fi
printf invoked > '${marker}'
${result}
`, { mode: 0o700 });
  process.env.PATH = bin;
  process.env[EMAILS_CLIENT_ENV_SECRET_ENV] = POINTER;
  return marker;
}

function installApiFixture(): string {
  return installSecretsFixture({ [EMAILS_API_URL_ENV]: API_URL, [EMAILS_API_KEY_ENV]: FIXTURE_VALUE });
}

function savedSelector(value: string): { path: string; bytes: string; mode: number } {
  const root = join(fixtureRoot, "legacy");
  mkdirSync(root, { mode: 0o700 });
  process.env.HASNA_EMAILS_HOME = root;
  const path = join(root, "config.json");
  const bytes = JSON.stringify({ emails_mode: value, default_provider: "fixture-provider" });
  writeFileSync(path, bytes, { mode: 0o640 });
  return { path, bytes, mode: statSync(path).mode };
}

beforeEach(() => {
  inherited = { ...process.env };
  fixtureRoot = mkdtempSync(join(tmpdir(), "emails-mode-"));
  stateRoots = ["home", "config", "data", "state", "cache"].map(name => join(fixtureRoot, name));
  for (const root of stateRoots) mkdirSync(root, { mode: 0o700 });
  for (const key of ENV_KEYS) delete process.env[key];
  [process.env.HOME, process.env.XDG_CONFIG_HOME, process.env.XDG_DATA_HOME,
    process.env.XDG_STATE_HOME, process.env.XDG_CACHE_HOME] = stateRoots;
  resetSelfHostedConfigCache();
  fetchSpy = spyOn(globalThis, "fetch").mockImplementation(() => {
    throw new Error("mode fixture must not dispatch HTTP");
  });
});

afterEach(() => {
  try {
    expect(fetchSpy).toHaveBeenCalledTimes(0);
    for (const root of stateRoots) expect(readdirSync(root)).toEqual([]);
  } finally {
    fetchSpy.mockRestore();
    resetSelfHostedConfigCache();
    for (const key of Object.keys(process.env)) if (!(key in inherited)) delete process.env[key];
    Object.assign(process.env, inherited);
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

describe("retained mode adapter — selectors are never configuration", () => {
  it("rejects both former modes, including case and padding", () => {
    for (const value of ["local", "  LOCAL  ", "self_hosted", "  SELF_HOSTED  "]) {
      expect(refusal(() => normalizeEmailsMode(value)).message).toContain("retired");
    }
  });

  it("rejects cloud, remote, hybrid and spelling aliases without reflecting values", () => {
    for (const value of ["cloud", "remote", "hybrid", "self-hosted", "selfhosted", "", FIXTURE_VALUE]) {
      expect(refusal(() => normalizeEmailsMode(value)).message).toContain("HTTPS API");
    }
  });

  it("labels both retained type literals as the same API transport", () => {
    expect(labelForEmailsMode("local")).toBe("Server API");
    expect(labelForEmailsMode("self_hosted")).toBe("Server API");
  });

  it("reports the API diagnostic without credentials, vault loading or filesystem state", () => {
    const marker = installSecretsFixture(null);
    expect(getEmailsMode()).toBe("self_hosted");
    expect(existsSync(marker)).toBe(false);
  });

  it("reports the same diagnostic with valid API credentials and no selector", () => {
    setApi();
    expect(getEmailsMode()).toBe("self_hosted");
  });

  it("rejects removed storage selectors under both prefixes", () => {
    for (const key of ["MAILERY_STORAGE_MODE", "HASNA_MAILERY_STORAGE_MODE", "EMAILS_STORAGE_MODE", "HASNA_EMAILS_STORAGE_MODE"]) {
      expect(refusal(() => assertNoLegacyHostedEnvironment({ [key]: "cloud" }), [key]).message).toContain(key);
    }
  });

  it("rejects legacy selectors for former valid values and blanks", () => {
    for (const key of ["MAILERY_MODE", "HASNA_MAILERY_MODE"]) {
      for (const value of ["local", "self_hosted", "cloud", ""]) {
        refusal(() => assertNoLegacyHostedEnvironment({ [key]: value }), [key]);
      }
    }
  });

  it("rejects every retired key by presence, including blank values", () => {
    for (const key of RETIRED_EMAILS_SELECTOR_SETTINGS) {
      for (const value of ["", FIXTURE_VALUE]) {
        refusal(() => assertNoLegacyHostedEnvironment({ [key]: value }), [key]);
      }
    }
  });

  it("does not revive the old explicit-mode bypass for legacy credentials", () => {
    const env = { MAILERY_API_URL: API_URL, MAILERY_API_KEY: FIXTURE_VALUE };
    refusal(() => assertNoLegacyHostedEnvironment(env, { allowHostedApiEnvWithExplicitSelfHosted: true }), Object.keys(env));
  });
});

describe("resolved API selection — validated and side-effect free", () => {
  it("resolves canonical URL and credential without any placement selector", () => {
    setApi();
    expect(resolveEmailsMode()).toEqual({
      mode: "self_hosted", label: "Server API",
      source: { kind: "env", name: EMAILS_API_URL_ENV, value: `${API_URL}/v1` }, warning: null,
    });
  });

  it("retains all endpoint and API-key aliases without a mode", () => {
    for (const endpoint of EMAILS_API_URL_SETTINGS) for (const credential of EMAILS_API_KEY_SETTINGS) {
      expect(resolveEmailsModeSelection({ [endpoint]: API_URL, [credential]: FIXTURE_VALUE }).source.value).toBe(`${API_URL}/v1`);
    }
  });

  it("rejects both former selector names beside complete API credentials", () => {
    for (const key of [EMAILS_MODE_ENV, HASNA_EMAILS_MODE_ENV]) {
      for (const value of ["local", "self_hosted", "cloud", "remote", "hybrid", ""]) {
        refusal(() => resolveEmailsModeSelection({ [EMAILS_API_URL_ENV]: API_URL, [EMAILS_API_KEY_ENV]: FIXTURE_VALUE, [key]: value }), [key]);
      }
    }
  });

  it("ignores an existing saved selector without rewriting or hardening its file", () => {
    const saved = savedSelector("local");
    setApi();
    expect(resolveEmailsMode().source.kind).toBe("env");
    expect(readFileSync(saved.path, "utf8")).toBe(saved.bytes);
    expect(statSync(saved.path).mode).toBe(saved.mode);
  });

  it("does not let a saved selector supply missing API configuration", () => {
    const saved = savedSelector("self_hosted");
    refusal(() => resolveEmailsMode(), [EMAILS_API_URL_ENV]);
    expect(readFileSync(saved.path, "utf8")).toBe(saved.bytes);
    expect(statSync(saved.path).mode).toBe(saved.mode);
  });

  it("fails closed without an endpoint instead of reporting a local mailbox", () => {
    expect(refusal(() => resolveEmailsMode(), [EMAILS_API_URL_ENV]).message).toContain("required");
  });

  it("requires a credential and never exposes one in a resolution", () => {
    process.env[EMAILS_API_URL_ENV] = API_URL;
    expect(refusal(() => resolveEmailsMode()).message).toContain("credential is required");
    process.env[EMAILS_API_KEY_ENV] = FIXTURE_VALUE;
    expect(JSON.stringify(resolveEmailsMode()).includes(FIXTURE_VALUE)).toBe(false);
  });

  it("refuses blank or conflicting aliases instead of picking a winner", () => {
    setApi();
    process.env.EMAILS_API_URL = "";
    refusal(() => resolveEmailsMode(), [EMAILS_API_URL_ENV, "EMAILS_API_URL"]);
    process.env.EMAILS_API_URL = "https://other.example.invalid";
    refusal(() => resolveEmailsMode(), [EMAILS_API_URL_ENV, "EMAILS_API_URL"]);
  });

  it("does not sanitize credential-bearing URLs into successful diagnostics", () => {
    setApi();
    process.env[EMAILS_API_URL_ENV] = `https://operator:${FIXTURE_VALUE}@emails.example.invalid`;
    expect(refusal(() => resolveEmailsMode()).message.includes("operator")).toBe(false);
  });

  it("rejects every client database setting before pointer loading", () => {
    const marker = installSecretsFixture(null);
    for (const key of CLIENT_DATABASE_SETTINGS) {
      process.env[key] = ":memory:";
      refusal(() => resolveEmailsMode(), [key]);
      delete process.env[key];
    }
    expect(existsSync(marker)).toBe(false);
  });
});

describe("explicit credential-pointer delivery", () => {
  it("does not claim successful selection when the private loader fails", () => {
    const marker = installSecretsFixture(null);
    let thrown: unknown;
    try { resolveEmailsModeSelection(); } catch (error) { thrown = error; }
    expect(thrown instanceof Error).toBe(true);
    expect(String(thrown).includes(FIXTURE_VALUE)).toBe(false);
    expect(existsSync(marker)).toBe(true);
  });

  it("loads canonical API configuration without introducing a selector", () => {
    const marker = installApiFixture();
    expect(resolveEmailsMode()).toMatchObject({
      mode: "self_hosted", source: { name: EMAILS_API_URL_ENV, value: `${API_URL}/v1` }, warning: null,
    });
    expect(existsSync(marker)).toBe(true);
    expect(process.env[EMAILS_API_KEY_ENV] === FIXTURE_VALUE).toBe(true);
    expect(process.env[EMAILS_MODE_ENV]).toBeUndefined();
  });

  it("reports only the endpoint, never the delivered credential or vault pointer", () => {
    installApiFixture();
    const resolution = JSON.stringify(resolveEmailsMode());
    expect(resolution.includes(FIXTURE_VALUE)).toBe(false);
    expect(resolution.includes(POINTER)).toBe(false);
  });

  it("rejects a stale local selector before it can shadow or load a pointer", () => {
    const marker = installSecretsFixture(null);
    process.env[EMAILS_MODE_ENV] = "local";
    refusal(() => resolveEmailsMode(), [EMAILS_MODE_ENV]);
    expect(existsSync(marker)).toBe(false);
    expect(process.env[EMAILS_API_KEY_ENV]).toBeUndefined();
  });

  it("also rejects a blank inherited selector before loading", () => {
    const marker = installSecretsFixture(null);
    process.env[HASNA_EMAILS_MODE_ENV] = "";
    refusal(() => resolveEmailsMode(), [HASNA_EMAILS_MODE_ENV]);
    expect(existsSync(marker)).toBe(false);
  });

  it("refuses an obsolete selector delivered by a credential pointer", () => {
    const marker = installSecretsFixture({ [EMAILS_MODE_ENV]: "self_hosted", [EMAILS_API_URL_ENV]: API_URL, [EMAILS_API_KEY_ENV]: FIXTURE_VALUE });
    refusal(() => resolveEmailsMode(), [EMAILS_MODE_ENV]);
    expect(existsSync(marker)).toBe(true);
    expect(process.env[EMAILS_API_KEY_ENV]).toBeUndefined();
  });
});

describe("obsolete override-warning adapters — refusal replaces a wrong-mailbox warning", () => {
  for (const key of [EMAILS_MODE_ENV, HASNA_EMAILS_MODE_ENV]) {
    it(`refuses ${key} instead of allowing it to shadow a pointer`, () => {
      const error = refusal(() => clientEnvPointerOverrideWarning(key, POINTER));
      expect(error.settings).toContain(key);
      expect(error.message).toContain("retired");
      expect(error.message.includes(POINTER)).toBe(false);
    });
  }

  it("requires removal of inherited selectors, not a warning after a local read", () => {
    const error = refusal(() => assertNoLegacyHostedEnvironment({ [EMAILS_MODE_ENV]: "local" }));
    expect(error.message).toContain("Remove them");
    expect(error.message).toContain("No local fallback exists");
  });

  it("refuses the direct-credential shadow path without reflecting its endpoint", () => {
    const error = refusal(() => clientEnvCredentialOverrideWarning(EMAILS_MODE_ENV, API_URL));
    expect(error.message).toContain("retired");
    expect(error.message.includes(API_URL)).toBe(false);
  });

  it("never reflects credential-like arguments from either compatibility function", () => {
    refusal(() => clientEnvPointerOverrideWarning(FIXTURE_VALUE, FIXTURE_VALUE));
    refusal(() => clientEnvCredentialOverrideWarning(FIXTURE_VALUE, FIXTURE_VALUE));
  });
});
