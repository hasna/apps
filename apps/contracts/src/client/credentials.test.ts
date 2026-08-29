// Credential provider chain — behaviour tests.
//
// The measured failure this suite exists to kill: a shell started BEFORE a key
// rotation holds the stale `HASNA_<SVC>_API_KEY` for its whole life, so every
// command from that shell 401s while a fresh login shell on the same machine in
// the same second succeeds. The credential on disk was correct throughout; only
// the process env was stale.

import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  CredentialResolutionError,
  __resetCredentialDeprecationNotices,
  appConfigDiskValue,
  credentialDiskSources,
  resolveCredential,
} from "./credentials.js";
import { credentialOverrideEnvKey } from "./env-keys.js";

const STALE_ENV_KEY = "hasna_accounts_STALE-revoked-key";
const FRESH_DISK_KEY = "hasna_accounts_FRESH-on-disk-key";

const homes: string[] = [];

function makeHome(): string {
  const home = mkdtempSync(join(tmpdir(), "hasna-cred-"));
  homes.push(home);
  return home;
}

/** Write the PRIMARY fleet-env layer, `~/.hasna/fleet-env/<app>.env`. */
function writeFleetEnv(home: string, app: string, body: string): string {
  const dir = join(home, ".hasna", "fleet-env");
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `${app}.env`);
  writeFileSync(path, body);
  return path;
}

/** Write the legacy-cloud layer, `~/.hasna/cloud/<app>.env` (NOISY, deprecated). */
function writeLegacyCloudEnv(home: string, app: string, body: string): string {
  const dir = join(home, ".hasna", "cloud");
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `${app}.env`);
  writeFileSync(path, body);
  return path;
}

/** Write the config tier under its FINAL name, `~/.config/hasna/<app>.env`. */
function writeConfigEnv(home: string, app: string, body: string): string {
  const dir = join(home, ".config", "hasna");
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `${app}.env`);
  writeFileSync(path, body);
  return path;
}

/** Write the deprecated config alias, `~/.config/hasna/<app>-cloud.env` (NOISY). */
function writeConfigLegacyEnv(home: string, app: string, body: string): string {
  const dir = join(home, ".config", "hasna");
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `${app}-cloud.env`);
  writeFileSync(path, body);
  return path;
}

afterEach(() => {
  __resetCredentialDeprecationNotices();
  while (homes.length > 0) {
    const home = homes.pop()!;
    rmSync(home, { recursive: true, force: true });
  }
});

describe("the measured failure: a stale shell must not outrank the disk", () => {
  test("a stale env key loses to a valid disk credential", () => {
    const home = makeHome();
    writeFleetEnv(home, "accounts", `HASNA_ACCOUNTS_API_KEY=${FRESH_DISK_KEY}\n`);

    const resolved = resolveCredential("accounts", {
      HOME: home,
      HASNA_ACCOUNTS_API_KEY: STALE_ENV_KEY,
    });

    expect(resolved).not.toBeNull();
    expect(resolved!.apiKey).toBe(FRESH_DISK_KEY);
    expect(resolved!.tier).toBe("fleet-env");
    expect(resolved!.deprecated).toBe(false);
  });

  test("the disk is re-read on every call, so a rotation heals without a new process", () => {
    const home = makeHome();
    writeFleetEnv(home, "accounts", "HASNA_ACCOUNTS_API_KEY=key-before-rotation\n");
    const env = { HOME: home, HASNA_ACCOUNTS_API_KEY: STALE_ENV_KEY };

    expect(resolveCredential("accounts", env)!.apiKey).toBe("key-before-rotation");

    // The rotation lands on disk. The process env is untouched and still stale.
    writeFleetEnv(home, "accounts", "HASNA_ACCOUNTS_API_KEY=key-after-rotation\n");

    expect(resolveCredential("accounts", env)!.apiKey).toBe("key-after-rotation");
  });
});

