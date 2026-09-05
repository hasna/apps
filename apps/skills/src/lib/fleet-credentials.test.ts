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
  resolveSkillsFleet,
  skillsCredentialFilePath,
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
