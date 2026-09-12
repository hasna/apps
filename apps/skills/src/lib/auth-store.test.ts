/**
 * What reads the credential back — and the fact that nothing here writes one.
 *
 * The location is the fleet credential ladder's disk tier (owner ruling
 * 2026-09-04, hasna/apps#1720): `~/.hasna/skills/config/credentials`, mode 0600,
 * relocated by `HASNA_HOME`, never by `$HASNA_SKILLS_DIR`. Since the fail-closed
 * re-cut (owner ruling 2026-09-07) this package has no writer for that file:
 * the provisioning step is the operator's, and the tests simulate it with the
 * test-only fixture writer. Every case uses a throwaway root so the
 * developer's real credential is never read.
 */
import { describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { useDefaultTestTimeout } from "../test-preload.js";
import * as authStore from "./auth-store.js";
import {
  CREDENTIAL_STORE_UNMANAGED,
  credentialFileMode,
  credentialPlacement,
  credentialPlacementMessage,
  getApiKey,
  getAuthConfig,
  getAuthFilePath,
  getAuthIdentity,
  getIdentityFilePath,
  readStoredApiUrl,
} from "./auth-store.js";
import { writeSkillsCredentialFixture } from "./credential-fixture.test-utils.js";
import { SKILLS_API_KEY_ENV, SKILLS_API_URL_ENV } from "./fleet-credentials.js";

useDefaultTestTimeout();

const SAMPLE = {
  apiKey: "sk_boundary_test_only",
  identity: { email: "boundary@example.com", orgId: "org_boundary", orgSlug: "boundary-org" },
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

describe("the credential this CLI reads", () => {
  test("a provisioned credentials file resolves through the shared ladder", () => {
    withFleetHome((env, root) => {
      const file = writeSkillsCredentialFixture(env, SAMPLE);
      expect(file).toBe(join(root, "skills", "config", "credentials"));
      expect(getAuthFilePath(env)).toBe(file);
      expect(credentialFileMode(env)).toBe(0o600);
      expect(getApiKey(env)).toBe(SAMPLE.apiKey);
      expect(getAuthConfig(env)).toEqual({ apiKey: SAMPLE.apiKey, ...SAMPLE.identity });
    });
  });

  test("identity beside the credential is display data: read only, never holding the key", () => {
    withFleetHome((env) => {
      const file = writeSkillsCredentialFixture(env, SAMPLE);
      const identityFile = getIdentityFilePath(env);
      expect(identityFile).not.toBe(file);
      expect(readFileSync(identityFile, "utf-8")).not.toContain(SAMPLE.apiKey);
      expect(getAuthIdentity(env)).toEqual(SAMPLE.identity);
    });
  });

  test("a stored API URL in the same file is read back; this package never writes one", () => {
    withFleetHome((env) => {
      writeSkillsCredentialFixture(env, { ...SAMPLE, apiUrl: "https://skills.internal.example/api/v1" });
      expect(readStoredApiUrl(env)).toBe("https://skills.internal.example");
      expect(getApiKey(env)).toBe(SAMPLE.apiKey);
    });
  });

  test("the module exports no credential writer and imports no filesystem writer", () => {
    for (const name of ["saveAuthConfig", "saveApiUrl", "clearAuthConfig", "writeCredentialValues"]) {
      expect((authStore as Record<string, unknown>)[name], name).toBeUndefined();
    }
    const source = readFileSync(new URL("./auth-store.ts", import.meta.url), "utf-8");
    for (const writer of ["writeFileSync", "appendFileSync", "renameSync", "unlinkSync", "chmodSync", "mkdirSync"]) {
      expect(source, writer).not.toContain(writer);
    }
  });

  test("credential placement names the tiers and contains no value", () => {
    withFleetHome((env, root) => {
      const placement = credentialPlacement(env);
      expect(placement.keychainItem).toBe("hasna.credentials.skills.api-key");
      expect(placement.keychainUrlItem).toBe("hasna.credentials.skills.api-url");
      expect(placement.credentialsFile).toBe(join(root, "skills", "config", "credentials"));
      expect(placement.envKey).toBe(SKILLS_API_KEY_ENV);
      expect(placement.envUrlKey).toBe(SKILLS_API_URL_ENV);

      const message = credentialPlacementMessage(env);
      expect(message.startsWith(`${CREDENTIAL_STORE_UNMANAGED}:`)).toBe(true);
      for (const name of [placement.keychainItem, placement.credentialsFile!, placement.envKey, placement.envUrlKey]) {
        expect(message).toContain(name);
      }
      expect(message).not.toMatch(/sk_[a-z0-9]/i);
    });
    // With no HOME at all the message still names the tiers and invents no path.
    expect(credentialPlacement({}).credentialsFile).toBeNull();
    expect(credentialPlacementMessage({})).toContain("~/.hasna/skills/config/credentials");
  });

  test("the retired auth.json locations are not read", () => {
    withFleetHome((env, root) => {
      // Both places a key used to live. Neither is a credential source now. The
      // local opt-in keeps the unconfigured shape legal here (local mode), which
      // is the point: the legacy files must still resolve NOTHING.
      const appDir = join(root, "skills");
      mkdirSync(appDir, { recursive: true });
      writeFileSync(join(appDir, "auth.json"), JSON.stringify({ apiKey: "sk_legacy_app_dir" }), { mode: 0o600 });
      const optedIn = { ...env, HASNA_SKILLS_LOCAL: "1" };
      expect(getApiKey(optedIn)).toBeNull();
      expect(getAuthConfig(optedIn)).toBeNull();
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
      expect(existsSync(file)).toBe(true);
    });
  });
});