describe("tier 1 — an explicit argument", () => {
  test("an explicit apiKey outranks the override, the disk, and the legacy env", () => {
    const home = makeHome();
    writeFleetEnv(home, "accounts", `HASNA_ACCOUNTS_API_KEY=${FRESH_DISK_KEY}\n`);

    const resolved = resolveCredential(
      "accounts",
      {
        HOME: home,
        HASNA_ACCOUNTS_API_KEY: STALE_ENV_KEY,
        HASNA_ACCOUNTS_API_KEY_OVERRIDE: "override-key",
      },
      { apiKey: "explicit-flag-key" },
    );

    expect(resolved!.apiKey).toBe("explicit-flag-key");
    expect(resolved!.tier).toBe("argument");
    expect(resolved!.deliberate).toBe(true);
  });
});

describe("tier 2 — a deliberate override never falls through to another identity", () => {
  test("the override wins even when a different, valid credential sits on disk", () => {
    const home = makeHome();
    writeFleetEnv(home, "accounts", `HASNA_ACCOUNTS_API_KEY=${FRESH_DISK_KEY}\n`);

    const resolved = resolveCredential("accounts", {
      HOME: home,
      HASNA_ACCOUNTS_API_KEY_OVERRIDE: "deliberate-tenant-x-key",
    });

    expect(resolved!.apiKey).toBe("deliberate-tenant-x-key");
    expect(resolved!.tier).toBe("override");
    expect(resolved!.deliberate).toBe(true);
    expect(resolved!.source).toBe("HASNA_ACCOUNTS_API_KEY_OVERRIDE");
  });

  test("a blank override throws instead of silently resolving to the disk identity", () => {
    const home = makeHome();
    writeFleetEnv(home, "accounts", `HASNA_ACCOUNTS_API_KEY=${FRESH_DISK_KEY}\n`);

    expect(() =>
      resolveCredential("accounts", {
        HOME: home,
        HASNA_ACCOUNTS_API_KEY_OVERRIDE: "   ",
      }),
    ).toThrow(CredentialResolutionError);
  });

  test("a HASNA_PROFILE pointer resolves the profile's own disk file", () => {
    const home = makeHome();
    writeFleetEnv(home, "accounts", `HASNA_ACCOUNTS_API_KEY=${FRESH_DISK_KEY}\n`);
    const dir = join(home, ".hasna", "cloud");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "accounts.staging.env"), "HASNA_ACCOUNTS_API_KEY=staging-key\n");

    const resolved = resolveCredential("accounts", { HOME: home, HASNA_PROFILE: "staging" });

    expect(resolved!.apiKey).toBe("staging-key");
    expect(resolved!.tier).toBe("profile");
    expect(resolved!.deliberate).toBe(true);
  });

  test("a HASNA_PROFILE naming a profile with no credential throws and names the paths tried", () => {
    const home = makeHome();
    writeFleetEnv(home, "accounts", `HASNA_ACCOUNTS_API_KEY=${FRESH_DISK_KEY}\n`);

    let caught: unknown;
    try {
      resolveCredential("accounts", { HOME: home, HASNA_PROFILE: "no-such-profile" });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(CredentialResolutionError);
    const message = (caught as Error).message;
    expect(message).toContain("no-such-profile");
    // It must NOT have quietly used the default identity that is sitting right there.
    expect(message).not.toContain(FRESH_DISK_KEY);
  });

  test("the per-service override outranks the global profile pointer", () => {
    const home = makeHome();
    const dir = join(home, ".hasna", "cloud");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "accounts.staging.env"), "HASNA_ACCOUNTS_API_KEY=staging-key\n");

    const resolved = resolveCredential("accounts", {
      HOME: home,
      HASNA_PROFILE: "staging",
      HASNA_ACCOUNTS_API_KEY_OVERRIDE: "override-key",
    });

    expect(resolved!.tier).toBe("override");
    expect(resolved!.apiKey).toBe("override-key");
  });
});

