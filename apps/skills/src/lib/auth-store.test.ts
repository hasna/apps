/**
 * The auth.json location boundary.
 *
 * $HASNA_SKILLS_DIR is the app/state root: config.json, the corpus, and the
 * server database all move with it. auth.json used to be frozen as an
 * import-time constant composed from homedir(), so with the override set the
 * CLI stored its API key at <skills data root>/auth.json while everything else
 * moved — the same override-only-half-works split getDataDir() fixed for the
 * other paths. These tests pin auth.json to the override.
 */
import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { useDefaultTestTimeout, withTempHome } from "../test-preload.js";
import { DATA_DIR_ENV } from "./config.js";
import { clearAuthConfig, getAuthConfig, saveAuthConfig, type AuthConfig } from "./auth-store.js";

useDefaultTestTimeout();

const SAMPLE_CONFIG: AuthConfig = {
  apiKey: "sk_boundary_test_only",
  email: "boundary@example.com",
  orgId: "org_boundary",
  orgSlug: "boundary-org",
};

function setOverride(dir: string): void {
  process.env[DATA_DIR_ENV] = dir;
}

describe("auth-store data directory boundary", () => {
  test("saveAuthConfig writes auth.json under HASNA_SKILLS_DIR when set", () => {
    const override = mkdtempSync(join(tmpdir(), "skills-auth-save-"));
    try {
      setOverride(override);
      clearAuthConfig();

      saveAuthConfig(SAMPLE_CONFIG);

      const file = join(override, "auth.json");
      expect(existsSync(file)).toBe(true);
      expect(JSON.parse(readFileSync(file, "utf-8"))).toEqual(SAMPLE_CONFIG);
      expect(getAuthConfig()).toEqual(SAMPLE_CONFIG);
    } finally {
      clearAuthConfig();
      rmSync(override, { recursive: true, force: true });
    }
  });

  test("getAuthConfig reads auth.json from HASNA_SKILLS_DIR when set", () => {
    const override = mkdtempSync(join(tmpdir(), "skills-auth-read-"));
    try {
      setOverride(override);
      clearAuthConfig();
      writeFileSync(join(override, "auth.json"), JSON.stringify(SAMPLE_CONFIG));

      expect(getAuthConfig()).toEqual(SAMPLE_CONFIG);
    } finally {
      clearAuthConfig();
      rmSync(override, { recursive: true, force: true });
    }
  });

  test("reads from the directory that is current, not one captured at import time", () => {
    const first = mkdtempSync(join(tmpdir(), "skills-auth-first-"));
    const second = mkdtempSync(join(tmpdir(), "skills-auth-second-"));
    try {
      setOverride(first);
      clearAuthConfig();
      saveAuthConfig({ ...SAMPLE_CONFIG, email: "first@example.com" });
      expect(getAuthConfig()?.email).toBe("first@example.com");

      // The override moves; the store must follow it, not the import-time path.
      // The first directory's file is deliberately left on disk (clearAuthConfig()
      // only removes the *current* path); what must move is where reads and writes
      // land.
      setOverride(second);
      clearAuthConfig();
      saveAuthConfig({ ...SAMPLE_CONFIG, email: "second@example.com" });

      expect(existsSync(join(second, "auth.json"))).toBe(true);
      expect(getAuthConfig()?.email).toBe("second@example.com");
      expect(existsSync(join(first, "auth.json"))).toBe(true);
    } finally {
      clearAuthConfig();
      rmSync(first, { recursive: true, force: true });
      rmSync(second, { recursive: true, force: true });
    }
  });

  test("no behavior regression when unset: auth.json stays at the skills data root", () => {
    withTempHome((home) => {
      clearAuthConfig();

      saveAuthConfig(SAMPLE_CONFIG);

      const file = join(home, ".hasna", "skills", "auth.json");
      expect(existsSync(file)).toBe(true);
      expect(JSON.parse(readFileSync(file, "utf-8"))).toEqual(SAMPLE_CONFIG);
      expect(getAuthConfig()).toEqual(SAMPLE_CONFIG);
    });
  });

  test("legacy ~/.skills/auth.json is still read as a fallback", () => {
    withTempHome((home) => {
      clearAuthConfig();
      mkdirSync(join(home, ".skills"), { recursive: true });
      writeFileSync(join(home, ".skills", "auth.json"), JSON.stringify(SAMPLE_CONFIG));

      expect(getAuthConfig()).toEqual(SAMPLE_CONFIG);
    });
  });
});
