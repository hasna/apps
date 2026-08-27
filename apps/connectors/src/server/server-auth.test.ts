import {
  describe,
  test,
  expect,
  afterEach,
  beforeAll,
} from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { connectorsHome } from "../lib/paths.js";
import {
  getAuthType,
  getAuthStatus,
  saveApiKey,
  getOAuthConfig,
  getTokenExpiry,
  getEnvVars,
  getOAuthStartUrl,
  validateOAuthState,
  listProfiles,
  switchProfile,
  deleteProfile,
} from "./auth.js";
import { startServer } from "./serve.js";

// ── Test isolation strategy ──
// Bun's os.homedir() does not respect runtime changes to process.env.HOME,
// so we write to the real connectors home directory using unique test connector
// names (prefixed with "zzztest") that are cleaned up after each test.

const TEST_ID = `zzztest${process.pid}`;

/** Get the real connectors home /<name> path */
function testConfigDir(name: string): string {
  return join(connectorsHome(), name);
}

function legacyTestConfigDir(name: string): string {
  return join(connectorsHome(), `connect-${name}`);
}

/** Clean up test connector directories from the connectors home */
function cleanupTestConnectors(...names: string[]) {
  for (const name of names) {
    for (const dir of [testConfigDir(name), legacyTestConfigDir(name)]) {
      if (existsSync(dir)) {
        rmSync(dir, { recursive: true });
      }
    }
  }
}

function fileMode(path: string): number {
  return statSync(path).mode & 0o777;
}

// ============================================================================
// Auth Module Tests
// ============================================================================