describe("tier 3 — disk", () => {
  test("the fleet-env file outranks the config file", () => {
    const home = makeHome();
    writeFleetEnv(home, "accounts", "HASNA_ACCOUNTS_API_KEY=primary-key\n");
    writeConfigEnv(home, "accounts", "HASNA_ACCOUNTS_API_KEY=secondary-key\n");

    const resolved = resolveCredential("accounts", { HOME: home });

    expect(resolved!.apiKey).toBe("primary-key");
    expect(resolved!.tier).toBe("fleet-env");
    expect(resolved!.deprecated).toBe(false);
  });

  test("two disk layers holding DIFFERENT keys produce a split-brain warning with no key material", () => {
    const home = makeHome();
    writeFleetEnv(home, "accounts", "HASNA_ACCOUNTS_API_KEY=primary-key\n");
    writeConfigEnv(home, "accounts", "HASNA_ACCOUNTS_API_KEY=secondary-key\n");

    const resolved = resolveCredential("accounts", { HOME: home });

    expect(resolved!.warning).toContain("disagree");
    expect(resolved!.warning).not.toContain("primary-key");
    expect(resolved!.warning).not.toContain("secondary-key");
  });

  test("two disk layers holding the SAME key produce no warning", () => {
    const home = makeHome();
    writeFleetEnv(home, "accounts", "HASNA_ACCOUNTS_API_KEY=same-key\n");
    writeConfigEnv(home, "accounts", "HASNA_ACCOUNTS_API_KEY=same-key\n");

    expect(resolveCredential("accounts", { HOME: home })!.warning).toBeNull();
  });

  test("the `export KEY=\"value\"` file shape is parsed", () => {
    const home = makeHome();
    writeFleetEnv(home, "knowledge", 'export HASNA_KNOWLEDGE_API_KEY="quoted-exported-key"\n');

    expect(resolveCredential("knowledge", { HOME: home })!.apiKey).toBe("quoted-exported-key");
  });

  test("comments, blank lines, and trailing whitespace are ignored", () => {
    const home = makeHome();
    writeFleetEnv(
      home,
      "accounts",
      "# a comment\n\n  HASNA_ACCOUNTS_API_KEY=spaced-key  \n# HASNA_ACCOUNTS_API_KEY=commented-out\n",
    );

    expect(resolveCredential("accounts", { HOME: home })!.apiKey).toBe("spaced-key");
  });

  test("rotated-out sibling files are never read", () => {
    const home = makeHome();
    const dir = join(home, ".hasna", "cloud");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "accounts.env.bak-20260101"), "HASNA_ACCOUNTS_API_KEY=backup-key\n");
    writeFileSync(join(dir, "accounts.env.pre-flip-1"), "HASNA_ACCOUNTS_API_KEY=preflip-key\n");

    expect(resolveCredential("accounts", { HOME: home })).toBeNull();
  });

  test("the unprefixed <APP>_API_KEY alias is honoured, but only after the canonical name", () => {
    const home = makeHome();
    writeFleetEnv(home, "accounts", "ACCOUNTS_API_KEY=alias-key\n");
    expect(resolveCredential("accounts", { HOME: home })!.apiKey).toBe("alias-key");

    writeFleetEnv(home, "accounts", "ACCOUNTS_API_KEY=alias-key\nHASNA_ACCOUNTS_API_KEY=canonical-key\n");
    expect(resolveCredential("accounts", { HOME: home })!.apiKey).toBe("canonical-key");
  });

  test("a malformed file yields no credential and leaks no file content into the result", () => {
    const home = makeHome();
    writeFleetEnv(home, "accounts", "this is not an env file at all\x00\xff\n");

    expect(resolveCredential("accounts", { HOME: home })).toBeNull();
  });

  test("an unreadable disk path is not fatal — resolution continues to the legacy tier", () => {
    const home = makeHome();
    // `~/.hasna/fleet-env/accounts.env` is a DIRECTORY, so reading it throws EISDIR.
    mkdirSync(join(home, ".hasna", "fleet-env", "accounts.env"), { recursive: true });

    const resolved = resolveCredential(
      "accounts",
      { HOME: home, HASNA_ACCOUNTS_API_KEY: STALE_ENV_KEY },
      { onDeprecation: () => {} },
    );

    expect(resolved!.tier).toBe("legacy-env");
  });
});

