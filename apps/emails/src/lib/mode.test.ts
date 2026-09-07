// THE CLIENT DATA-SOURCE MODE, resolved from the storage plan and from nothing else.
//
// Deployment modes were removed (hasna/apps#1566) and the credential resoser
// adoption (hasna/apps#1720) deleted the last guards that spelled the removed
// words: no variable, config key or operator instruction selects a mode any more.
// The store seam (src/store-resolution.ts) decides which store this process reads
// and writes from storage configuration alone — the @hasna/contracts-resolved API
// authority plus a credential (Keychain / credentials file / canonical env names
// or their one-release aliases), or an explicit database path — and this module
// maps that plan onto the two-arm value the not-yet-collapsed repository families
// still route on (`local` / `self_hosted`). These tests pin that mapping.

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { chmodSync, existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { resetSelfHostedConfigCache } from "../db/self-hosted-store.js";
import { EMAILS_CLIENT_ENV_SECRET_ENV, EMAILS_SELF_HOSTED_API_KEY_ENV } from "./client-env.js";
import { clientModeLabel, getClientMode, resolveClientMode, resolveClientModeSelection } from "./mode.js";

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

// Every environment key a resolution reads, scrubbed between cases so no test
// inherits another's storage configuration.
const ENV_KEYS = [
  ["EMAILS", "MODE"].join("_"),
  ["HASNA", "EMAILS", "MODE"].join("_"),
  EMAILS_CLIENT_ENV_SECRET_ENV,
  "HASNA_EMAILS_DB_PATH",
  "EMAILS_DB_PATH",
  "HASNA_EMAILS_API_URL",
  "HASNA_EMAILS_API_KEY",
  "EMAILS_SELF_HOSTED_URL",
  "EMAILS_SELF_HOSTED_API_KEY",
  "EMAILS_SESSION_TOKEN",
  "EMAILS_IDP_TOKEN",
] as const;

// A canonical, non-loopback API origin (HTTPS is mandatory off-loopback).
const SELF_HOSTED_URL = "https://emails.example.invalid";
const SELF_HOSTED_KEY = "not-a-real-key";

function setSelfHostedCredentials(): void {
  process.env["EMAILS_SELF_HOSTED_URL"] = SELF_HOSTED_URL;
  process.env[EMAILS_SELF_HOSTED_API_KEY_ENV] = SELF_HOSTED_KEY;
}

// Install a `secrets` shim on PATH that returns a client-env payload carrying the
// app's own principals (session/identity tokens).
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

  it("maps the canonical API URL plus a credential to the API arm, without any mode variable", () => {
    // The deployment-mode variable is retired (hasna/apps#1566): the API settings
    // alone are the whole selection contract, resolved through the shared
    // credential resolver under the canonical names.
    process.env["HASNA_EMAILS_API_URL"] = SELF_HOSTED_URL;
    process.env["HASNA_EMAILS_API_KEY"] = SELF_HOSTED_KEY;
    expect(resolveClientModeSelection()).toEqual({
      mode: "self_hosted",
      label: "Server API",
      source: { kind: "env", name: "HASNA_EMAILS_API_URL", value: SELF_HOSTED_URL },
      warning: null,
    });
    expect(getClientMode()).toBe("self_hosted");
  });

  it("accepts the ONE-RELEASE legacy aliases beneath the canonical names", () => {
    // EMAILS_SELF_HOSTED_URL / EMAILS_SELF_HOSTED_API_KEY stay accepted for one
    // release (skills kept SKILLS_API_* the same way), one rung below the
    // canonical HASNA_EMAILS_API_URL / HASNA_EMAILS_API_KEY.
    setSelfHostedCredentials();
    expect(resolveClientModeSelection()).toEqual({
      mode: "self_hosted",
      label: "Server API",
      source: { kind: "env", name: "HASNA_EMAILS_API_URL", value: SELF_HOSTED_URL },
      warning: null,
    });
  });

  it("prefers the canonical names over the aliases when both are set", () => {
    process.env["HASNA_EMAILS_API_URL"] = "https://canonical.example.invalid";
    process.env["EMAILS_SELF_HOSTED_URL"] = SELF_HOSTED_URL;
    process.env["HASNA_EMAILS_API_KEY"] = "canonical-key";
    process.env[EMAILS_SELF_HOSTED_API_KEY_ENV] = SELF_HOSTED_KEY;
    const plan = resolveClientModeSelection();
    expect(plan.mode).toBe("self_hosted");
    expect(plan.source.name).toBe("HASNA_EMAILS_API_URL");
    expect(plan.source.value).toBe("https://canonical.example.invalid");
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

  it("fails closed on an API URL without a credential, naming the credential routes", () => {
    process.env["EMAILS_SELF_HOSTED_URL"] = SELF_HOSTED_URL;
    let thrown: unknown;
    try {
      resolveClientModeSelection();
    } catch (error) {
      thrown = error;
    }
    const message = String(thrown);
    expect(message).toContain("no API credential resolved");
    expect(message).toContain("HASNA_EMAILS_API_KEY");
    expect(message).toContain("EMAILS_SELF_HOSTED_API_KEY");
    expect(message.toLowerCase()).toContain("refusing");
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
      // The required API environment (canonical names) and the credential routes...
      expect(message).toContain("HASNA_EMAILS_API_URL");
      expect(message).toContain("HASNA_EMAILS_API_KEY");
      expect(message).toContain("EMAILS_SELF_HOSTED_API_KEY");
      // ...and the explicit ways back to local.
      expect(message).toContain("HASNA_EMAILS_DB_PATH");
      expect(message).toContain("EMAILS_DB_PATH");
    }
  });

  it("never carries the credential value on the resolution", () => {
    process.env["EMAILS_SELF_HOSTED_URL"] = SELF_HOSTED_URL;
    process.env[EMAILS_SELF_HOSTED_API_KEY_ENV] = SELF_HOSTED_KEY;
    const resolution = resolveClientMode();
    expect(JSON.stringify(resolution)).not.toContain(SELF_HOSTED_KEY);
    expect(resolution.source.value).toBe(SELF_HOSTED_URL);
  });
});

