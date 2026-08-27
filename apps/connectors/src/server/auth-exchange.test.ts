import { afterEach, describe, expect, mock, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { connectorsHome } from "../lib/paths.js";
import { exchangeOAuthCode } from "./auth.js";

const TEST_ID = `zzztest${process.pid}`;
const originalFetch = global.fetch;

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

afterEach(() => {
  global.fetch = originalFetch;
  cleanupTestConnectors(`${TEST_ID}exchange`);
});

describe("exchangeOAuthCode", () => {
  test("exchanges authorization code for tokens and persists them", async () => {
    const name = `${TEST_ID}exchange`;
    const profileDir = join(testConfigDir(name), "profiles", "default");
    mkdirSync(profileDir, { recursive: true });
    writeFileSync(
      join(testConfigDir(name), "credentials.json"),
      JSON.stringify({
        clientId: "exchange-client-id",
        clientSecret: "exchange-client-secret",
      })
    );

    global.fetch = mock(async (_url, init) => {
      const body = new URLSearchParams(String(init?.body));
      expect(body.get("grant_type")).toBe("authorization_code");
      expect(body.get("code")).toBe("auth-code-123");
      expect(body.get("redirect_uri")).toBe("http://localhost:9876/callback");
      expect(body.get("client_id")).toBe("exchange-client-id");
      expect(body.get("client_secret")).toBe("exchange-client-secret");

      return new Response(
        JSON.stringify({
          access_token: "exchanged-access-token",
          refresh_token: "exchanged-refresh-token",
          expires_in: 3600,
          token_type: "Bearer",
          scope: "https://mail.google.com/",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }) as unknown as typeof fetch;

    const tokens = await exchangeOAuthCode(
      name,
      "auth-code-123",
      "http://localhost:9876/callback"
    );

    expect(tokens.accessToken).toBe("exchanged-access-token");
    expect(tokens.refreshToken).toBe("exchanged-refresh-token");
    expect(tokens.tokenType).toBe("Bearer");

    const saved = JSON.parse(readFileSync(join(profileDir, "tokens.json"), "utf-8"));
    expect(saved.accessToken).toBe("exchanged-access-token");
    expect(saved.refreshToken).toBe("exchanged-refresh-token");
  });

  test("throws when token exchange fails", async () => {
    const name = `${TEST_ID}exchange`;
    const profileDir = join(testConfigDir(name), "profiles", "default");
    mkdirSync(profileDir, { recursive: true });
    writeFileSync(
      join(testConfigDir(name), "credentials.json"),
      JSON.stringify({
        clientId: "exchange-client-id",
        clientSecret: "exchange-client-secret",
      })
    );

    global.fetch = mock(async () =>
      new Response(
        JSON.stringify({
          error: "invalid_grant",
          error_description: "Code was already redeemed.",
        }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      )
    ) as unknown as typeof fetch;

    await expect(
      exchangeOAuthCode(name, "bad-code", "http://localhost:9876/callback")
    ).rejects.toThrow("Token exchange failed");
  });

  test("throws when OAuth client credentials are missing", async () => {
    await expect(
      exchangeOAuthCode(`${TEST_ID}exchange`, "code", "http://localhost/callback")
    ).rejects.toThrow("OAuth credentials not configured");
  });
});
