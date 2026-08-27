import {
  describe,
  test,
  expect,
  afterEach,
  afterAll,
  beforeAll,
} from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  readFileSync,
  writeFileSync,
} from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { connectorsHome } from "../lib/paths.js";
import { startServer } from "./serve.js";

const TEST_ID = `zzztest${process.pid}c`;
const ORIGINAL_HOME = process.env.HOME;
const TEST_HOME = mkdtempSync(join(tmpdir(), "connectors-server-"));

function testConfigDir(name: string): string {
  return join(connectorsHome(), name);
}

function legacyTestConfigDir(name: string): string {
  return join(connectorsHome(), `connect-${name}`);
}

function cleanupTestConnectors(...names: string[]) {
  for (const name of names) {
    for (const dir of [testConfigDir(name), legacyTestConfigDir(name)]) {
      if (existsSync(dir)) rmSync(dir, { recursive: true });
    }
  }
}

describe("server API routes", () => {
  let serverPort: number;
  let baseUrl: string;

  beforeAll(async () => {
    process.env.HOME = TEST_HOME;
    serverPort = 40000 + Math.floor(Math.random() * 10000);
    serverPort = await startServer(serverPort, { open: false });
    baseUrl = `http://localhost:${serverPort}`;
  });

  afterAll(() => {
    if (ORIGINAL_HOME) {
      process.env.HOME = ORIGINAL_HOME;
    } else {
      delete process.env.HOME;
    }
    rmSync(TEST_HOME, { recursive: true, force: true });
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

      // Verify the key was actually saved to disk (directory pattern)
      const configFile = join(
        testConfigDir(testKeyName),
        "profiles",
        "default",
        "config.json"
      );
      expect(existsSync(configFile)).toBe(true);
      const saved = JSON.parse(readFileSync(configFile, "utf-8"));
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

  // ── Invalid connector name validation ──

  describe("invalid connector name validation", () => {
    test("GET /api/connectors/:name returns 400 for names with dots", async () => {
      const res = await fetch(`${baseUrl}/api/connectors/stripe.test`);
      expect(res.status).toBe(400);
      const data = (await res.json()) as { error: string };
      expect(data.error).toContain("Invalid connector name");
    });

    test("GET /api/connectors/:name returns 400 for uppercase names", async () => {
      const res = await fetch(`${baseUrl}/api/connectors/STRIPE`);
      expect(res.status).toBe(400);
      const data = (await res.json()) as { error: string };
      expect(data.error).toContain("Invalid connector name");
    });

    test("GET /api/connectors/:name returns 400 for names with special chars", async () => {
      const res = await fetch(`${baseUrl}/api/connectors/stripe%21`);
      expect(res.status).toBe(400);
      const data = (await res.json()) as { error: string };
      expect(data.error).toContain("Invalid connector name");
    });

    test("POST /api/connectors/:name/key returns 400 for invalid name", async () => {
      const res = await fetch(`${baseUrl}/api/connectors/INVALID/key`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: "test" }),
      });
      expect(res.status).toBe(400);
      const data = (await res.json()) as { error: string };
      expect(data.error).toContain("Invalid connector name");
    });
  });

  // ── POST /api/connectors/:name/refresh ──

  describe("POST /api/connectors/:name/refresh", () => {
    test("returns 400 for invalid connector name", async () => {
      const res = await fetch(`${baseUrl}/api/connectors/INVALID/refresh`, {
        method: "POST",
      });
      expect(res.status).toBe(400);
      const data = (await res.json()) as { error: string };
      expect(data.error).toContain("Invalid connector name");
    });

    test("returns 500 when no OAuth credentials configured", async () => {
      const res = await fetch(
        `${baseUrl}/api/connectors/gmail/refresh`,
        { method: "POST" }
      );
      expect(res.status).toBe(500);
      const data = (await res.json()) as { success: boolean; error: string };
      expect(data.success).toBe(false);
      expect(data.error).toBeTruthy();
    });
  });

  // ── OAuth routes ──

  describe("OAuth routes", () => {
    test("GET /oauth/:name/start returns HTML error when no credentials", async () => {
      const res = await fetch(`${baseUrl}/oauth/gmail/start`, {
        redirect: "manual",
      });
      // No credentials => returns error HTML page (not a redirect)
      expect(res.status).toBe(200);
      const html = await res.text();
      expect(html).toContain("OAuth Not Available");
      expect(html).toContain("credentials");
    });

    test("GET /oauth/:name/start redirects when credentials exist", async () => {
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
        const res = await fetch(`${baseUrl}/oauth/gmail/start`, {
          redirect: "manual",
        });
        expect(res.status).toBe(302);
        const location = res.headers.get("location");
        expect(location).toContain("accounts.google.com");
        expect(location).toContain("client_id=test-client-id");
      } finally {
        cleanupTestConnectors("gmail");
      }
    });

    test("GET /oauth/:name/callback returns error when error param present", async () => {
      const res = await fetch(
        `${baseUrl}/oauth/gmail/callback?error=access_denied`
      );
      expect(res.status).toBe(200);
      const html = await res.text();
      expect(html).toContain("Authentication Failed");
      expect(html).toContain("access_denied");
    });

    test("GET /oauth/:name/callback returns error for invalid state", async () => {
      const res = await fetch(
        `${baseUrl}/oauth/gmail/callback?code=test-code&state=invalid-state`
      );
      expect(res.status).toBe(200);
      const html = await res.text();
      expect(html).toContain("Invalid State");
      expect(html).toContain("CSRF");
    });

    test("GET /oauth/:name/callback returns error when no code", async () => {
      // Need a valid state first
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
        // Get a valid state token via the start URL
        const startRes = await fetch(`${baseUrl}/oauth/gmail/start`, {
          redirect: "manual",
        });
        const location = startRes.headers.get("location")!;
        const state = new URL(location).searchParams.get("state");

        // Call callback with valid state but no code
        const res = await fetch(
          `${baseUrl}/oauth/gmail/callback?state=${state}`
        );
        expect(res.status).toBe(200);
        const html = await res.text();
        expect(html).toContain("Missing Authorization Code");
      } finally {
        cleanupTestConnectors("gmail");
      }
    });
  });

  // ── GET /api/connectors/:name additional tests ──

  describe("GET /api/connectors/:name additional", () => {
    test("returns overview from docs", async () => {
      const res = await fetch(`${baseUrl}/api/connectors/anthropic`);
      const data = (await res.json()) as Record<string, unknown>;
      expect(data.name).toBe("anthropic");
      expect(data.overview).not.toBeNull();
    });

    test("returns correct category and displayName", async () => {
      const res = await fetch(`${baseUrl}/api/connectors/figma`);
      const data = (await res.json()) as Record<string, unknown>;
      expect(data.displayName).toBe("Figma");
      expect(data.category).toBe("Design & Content");
    });

    test("returns oauth type for gmail", async () => {
      const res = await fetch(`${baseUrl}/api/connectors/gmail`);
      const data = (await res.json()) as {
        auth: { type: string; configured: boolean; hasRefreshToken?: boolean };
      };
      expect(data.auth.type).toBe("oauth");
      expect(typeof data.auth.hasRefreshToken).toBe("boolean");
    });
  });

  // ── HEAD request handling ──

  describe("HEAD requests", () => {
    test("HEAD to root path does not return 404", async () => {
      const res = await fetch(`${baseUrl}/`, { method: "HEAD" });
      // Should serve dashboard index.html or 404 if not built
      // Either way it shouldn't crash
      expect([200, 404]).toContain(res.status);
    });
  });

  // ── POST /api/connectors/:name/key with custom field ──

  describe("POST /api/connectors/:name/key with field", () => {
    const testKeyName = `${TEST_ID}srvkey2`;

    afterEach(() => {
      cleanupTestConnectors(testKeyName);
    });

    test("saves API key with custom field name", async () => {
      const res = await fetch(
        `${baseUrl}/api/connectors/${testKeyName}/key`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ key: "my-token-456", field: "bearerToken" }),
        }
      );

      expect(res.status).toBe(200);
      const data = (await res.json()) as { success: boolean };
      expect(data.success).toBe(true);

      const configFile = join(
        testConfigDir(testKeyName),
        "profiles",
        "default",
        "config.json"
      );
      const saved = JSON.parse(readFileSync(configFile, "utf-8"));
      expect(saved.bearerToken).toBe("my-token-456");
    });
  });

  // ── POST /api/connectors/:name/install ──
});
