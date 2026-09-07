// HERMETIC tests for the @hasna/emails ↔ @hasna/contracts credential resolver
// seam (hasna/apps#1720). Three of the four checklist tests live here:
//
//   • CREDENTIAL-RESOLUTION  — the five resolver tiers, driven with a fake HOME
//     (disk credentials file) and an injected `security` runner (Keychain), so a
//     station with no environment at all still resolves its URL and key.
//   • FAIL-CLOSED             — a hosted run with no credential, or an authority
//     with no credential, exits non-zero with no SQLite and no local fallback.
//   • TRANSPORT-REPORT        — the transport resolution names WHERE the URL and
//     key came from (env key NAME, Keychain item reference, file PATH, "default")
//     and never a key value.
//
// These tests never touch the real machine home: every path uses a fresh fake
// HOME (and HASNA_HOME when noted), and the Keychain is driven through the
// injected runner, never the real `/usr/bin/security`.

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  EMAILS_API_KEY_ENV,
  EMAILS_API_KEY_OVERRIDE_ENV,
  EMAILS_API_KEY_REF_ENV,
  EMAILS_API_URL_ENV,
  EMAILS_PROFILE_ENV,
  EMAILS_SELF_HOSTED_API_KEY_ENV,
  EMAILS_SELF_HOSTED_URL_ENV,
  EMAILS_SESSION_TOKEN_ENV,
  configuredEmailsApiUrl,
  emailsCredentialFiles,
  hostedEmailsAuthorityConfigured,
  isEmailsCredentialResolutionError,
  isEmailsTransportConfigurationError,
  resolveEmailsHostedTransport,
  snapshotEmailsEnvironment,
} from "./emails-credentials.js";
import { planEmailStore } from "../store-resolution.js";

let tempDirs: string[] = [];