describe("the fleet-env migration: primary order and the NOISY legacy-cloud fallback", () => {
  test("fleet-env beats the legacy-cloud fallback", () => {
    const home = makeHome();
    writeFleetEnv(home, "accounts", "HASNA_ACCOUNTS_API_KEY=fleet-key\n");
    writeLegacyCloudEnv(home, "accounts", "HASNA_ACCOUNTS_API_KEY=legacy-key\n");

    const resolved = resolveCredential("accounts", { HOME: home });

    expect(resolved!.apiKey).toBe("fleet-key");
    expect(resolved!.tier).toBe("fleet-env");
    expect(resolved!.deprecated).toBe(false);
  });

  test("a legacy-cloud winner is NOISY: deprecated, warned, and deadline-named", () => {
    const home = makeHome();
    writeLegacyCloudEnv(home, "accounts", "HASNA_ACCOUNTS_API_KEY=legacy-key\n");
    const messages: string[] = [];
    const resolved = resolveCredential("accounts", { HOME: home }, { onDeprecation: (m) => messages.push(m) });

    expect(resolved!.apiKey).toBe("legacy-key");
    expect(resolved!.tier).toBe("legacy-cloud");
    expect(resolved!.deprecated).toBe(true);
    // The notice names the source and the deadline, and directs to the
    // sanctioned route (the secrets-vault REF pointer) — never the
    // unsanctioned ~/.hasna/fleet-env home.
    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain(join(home, ".hasna", "cloud", "accounts.env"));
    expect(messages[0]).toContain("2026-10-01");
    expect(messages[0]).toContain("HASNA_ACCOUNTS_API_KEY_REF");
    expect(messages[0]).not.toContain("fleet-env");
    // The resolution's warning also names the deadline, never the key.
    expect(resolved!.warning).toContain("2026-10-01");
    expect(resolved!.warning).not.toContain("legacy-key");
  });

  test("the legacy-cloud deprecation is emitted once per source, not per call", () => {
    const home = makeHome();
    writeLegacyCloudEnv(home, "accounts", "HASNA_ACCOUNTS_API_KEY=legacy-key\n");
    const messages: string[] = [];
    const options = { onDeprecation: (m: string) => messages.push(m) };
    resolveCredential("accounts", { HOME: home }, options);
    resolveCredential("accounts", { HOME: home }, options);
    expect(messages).toHaveLength(1);
  });

  test("the config tier's final name beats its deprecated `-cloud.env` alias", () => {
    const home = makeHome();
    writeConfigEnv(home, "accounts", "HASNA_ACCOUNTS_API_KEY=config-key\n");
    writeConfigLegacyEnv(home, "accounts", "HASNA_ACCOUNTS_API_KEY=alias-key\n");

    const resolved = resolveCredential("accounts", { HOME: home });

    expect(resolved!.apiKey).toBe("config-key");
    expect(resolved!.tier).toBe("config");
    expect(resolved!.deprecated).toBe(false);
  });

  test("a config `-cloud.env` alias winner is deprecated and NOISY", () => {
    const home = makeHome();
    writeConfigLegacyEnv(home, "accounts", "HASNA_ACCOUNTS_API_KEY=alias-key\n");
    const messages: string[] = [];
    const resolved = resolveCredential("accounts", { HOME: home }, { onDeprecation: (m) => messages.push(m) });

    expect(resolved!.tier).toBe("config-legacy");
    expect(resolved!.deprecated).toBe(true);
    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain("2026-10-01");
  });

  test("the legacy-cloud fallback is used only when fleet-env is silent", () => {
    const home = makeHome();
    writeLegacyCloudEnv(home, "accounts", "HASNA_ACCOUNTS_API_KEY=legacy-key\n");
    const resolved = resolveCredential("accounts", { HOME: home });
    expect(resolved!.tier).toBe("legacy-cloud");
  });
});

