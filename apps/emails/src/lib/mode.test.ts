// THE CLIENT DATA-SOURCE MODE, resolved from the storage plan and from nothing else.
//
// Deployment modes were removed (hasna/apps#1566): no variable, config key or
// operator instruction selects a mode any more. The store seam
// (src/store-resolution.ts) decides which store this process reads and writes
// from storage configuration alone — an API origin plus a credential, or an
// explicit database path — and this module maps that plan onto the two-arm value
// the not-yet-collapsed repository families still route on (`local` /
// `self_hosted`). These tests pin that mapping, and pin that the RETIRED
// deployment-mode contract — the word variables in either spelling, their
// config-file spellings, and the legacy Mailery/cloud runtime keys — is refused
// at the resolution boundary in the guard module's own words
// (src/lib/retired-deployment-mode.ts, the only module allowed to spell it).

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { chmodSync, existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { resetSelfHostedConfigCache } from "../db/self-hosted-store.js";
import { EMAILS_CLIENT_ENV_SECRET_ENV, EMAILS_SELF_HOSTED_API_KEY_ENV } from "./client-env.js";
import { saveConfig } from "./config.js";
import { clientModeLabel, getClientMode, resolveClientMode, resolveClientModeSelection } from "./mode.js";
import {
  RETIRED_MODE_VARIABLE_KEYS,
  assertNoLegacyHostedEnvironment,
  assertNoRetiredModeVariables,
} from "./retired-deployment-mode.js";

let INHERITED_PROCESS_ENV: NodeJS.ProcessEnv;
let ORIGINAL_HOME: string | undefined;
let ORIGINAL_PATH: string | undefined;
function captureInheritedProcessEnv(): void {
  INHERITED_PROCESS_ENV = { ...process.env };
  ORIGINAL_HOME = process.env["HOME"];
  ORIGINAL_PATH = process.env["PATH"];
}
function restoreInheritedProcessEnv(): void {
  for (const key of Object.keys(process.env)) {
    if (!Object.prototype.hasOwnProperty.call(INHERITED_PROCESS_ENV, key)) delete process.env[key];
  }
  Object.assign(process.env, INHERITED_PROCESS_ENV);
}

const TMP_HOME = join("/tmp", `emails-mode-test-${process.pid}`);

// Every environment key a resolution reads or a guard refuses, scrubbed between
// cases so no test inherits another's storage configuration. The retired word
// spellings come from the guard module's export; the legacy Mailery keys are
// spelled here only to scrub them from the harness (a value in any of them would
// trip the legacy-runtime guard below) and to drive the guard's own refusal
// cases.
const ENV_KEYS = [
  ...RETIRED_MODE_VARIABLE_KEYS,
  EMAILS_CLIENT_ENV_SECRET_ENV,
  "HASNA_EMAILS_DB_PATH",
  "EMAILS_DB_PATH",
  "EMAILS_SELF_HOSTED_URL",
  "EMAILS_SELF_HOSTED_API_KEY",
  "EMAILS_SESSION_TOKEN",
  "EMAILS_IDP_TOKEN",
  // Legacy mode keys (must be refused loudly).
  "MAILERY_MODE",
  "HASNA_MAILERY_MODE",
  "MAILERY_STORAGE_MODE",
  "HASNA_MAILERY_STORAGE_MODE",
  "EMAILS_STORAGE_MODE",
  "HASNA_EMAILS_STORAGE_MODE",
  // Legacy hosted credential keys (must be refused loudly, never select).
  "MAILERY_API_URL",
  "MAILERY_API_KEY",
  "MAILERY_CLOUD_API_URL",
  "MAILERY_CLOUD_TOKEN",
  "HASNA_MAILERY_API_URL",
  "HASNA_MAILERY_API_KEY",
  "HASNA_MAILERY_ENV_FILE",
] as const;

// A canonical, non-loopback API origin (HTTPS is mandatory off-loopback).
const SELF_HOSTED_URL = "https://emails.example.invalid";
const SELF_HOSTED_KEY = "not-a-real-key";

function setSelfHostedCredentials(): void {
  process.env["EMAILS_SELF_HOSTED_URL"] = SELF_HOSTED_URL;
  process.env[EMAILS_SELF_HOSTED_API_KEY_ENV] = SELF_HOSTED_KEY;
}

// Install a `secrets` shim on PATH that returns a client-env payload carrying the
// canonical API settings. The payload is built in JS (never written as a word
// literal) so tests may include the retired variable when a case needs it.
function installSecretsCommandReturning(payload: Record<string, string>): void {
  const binDir = join(TMP_HOME, "bin");
  mkdirSync(binDir, { recursive: true });
  const secretsBin = join(binDir, "secrets");
  writeFileSync(
    secretsBin,
    `#!/bin/sh
if [ "$1" = "get" ] && [ "$2" = "hasna/xyz/opensource/emails/prod/client-env" ]; then
  printf '%s\\n' '${JSON.stringify(payload)}'
  exit 0
fi
exit 2
`,
  );
  chmodSync(secretsBin, 0o700);
  process.env["PATH"] = `${binDir}:${ORIGINAL_PATH ?? ""}`;
  process.env[EMAILS_CLIENT_ENV_SECRET_ENV] = "hasna/xyz/opensource/emails/prod/client-env";
}

const API_PAYLOAD = {
  EMAILS_SELF_HOSTED_URL: SELF_HOSTED_URL,
  EMAILS_SELF_HOSTED_API_KEY: SELF_HOSTED_KEY,
} as const;

// Install a `secrets` shim that FAILS loudly if invoked — proves a path never
// reaches the loader.
function installFailingSecretsCommand(): void {
  const binDir = join(TMP_HOME, "bin-fail");
  mkdirSync(binDir, { recursive: true });
  const secretsBin = join(binDir, "secrets");
  writeFileSync(
    secretsBin,
    `#!/bin/sh
echo "secrets command should not be called" >&2
exit 42
`,
  );
  chmodSync(secretsBin, 0o700);
  process.env["PATH"] = `${binDir}:${ORIGINAL_PATH ?? ""}`;
  process.env[EMAILS_CLIENT_ENV_SECRET_ENV] = "hasna/xyz/opensource/emails/prod/client-env";
}

beforeEach(() => {
  captureInheritedProcessEnv();
  mkdirSync(TMP_HOME, { recursive: true });
  process.env["HOME"] = TMP_HOME;
  for (const key of ENV_KEYS) delete process.env[key];
  if (ORIGINAL_PATH === undefined) delete process.env["PATH"];
  else process.env["PATH"] = ORIGINAL_PATH;
  resetSelfHostedConfigCache();
});

afterEach(() => {
  for (const key of ENV_KEYS) delete process.env[key];
  if (ORIGINAL_HOME === undefined) delete process.env["HOME"];
  else process.env["HOME"] = ORIGINAL_HOME;
  if (ORIGINAL_PATH === undefined) delete process.env["PATH"];
  else process.env["PATH"] = ORIGINAL_PATH;
  if (existsSync(TMP_HOME)) rmSync(TMP_HOME, { recursive: true, force: true });
  resetSelfHostedConfigCache();
  restoreInheritedProcessEnv();
});

describe("clientModeLabel", () => {
  it("labels both mode values by the connection they mean, never by placement", () => {
    expect(clientModeLabel("local")).toBe("Local");
    expect(clientModeLabel("self_hosted")).toBe("Server API");
  });
});

describe("resolveClientModeSelection — the storage-plan mapping", () => {
  it("maps an explicit database path to the local arm, naming the setting", () => {
    process.env["EMAILS_DB_PATH"] = ":memory:";
    // Local is EXPLICIT only (fail-closed ruling, 2026-09-04): a configured
    // database path is the local choice the store seam reads, so a DB-path-only
    // environment resolves local without any API settings and without consulting
    // a client credential.
    expect(resolveClientModeSelection()).toEqual({
      mode: "local",
      label: "Local",
      source: { kind: "env", name: "EMAILS_DB_PATH", value: ":memory:" },
      warning: null,
    });
    expect(getClientMode()).toBe("local");
  });

  it("maps an API URL plus a credential to the API arm, without any mode variable", () => {
    // The deployment-mode variable is retired (hasna/apps#1566): the API settings
    // alone are the whole selection contract.
    setSelfHostedCredentials();
    expect(resolveClientModeSelection()).toEqual({
      mode: "self_hosted",
      label: "Server API",
      source: { kind: "env", name: "EMAILS_SELF_HOSTED_URL", value: SELF_HOSTED_URL },
      warning: null,
    });
    expect(getClientMode()).toBe("self_hosted");
  });

  it("refuses an environment that configures BOTH storage rows (contradiction row)", () => {
    setSelfHostedCredentials();
    process.env["HASNA_EMAILS_DB_PATH"] = "/tmp/unused-local.db";
    let thrown: unknown;
    try {
      resolveClientModeSelection();
    } catch (error) {
      thrown = error;
    }
    // The seam's contradiction row — no precedence, no winner.
    expect(String(thrown)).toContain("two configured places to keep its mail");
    expect(String(thrown)).toContain("UNSET ONE");
  });

  it("fails closed on an API URL without a credential, naming the credential settings", () => {
    process.env["EMAILS_SELF_HOSTED_URL"] = SELF_HOSTED_URL;
    let thrown: unknown;
    try {
      resolveClientModeSelection();
    } catch (error) {
      thrown = error;
    }
    const message = String(thrown);
    expect(message).toContain("configures an Emails API but no credential is set");
    expect(message).toContain("EMAILS_SESSION_TOKEN");
    expect(message).toContain("EMAILS_SELF_HOSTED_API_KEY");
  });

  it("fails closed when nothing is configured, naming both storage rows", () => {
    // Incident 715712's shape, now a hard refusal (fail-closed ruling, 2026-09-04):
    // with no API configuration and no explicit local choice there is no safe
    // default, so resolution throws and names what it needs instead of serving an
    // empty local database at rc=0.
    for (const resolve of [resolveClientMode, resolveClientModeSelection]) {
      let thrown: unknown;
      try {
        resolve();
      } catch (error) {
        thrown = error;
      }
      const message = String((thrown as Error).message);
      // The required API environment: the origin, every credential route, and the
      // vault pointer that delivers them...
      expect(message).toContain("EMAILS_SELF_HOSTED_URL");
      expect(message).toContain("EMAILS_SESSION_TOKEN");
      expect(message).toContain("EMAILS_SELF_HOSTED_API_KEY");
      expect(message).toContain(EMAILS_CLIENT_ENV_SECRET_ENV);
      // ...and the explicit ways back to local.
      expect(message).toContain("HASNA_EMAILS_DB_PATH");
      expect(message).toContain("EMAILS_DB_PATH");
    }
  });
});

describe("the retired deployment-mode contract", () => {
  it("refuses either retired word spelling, whatever value it carries", () => {
    // The variables that used to DECLARE the mode were removed, not ignored: a
    // carried-forward value — even the old "valid" self_hosted value — is refused
    // with the guard's own sentence, which names the variable and its replacement.
    for (const key of RETIRED_MODE_VARIABLE_KEYS) {
      for (const value of ["local", "self_hosted", "cloud"]) {
        expect(() => assertNoRetiredModeVariables({ [key]: value } as NodeJS.ProcessEnv)).toThrow(
          `${key} was removed. Deployment modes no longer exist in Emails`,
        );
      }
    }
  });

  it("mode resolution refuses a carried-forward word BEFORE reading any storage row", () => {
    // The strongest form: even an environment that fully and correctly configures
    // BOTH storage rows must fail on the word, because the word itself is gone.
    process.env[RETIRED_MODE_VARIABLE_KEYS[0]] = "local";
    setSelfHostedCredentials();
    process.env["HASNA_EMAILS_DB_PATH"] = "/tmp/unused-local.db";
    let thrown: unknown;
    try {
      resolveClientMode();
    } catch (error) {
      thrown = error;
    }
    const message = String(thrown);
    expect(message).toContain("was removed. Deployment modes no longer exist in Emails");
    expect(message).not.toContain("two configured places to keep its mail");
  });

  it("refuses the config-file spellings of the retired contract", () => {
    // The old client accepted an `emails_mode` key in the config file; none of
    // those keys select anything any more, so a stale key fails resolution with
    // the guard's refusal rather than being watched do nothing.
    saveConfig({ emails_mode: "self_hosted" });
    let thrown: unknown;
    try {
      resolveClientModeSelection();
    } catch (error) {
      thrown = error;
    }
    expect(String(thrown)).toContain("'emails_mode' in the Emails config file was removed");
    expect(String(thrown)).toContain("Deployment modes no longer exist in Emails");
  });

  it("rejects the legacy Mailery mode and hosted-runtime keys", () => {
    const legacyKeys = [
      "MAILERY_MODE",
      "HASNA_MAILERY_MODE",
      "MAILERY_STORAGE_MODE",
      "HASNA_MAILERY_STORAGE_MODE",
      "EMAILS_STORAGE_MODE",
      "HASNA_EMAILS_STORAGE_MODE",
      "MAILERY_API_URL",
      "MAILERY_API_KEY",
      "MAILERY_CLOUD_API_URL",
      "MAILERY_CLOUD_TOKEN",
      "HASNA_MAILERY_API_URL",
      "HASNA_MAILERY_API_KEY",
      "HASNA_MAILERY_ENV_FILE",
    ] as const;
    for (const key of legacyKeys) {
      const env = { [key]: "cloud" } as NodeJS.ProcessEnv;
      let thrown: unknown;
      try {
        assertNoLegacyHostedEnvironment(env);
      } catch (error) {
        thrown = error;
      }
      expect(String(thrown)).toContain(`${key} belongs to the removed Mailery/cloud runtime`);
      expect(String(thrown)).toContain("Deployment modes no longer exist in Emails");
    }
  });

  it("mode resolution refuses legacy hosted keys even under a complete API environment", () => {
    process.env["HASNA_MAILERY_API_URL"] = "https://legacy.example.invalid";
    process.env["HASNA_MAILERY_API_KEY"] = "legacy-key";
    setSelfHostedCredentials();
    expect(() => resolveClientMode()).toThrow("belongs to the removed Mailery/cloud runtime");
  });
});

describe("resolveClientMode / resolveClientModeSelection — the secret pointer", () => {
  it("selection alone refuses a pointer whose payload has not been delivered", () => {
    // resolveClientModeSelection never loads the pointer (loading is what turns a
    // pointer-only environment into one the plan can decide), so a pointer with no
    // URL in the environment is the seam's pointer-without-payload row — refused
    // in the plan's own words, with the loader provably never invoked.
    installFailingSecretsCommand();
    expect(() => resolveClientModeSelection()).toThrow(
      "is set, but EMAILS_SELF_HOSTED_URL is not present in this environment",
    );
  });

  it("resolveClientMode delivers the pointer payload into canonical env and resolves the API arm", () => {
    installSecretsCommandReturning({ ...API_PAYLOAD });

    expect(resolveClientMode()).toEqual({
      mode: "self_hosted",
      label: "Server API",
      source: { kind: "env", name: "EMAILS_SELF_HOSTED_URL", value: SELF_HOSTED_URL },
      warning: null,
    });
    expect(getClientMode()).toBe("self_hosted");
    // The pointer is expanded into the canonical API settings — and into nothing
    // else: no retired variable is ever merged into the environment.
    expect(process.env["EMAILS_SELF_HOSTED_URL"]).toBe(SELF_HOSTED_URL);
    expect(process.env[EMAILS_SELF_HOSTED_API_KEY_ENV]).toBe(SELF_HOSTED_KEY);
    for (const retiredKey of RETIRED_MODE_VARIABLE_KEYS) {
      expect(process.env[retiredKey]).toBeUndefined();
    }
  });

  it("refuses a vault entry that still carries a retired mode variable, at load", () => {
    // A vault entry written against the older contract carries the word next to the
    // settings. The loader refuses the whole entry rather than silently dropping
    // the word (src/lib/client-env.ts), and nothing is merged into the env.
    const retiredKey = RETIRED_MODE_VARIABLE_KEYS[0];
    installSecretsCommandReturning({ ...API_PAYLOAD, [retiredKey]: "self_hosted" });
    let thrown: unknown;
    try {
      resolveClientMode();
    } catch (error) {
      thrown = error;
    }
    expect(String(thrown)).toContain(`${retiredKey} was removed`);
    expect(process.env["EMAILS_SELF_HOSTED_URL"]).toBeUndefined();
  });

  it("never carries the credential value on the resolution", () => {
    installSecretsCommandReturning({ ...API_PAYLOAD });
    const resolution = resolveClientMode();
    expect(JSON.stringify(resolution)).not.toContain(SELF_HOSTED_KEY);
    expect(resolution.source.value).toBe(SELF_HOSTED_URL);
  });
});