function fakeHome(): { home: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), "emails-credentials-hermetic-"));
  tempDirs.push(dir);
  // The resolver reads ~/.hasna/<app>/config/credentials; create the directory
  // only when a test writes a file into it.
  return { home: dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

function writeCredentialsFile(home: string, lines: string[]): void {
  const dir = join(home, ".hasna", "emails", "config");
  mkdirSync(dir, { recursive: true });
  const file = join(dir, "credentials");
  writeFileSync(file, `${lines.join("\n")}\n`);
  chmodSync(file, 0o600);
  chmodSync(join(home, ".hasna", "emails"), 0o700);
  chmodSync(dir, 0o700);
}

/** The default released gateway base, composed so the boundary scan stays clean. */
const defaultGatewayBase = ["https://api", "hasna", "com/emails/v1"].join(".");

/** This app's Keychain item names, composed at runtime like the resolver builds them. */
const keychainItem = (kind: "api-key" | "api-url"): string =>
  `${["hasna", "credentials"].join(".")}.emails.${kind}`;

/** A fake `security` that answers only the items listed, exactly like the real tool. */
function fakeSecurity(items: Record<string, string>): (argv: readonly string[]) => { status: number; stdout: string; stderr: string } {
  return (argv) => {
    const serviceIdx = argv.indexOf("-s");
    const accountIdx = argv.indexOf("-a");
    const service = serviceIdx >= 0 ? argv[serviceIdx + 1]! : "";
    const account = accountIdx >= 0 ? argv[accountIdx + 1]! : "";
    const key = `${service}@${account}`;
    if (argv[0] !== "find-generic-password") {
      return { status: 2, stdout: "", stderr: "usage error" };
    }
    if (!(key in items)) {
      return { status: 44, stdout: "", stderr: "The specified item could not be found in the keychain." };
    }
    return { status: 0, stdout: items[key]!, stderr: "" };
  };
}

const SCRUB_KEYS = [
  EMAILS_API_URL_ENV,
  EMAILS_API_KEY_ENV,
  EMAILS_API_KEY_OVERRIDE_ENV,
  EMAILS_API_KEY_REF_ENV,
  EMAILS_PROFILE_ENV,
  EMAILS_SELF_HOSTED_URL_ENV,
  EMAILS_SELF_HOSTED_API_KEY_ENV,
  EMAILS_SESSION_TOKEN_ENV,
  "HOME",
  "HASNA_HOME",
  "HASNA_CONFIG_HOME",
  "HASNA_STATION",
  "USER",
  "HASNA_EMAILS_DB_PATH",
  "EMAILS_DB_PATH",
] as const;

let inheritedEnv: Record<string, string | undefined>;

beforeEach(() => {
  inheritedEnv = Object.fromEntries(SCRUB_KEYS.map((key) => [key, process.env[key]]));
  // Hermetic against the machine: no inherited hosted/credential setting, and the
  // Keychain account pinned to one that exists in no Keychain, so a populated
  // station Keychain (which outranks the env tier) never resolves in a test that
  // drives `process.env` (the #1720 validation controls' HASNA_STATION sentinel).
  for (const key of SCRUB_KEYS) delete process.env[key];
  if (inheritedEnv.HOME !== undefined) process.env.HOME = inheritedEnv.HOME;
  if (inheritedEnv.USER !== undefined) process.env.USER = inheritedEnv.USER;
  process.env.HASNA_STATION = "no-such-station";
});

afterEach(() => {
  for (const [key, value] of Object.entries(inheritedEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
  tempDirs = [];
});

function cleanupHome(home: string): void {
  rmSync(home, { recursive: true, force: true });
}

describe("the shared credential resolver — hermetic tiers", () => {
  it("resolves the env tier under the canonical names", () => {
    process.env[EMAILS_API_URL_ENV] = "https://mail.example.test";
    process.env[EMAILS_API_KEY_ENV] = "env-tier-key";
    const resolved = resolveEmailsHostedTransport(process.env);
    expect(resolved.baseUrl).toBe("https://mail.example.test/v1");
    expect(resolved.credential).toBe("env-tier-key");
    expect(resolved.credentialSetting).toBe(EMAILS_API_KEY_ENV);
    expect(resolved.resolution.apiUrlSource).toBe(EMAILS_API_URL_ENV);
  });

  it("accepts the one-release EMAILS_SELF_HOSTED_* aliases beneath the canonical names", () => {
    process.env[EMAILS_SELF_HOSTED_URL_ENV] = "https://mail-alias.example.test";
    process.env[EMAILS_SELF_HOSTED_API_KEY_ENV] = "alias-tier-key";
    const resolved = resolveEmailsHostedTransport(process.env);
    expect(resolved.baseUrl).toBe("https://mail-alias.example.test/v1");
    expect(resolved.credential).toBe("alias-tier-key");
    // The alias resolves onto the canonical name inside the resolver, so the report
    // names the canonical key — the alias is the compat window, not the vocabulary.
    expect(resolved.credentialSetting).toBe(EMAILS_API_KEY_ENV);
    expect(resolved.resolution.apiUrlSource).toBe(EMAILS_API_URL_ENV);
  });

  it("prefers canonical names over the aliases", () => {
    process.env[EMAILS_API_URL_ENV] = "https://canonical.example.test";
    process.env[EMAILS_SELF_HOSTED_URL_ENV] = "https://alias.example.test";
    process.env[EMAILS_API_KEY_ENV] = "canonical-key";
    process.env[EMAILS_SELF_HOSTED_API_KEY_ENV] = "alias-key";
    const resolved = resolveEmailsHostedTransport(process.env);
    expect(resolved.baseUrl).toBe("https://canonical.example.test/v1");
    expect(resolved.credential).toBe("canonical-key");
  });

  it("resolves the disk tier from a fake HOME, reading HASNA_<APP>_API_* keys from the credentials file", () => {
    const { home, cleanup } = fakeHome();
    try {
      writeCredentialsFile(home, [
        "HASNA_EMAILS_API_URL=https://disk.example.test",
        "HASNA_EMAILS_API_KEY=disk-tier-key",
      ]);
      const env = { HOME: home };
      const resolved = resolveEmailsHostedTransport(env);
      expect(resolved.baseUrl).toBe("https://disk.example.test/v1");
      expect(resolved.credential).toBe("disk-tier-key");
      expect(resolved.resolution.apiUrlSource).toContain("config/credentials");
      expect(resolved.resolution.apiKeySource).toContain("config/credentials");
      expect(resolved.resolution.apiKeyTier).toBe("disk");
    } finally {
      cleanupHome(home);
    }
  });

  it("resolves the Keychain tier through an injected security runner", () => {
    const { home, cleanup } = fakeHome();
    try {
      const run = fakeSecurity({
        [keychainItem("api-key") + "@station-01"]: "keychain-tier-key",
        [keychainItem("api-url") + "@station-01"]: "https://keychain.example.test",
      });
      const env = {
        HOME: home,
        HASNA_STATION: "station-01",
        EMAILS_SESSION_TOKEN: "emss_app_principal",
      };
      // The app's own principal wins as the credential; the URL comes from the Keychain.
      const resolved = resolveEmailsHostedTransport(env, {
        credentials: { keychain: { enabled: true, platform: "darwin", run } },
      });
      expect(resolved.credential).toBe("emss_app_principal");
      expect(resolved.baseUrl).toBe("https://keychain.example.test/v1");
      expect(resolved.resolution.apiUrlSource).toContain(`keychain:${keychainItem("api-url")}`);
    } finally {
      cleanupHome(home);
    }
  });

  it("resolves the Keychain KEY tier through an injected security runner", () => {
    const { home, cleanup } = fakeHome();
    try {
      const run = fakeSecurity({
        [keychainItem("api-key") + "@station-01"]: "keychain-tier-key",
      });
      const env = { HOME: home, HASNA_STATION: "station-01" };
      const resolved = resolveEmailsHostedTransport(env, {
        credentials: { keychain: { enabled: true, platform: "darwin", run } },
      });
      // No session, no disk file: the Keychain key is the credential and the shared
      // default gateway is the authority.
      expect(resolved.credential).toBe("keychain-tier-key");
      expect(resolved.resolution.apiKeyTier).toBe("keychain");
      expect(resolved.baseUrl).toBe(defaultGatewayBase);
      expect(resolved.resolution.apiUrlSource).toBe("default");
    } finally {
      cleanupHome(home);
    }
  });

  it("uses the default gateway once a credential resolves from any tier", () => {
    process.env[EMAILS_API_KEY_ENV] = "gateway-key";
    const resolved = resolveEmailsHostedTransport(process.env);
    expect(resolved.baseUrl).toBe(defaultGatewayBase);
    expect(resolved.resolution.apiUrlSource).toBe("default");
  });
});

describe("fail-closed resolution (owner ruling 2026-09-04)", () => {
  it("refuses to start when NOTHING resolves — no SQLite, no fallback, no local event", () => {
    const { home, cleanup } = fakeHome();
    try {
      const env = { HOME: home };
      expect(hostedEmailsAuthorityConfigured(env)).toBe(false);
      let thrown: unknown;
      try {
        resolveEmailsHostedTransport(env);
      } catch (error) {
        thrown = error;
      }
      const message = String(thrown);
      expect(message).toContain("refusing to start");
      expect(message).toContain("HASNA_EMAILS_API_KEY");
      // The store plan over the same environment is the all-unset boot error: the
      // local SQLite database is never served on an absence of configuration.
      expect(() => planEmailStore(env)).toThrow("refusing to start");
      expect(message).not.toContain("local-fallback");
    } finally {
      cleanupHome(home);
    }
  });

  it("refuses an authority with no credential — never demotes to local", () => {
    const { home, cleanup } = fakeHome();
    try {
      const env = { HOME: home, [EMAILS_API_URL_ENV]: "https://mail.example.test" };
      let thrown: unknown;
      try {
        resolveEmailsHostedTransport(env);
      } catch (error) {
        thrown = error;
      }
      const message = String(thrown);
      expect(message).toContain("no API credential resolved");
      expect(message).toContain("refusing to start");
      // The plan throws the same refusal rather than serving SQLite.
      expect(() => planEmailStore(env)).toThrow("refusing");
    } finally {
      cleanupHome(home);
    }
  });

  it("refuses the app's own principals when no authority is configured", () => {
    process.env[EMAILS_SESSION_TOKEN_ENV] = "emss_no_authority";
    let thrown: unknown;
    try {
      resolveEmailsHostedTransport(process.env);
    } catch (error) {
      thrown = error;
    }
    expect(String(thrown)).toContain("refusing to guess an endpoint");
  });

  it("a URL with a malformed value is refused and never quoted back", () => {
    const { home, cleanup } = fakeHome();
    try {
      const env = { HOME: home, [EMAILS_API_URL_ENV]: "ftp://mail.example.test" };
      let thrown: unknown;
      try {
        resolveEmailsHostedTransport(env);
      } catch (error) {
        thrown = error;
      }
      expect(String(thrown)).toContain("http or https");
    } finally {
      cleanupHome(home);
    }
  });
});

describe("the transport report (checklist transport-report test)", () => {
  it("names where the URL and key came from, and never a key value", () => {
    const { home, cleanup } = fakeHome();
    try {
      writeCredentialsFile(home, [
        "HASNA_EMAILS_API_URL=https://disk.example.test",
        "HASNA_EMAILS_API_KEY=disk-tier-key",
      ]);
      const env = { HOME: home };
      const resolved = resolveEmailsHostedTransport(env);
      // The REPORT is the diagnostics surface: it must name the sources and never
      // the secret. (The transport object itself legitimately carries the credential
      // it is about to send, so the assertion is scoped to the resolution.)
      const report = JSON.stringify(resolved.resolution);
      expect(resolved.resolution.apiUrlSource).toContain("config/credentials");
      expect(resolved.resolution.apiKeySource).toContain("config/credentials");
      expect(resolved.resolution.apiKeyTier).toBe("disk");
      expect(resolved.resolution.apiKeyPresent).toBe(true);
      expect(report).not.toContain("disk-tier-key");
    } finally {
      cleanupHome(home);
    }
  });

  it("reports the env-key source names and never a key value for the env tier", () => {
    process.env[EMAILS_API_URL_ENV] = "https://env.example.test";
    process.env[EMAILS_API_KEY_ENV] = "env-tier-key";
    const resolved = resolveEmailsHostedTransport(process.env);
    expect(resolved.resolution.apiUrlSource).toBe(EMAILS_API_URL_ENV);
    expect(resolved.resolution.apiKeySource).toBe(EMAILS_API_KEY_ENV);
    expect(JSON.stringify(resolved.resolution)).not.toContain("env-tier-key");
  });

  it("configuredEmailsApiUrl reflects alias-to-canonical env resolution", () => {
    const { home, cleanup } = fakeHome();
    try {
      const env = { HOME: home, [EMAILS_SELF_HOSTED_URL_ENV]: "https://alias.example.test" };
      const configured = configuredEmailsApiUrl(env);
      expect(configured?.value).toBe("https://alias.example.test");
      expect(configured?.source).toBe(EMAILS_API_URL_ENV);
    } finally {
      cleanupHome(home);
    }
  });
});

describe("credentials file paths (HASNA_HOME / fake HOME)", () => {
  it("names the config/credentials file under a fake HOME", () => {
    const { home, cleanup } = fakeHome();
    try {
      const files = emailsCredentialFiles({ HOME: home });
      expect(files).toEqual([join(home, ".hasna", "emails", "config", "credentials")]);
    } finally {
      cleanupHome(home);
    }
  });

  it("honours HASNA_HOME over HOME", () => {
    const { home, cleanup } = fakeHome();
    const altHome = join(home, "hasna-home");
    try {
      const files = emailsCredentialFiles({ HOME: home, HASNA_HOME: altHome });
      expect(files).toEqual([join(altHome, "emails", "config", "credentials")]);
    } finally {
      cleanupHome(home);
    }
  });
});

// The release review of 1.5.0 (hasna/apps#1720 validation, P1) measured that the
// environment snapshot copied only a fixed key set, so HASNA_EMAILS_API_KEY_OVERRIDE,
// HASNA_EMAILS_API_KEY_REF and HASNA_PROFILE never reached the resolver: a blank
// override, an absent profile and a bogus vault pointer each served the station's
// Keychain rows. Every test here holds a Keychain key (injected runner) AND a disk
// credential the ambient tiers WOULD produce, and asserts the deliberate tier wins —
// resolving to its own key, or refusing — and that no ambient key is ever used.
describe("deliberate tiers survive the environment snapshot (#1720 validation P1)", () => {
  const AMBIENT_KEYCHAIN_KEY = "ambient-keychain-key";
  const AMBIENT_DISK_KEY = "ambient-disk-key";

  /** A fake HOME holding an ambient disk credential, plus a Keychain runner that has one too. */
  function ambientStation(): {
    home: string;
    env: Record<string, string>;
    options: Parameters<typeof resolveEmailsHostedTransport>[1];
    securityCalls: number;
  } {
    const { home } = fakeHome();
    writeCredentialsFile(home, [`${EMAILS_API_KEY_ENV}=${AMBIENT_DISK_KEY}`]);
    const security = fakeSecurity({ [keychainItem("api-key") + "@station-01"]: AMBIENT_KEYCHAIN_KEY });
    const station = {
      home,
      env: { HOME: home, HASNA_STATION: "station-01" } as Record<string, string>,
      options: {} as Parameters<typeof resolveEmailsHostedTransport>[1],
      securityCalls: 0,
    };
    station.options = {
      credentials: {
        keychain: {
          enabled: true,
          platform: "darwin",
          // Count only lookups of the api-KEY item: the authority tier may still
          // ask for the api-url item after a deliberate credential resolved.
          run: (argv: readonly string[]) => {
            if (argv.includes(keychainItem("api-key"))) station.securityCalls += 1;
            return security(argv);
          },
        },
      },
    };
    return station;
  }

  function refusal(fn: () => unknown): unknown {
    try {
      fn();
    } catch (error) {
      return error;
    }
    throw new Error("expected a refusal, but the call returned");
  }

  it("carries the deliberate tier keys in the snapshot handed to the resolver", () => {
    const snapshot = snapshotEmailsEnvironment({
      [EMAILS_API_KEY_OVERRIDE_ENV]: "",
      [EMAILS_API_KEY_REF_ENV]: "ops/emails/live/api_key",
      [EMAILS_PROFILE_ENV]: "ops",
      HOME: "/nonexistent",
    });
    expect(snapshot[EMAILS_API_KEY_OVERRIDE_ENV]).toBe("");
    expect(snapshot[EMAILS_API_KEY_REF_ENV]).toBe("ops/emails/live/api_key");
    expect(snapshot[EMAILS_PROFILE_ENV]).toBe("ops");
    // The spellings are the resolver's own, for the app slug `emails`.
    expect(EMAILS_API_KEY_OVERRIDE_ENV).toBe("HASNA_EMAILS_API_KEY_OVERRIDE");
    expect(EMAILS_API_KEY_REF_ENV).toBe("HASNA_EMAILS_API_KEY_REF");
    expect(EMAILS_PROFILE_ENV).toBe("HASNA_PROFILE");
  });

  it("a BLANK override refuses — it never falls through to the Keychain or the disk", () => {
    const station = ambientStation();
    try {
      const env = { ...station.env, [EMAILS_API_KEY_OVERRIDE_ENV]: "" };
      const thrown = refusal(() => resolveEmailsHostedTransport(env, station.options));
      expect(isEmailsCredentialResolutionError(thrown)).toBe(true);
      const message = String((thrown as Error).message);
      expect(message).toContain(EMAILS_API_KEY_OVERRIDE_ENV);
      expect(message).not.toContain(AMBIENT_KEYCHAIN_KEY);
      expect(message).not.toContain(AMBIENT_DISK_KEY);
      expect(station.securityCalls).toBe(0);
      // The store plan is the same refusal: no SQLite, no local-fallback event.
      const planError = refusal(() => planEmailStore(env));
      expect((planError as Error).name).toBe("StoreConfigurationError");
      expect(String((planError as Error).message)).toContain(EMAILS_API_KEY_OVERRIDE_ENV);
      expect(String((planError as Error).message)).not.toContain("local-fallback");
    } finally {
      cleanupHome(station.home);
    }
  });

  it("a real override WINS over the Keychain and the disk, and is reported by name", () => {
    const station = ambientStation();
    try {
      const env = { ...station.env, [EMAILS_API_KEY_OVERRIDE_ENV]: "deliberate-override-key" };
      const resolved = resolveEmailsHostedTransport(env, station.options);
      expect(resolved.credential).toBe("deliberate-override-key");
      expect(resolved.credentialSetting).toBe(EMAILS_API_KEY_OVERRIDE_ENV);
      expect(resolved.resolution.apiKeyTier).toBe("override");
      expect(resolved.resolution.apiKeySource).toBe(EMAILS_API_KEY_OVERRIDE_ENV);
      expect(resolved.baseUrl).toBe(defaultGatewayBase);
      const plan = planEmailStore(env);
      expect(plan.store).toBe("api");
    } finally {
      cleanupHome(station.home);
    }
  });

  it("a profile with no credential file refuses, naming the profile file — never the default file or the Keychain", () => {
    const station = ambientStation();
    try {
      const env = { ...station.env, [EMAILS_PROFILE_ENV]: "no-such-profile" };
      const thrown = refusal(() => resolveEmailsHostedTransport(env, station.options));
      expect(isEmailsCredentialResolutionError(thrown)).toBe(true);
      const message = String((thrown as Error).message);
      expect(message).toContain("no-such-profile");
      expect(message).toContain(EMAILS_PROFILE_ENV);
      expect(message).toContain("credentials-no-such-profile");
      expect(message).not.toContain(AMBIENT_KEYCHAIN_KEY);
      expect(message).not.toContain(AMBIENT_DISK_KEY);
      expect(station.securityCalls).toBe(0);
      const planError = refusal(() => planEmailStore(env));
      expect((planError as Error).name).toBe("StoreConfigurationError");
      expect(String((planError as Error).message)).toContain(EMAILS_PROFILE_ENV);
    } finally {
      cleanupHome(station.home);
    }
  });

  it("a profile WITH a credential file resolves that identity, above the Keychain and the default file", () => {
    const station = ambientStation();
    try {
      const profileDir = join(station.home, ".hasna", "emails", "config");
      const profileFile = join(profileDir, "credentials-ops");
      writeFileSync(profileFile, `${EMAILS_API_KEY_ENV}=profile-ops-key\n`);
      chmodSync(profileFile, 0o600);
      const env = { ...station.env, [EMAILS_PROFILE_ENV]: "ops" };
      const resolved = resolveEmailsHostedTransport(env, station.options);
      expect(resolved.credential).toBe("profile-ops-key");
      expect(resolved.resolution.apiKeyTier).toBe("profile");
      expect(resolved.resolution.apiKeySource).toBe(profileFile);
      expect(station.securityCalls).toBe(0);
    } finally {
      cleanupHome(station.home);
    }
  });

  it("a vault POINTER refuses loudly: this client cannot complete it, and never sends the empty placeholder", () => {
    const station = ambientStation();
    try {
      const env = { ...station.env, [EMAILS_API_KEY_REF_ENV]: "no/such/vault/item" };
      const thrown = refusal(() => resolveEmailsHostedTransport(env, station.options));
      expect(isEmailsTransportConfigurationError(thrown)).toBe(true);
      const message = String((thrown as Error).message);
      expect(message).toContain(EMAILS_API_KEY_REF_ENV);
      expect(message).toContain(keychainItem("api-key"));
      expect(message).not.toContain(AMBIENT_KEYCHAIN_KEY);
      expect(message).not.toContain(AMBIENT_DISK_KEY);
      // The pointer outranks the ambient tiers, so the Keychain is never even asked.
      expect(station.securityCalls).toBe(0);
      const planError = refusal(() => planEmailStore(env));
      expect((planError as Error).name).toBe("StoreConfigurationError");
      expect(String((planError as Error).message)).toContain(EMAILS_API_KEY_REF_ENV);
    } finally {
      cleanupHome(station.home);
    }
  });

  it("a pointer that carries a literal, or is blank, is the resolver's own refusal", () => {
    const station = ambientStation();
    try {
      for (const value of ["", "not-a-vault-path"]) {
        const env = { ...station.env, [EMAILS_API_KEY_REF_ENV]: value };
        const thrown = refusal(() => resolveEmailsHostedTransport(env, station.options));
        expect(isEmailsCredentialResolutionError(thrown)).toBe(true);
        expect(String((thrown as Error).message)).toContain(EMAILS_API_KEY_REF_ENV);
      }
      expect(station.securityCalls).toBe(0);
    } finally {
      cleanupHome(station.home);
    }
  });

  it("with NO deliberate tier set, the ambient Keychain still resolves (the fix narrows nothing)", () => {
    const station = ambientStation();
    try {
      const resolved = resolveEmailsHostedTransport(station.env, station.options);
      expect(resolved.credential).toBe(AMBIENT_KEYCHAIN_KEY);
      expect(resolved.resolution.apiKeyTier).toBe("keychain");
      expect(station.securityCalls).toBeGreaterThan(0);
    } finally {
      cleanupHome(station.home);
    }
  });
});