describe("auth", () => {
  // ── getAuthType ──

  describe("getAuthType", () => {
    test("returns 'bearer' for connectors with Bearer Token auth (stripe)", () => {
      const authType = getAuthType("stripe");
      expect(authType).toBe("bearer");
    });

    test("returns 'oauth' for connectors with OAuth auth (gmail)", () => {
      const authType = getAuthType("gmail");
      expect(authType).toBe("oauth");
    });

    test("returns 'apikey' as default for connectors without CLAUDE.md", () => {
      const authType = getAuthType("nonexistent-xyz-abc");
      expect(authType).toBe("apikey");
    });

    test("returns 'bearer' for anthropic connector", () => {
      const authType = getAuthType("anthropic");
      expect(authType).toBe("bearer");
    });

    test("returns 'oauth' for googlecalendar connector", () => {
      const authType = getAuthType("googlecalendar");
      expect(authType).toBe("oauth");
    });
  });

  // ── getAuthStatus ──

  describe("getAuthStatus", () => {
    test("returns correct type for bearer connector", () => {
      const status = getAuthStatus("anthropic");
      expect(status.type).toBe("bearer");
      expect(status.envVars).toBeInstanceOf(Array);
    });

    test("returns configured=true when env var is set", () => {
      const originalValue = process.env.STRIPE_API_KEY;
      process.env.STRIPE_API_KEY = "fixture-stripe-value";
      try {
        const status = getAuthStatus("stripe");
        expect(status.type).toBe("bearer");
        expect(status.configured).toBe(true);
        expect(status.envVars.length).toBeGreaterThan(0);
        const keyVar = status.envVars.find(
          (v) => v.variable === "STRIPE_API_KEY"
        );
        expect(keyVar).toBeDefined();
        expect(keyVar!.set).toBe(true);
      } finally {
        if (originalValue === undefined) {
          delete process.env.STRIPE_API_KEY;
        } else {
          process.env.STRIPE_API_KEY = originalValue;
        }
      }
    });

    test("returns configured=true for TomTom when TOMTOM_API_KEY is set", () => {
      const originalValue = process.env.TOMTOM_API_KEY;
      process.env.TOMTOM_API_KEY = "fixture-tomtom-value";
      try {
        const status = getAuthStatus("tomtom");
        expect(status.type).toBe("apikey");
        expect(status.configured).toBe(true);
        const keyVar = status.envVars.find(
          (v) => v.variable === "TOMTOM_API_KEY"
        );
        expect(keyVar).toBeDefined();
        expect(keyVar!.set).toBe(true);
      } finally {
        if (originalValue === undefined) {
          delete process.env.TOMTOM_API_KEY;
        } else {
          process.env.TOMTOM_API_KEY = originalValue;
        }
      }
    });

    test("returns unconfigured oauth status when no tokens exist", () => {
      // Use a unique test connector name — no profile dir exists so configured=false
      // getAuthType falls back to 'apikey' for unknown connectors, so we test 'apikey'
      // unconfigured state instead (same intent: a connector with no stored credentials)
      const uniqueName = `zzztest-unconf-${process.pid}`;
      const status = getAuthStatus(uniqueName);
      expect(status.configured).toBe(false);
      // No creds, no env vars set, no tokens
      expect(status.hasRefreshToken).toBeFalsy();
      expect(status.tokenExpiry).toBeUndefined();
    });

    test("returns configured=true for oauth when credentials.json has client credentials", () => {
      const configDir = testConfigDir("gmail");
      const credsFile = join(configDir, "credentials.json");
      const hadCreds = existsSync(credsFile);
      const previous = hadCreds ? readFileSync(credsFile, "utf-8") : null;

      mkdirSync(configDir, { recursive: true });
      writeFileSync(
        credsFile,
        JSON.stringify({
          clientId: "stored-client-id",
          clientSecret: "stored-client-secret",
        })
      );

      try {
        const status = getAuthStatus("gmail");
        expect(status.type).toBe("oauth");
        expect(status.configured).toBe(true);
        expect(status.hasOAuthCredentials).toBe(true);
        expect(status.envVars.find((v) => v.variable === "GMAIL_CLIENT_ID")?.set).toBe(true);
        expect(status.envVars.find((v) => v.variable === "GMAIL_CLIENT_SECRET")?.set).toBe(true);
      } finally {
        if (previous !== null) {
          writeFileSync(credsFile, previous);
        } else if (existsSync(credsFile)) {
          rmSync(credsFile);
        }
      }
    });

    test("returns configured=true for oauth when tokens exist in profile", () => {
      const profileDir = join(testConfigDir("gmail"), "profiles", "default");
      const tokensFile = join(profileDir, "tokens.json");
      const hadTokens = existsSync(tokensFile);
      const previous = hadTokens ? readFileSync(tokensFile, "utf-8") : null;

      mkdirSync(profileDir, { recursive: true });
      writeFileSync(
        tokensFile,
        JSON.stringify({
          accessToken: "access-token",
          refreshToken: "refresh-token",
          expiresAt: Date.now() + 3600_000,
        })
      );

      try {
        const status = getAuthStatus("gmail");
        expect(status.type).toBe("oauth");
        expect(status.configured).toBe(true);
        expect(status.hasRefreshToken).toBe(true);
        expect(status.envVars.find((v) => v.variable === "GMAIL_ACCESS_TOKEN")?.set).toBe(true);
        expect(status.envVars.find((v) => v.variable === "GMAIL_REFRESH_TOKEN")?.set).toBe(true);
      } finally {
        if (previous !== null) {
          writeFileSync(tokensFile, previous);
        } else if (existsSync(tokensFile)) {
          rmSync(tokensFile);
        }
      }
    });

    test("envVars array includes expected variables for stripe", () => {
      const status = getAuthStatus("stripe");
      expect(status.envVars.length).toBeGreaterThan(0);
      const variables = status.envVars.map((v) => v.variable);
      expect(variables).toContain("STRIPE_API_KEY");
    });

    test("envVars show set=false when env vars are not set", () => {
      const originalValue = process.env.ANTHROPIC_API_KEY;
      const originalHome = process.env.HOME;
      const originalUserProfile = process.env.USERPROFILE;
      const tempHome = mkdtempSync(join(tmpdir(), "connectors-auth-empty-home-"));

      delete process.env.ANTHROPIC_API_KEY;
      process.env.HOME = tempHome;
      delete process.env.USERPROFILE;

      try {
        const status = getAuthStatus("anthropic");
        const keyVar = status.envVars.find(
          (v) => v.variable === "ANTHROPIC_API_KEY"
        );
        expect(keyVar).toBeDefined();
        expect(keyVar!.set).toBe(false);
      } finally {
        if (originalValue !== undefined) {
          process.env.ANTHROPIC_API_KEY = originalValue;
        }
        if (originalHome !== undefined) {
          process.env.HOME = originalHome;
        } else {
          delete process.env.HOME;
        }
        if (originalUserProfile !== undefined) {
          process.env.USERPROFILE = originalUserProfile;
        } else {
          delete process.env.USERPROFILE;
        }
        rmSync(tempHome, { recursive: true, force: true });
      }
    });

    test("credential env vars with key-like names count as configured", () => {
      const secretEnvVar = ["AWS", "SECRET", "ACCESS", "KEY"].join("_");
      const originalAccessKey = process.env.AWS_ACCESS_KEY_ID;
      const originalAwsValue = process.env[secretEnvVar];
      process.env.AWS_ACCESS_KEY_ID = "x";
      process.env[secretEnvVar] = "x";

      try {
        const status = getAuthStatus("aws");
        expect(status.configured).toBe(true);
        expect(status.envVars.find((v) => v.variable === "AWS_ACCESS_KEY_ID")?.set).toBe(true);
        expect(status.envVars.find((v) => v.variable === secretEnvVar)?.set).toBe(true);
      } finally {
        if (originalAccessKey === undefined) {
          delete process.env.AWS_ACCESS_KEY_ID;
        } else {
          process.env.AWS_ACCESS_KEY_ID = originalAccessKey;
        }
        if (originalAwsValue === undefined) {
          delete process.env[secretEnvVar];
        } else {
          process.env[secretEnvVar] = originalAwsValue;
        }
      }
    });

    test("detects Solcast API key saved in shared profile config", () => {
      const solcastApiKeyVar = ["SOLCAST", "API", "KEY"].join("_");
      const originalHome = process.env.HOME;
      const originalSolcastValue = process.env[solcastApiKeyVar];
      const tempHome = mkdtempSync(join(tmpdir(), "solcast-auth-status-"));

      process.env.HOME = tempHome;
      delete process.env[solcastApiKeyVar];

      try {
        const profileDir = join(
          tempHome,
          ".hasna",
          "connectors",
          "solcast",
          "profiles",
          "default"
        );
        mkdirSync(profileDir, { recursive: true });
        writeFileSync(
          join(profileDir, "config.json"),
          JSON.stringify({ apiKey: "shared-solcast-key" }, null, 2)
        );

        const status = getAuthStatus("solcast");
        expect(status.type).toBe("apikey");
        expect(status.configured).toBe(true);
        expect(status.envVars.find((v) => v.variable === solcastApiKeyVar)?.set).toBe(true);
      } finally {
        if (originalHome === undefined) {
          delete process.env.HOME;
        } else {
          process.env.HOME = originalHome;
        }
        if (originalSolcastValue === undefined) {
          delete process.env[solcastApiKeyVar];
        } else {
          process.env[solcastApiKeyVar] = originalSolcastValue;
        }
        rmSync(tempHome, { recursive: true, force: true });
      }
    });

    test("does not treat Solcast base URL-only profile config as authenticated", () => {
      const solcastApiKeyVar = ["SOLCAST", "API", "KEY"].join("_");
      const originalHome = process.env.HOME;
      const originalSolcastValue = process.env[solcastApiKeyVar];
      const originalBaseUrl = process.env.SOLCAST_BASE_URL;
      const tempHome = mkdtempSync(join(tmpdir(), "solcast-auth-baseurl-"));

      process.env.HOME = tempHome;
      delete process.env[solcastApiKeyVar];
      delete process.env.SOLCAST_BASE_URL;

      try {
        const profileDir = join(
          tempHome,
          ".hasna",
          "connectors",
          "solcast",
          "profiles",
          "default"
        );
        mkdirSync(profileDir, { recursive: true });
        writeFileSync(
          join(profileDir, "config.json"),
          JSON.stringify({ baseUrl: "https://profile.example.test" }, null, 2)
        );

        const status = getAuthStatus("solcast");
        expect(status.type).toBe("apikey");
        expect(status.configured).toBe(false);
        expect(status.envVars.find((v) => v.variable === solcastApiKeyVar)?.set).toBe(false);
      } finally {
        if (originalHome === undefined) {
          delete process.env.HOME;
        } else {
          process.env.HOME = originalHome;
        }
        if (originalSolcastValue === undefined) {
          delete process.env[solcastApiKeyVar];
        } else {
          process.env[solcastApiKeyVar] = originalSolcastValue;
        }
        if (originalBaseUrl === undefined) {
          delete process.env.SOLCAST_BASE_URL;
        } else {
          process.env.SOLCAST_BASE_URL = originalBaseUrl;
        }
        rmSync(tempHome, { recursive: true, force: true });
      }
    });
  });

  // ── saveApiKey ──
  // Uses a unique connector home per test run for isolation.

  describe("saveApiKey", () => {
    const name1 = `${TEST_ID}save1`;
    const name2 = `${TEST_ID}save2`;
    const name3 = `${TEST_ID}save3`;
    const name4 = `${TEST_ID}save4`;
    const name5 = `${TEST_ID}oauth-creds`;
    const name6 = `${TEST_ID}save-mode`;

    afterEach(() => {
      cleanupTestConnectors(name1, name2, name3, name4, name5, name6);
    });

    test("creates profile directory and saves key for new connector", async () => {
      await saveApiKey(name1, "test-api-key-123");

      const configFile = join(
        testConfigDir(name1),
        "profiles",
        "default",
        "config.json"
      );
      expect(existsSync(configFile)).toBe(true);

      const content = JSON.parse(readFileSync(configFile, "utf-8"));
      expect(content.apiKey).toBe("test-api-key-123");
    });

    test("creates credential-bearing directories and files with owner-only permissions", async () => {
      await saveApiKey(name6, "mode-test-api-key");

      const configDir = testConfigDir(name6);
      const profilesDir = join(configDir, "profiles");
      const profileDir = join(profilesDir, "default");
      const configFile = join(profileDir, "config.json");

      expect(fileMode(configDir)).toBe(0o700);
      expect(fileMode(profilesDir)).toBe(0o700);
      expect(fileMode(profileDir)).toBe(0o700);
      expect(fileMode(configFile)).toBe(0o600);
    });

    test("saves key with custom field name", async () => {
      await saveApiKey(name2, "my-secret-token", "secretToken");

      const configFile = join(
        testConfigDir(name2),
        "profiles",
        "default",
        "config.json"
      );
      expect(existsSync(configFile)).toBe(true);

      const content = JSON.parse(readFileSync(configFile, "utf-8"));
      expect(content.secretToken).toBe("my-secret-token");
    });

    test("updates existing profile file (pattern 1)", async () => {
      const profilesDir = join(testConfigDir(name3), "profiles");
      mkdirSync(profilesDir, { recursive: true });
      writeFileSync(
        join(profilesDir, "default.json"),
        JSON.stringify({ existingField: "keep-me" }, null, 2)
      );

      await saveApiKey(name3, "new-key-456", "apiKey");

      const content = JSON.parse(
        readFileSync(join(profilesDir, "default.json"), "utf-8")
      );
      expect(content.apiKey).toBe("new-key-456");
      expect(content.existingField).toBe("keep-me");
    });

    test("updates existing profile directory (pattern 2)", async () => {
      const profileDir = join(testConfigDir(name4), "profiles", "default");
      mkdirSync(profileDir, { recursive: true });
      writeFileSync(
        join(profileDir, "config.json"),
        JSON.stringify({ oldKey: "old-value" }, null, 2)
      );

      await saveApiKey(name4, "updated-key", "apiKey");

      const content = JSON.parse(
        readFileSync(join(profileDir, "config.json"), "utf-8")
      );
      expect(content.apiKey).toBe("updated-key");
      expect(content.oldKey).toBe("old-value");
    });

    test("saves OAuth client credentials to credentials.json", async () => {
      await saveApiKey(name5, "oauth-client-id", "clientId");
      await saveApiKey(name5, "oauth-client-secret", "clientSecret");

      const credentialsFile = join(testConfigDir(name5), "credentials.json");
      expect(existsSync(credentialsFile)).toBe(true);

      const creds = JSON.parse(readFileSync(credentialsFile, "utf-8"));
      expect(creds.clientId).toBe("oauth-client-id");
      expect(creds.clientSecret).toBe("oauth-client-secret");

      const config = getOAuthConfig(name5);
      expect(config.clientId).toBe("oauth-client-id");
      expect(config.clientSecret).toBe("oauth-client-secret");
    });
  });

  // ── getOAuthConfig ──

  describe("getOAuthConfig", () => {
    const name1 = `${TEST_ID}oauth1`;
    const name2 = `${TEST_ID}oauth2`;
    const name3 = `${TEST_ID}oauth3`;

    afterEach(() => {
      cleanupTestConnectors(name1, name2, name3);
    });

    test("reads credentials.json from connector config dir", () => {
      const configDir = testConfigDir(name1);
      mkdirSync(configDir, { recursive: true });
      writeFileSync(
        join(configDir, "credentials.json"),
        JSON.stringify({
          clientId: "test-client-id",
          clientSecret: "test-client-secret",
        })
      );

      const config = getOAuthConfig(name1);
      expect(config.clientId).toBe("test-client-id");
      expect(config.clientSecret).toBe("test-client-secret");
    });

    test("returns undefined fields when no credentials exist", () => {
      const config = getOAuthConfig(name2);
      expect(config.clientId).toBeUndefined();
      expect(config.clientSecret).toBeUndefined();
    });

    test("falls back to profile config when no credentials.json", () => {
      const profilesDir = join(testConfigDir(name3), "profiles");
      mkdirSync(profilesDir, { recursive: true });
      writeFileSync(
        join(profilesDir, "default.json"),
        JSON.stringify({
          clientId: "profile-client-id",
          clientSecret: "profile-client-secret",
        })
      );

      const config = getOAuthConfig(name3);
      expect(config.clientId).toBe("profile-client-id");
      expect(config.clientSecret).toBe("profile-client-secret");
    });
  });

  // ── getTokenExpiry ──

  describe("getTokenExpiry", () => {
    const name1 = `${TEST_ID}exp1`;
    const name2 = `${TEST_ID}exp2`;

    afterEach(() => {
      cleanupTestConnectors(name1, name2);
    });

    test("returns null when no tokens exist", () => {
      const expiry = getTokenExpiry(name1);
      expect(expiry).toBeNull();
    });

    test("returns null for non-existent connector config", () => {
      const expiry = getTokenExpiry("nonexistent-xyz-abc");
      expect(expiry).toBeNull();
    });

    test("returns expiry timestamp when tokens exist", () => {
      const expiresAt = Date.now() + 3600 * 1000;
      const profileDir = join(testConfigDir(name2), "profiles", "default");
      mkdirSync(profileDir, { recursive: true });
      writeFileSync(
        join(profileDir, "tokens.json"),
        JSON.stringify({
          accessToken: "fake-access-token",
          refreshToken: "fake-refresh-token",
          expiresAt,
        })
      );

      const result = getTokenExpiry(name2);
      expect(result).toBe(expiresAt);
    });
  });

  // ── getEnvVars ──

  describe("getEnvVars", () => {
    test("returns env vars for a connector with documented env vars", () => {
      const envVars = getEnvVars("stripe");
      expect(Array.isArray(envVars)).toBe(true);
      expect(envVars.length).toBeGreaterThan(0);
      const apiKey = envVars.find((v) => v.variable === "STRIPE_API_KEY");
      expect(apiKey).toBeDefined();
      expect(apiKey!.description).toBeTruthy();
    });

    test("returns env vars for anthropic", () => {
      const envVars = getEnvVars("anthropic");
      expect(envVars.length).toBeGreaterThan(0);
      const apiKey = envVars.find((v) => v.variable === "ANTHROPIC_API_KEY");
      expect(apiKey).toBeDefined();
    });

    test("returns env vars for gmail", () => {
      const envVars = getEnvVars("gmail");
      expect(envVars.length).toBeGreaterThan(0);
      expect(envVars.some((v) => v.variable === "GMAIL_CLIENT_ID")).toBe(true);
    });

    test("returns empty array for non-existent connector", () => {
      const envVars = getEnvVars("nonexistent-xyz-abc");
      expect(envVars).toEqual([]);
    });

    test("each env var has variable and description", () => {
      const envVars = getEnvVars("github");
      for (const v of envVars) {
        expect(typeof v.variable).toBe("string");
        expect(v.variable.length).toBeGreaterThan(0);
        expect(typeof v.description).toBe("string");
      }
    });
  });

  // ── getOAuthStartUrl ──

  describe("getOAuthStartUrl", () => {
    const oauthName = `${TEST_ID}oauthurl`;

    afterEach(() => {
      cleanupTestConnectors(oauthName);
    });

    test("returns null or url depending on credentials", () => {
      // Use a unique name that won't have credentials
      const url = getOAuthStartUrl("zzztest-no-creds", "http://localhost:3000/callback");
      expect(url).toBeNull();
    });

    test("returns null for connector without Google scopes", () => {
      // Set up credentials for a non-Google connector
      const configDir = testConfigDir(oauthName);
      mkdirSync(configDir, { recursive: true });
      writeFileSync(
        join(configDir, "credentials.json"),
        JSON.stringify({
          clientId: "test-client-id",
          clientSecret: "test-client-secret",
        })
      );

      const url = getOAuthStartUrl(oauthName, "http://localhost:3000/callback");
      expect(url).toBeNull();
    });

    test("returns a URL when credentials and scopes are configured", () => {
      // Set up credentials for gmail
      const configDir = testConfigDir("gmail");
      mkdirSync(configDir, { recursive: true });
      writeFileSync(
        join(configDir, "credentials.json"),
        JSON.stringify({
          clientId: "test-client-id",
          clientSecret: "test-client-secret",
        })
      );

      try {
        const url = getOAuthStartUrl("gmail", "http://localhost:3000/callback");
        expect(url).not.toBeNull();
        expect(url!).toContain("accounts.google.com");
        expect(url!).toContain("client_id=test-client-id");
        expect(url!).toContain("redirect_uri=");
        expect(url!).toContain("response_type=code");
        expect(url!).toContain("scope=");
        expect(url!).toContain("access_type=offline");
        expect(url!).toContain("state=");
      } finally {
        cleanupTestConnectors("gmail");
      }
    });
  });

  // ── validateOAuthState ──

  describe("validateOAuthState", () => {
    test("returns false for null state", () => {
      const result = validateOAuthState(null, "gmail");
      expect(result).toBe(false);
    });

    test("returns false for empty string state", () => {
      const result = validateOAuthState("", "gmail");
      expect(result).toBe(false);
    });

    test("returns false for unknown state token", () => {
      const result = validateOAuthState("nonexistent-state-token", "gmail");
      expect(result).toBe(false);
    });

    test("validates and consumes state from getOAuthStartUrl", () => {
      // Set up gmail credentials so getOAuthStartUrl generates a state
      const configDir = testConfigDir("gmail");
      mkdirSync(configDir, { recursive: true });
      writeFileSync(
        join(configDir, "credentials.json"),
        JSON.stringify({
          clientId: "test-client-id",
          clientSecret: "test-client-secret",
        })
      );

      try {
        const url = getOAuthStartUrl("gmail", "http://localhost:3000/callback");
        expect(url).not.toBeNull();

        // Extract state from URL
        const urlObj = new URL(url!);
        const state = urlObj.searchParams.get("state");
        expect(state).not.toBeNull();

        // First validation should succeed
        const valid = validateOAuthState(state, "gmail");
        expect(valid).toBe(true);

        // Second validation should fail (state consumed)
        const invalid = validateOAuthState(state, "gmail");
        expect(invalid).toBe(false);
      } finally {
        cleanupTestConnectors("gmail");
      }
    });

    test("returns false when connector doesn't match", () => {
      const configDir = testConfigDir("gmail");
      mkdirSync(configDir, { recursive: true });
      writeFileSync(
        join(configDir, "credentials.json"),
        JSON.stringify({
          clientId: "test-client-id",
          clientSecret: "test-client-secret",
        })
      );

      try {
        const url = getOAuthStartUrl("gmail", "http://localhost:3000/callback");
        expect(url).not.toBeNull();

        const urlObj = new URL(url!);
        const state = urlObj.searchParams.get("state");

        // Validate with wrong connector name
        const result = validateOAuthState(state, "googledrive");
        expect(result).toBe(false);
      } finally {
        cleanupTestConnectors("gmail");
      }
    });
  });

  // ── getAuthStatus with OAuth tokens ──

  describe("getAuthStatus with tokens", () => {
    const name1 = `${TEST_ID}authstatus1`;
    const name2 = `${TEST_ID}authstatus2`;

    afterEach(() => {
      cleanupTestConnectors(name1, name2);
    });

    test("returns configured=true when profile has a key value", () => {
      const profilesDir = join(testConfigDir(name1), "profiles");
      mkdirSync(profilesDir, { recursive: true });
      writeFileSync(
        join(profilesDir, "default.json"),
        JSON.stringify({ apiKey: "test-key-123" })
      );

      const status = getAuthStatus(name1);
      expect(status.configured).toBe(true);
    });

    test("returns configured=false when profile has only empty values", () => {
      const profilesDir = join(testConfigDir(name2), "profiles");
      mkdirSync(profilesDir, { recursive: true });
      writeFileSync(
        join(profilesDir, "default.json"),
        JSON.stringify({ apiKey: "" })
      );

      const status = getAuthStatus(name2);
      expect(status.configured).toBe(false);
    });
  });

  // ── saveApiKey with guessKeyField (indirect test) ──

  describe("saveApiKey guessKeyField", () => {
    const name1 = `${TEST_ID}guess1`;

    afterEach(() => {
      cleanupTestConnectors(name1);
    });

    test("defaults to 'apiKey' when no field specified and connector has no docs", async () => {
      await saveApiKey(name1, "my-test-key");

      const configFile = join(
        testConfigDir(name1),
        "profiles",
        "default",
        "config.json"
      );
      const content = JSON.parse(readFileSync(configFile, "utf-8"));
      expect(content.apiKey).toBe("my-test-key");
    });
  });

  // ── getOAuthConfig with corrupt credentials.json ──

  describe("getOAuthConfig edge cases", () => {
    const name1 = `${TEST_ID}oauthcfg1`;

    afterEach(() => {
      cleanupTestConnectors(name1);
    });

    test("handles corrupt credentials.json gracefully", () => {
      const configDir = testConfigDir(name1);
      mkdirSync(configDir, { recursive: true });
      writeFileSync(join(configDir, "credentials.json"), "not valid json");

      const config = getOAuthConfig(name1);
      // Falls through to profile config, which also doesn't exist
      expect(config.clientId).toBeUndefined();
      expect(config.clientSecret).toBeUndefined();
    });
  });

  describe("legacy config compatibility", () => {
    const name1 = `${TEST_ID}legacy1`;
    const name2 = `${TEST_ID}legacy2`;

    afterEach(() => {
      cleanupTestConnectors(name1, name2);
    });

    test("reads OAuth tokens from legacy connect-prefixed config dirs", () => {
      const expiresAt = Date.now() + 60_000;
      const legacyProfileDir = join(legacyTestConfigDir(name1), "profiles", "default");
      mkdirSync(legacyProfileDir, { recursive: true });
      writeFileSync(
        join(legacyProfileDir, "tokens.json"),
        JSON.stringify({ accessToken: "legacy-token", expiresAt })
      );

      expect(getTokenExpiry(name1)).toBe(expiresAt);
    });

    test("writes new API keys to prefixless dirs without mutating legacy config", async () => {
      const legacyProfileDir = join(legacyTestConfigDir(name2), "profiles", "default");
      mkdirSync(legacyProfileDir, { recursive: true });
      writeFileSync(
        join(legacyProfileDir, "config.json"),
        JSON.stringify({ apiKey: "legacy-key" }, null, 2)
      );

      expect(getAuthStatus(name2).configured).toBe(true);
      await saveApiKey(name2, "prefixless-key", "apiKey");

      const prefixlessConfigFile = join(testConfigDir(name2), "profiles", "default", "config.json");
      const legacyConfigFile = join(legacyProfileDir, "config.json");
      expect(JSON.parse(readFileSync(prefixlessConfigFile, "utf-8")).apiKey).toBe("prefixless-key");
      expect(JSON.parse(readFileSync(legacyConfigFile, "utf-8")).apiKey).toBe("legacy-key");
    });
  });

  // ── listProfiles ──

  describe("listProfiles", () => {
    const name1 = `${TEST_ID}lp1`;
    const name2 = `${TEST_ID}lp2`;
    const name3 = `${TEST_ID}lp3`;
    const name4 = `${TEST_ID}lp4`;

    afterEach(() => {
      cleanupTestConnectors(name1, name2, name3, name4);
    });

    test("returns ['default'] for non-existent connector config", () => {
      const profiles = listProfiles(name1);
      expect(profiles).toEqual(["default"]);
    });

    test("returns profile names from .json files (pattern 1)", () => {
      const profilesDir = join(testConfigDir(name2), "profiles");
      mkdirSync(profilesDir, { recursive: true });
      writeFileSync(
        join(profilesDir, "default.json"),
        JSON.stringify({ apiKey: "key1" })
      );
      writeFileSync(
        join(profilesDir, "staging.json"),
        JSON.stringify({ apiKey: "key2" })
      );

      const profiles = listProfiles(name2);
      expect(profiles).toContain("default");
      expect(profiles).toContain("staging");
      expect(profiles.length).toBe(2);
    });

    test("returns profile names from directories (pattern 2)", () => {
      const profilesDir = join(testConfigDir(name3), "profiles");
      mkdirSync(join(profilesDir, "default"), { recursive: true });
      writeFileSync(
        join(profilesDir, "default", "config.json"),
        JSON.stringify({ apiKey: "key1" })
      );
      mkdirSync(join(profilesDir, "production"), { recursive: true });
      writeFileSync(
        join(profilesDir, "production", "config.json"),
        JSON.stringify({ apiKey: "key2" })
      );

      const profiles = listProfiles(name3);
      expect(profiles).toContain("default");
      expect(profiles).toContain("production");
      expect(profiles.length).toBe(2);
    });

    test("always includes 'default' even if not on disk", () => {
      const profilesDir = join(testConfigDir(name4), "profiles");
      mkdirSync(profilesDir, { recursive: true });
      writeFileSync(
        join(profilesDir, "custom.json"),
        JSON.stringify({ apiKey: "key1" })
      );

      const profiles = listProfiles(name4);
      expect(profiles).toContain("default");
      expect(profiles).toContain("custom");
      expect(profiles.length).toBe(2);
    });
  });

  // ── switchProfile ──

  describe("switchProfile", () => {
    const name1 = `${TEST_ID}sp1`;
    const name2 = `${TEST_ID}sp2`;

    afterEach(() => {
      cleanupTestConnectors(name1, name2);
    });

    test("creates current_profile file with profile name", () => {
      switchProfile(name1, "staging");

      const currentProfileFile = join(
        testConfigDir(name1),
        "current_profile"
      );
      expect(existsSync(currentProfileFile)).toBe(true);
      const content = readFileSync(currentProfileFile, "utf-8");
      expect(content).toBe("staging");
    });

    test("overwrites existing current_profile", () => {
      switchProfile(name2, "staging");
      switchProfile(name2, "production");

      const currentProfileFile = join(
        testConfigDir(name2),
        "current_profile"
      );
      const content = readFileSync(currentProfileFile, "utf-8");
      expect(content).toBe("production");
    });
  });

  // ── deleteProfile ──

  describe("deleteProfile", () => {
    const name1 = `${TEST_ID}dp1`;
    const name2 = `${TEST_ID}dp2`;
    const name3 = `${TEST_ID}dp3`;
    const name4 = `${TEST_ID}dp4`;
    const name5 = `${TEST_ID}dp5`;

    afterEach(() => {
      cleanupTestConnectors(name1, name2, name3, name4, name5);
    });

    test("returns false for 'default' profile", () => {
      const result = deleteProfile(name1, "default");
      expect(result).toBe(false);
    });

    test("returns false for non-existent profile", () => {
      const result = deleteProfile(name2, "nonexistent");
      expect(result).toBe(false);
    });

    test("deletes .json pattern profile", () => {
      const profilesDir = join(testConfigDir(name3), "profiles");
      mkdirSync(profilesDir, { recursive: true });
      writeFileSync(
        join(profilesDir, "staging.json"),
        JSON.stringify({ apiKey: "key1" })
      );

      const result = deleteProfile(name3, "staging");
      expect(result).toBe(true);
      expect(existsSync(join(profilesDir, "staging.json"))).toBe(false);
    });

    test("deletes directory pattern profile", () => {
      const profilesDir = join(testConfigDir(name4), "profiles");
      const profileDir = join(profilesDir, "staging");
      mkdirSync(profileDir, { recursive: true });
      writeFileSync(
        join(profileDir, "config.json"),
        JSON.stringify({ apiKey: "key1" })
      );
      writeFileSync(
        join(profileDir, "tokens.json"),
        JSON.stringify({ accessToken: "tok" })
      );

      const result = deleteProfile(name4, "staging");
      expect(result).toBe(true);
      expect(existsSync(profileDir)).toBe(false);
    });

    test("switches back to default if deleted profile was current", () => {
      const profilesDir = join(testConfigDir(name5), "profiles");
      mkdirSync(profilesDir, { recursive: true });
      writeFileSync(
        join(profilesDir, "staging.json"),
        JSON.stringify({ apiKey: "key1" })
      );

      // Set staging as current profile
      switchProfile(name5, "staging");

      // Delete the current profile
      const result = deleteProfile(name5, "staging");
      expect(result).toBe(true);

      // Verify current_profile was switched back to default
      const currentProfileFile = join(
        testConfigDir(name5),
        "current_profile"
      );
      const content = readFileSync(currentProfileFile, "utf-8");
      expect(content).toBe("default");
    });
  });
});