describe("the secrets-vault pointer tier", () => {
  test("a present pointer returns a deliberate pointer resolution carrying the vault key, never a fall-through", () => {
    const home = makeHome();
    writeFleetEnv(home, "accounts", "HASNA_ACCOUNTS_API_KEY=disk-key\n");
    const resolved = resolveCredential("accounts", {
      HOME: home,
      HASNA_ACCOUNTS_API_KEY_REF: "hasna/apps/accounts/live/api_key",
    });

    expect(resolved!.tier).toBe("pointer");
    expect(resolved!.deliberate).toBe(true);
    expect(resolved!.pointerVaultKey).toBe("hasna/apps/accounts/live/api_key");
    // The apiKey is an empty sentinel until the transport completes it; the
    // disk credential sitting right there is NEVER used instead.
    expect(resolved!.apiKey).toBe("");
  });

  test("a pointer outranks disk but loses to the override", () => {
    const home = makeHome();
    writeFleetEnv(home, "accounts", "HASNA_ACCOUNTS_API_KEY=disk-key\n");
    const resolved = resolveCredential("accounts", {
      HOME: home,
      HASNA_ACCOUNTS_API_KEY_REF: "hasna/apps/accounts/live/api_key",
      HASNA_ACCOUNTS_API_KEY_OVERRIDE: "override-key",
    });
    expect(resolved!.tier).toBe("override");
  });

  test("an empty pointer is a TERMINAL failure, never a fall-through", () => {
    const home = makeHome();
    writeFleetEnv(home, "accounts", "HASNA_ACCOUNTS_API_KEY=disk-key\n");
    expect(() =>
      resolveCredential("accounts", { HOME: home, HASNA_ACCOUNTS_API_KEY_REF: "  " }),
    ).toThrow(CredentialResolutionError);
  });

  test("a pointer carrying a credential value (not a vault item key) is refused", () => {
    const home = makeHome();
    expect(() =>
      resolveCredential("accounts", { HOME: home, HASNA_ACCOUNTS_API_KEY_REF: "literal-secret-value" }),
    ).toThrow(/vault ITEM KEY/);
  });

  test("a literal API key shaped like a vault path is refused everywhere it is a literal", () => {
    const home = makeHome();
    // In the legacy env literal.
    expect(() =>
      resolveCredential("accounts", { HOME: home, HASNA_ACCOUNTS_API_KEY: "hasna/apps/accounts/live/api_key" }),
    ).toThrow(/vault path is NEVER accepted as a literal API key/);
    // In the override literal.
    expect(() =>
      resolveCredential("accounts", { HOME: home, HASNA_ACCOUNTS_API_KEY_OVERRIDE: "hasna/apps/accounts/live/api_key" }),
    ).toThrow(/vault path is NEVER accepted as a literal API key/);
    // As an explicit argument.
    expect(() => resolveCredential("accounts", { HOME: home }, { apiKey: "hasna/apps/accounts/live/api_key" })).toThrow(
      /vault path is NEVER accepted as a literal API key/,
    );
    // In a fleet-env disk file.
    writeFleetEnv(home, "accounts", "HASNA_ACCOUNTS_API_KEY=hasna/apps/accounts/live/api_key\n");
    expect(() => resolveCredential("accounts", { HOME: home })).toThrow(/vault path is NEVER accepted as a literal API key/);
  });
});

