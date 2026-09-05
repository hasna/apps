/**
 * Where the credential is written, and what reads it back.
 *
 * The location changed with the fleet credential ladder (owner ruling
 * 2026-09-04, hasna/apps#1720): `~/.hasna/skills/config/credentials`, mode 0600,
 * the shared @hasna/contracts disk tier — not `auth.json` in this app's data
 * directory. `$HASNA_SKILLS_DIR` therefore no longer moves it: that variable
 * relocates this app's DATA (corpus, database, config), and the fleet
 * credential is the machine's, shared with every other Hasna CLI. `HASNA_HOME`
 * is what relocates it, and these tests use a throwaway one throughout so the
 * developer's real credential is never read or written.
 */
import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync, mkdirSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { useDefaultTestTimeout } from "../test-preload.js";
import {
  clearAuthConfig,
  credentialFileMode,
  getApiKey,
  getAuthConfig,
  getAuthFilePath,
  getIdentityFilePath,
  readStoredApiUrl,
  saveApiUrl,
  saveAuthConfig,
  type StoredAuthConfig,
} from "./auth-store.js";
import { SKILLS_API_KEY_ENV, SKILLS_API_URL_ENV } from "./fleet-credentials.js";

useDefaultTestTimeout();

const SAMPLE_CONFIG: StoredAuthConfig = {
  apiKey: "sk_boundary_test_only",
  email: "boundary@example.com",
  orgId: "org_boundary",
  orgSlug: "boundary-org",
};

/** Run `fn` against a throwaway `~/.hasna` root, with no ambient credential. */
function withFleetHome<T>(fn: (env: Record<string, string | undefined>, root: string) => T): T {
  const root = mkdtempSync(join(tmpdir(), "skills-auth-home-"));
  try {
    return fn({ HASNA_HOME: root }, root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

describe("the credential this CLI writes", () => {
  test("saveAuthConfig writes the shared credentials file, owner-only", () => {
    withFleetHome((env, root) => {
      const file = saveAuthConfig(SAMPLE_CONFIG, env);

      expect(file).toBe(join(root, "skills", "config", "credentials"));
      expect(getAuthFilePath(env)).toBe(file);
      expect(readFileSync(file, "utf-8")).toContain(`${SKILLS_API_KEY_ENV}=${SAMPLE_CONFIG.apiKey}`);
      expect(statSync(file).mode & 0o777).toBe(0o600);
      expect(credentialFileMode(env)).toBe(0o600);
    });
  });

  test("the ladder reads back exactly what was written", () => {
    withFleetHome((env) => {
      saveAuthConfig(SAMPLE_CONFIG, env);
      expect(getApiKey(env)).toBe(SAMPLE_CONFIG.apiKey);
      expect(getAuthConfig(env)).toEqual(SAMPLE_CONFIG);
    });
  });

  test("identity is stored beside the credential, never inside it", () => {
    withFleetHome((env) => {
      const file = saveAuthConfig(SAMPLE_CONFIG, env);
      const identityFile = getIdentityFilePath(env);

      expect(existsSync(identityFile)).toBe(true);
      const identity = JSON.parse(readFileSync(identityFile, "utf-8"));
      expect(identity).toEqual({
        apiUrl: "https://api.hasna.com/skills",
        email: SAMPLE_CONFIG.email,
        orgId: SAMPLE_CONFIG.orgId,
        orgSlug: SAMPLE_CONFIG.orgSlug,
      });
      // The secret is in the credentials file and nowhere else.
      expect(readFileSync(identityFile, "utf-8")).not.toContain(SAMPLE_CONFIG.apiKey);
      expect(file).not.toBe(identityFile);
    });
  });

  test("a stored API URL lives in the same file and is read back by the ladder", () => {
    withFleetHome((env) => {
      saveAuthConfig(SAMPLE_CONFIG, env);
      saveApiUrl("https://skills.internal.example", env);

      const contents = readFileSync(getAuthFilePath(env), "utf-8");
      expect(contents).toContain(`${SKILLS_API_URL_ENV}=https://skills.internal.example`);
      // Writing the URL must not disturb the key that is already there.
      expect(contents).toContain(`${SKILLS_API_KEY_ENV}=${SAMPLE_CONFIG.apiKey}`);
      expect(readStoredApiUrl(env)).toBe("https://skills.internal.example");

      expect(saveApiUrl(null, env)).toBe(getAuthFilePath(env));
      expect(readStoredApiUrl(env)).toBeNull();
      expect(getApiKey(env)).toBe(SAMPLE_CONFIG.apiKey);
    });
  });

  test("logout removes the credential this command owns and reports what is left", () => {
    withFleetHome((env) => {
      saveAuthConfig(SAMPLE_CONFIG, env);
      expect(clearAuthConfig(env)).toEqual({ stillResolves: false });
      expect(() => getApiKey(env)).toThrow("no API key resolved");
      expect(existsSync(getIdentityFilePath(env))).toBe(false);

      // A key injected by the environment belongs to the machine, not to this
      // command: it is reported, never silently "signed out".
      saveAuthConfig(SAMPLE_CONFIG, env);
      const withEnvKey = { ...env, [SKILLS_API_KEY_ENV]: "sk_from_the_environment" };
      expect(clearAuthConfig(withEnvKey)).toEqual({ stillResolves: true });
      expect(getApiKey(withEnvKey)).toBe("sk_from_the_environment");
    });
  });

  test("a blank or non-ASCII key is refused rather than written", () => {
    withFleetHome((env) => {
      expect(() => saveAuthConfig({ apiKey: "   " }, env)).toThrow(/empty/);
      expect(() => saveAuthConfig({ apiKey: "sk_with\na_newline" }, env)).toThrow(/control characters/);
      expect(existsSync(getAuthFilePath(env))).toBe(false);
    });
  });

  test("the retired auth.json locations are not read", () => {
    withFleetHome((env, root) => {
      // Both places a key used to live. Neither is a credential source now, and
      // an operator holding one is told to sign in again rather than being
      // silently authenticated from a file the shared ladder cannot see.
      const appDir = join(root, "skills");
      mkdirSync(appDir, { recursive: true });
      writeFileSync(join(appDir, "auth.json"), JSON.stringify({ apiKey: "sk_legacy_app_dir" }), { mode: 0o600 });
      expect(getApiKey(env)).toBeNull();
      expect(getAuthConfig(env)).toBeNull();
    });
  });

  test("a credentials file anyone can read is refused, not silently ignored", () => {
    withFleetHome((env, root) => {
      const dir = join(root, "skills", "config");
      mkdirSync(dir, { recursive: true });
      const file = join(dir, "credentials");
      writeFileSync(file, `${SKILLS_API_KEY_ENV}=sk_world_readable\n`);
      chmodSync(file, 0o644);
      expect(() => getApiKey(env)).toThrow();
    });
  });
});