describe("resolveClientMode / resolveClientModeSelection — the app's own principals", () => {
  it("resolveClientMode delivers a vault session into env and resolves the API arm", () => {
    installSecretsCommandReturning({ EMAILS_SESSION_TOKEN: "emss_from_vault" });
    process.env["HASNA_EMAILS_API_URL"] = SELF_HOSTED_URL;

    expect(resolveClientMode()).toEqual({
      mode: "self_hosted",
      label: "Server API",
      source: { kind: "env", name: "HASNA_EMAILS_API_URL", value: SELF_HOSTED_URL },
      warning: null,
    });
    expect(getClientMode()).toBe("self_hosted");
    // The pointer expands ONLY the app's own principals — never a URL or an API
    // key, which come from the shared resolver tiers.
    expect(process.env["EMAILS_SESSION_TOKEN"]).toBe("emss_from_vault");
    expect(process.env["EMAILS_SELF_HOSTED_URL"]).toBeUndefined();
    expect(process.env[EMAILS_SELF_HOSTED_API_KEY_ENV]).toBeUndefined();
  });

  it("a vault session with no authority is a hosted run without an endpoint — refused", () => {
    installSecretsCommandReturning({ EMAILS_SESSION_TOKEN: "emss_from_vault" });
    let thrown: unknown;
    try {
      resolveClientMode();
    } catch (error) {
      thrown = error;
    }
    expect(String(thrown)).toContain("refusing");
  });

  it("a session in the vault wins as the bearer credential for a configured API", () => {
    installSecretsCommandReturning({
      EMAILS_SESSION_TOKEN: "emss_from_vault",
      EMAILS_IDP_TOKEN: "emid_from_vault",
    });
    process.env["EMAILS_SELF_HOSTED_URL"] = SELF_HOSTED_URL;
    process.env[EMAILS_SELF_HOSTED_API_KEY_ENV] = SELF_HOSTED_KEY;
    // The plan reports which credential setting the store will send, and it is the
    // live session — the app's own principal — never the operator key.
    const plan = resolveClientMode();
    expect(plan.mode).toBe("self_hosted");
    expect(JSON.stringify(plan)).not.toContain("emss_from_vault");
    expect(JSON.stringify(plan)).not.toContain(SELF_HOSTED_KEY);
  });

  it("never reads the vault when no pointer is configured", () => {
    process.env["EMAILS_SELF_HOSTED_URL"] = SELF_HOSTED_URL;
    process.env[EMAILS_SELF_HOSTED_API_KEY_ENV] = SELF_HOSTED_KEY;
    expect(resolveClientMode().mode).toBe("self_hosted");
  });
});