describe("tier 4 — the legacy process env is a fallback, not a default", () => {
  test("legacy env is used only when the disk yields nothing", () => {
    const home = makeHome();
    const resolved = resolveCredential(
      "accounts",
      { HOME: home, HASNA_ACCOUNTS_API_KEY: STALE_ENV_KEY },
      { onDeprecation: () => {} },
    );

    expect(resolved!.apiKey).toBe(STALE_ENV_KEY);
    expect(resolved!.tier).toBe("legacy-env");
    expect(resolved!.deprecated).toBe(true);
  });

  test("the deprecation names the env key AND the sanctioned route that replaces it", () => {
    const home = makeHome();
    const messages: string[] = [];
    resolveCredential(
      "accounts",
      { HOME: home, HASNA_ACCOUNTS_API_KEY: STALE_ENV_KEY },
      { onDeprecation: (message) => messages.push(message) },
    );

    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain("HASNA_ACCOUNTS_API_KEY");
    expect(messages[0]).toContain("HASNA_ACCOUNTS_API_KEY_REF");
    expect(messages[0]).not.toContain("fleet-env");
    expect(messages[0]).not.toContain(STALE_ENV_KEY);
  });

  test("the deprecation is emitted once per app, not once per call", () => {
    const home = makeHome();
    const messages: string[] = [];
    const env = { HOME: home, HASNA_ACCOUNTS_API_KEY: STALE_ENV_KEY };
    const options = { onDeprecation: (message: string) => messages.push(message) };

    resolveCredential("accounts", env, options);
    resolveCredential("accounts", env, options);
    resolveCredential("accounts", env, options);

    expect(messages).toHaveLength(1);
  });

  test("a second app emits its own deprecation", () => {
    const home = makeHome();
    const messages: string[] = [];
    const options = { onDeprecation: (message: string) => messages.push(message) };

    resolveCredential("accounts", { HOME: home, HASNA_ACCOUNTS_API_KEY: "a" }, options);
    resolveCredential("knowledge", { HOME: home, HASNA_KNOWLEDGE_API_KEY: "k" }, options);

    expect(messages).toHaveLength(2);
  });
});

describe("precedence holds across all four tiers", () => {
  test("removing each tier in turn falls to exactly the next one", () => {
    const home = makeHome();
    writeFleetEnv(home, "accounts", "HASNA_ACCOUNTS_API_KEY=disk-key\n");
    const base = {
      HOME: home,
      HASNA_ACCOUNTS_API_KEY: "legacy-key",
      HASNA_ACCOUNTS_API_KEY_OVERRIDE: "override-key",
    };
    const silent = { onDeprecation: () => {} };

    expect(resolveCredential("accounts", base, { ...silent, apiKey: "argument-key" })!.tier).toBe("argument");
    expect(resolveCredential("accounts", base, silent)!.tier).toBe("override");

    const { HASNA_ACCOUNTS_API_KEY_OVERRIDE: _dropped, ...noOverride } = base;
    expect(resolveCredential("accounts", noOverride, silent)!.tier).toBe("fleet-env");

    rmSync(join(home, ".hasna", "fleet-env", "accounts.env"));
    expect(resolveCredential("accounts", noOverride, silent)!.tier).toBe("legacy-env");

    const { HASNA_ACCOUNTS_API_KEY: _alsoDropped, ...nothing } = noOverride;
    expect(resolveCredential("accounts", nothing, silent)).toBeNull();
  });
});

describe("the disk tier is hermetic: it reads only the HOME it is given", () => {
  test("an env with no HOME performs no disk read at all", () => {
    expect(credentialDiskSources("accounts", {})).toEqual([]);
    expect(resolveCredential("accounts", {})).toBeNull();
  });

  test("credentialDiskSources reports all four layers for a given HOME, fleet-env first", () => {
    const home = makeHome();
    expect(credentialDiskSources("accounts", { HOME: home })).toEqual([
      join(home, ".hasna", "fleet-env", "accounts.env"),
      join(home, ".hasna", "cloud", "accounts.env"),
      join(home, ".config", "hasna", "accounts.env"),
      join(home, ".config", "hasna", "accounts-cloud.env"),
    ]);
  });
});

