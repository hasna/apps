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
  rmSync,
  readFileSync,
  writeFileSync,
} from "fs";
import { join } from "path";
import { homedir } from "os";
import {
  getAuthType,
  getAuthStatus,
  saveApiKey,
  getOAuthConfig,
  getTokenExpiry,
} from "./auth.js";
import { startServer } from "./serve.js";

// ── Test isolation strategy ──
// Bun's os.homedir() does not respect runtime changes to process.env.HOME,
// so we write to the real ~/.connect/ directory using unique test connector
// names (prefixed with "zzztest") that are cleaned up after each test.

const HOME = homedir();
const TEST_ID = `zzztest${process.pid}`;

/** Get the real ~/.connect/connect-<name> path */
function testConfigDir(name: string): string {
  return join(HOME, ".connect", `connect-${name}`);
}

/** Clean up test connector directories from ~/.connect/ */
function cleanupTestConnectors(...names: string[]) {
  for (const name of names) {
    const dir = testConfigDir(name);
    if (existsSync(dir)) {
      rmSync(dir, { recursive: true });
    }
  }
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
      process.env.STRIPE_API_KEY = "sk_test_fake_key";
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

    test("returns unconfigured oauth status when no tokens exist", () => {
      const status = getAuthStatus("gmail");
      expect(status.type).toBe("oauth");
      expect(status.configured).toBe(false);
      expect(status.hasRefreshToken).toBe(false);
      expect(status.tokenExpiry).toBeUndefined();
    });

    test("envVars array includes expected variables for stripe", () => {
      const status = getAuthStatus("stripe");
      expect(status.envVars.length).toBeGreaterThan(0);
      const variables = status.envVars.map((v) => v.variable);
      expect(variables).toContain("STRIPE_API_KEY");
    });

    test("envVars show set=false when env vars are not set", () => {
      const originalValue = process.env.ANTHROPIC_API_KEY;
      delete process.env.ANTHROPIC_API_KEY;
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
      }
    });
  });

  // ── saveApiKey ──
  // Uses real ~/.connect/ with unique test connector names for isolation.

  describe("saveApiKey", () => {
    const name1 = `${TEST_ID}save1`;
    const name2 = `${TEST_ID}save2`;
    const name3 = `${TEST_ID}save3`;
    const name4 = `${TEST_ID}save4`;

    afterEach(() => {
      cleanupTestConnectors(name1, name2, name3, name4);
    });

    test("creates profile directory and saves key for new connector", () => {
      saveApiKey(name1, "test-api-key-123");

      const profileFile = join(
        testConfigDir(name1),
        "profiles",
        "default.json"
      );
      expect(existsSync(profileFile)).toBe(true);

      const content = JSON.parse(readFileSync(profileFile, "utf-8"));
      expect(content.apiKey).toBe("test-api-key-123");
    });

    test("saves key with custom field name", () => {
      saveApiKey(name2, "my-secret-token", "secretToken");

      const profileFile = join(
        testConfigDir(name2),
        "profiles",
        "default.json"
      );
      expect(existsSync(profileFile)).toBe(true);

      const content = JSON.parse(readFileSync(profileFile, "utf-8"));
      expect(content.secretToken).toBe("my-secret-token");
    });

    test("updates existing profile file (pattern 1)", () => {
      const profilesDir = join(testConfigDir(name3), "profiles");
      mkdirSync(profilesDir, { recursive: true });
      writeFileSync(
        join(profilesDir, "default.json"),
        JSON.stringify({ existingField: "keep-me" }, null, 2)
      );

      saveApiKey(name3, "new-key-456", "apiKey");

      const content = JSON.parse(
        readFileSync(join(profilesDir, "default.json"), "utf-8")
      );
      expect(content.apiKey).toBe("new-key-456");
      expect(content.existingField).toBe("keep-me");
    });

    test("updates existing profile directory (pattern 2)", () => {
      const profileDir = join(testConfigDir(name4), "profiles", "default");
      mkdirSync(profileDir, { recursive: true });
      writeFileSync(
        join(profileDir, "config.json"),
        JSON.stringify({ oldKey: "old-value" }, null, 2)
      );

      saveApiKey(name4, "updated-key", "apiKey");

      const content = JSON.parse(
        readFileSync(join(profileDir, "config.json"), "utf-8")
      );
      expect(content.apiKey).toBe("updated-key");
      expect(content.oldKey).toBe("old-value");
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
});

// ============================================================================
// Server API Route Tests
// ============================================================================

describe("server API routes", () => {
  let serverPort: number;
  let baseUrl: string;

  beforeAll(async () => {
    // Pick a random high port to avoid conflicts
    serverPort = 30000 + Math.floor(Math.random() * 20000);
    baseUrl = `http://localhost:${serverPort}`;

    // Start the real server with browser open disabled
    await startServer(serverPort, { open: false });
  });

  // ── GET /api/connectors ──

  describe("GET /api/connectors", () => {
    test("returns an array of connectors", async () => {
      const res = await fetch(`${baseUrl}/api/connectors`);
      expect(res.status).toBe(200);

      const data = (await res.json()) as Array<Record<string, unknown>>;
      expect(Array.isArray(data)).toBe(true);
      expect(data.length).toBeGreaterThan(0);
    });

    test("each connector has required fields", async () => {
      const res = await fetch(`${baseUrl}/api/connectors`);
      const data = (await res.json()) as Array<Record<string, unknown>>;

      const first = data[0];
      expect(first).toHaveProperty("name");
      expect(first).toHaveProperty("displayName");
      expect(first).toHaveProperty("description");
      expect(first).toHaveProperty("category");
      expect(first).toHaveProperty("installed");
      expect(first).toHaveProperty("auth");
    });

    test("response has correct content-type header", async () => {
      const res = await fetch(`${baseUrl}/api/connectors`);
      expect(res.headers.get("content-type")).toBe("application/json");
    });

    test("includes known connectors like stripe and anthropic", async () => {
      const res = await fetch(`${baseUrl}/api/connectors`);
      const data = (await res.json()) as Array<{ name: string }>;

      const names = data.map((c) => c.name);
      expect(names).toContain("stripe");
      expect(names).toContain("anthropic");
      expect(names).toContain("gmail");
    });
  });

  // ── GET /api/connectors/:name ──

  describe("GET /api/connectors/:name", () => {
    test("returns connector details for a valid name", async () => {
      const res = await fetch(`${baseUrl}/api/connectors/stripe`);
      expect(res.status).toBe(200);

      const data = (await res.json()) as Record<string, unknown>;
      expect(data.name).toBe("stripe");
      expect(data.displayName).toBe("Stripe");
      expect(data).toHaveProperty("auth");
      expect(data).toHaveProperty("overview");
    });

    test("returns 404 for non-existent connector", async () => {
      const res = await fetch(
        `${baseUrl}/api/connectors/nonexistent-xyz-abc`
      );
      expect(res.status).toBe(404);

      const data = (await res.json()) as { error: string };
      expect(data.error).toContain("not found");
    });

    test("returns auth status with type field", async () => {
      const res = await fetch(`${baseUrl}/api/connectors/stripe`);
      const data = (await res.json()) as {
        auth: { type: string; configured: boolean };
      };

      expect(data.auth).toBeDefined();
      expect(data.auth.type).toBe("bearer");
      expect(typeof data.auth.configured).toBe("boolean");
    });
  });

  // ── POST /api/connectors/:name/key ──

  describe("POST /api/connectors/:name/key", () => {
    const testKeyName = `${TEST_ID}srvkey`;

    afterEach(() => {
      cleanupTestConnectors(testKeyName);
    });

    test("saves API key and returns success", async () => {
      const res = await fetch(
        `${baseUrl}/api/connectors/${testKeyName}/key`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ key: "sk_test_key_12345" }),
        }
      );

      expect(res.status).toBe(200);
      const data = (await res.json()) as { success: boolean };
      expect(data.success).toBe(true);

      // Verify the key was actually saved to disk
      const profileFile = join(
        testConfigDir(testKeyName),
        "profiles",
        "default.json"
      );
      expect(existsSync(profileFile)).toBe(true);
      const saved = JSON.parse(readFileSync(profileFile, "utf-8"));
      expect(saved.apiKey).toBe("sk_test_key_12345");
    });

    test("returns 400 when key is missing from body", async () => {
      const res = await fetch(`${baseUrl}/api/connectors/stripe/key`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ field: "apiKey" }),
      });

      expect(res.status).toBe(400);
      const data = (await res.json()) as { error: string };
      expect(data.error).toContain("Missing 'key'");
    });

    test("returns 400 when key is empty string", async () => {
      const res = await fetch(`${baseUrl}/api/connectors/stripe/key`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: "" }),
      });

      expect(res.status).toBe(400);
      const data = (await res.json()) as { error: string };
      expect(data.error).toContain("Missing 'key'");
    });

    test("returns 500 for invalid JSON body", async () => {
      const res = await fetch(`${baseUrl}/api/connectors/stripe/key`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "not valid json",
      });

      expect(res.status).toBe(500);
    });
  });

  // ── 404 for unknown routes ──

  describe("unknown routes", () => {
    test("GET /api/nonexistent does not return valid connector API data", async () => {
      const res = await fetch(`${baseUrl}/api/nonexistent`);
      // If dashboard is built, SPA fallback may serve index.html (200).
      // If not built, server returns JSON { error: "Not found" } with 404.
      const text = await res.text();
      try {
        const data = JSON.parse(text);
        if (data.error) {
          expect(data.error).toContain("Not found");
        }
      } catch {
        // HTML response from SPA fallback is acceptable
        expect(text).toContain("<!DOCTYPE");
      }
    });

    test("POST to unknown path returns 404 JSON", async () => {
      const res = await fetch(`${baseUrl}/api/unknown/route`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ test: true }),
      });
      expect(res.status).toBe(404);
      const data = (await res.json()) as { error: string };
      expect(data.error).toContain("Not found");
    });
  });

  // ── CORS / OPTIONS ──

  describe("OPTIONS (CORS)", () => {
    test("returns CORS headers for OPTIONS request", async () => {
      const res = await fetch(`${baseUrl}/api/connectors`, {
        method: "OPTIONS",
      });

      expect(res.status).toBe(200);

      const origin = res.headers.get("Access-Control-Allow-Origin");
      expect(origin).toBeDefined();
      expect(origin).toContain("localhost");

      expect(res.headers.get("Access-Control-Allow-Methods")).toContain(
        "GET"
      );
      expect(res.headers.get("Access-Control-Allow-Methods")).toContain(
        "POST"
      );
      expect(res.headers.get("Access-Control-Allow-Methods")).toContain(
        "OPTIONS"
      );
      expect(res.headers.get("Access-Control-Allow-Headers")).toContain(
        "Content-Type"
      );
    });

    test("OPTIONS returns empty body", async () => {
      const res = await fetch(`${baseUrl}/api/connectors`, {
        method: "OPTIONS",
      });

      const body = await res.text();
      expect(body).toBe("");
    });
  });

  // ── Response headers ──

  describe("response headers", () => {
    test("JSON responses include Access-Control-Allow-Origin with port", async () => {
      const res = await fetch(`${baseUrl}/api/connectors`);
      const origin = res.headers.get("Access-Control-Allow-Origin");
      expect(origin).toBeDefined();
      expect(origin).toContain("localhost");
      expect(origin).toContain(String(serverPort));
    });

    test("JSON responses include security headers", async () => {
      const res = await fetch(`${baseUrl}/api/connectors`);
      expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
      expect(res.headers.get("X-Frame-Options")).toBe("DENY");
    });
  });
});
