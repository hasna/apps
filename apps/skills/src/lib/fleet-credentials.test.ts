/**
 * The fleet credential ladder, as this package uses it.
 *
 * These tests are hermetic in the strong sense: every case passes its own env
 * object, so the shared resolver performs no ambient read at all (no real HOME,
 * no real login Keychain) — the Keychain tier is exercised with an injected
 * `security` runner, which is the seam @hasna/contracts provides for exactly
 * this. See test-preload.ts for why the ambient variables are stripped from the
 * whole suite as well.
 */
import { describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { useDefaultTestTimeout } from "../test-preload.js";
import {
  MissingSkillsFleetError,
  SkillsFleetCredentialError,
  configuredSkillsApiUrl,
  noticeLocalSkillsMode,
  requireSkillsFleet,
  resetLocalSkillsModeNotice,
  resolveSkillsApiKey,
  resolveSkillsFleet,
  skillsCredentialFilePath,
  skillsCredentialOrReason,
  SKILLS_API_KEY_ENV,
  SKILLS_API_URL_ENV,
} from "./fleet-credentials.js";
import { CLI_PATH } from "../cli/cli.test-utils.js";

useDefaultTestTimeout();

const KEY = "sk_fleet_ladder_test_only";

/** A fake `/usr/bin/security` that holds the given items. Never touches a real keychain. */
function fakeKeychain(items: Record<string, string>) {
  return {
    enabled: true,
    platform: "darwin",
    hostname: () => "test-station.local",
    run: (argv: readonly string[]) => {
      const service = argv[argv.indexOf("-s") + 1] ?? "";
      const value = items[service];
      if (value === undefined) return { status: 44, stdout: "", stderr: "The specified item could not be found." };
      return { status: 0, stdout: `${value}\n`, stderr: "" };
    },
  };
}

function withTempDir<T>(fn: (dir: string) => T): T {
  const dir = mkdtempSync(join(tmpdir(), "skills-fleet-"));
  try {
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Write `~/.hasna/skills/config/credentials` under a throwaway home. */
function writeCredentialsFile(home: string, body: string, mode = 0o600): string {
  const dir = join(home, ".hasna", "skills", "config");
  mkdirSync(dir, { recursive: true });
  const file = join(dir, "credentials");
  writeFileSync(file, body, { mode });
  chmodSync(file, mode);
  return file;
}

describe("fleet credential ladder", () => {
  test("tier 5 — HASNA_SKILLS_API_KEY alone reaches the fleet gateway", () => {
    const fleet = resolveSkillsFleet({ [SKILLS_API_KEY_ENV]: KEY });
    expect(fleet.mode).toBe("hosted");
    if (fleet.mode !== "hosted") return;
    expect(fleet.apiKey).toBe(KEY);
    expect(fleet.apiKeySource).toBe(SKILLS_API_KEY_ENV);
    // URLs never need configuring: the gateway is path-prefixed by app.
    expect(fleet.apiOrigin).toBe("https://api.hasna.com/skills");
    expect(fleet.apiUrlSource).toBe("default");
  });

  test("the unprefixed SKILLS_API_KEY alias still works, silently", () => {
    const fleet = resolveSkillsFleet({ SKILLS_API_KEY: KEY });
    expect(fleet.mode).toBe("hosted");
    if (fleet.mode !== "hosted") return;
    expect(fleet.apiKey).toBe(KEY);
    expect(fleet.apiKeySource).toBe("SKILLS_API_KEY");
  });

  test("SKILL_API_KEY (singular) is not a credential source any more", () => {
    expect(resolveSkillsFleet({ SKILL_API_KEY: KEY }).mode).toBe("local");
  });

  test("tier 4 — the credentials file supplies the key, and outranks the env", () => {
    withTempDir((home) => {
      const file = writeCredentialsFile(home, `${SKILLS_API_KEY_ENV}=${KEY}_disk\n`);
      const fleet = resolveSkillsFleet({ HOME: home, [SKILLS_API_KEY_ENV]: `${KEY}_env` });
      expect(fleet.mode).toBe("hosted");
      if (fleet.mode !== "hosted") return;
      // Disk above env is the whole point: a shell that outlived a rotation
      // holds a stale export, and the file on disk is the current key.
      expect(fleet.apiKey).toBe(`${KEY}_disk`);
      expect(fleet.apiKeySource).toBe(file);
      expect(skillsCredentialFilePath({ HOME: home })).toBe(file);
    });
  });

  test("a blank or malformed URL in the credentials file is refused, not skipped", () => {
    withTempDir((home) => {
      writeCredentialsFile(home, `${SKILLS_API_URL_ENV}=""\n${SKILLS_API_KEY_ENV}=${KEY}\n`);
      // Skipping it would silently demote a configured install to the gateway
      // default, which is the class of silence this ladder exists to remove.
      expect(() => resolveSkillsFleet({ HOME: home })).toThrow(/blank or malformed/);
      try {
        configuredSkillsApiUrl({ HOME: home });
        throw new Error("expected a refusal");
      } catch (error) {
        // A distinct code: a malformed authority is not the same fault as a
        // missing credential, and a JSON caller must be able to tell them apart.
        expect((error as SkillsFleetCredentialError).code).toBe("INVALID_API_URL");
      }
    });
  });

  test("a credentials file readable by anyone else is refused, never treated as absent", () => {
    withTempDir((home) => {
      writeCredentialsFile(home, `${SKILLS_API_KEY_ENV}=${KEY}\n`, 0o644);
      expect(() => resolveSkillsFleet({ HOME: home })).toThrow();
    });
  });

  test("the credentials file also supplies the API URL", () => {
    withTempDir((home) => {
      writeCredentialsFile(
        home,
        `${SKILLS_API_URL_ENV}=https://skills.internal.example\n${SKILLS_API_KEY_ENV}=${KEY}\n`,
      );
      const fleet = resolveSkillsFleet({ HOME: home });
      expect(fleet.mode).toBe("hosted");
      if (fleet.mode !== "hosted") return;
      expect(fleet.apiOrigin).toBe("https://skills.internal.example");
    });
  });

  test("tier 3 — the macOS Keychain supplies the key and the URL", () => {
    const fleet = resolveSkillsFleet(
      { HOME: "/nonexistent-home-for-this-test" },
      {
        credentials: {
          keychain: fakeKeychain({
            "hasna.credentials.skills.api-key": KEY,
            "hasna.credentials.skills.api-url": "https://skills.station.example",
          }),
        },
      },
    );
    expect(fleet.mode).toBe("hosted");
    if (fleet.mode !== "hosted") return;
    expect(fleet.apiKey).toBe(KEY);
    expect(fleet.apiKeySource).toContain("keychain:hasna.credentials.skills.api-key");
    expect(fleet.apiOrigin).toBe("https://skills.station.example");
  });

  test("tier 3 outranks the credentials file", () => {
    withTempDir((home) => {
      writeCredentialsFile(home, `${SKILLS_API_KEY_ENV}=${KEY}_disk\n`);
      const fleet = resolveSkillsFleet(
        { HOME: home },
        { credentials: { keychain: fakeKeychain({ "hasna.credentials.skills.api-key": `${KEY}_keychain` }) } },
      );
      expect(fleet.mode).toBe("hosted");
      if (fleet.mode !== "hosted") return;
      expect(fleet.apiKey).toBe(`${KEY}_keychain`);
    });
  });

  test("tier 2 — a deliberate override outranks every store", () => {
    withTempDir((home) => {
      writeCredentialsFile(home, `${SKILLS_API_KEY_ENV}=${KEY}_disk\n`);
      const fleet = resolveSkillsFleet(
        { HOME: home, HASNA_SKILLS_API_KEY_OVERRIDE: `${KEY}_override` },
        { credentials: { keychain: fakeKeychain({ "hasna.credentials.skills.api-key": `${KEY}_keychain` }) } },
      );
      expect(fleet.mode).toBe("hosted");
      if (fleet.mode !== "hosted") return;
      expect(fleet.apiKey).toBe(`${KEY}_override`);
    });
  });

  test("tier 1 — an explicit argument wins", () => {
    const fleet = resolveSkillsFleet(
      { [SKILLS_API_KEY_ENV]: `${KEY}_env` },
      { credentials: { apiKey: `${KEY}_argument` } },
    );
    expect(fleet.mode).toBe("hosted");
    if (fleet.mode !== "hosted") return;
    expect(fleet.apiKey).toBe(`${KEY}_argument`);
  });

  test("an operator's full API base is not doubled up", () => {
    const fleet = resolveSkillsFleet({
      [SKILLS_API_URL_ENV]: "https://skills.internal.example/api/v1/",
      [SKILLS_API_KEY_ENV]: KEY,
    });
    expect(fleet.mode).toBe("hosted");
    if (fleet.mode !== "hosted") return;
    expect(fleet.apiOrigin).toBe("https://skills.internal.example");
  });

  test("nothing configured is local mode, and says so once", () => {
    const fleet = resolveSkillsFleet({});
    expect(fleet).toEqual({ mode: "local", apiOrigin: null, apiKey: null });
    expect(configuredSkillsApiUrl({})).toBeNull();

    resetLocalSkillsModeNotice();
    const lines: string[] = [];
    noticeLocalSkillsMode((line) => lines.push(line));
    noticeLocalSkillsMode((line) => lines.push(line));
    expect(lines.length).toBe(1);
    expect(lines[0]).toContain("local mode");
    expect(lines[0]).toContain(SKILLS_API_KEY_ENV);
  });

  test("an authority with no credential fails loud — it never degrades to local", () => {
    const attempt = () => resolveSkillsFleet({ [SKILLS_API_URL_ENV]: "https://skills.internal.example" });
    expect(attempt).toThrow(SkillsFleetCredentialError);
    try {
      attempt();
    } catch (error) {
      const message = (error as Error).message;
      expect(message).toContain(SKILLS_API_URL_ENV);
      expect(message).toContain("hasna.credentials.skills.api-key");
      expect(message).toContain("skills auth login");
      // Never the value, and never a key-shaped string.
      expect(message).not.toContain(KEY);
    }
  });

  test("requireSkillsFleet names what is missing and hands back no endpoint", () => {
    let thrown: unknown;
    try {
      requireSkillsFleet("Publishing", {});
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(MissingSkillsFleetError);
    const message = (thrown as Error).message;
    expect(message).toContain("Publishing");
    expect(message).toContain(SKILLS_API_KEY_ENV);
    expect(message).not.toContain("https://");
  });
});

describe("the CLI fails closed rather than opening a local database", () => {
  test("an API URL with no credential exits non-zero and creates no database", async () => {
    const home = mkdtempSync(join(tmpdir(), "skills-fleet-cli-"));
    try {
      const proc = Bun.spawn(["bun", "run", CLI_PATH, "--", "list", "--json"], {
        stdout: "pipe",
        stderr: "pipe",
        env: {
          PATH: process.env.PATH ?? "",
          HOME: home,
          NO_COLOR: "1",
          SKILLS_TEST_MODE: "1",
          HASNA_STATION: "skills-suite-no-such-keychain-account",
          [SKILLS_API_URL_ENV]: "https://skills.internal.example",
        },
      });
      const output = (await new Response(proc.stdout).text()) + (await new Response(proc.stderr).text());
      const exitCode = await proc.exited;

      expect(exitCode).not.toBe(0);
      expect(output).toContain(SKILLS_API_URL_ENV);
      expect(databaseFilesUnder(home)).toEqual([]);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });
});

/** Every *.db this run left behind, so "no local fallback" is checked on disk. */
function databaseFilesUnder(root: string): string[] {
  const found: string[] = [];
  const walk = (dir: string): void => {
    if (!existsSync(dir)) return;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (entry.name.endsWith(".db")) found.push(path);
    }
  };
  walk(root);
  return found;
}

/**
 * Tier 2, the half that had no coverage.
 *
 * `HASNA_SKILLS_API_KEY_REF` names a VAULT ITEM, so `resolveCredential` answers
 * with a TRUTHY credential whose own `apiKey` is the empty string plus the item
 * to fetch; completing it is a separate async step. Publishing that empty
 * string as the resolved key produced hosted mode with no credential — and the
 * read path, seeing a falsy token, served the bundled local corpus with a zero
 * exit and no notice. Configuring a credential made the CLI LESS safe than
 * configuring nothing, which is precisely what the 2026-09-04 ruling forbids.
 */
describe("tier 2 — a vault pointer is a credential, never a blank key", () => {
  const POINTER_ENV = "HASNA_SKILLS_API_KEY_REF";
  const VAULT_ITEM = "hasna/skills/live/api_key";

  test("resolves hosted, carries the pointer, and publishes no key", () => {
    const fleet = resolveSkillsFleet({ [POINTER_ENV]: VAULT_ITEM });
    expect(fleet.mode).toBe("hosted");
    if (fleet.mode !== "hosted") return;
    expect(fleet.apiKey).toBeNull();
    expect(fleet.apiKey).not.toBe("");
    expect(fleet.apiKeyTier).toBe("pointer");
    expect(fleet.apiKeyPointer).not.toBeNull();
    expect(fleet.apiOrigin).toBe("https://api.hasna.com/skills");
  });

  test("completing it without the secrets SDK refuses loudly", async () => {
    // Terminal by contract: a deliberate pointer never falls through to another
    // tier, and it certainly never falls back to local data.
    const failure = resolveSkillsApiKey({ [POINTER_ENV]: VAULT_ITEM });
    await expect(failure).rejects.toBeInstanceOf(SkillsFleetCredentialError);
    await expect(failure).rejects.toThrow(/HASNA_SKILLS_API_KEY_REF/);
  });

  test("and reaches a --json surface as a reason, not as an unhandled error", async () => {
    const { apiKey, reason } = await skillsCredentialOrReason({ [POINTER_ENV]: VAULT_ITEM });
    expect(apiKey).toBeNull();
    // `reason: null` here would be the false green: "not signed in" for an
    // install that IS configured, and a caller free to answer locally.
    expect(reason).toMatch(/HASNA_SKILLS_API_KEY_REF/);
  });
});

/**
 * Tier 2, the profile pointer.
 *
 * `@hasna/contracts` throws its own `CredentialResolutionError` for a
 * deliberate selection it cannot honour. Untranslated, that error escaped every
 * helper here — `skillsCredentialOrReason` and `resolveConfiguredRunRouting`
 * recognise only `SkillsFleetCredentialError` — so a `--json` command or an MCP
 * tool got an unhandled exception where the structured refusal was the point.
 */
describe("tier 2 — HASNA_PROFILE", () => {
  test("a profile with no entry is this package's refusal, with a stable code", () => {
    withTempDir((home) => {
      let thrown: unknown;
      try {
        resolveSkillsFleet({ HOME: home, HASNA_PROFILE: "work" });
      } catch (error) {
        thrown = error;
      }
      expect(thrown).toBeInstanceOf(SkillsFleetCredentialError);
      expect((thrown as SkillsFleetCredentialError).code).toBe("MISSING_API_CREDENTIAL");
      expect((thrown as Error).message).toMatch(/work/);
    });
  });

  test("and reaches a --json surface as a reason", async () => {
    const home = mkdtempSync(join(tmpdir(), "skills-fleet-profile-"));
    try {
      const { apiKey, reason } = await skillsCredentialOrReason({ HOME: home, HASNA_PROFILE: "work" });
      expect(apiKey).toBeNull();
      expect(reason).toMatch(/work/);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  test("a profile that HAS a credentials file resolves through it", () => {
    withTempDir((home) => {
      const dir = join(home, ".hasna", "skills", "config");
      mkdirSync(dir, { recursive: true });
      const file = join(dir, "credentials-work");
      writeFileSync(file, `${SKILLS_API_KEY_ENV}=${KEY}_work\n`, { mode: 0o600 });
      chmodSync(file, 0o600);
      const fleet = resolveSkillsFleet({ HOME: home, HASNA_PROFILE: "work" });
      expect(fleet.mode).toBe("hosted");
      if (fleet.mode !== "hosted") return;
      expect(fleet.apiKey).toBe(`${KEY}_work`);
      expect(fleet.apiKeyTier).toBe("profile");
      expect(fleet.apiKeyPointer).toBeNull();
    });
  });
});

describe("skills setup-info reports where the credential came from, never its value", () => {
  test("names the tier and the file mode, and says local when nothing is configured", async () => {
    const home = mkdtempSync(join(tmpdir(), "skills-setup-info-"));
    try {
      const configDir = join(home, ".hasna", "skills", "config");
      mkdirSync(configDir, { recursive: true });
      writeFileSync(join(configDir, "credentials"), `${SKILLS_API_KEY_ENV}=${KEY}\n`, { mode: 0o600 });

      const hosted = await runSetupInfo(home, {});
      expect(hosted.credential).toMatchObject({
        mode: "hosted",
        apiUrl: "https://api.hasna.com/skills",
        apiUrlSource: "default",
        apiKeyTier: "disk",
        credentialsFileMode: "0600",
      });
      expect(hosted.credential.apiKeySource).toBe(join(configDir, "credentials"));
      expect(JSON.stringify(hosted)).not.toContain(KEY);

      rmSync(join(configDir, "credentials"));
      const local = await runSetupInfo(home, {});
      expect(local.credential).toMatchObject({ mode: "local", apiUrl: null, apiKeySource: null });
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });
});

/** `skills setup-info --json` under a throwaway home, with no ambient credential. */
async function runSetupInfo(home: string, extra: Record<string, string>): Promise<any> {
  const proc = Bun.spawn(["bun", "run", CLI_PATH, "--", "setup-info", "--json"], {
    stdout: "pipe",
    stderr: "pipe",
    env: {
      PATH: process.env.PATH ?? "",
      HOME: home,
      NO_COLOR: "1",
      SKILLS_TEST_MODE: "1",
      HASNA_STATION: "skills-suite-no-such-keychain-account",
      ...extra,
    },
  });
  const stdout = await new Response(proc.stdout).text();
  await new Response(proc.stderr).text();
  await proc.exited;
  return JSON.parse(stdout);
}