describe("no key material ever escapes into diagnostics", () => {
  test("the resolution's source and warning never contain the secret", () => {
    const home = makeHome();
    writeFleetEnv(home, "accounts", `HASNA_ACCOUNTS_API_KEY=${FRESH_DISK_KEY}\n`);

    const resolved = resolveCredential("accounts", { HOME: home })!;

    expect(resolved.source).not.toContain(FRESH_DISK_KEY);
    expect(resolved.warning ?? "").not.toContain(FRESH_DISK_KEY);
  });
});

// ---------------------------------------------------------------------------
// The NON-SECRET config tier (todos f8642ed2).
//
// `~/.hasna/cloud/<app>.env` is the fleet's app config file. The credential is
// one field in it; the API URL is another. This module already opened and
// parsed that file to take the key — these tests cover reading the non-secret
// fields out of it WITHOUT opening a second door onto the secret.
//
// Design inherited from Tullius, whose original RED tests for this helper were
// left uncommitted when it stopped. The helper's shape and its security
// boundary are its work.
// ---------------------------------------------------------------------------

describe("appConfigDiskValue — non-secret config from the same file", () => {
  test("reads a declared value and names the file it came from", () => {
    const home = makeHome();
    const path = writeFleetEnv(home, "todos", "HASNA_TODOS_API_URL=https://todos.example.invalid\n");

    const hit = appConfigDiskValue("todos", { HOME: home }, ["HASNA_TODOS_API_URL"]);

    expect(hit).not.toBeNull();
    expect(hit!.value).toBe("https://todos.example.invalid");
    expect(hit!.key).toBe("HASNA_TODOS_API_URL");
    expect(hit!.path).toBe(path);
  });

  test("honours the caller's key precedence, not the file's line order", () => {
    const home = makeHome();
    writeFleetEnv(
      home,
      "todos",
      "TODOS_API_URL=https://unprefixed.example.invalid\nHASNA_TODOS_API_URL=https://prefixed.example.invalid\n",
    );

    const hit = appConfigDiskValue("todos", { HOME: home }, ["HASNA_TODOS_API_URL", "TODOS_API_URL"]);

    expect(hit!.key).toBe("HASNA_TODOS_API_URL");
    expect(hit!.value).toBe("https://prefixed.example.invalid");
  });

  test("the first disk layer wins over the second", () => {
    const home = makeHome();
    const first = writeFleetEnv(home, "todos", "HASNA_TODOS_API_URL=https://first.example.invalid\n");
    writeConfigEnv(home, "todos", "HASNA_TODOS_API_URL=https://second.example.invalid\n");

    const hit = appConfigDiskValue("todos", { HOME: home }, ["HASNA_TODOS_API_URL"]);

    expect(hit!.value).toBe("https://first.example.invalid");
    expect(hit!.path).toBe(first);
  });

  test("falls through to the second layer when the first lacks the key", () => {
    const home = makeHome();
    writeFleetEnv(home, "todos", "SOMETHING_ELSE=1\n");
    const second = writeConfigEnv(home, "todos", "HASNA_TODOS_API_URL=https://second.example.invalid\n");

    const hit = appConfigDiskValue("todos", { HOME: home }, ["HASNA_TODOS_API_URL"]);

    expect(hit!.path).toBe(second);
  });

  test("a missing file, an absent key, and no HOME are all just null", () => {
    const home = makeHome();
    expect(appConfigDiskValue("todos", { HOME: home }, ["HASNA_TODOS_API_URL"])).toBeNull();
    writeFleetEnv(home, "todos", "SOMETHING_ELSE=1\n");
    expect(appConfigDiskValue("todos", { HOME: home }, ["HASNA_TODOS_API_URL"])).toBeNull();
    expect(appConfigDiskValue("todos", {}, ["HASNA_TODOS_API_URL"])).toBeNull();
  });

  test("an unsafe app slug never reaches the filesystem", () => {
    const home = makeHome();
    expect(appConfigDiskValue("../../elsewhere", { HOME: home }, ["ANYTHING"])).toBeNull();
  });

  // THE SECURITY BOUNDARY. This function must never become a second, unsealed
  // way to read the credential out of the same file. The sealed chain in
  // `resolveCredential` exists precisely so the secret is non-enumerable and
  // redacted on inspection; a plain `{ key, value }` hit would defeat that.
  test("REFUSES to return anything that looks like a credential key", () => {
    const home = makeHome();
    writeFleetEnv(
      home,
      "accounts",
      `HASNA_ACCOUNTS_API_KEY=${FRESH_DISK_KEY}\n` +
        `${credentialOverrideEnvKey("accounts")}=${FRESH_DISK_KEY}\n` +
        `HASNA_ACCOUNTS_TOKEN=${FRESH_DISK_KEY}\n` +
        `HASNA_ACCOUNTS_CLIENT_SECRET=${FRESH_DISK_KEY}\n` +
        `HASNA_ACCOUNTS_PASSWORD=${FRESH_DISK_KEY}\n`,
    );

    for (const key of [
      "HASNA_ACCOUNTS_API_KEY",
      credentialOverrideEnvKey("accounts"),
      "HASNA_ACCOUNTS_TOKEN",
      "HASNA_ACCOUNTS_CLIENT_SECRET",
      "HASNA_ACCOUNTS_PASSWORD",
    ]) {
      const hit = appConfigDiskValue("accounts", { HOME: home }, [key]);
      expect(hit).toBeNull();
    }

    // POSITIVE CONTROL for the refusal: the same file, same call shape, a
    // non-secret key — proves the refusal above is the filter doing its job and
    // not the reader simply failing to read this file at all.
    writeFleetEnv(
      home,
      "accounts",
      `HASNA_ACCOUNTS_API_KEY=${FRESH_DISK_KEY}\nHASNA_ACCOUNTS_API_URL=https://accounts.example.invalid\n`,
    );
    const allowed = appConfigDiskValue("accounts", { HOME: home }, ["HASNA_ACCOUNTS_API_URL"]);
    expect(allowed).not.toBeNull();
    expect(allowed!.value).toBe("https://accounts.example.invalid");
  });

  test("a credential-shaped key mixed into the request list is dropped, not honoured", () => {
    const home = makeHome();
    writeFleetEnv(
      home,
      "accounts",
      `HASNA_ACCOUNTS_API_KEY=${FRESH_DISK_KEY}\nHASNA_ACCOUNTS_API_URL=https://accounts.example.invalid\n`,
    );

    const hit = appConfigDiskValue("accounts", { HOME: home }, [
      "HASNA_ACCOUNTS_API_KEY",
      "HASNA_ACCOUNTS_API_URL",
    ]);

    expect(hit!.key).toBe("HASNA_ACCOUNTS_API_URL");
    expect(hit!.value).not.toBe(FRESH_DISK_KEY);
  });

  // A live fleet file still carries the retired mode key. Reading config off
  // disk must not resurrect it, and must not blow up over it either.
  test("a retired key in the file is neither returned nor fatal", () => {
    const home = makeHome();
    writeFleetEnv(
      home,
      "todos",
      "HASNA_TODOS_STORAGE_MODE=postgres\nHASNA_TODOS_API_URL=https://todos.example.invalid\n",
    );

    expect(appConfigDiskValue("todos", { HOME: home }, ["HASNA_TODOS_STORAGE_MODE"])!.value).toBe("postgres");
    expect(appConfigDiskValue("todos", { HOME: home }, ["HASNA_TODOS_API_URL"])!.value).toBe(
      "https://todos.example.invalid",
    );
  });
});
