import { afterEach, describe, expect, mock, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { refreshOAuthToken } from "./auth.js";
import { connectorsHome } from "../lib/paths.js";

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
  cleanupTestConnectors(`${TEST_ID}refresh`);
});

describe("refreshOAuthToken", () => {
  test("refreshes access token using stored refresh token and credentials", async () => {
    const name = `${TEST_ID}refresh`;
    const profileDir = join(testConfigDir(name), "profiles", "default");
    mkdirSync(profileDir, { recursive: true });
    writeFileSync(
      join(testConfigDir(name), "credentials.json"),
      JSON.stringify({
        clientId: "refresh-client-id",
        clientSecret: "refresh-client-secret",
      })
    );
    writeFileSync(
      join(profileDir, "tokens.json"),
      JSON.stringify({
        accessToken: "old-access-token",
        refreshToken: "stored-refresh-token",
        expiresAt: Date.now() - 60_000,
      })
    );

    global.fetch = mock(async (_url, init) => {
      const body = new URLSearchParams(String(init?.body));
      expect(body.get("grant_type")).toBe("refresh_token");
      expect(body.get("refresh_token")).toBe("stored-refresh-token");
      expect(body.get("client_id")).toBe("refresh-client-id");
      expect(body.get("client_secret")).toBe("refresh-client-secret");

      return new Response(
        JSON.stringify({
          access_token: "new-access-token",
          expires_in: 3600,
          token_type: "Bearer",
          scope: "https://mail.google.com/",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }) as unknown as typeof fetch;

    const tokens = await refreshOAuthToken(name);

    expect(tokens.accessToken).toBe("new-access-token");
    expect(tokens.refreshToken).toBe("stored-refresh-token");
    expect(tokens.expiresAt).toBeGreaterThan(Date.now());

    const saved = JSON.parse(readFileSync(join(profileDir, "tokens.json"), "utf-8"));
    expect(saved.accessToken).toBe("new-access-token");
  });

  test("throws when refresh token is missing", async () => {
    const name = `${TEST_ID}refresh`;
    const profileDir = join(testConfigDir(name), "profiles", "default");
    mkdirSync(profileDir, { recursive: true });
    writeFileSync(
      join(testConfigDir(name), "credentials.json"),
      JSON.stringify({
        clientId: "refresh-client-id",
        clientSecret: "refresh-client-secret",
      })
    );
    writeFileSync(
      join(profileDir, "tokens.json"),
      JSON.stringify({
        accessToken: "old-access-token",
        expiresAt: Date.now() - 60_000,
      })
    );

    await expect(refreshOAuthToken(name)).rejects.toThrow("No refresh token available");
  });

  test("throws when OAuth client credentials are missing", async () => {
    const name = `${TEST_ID}refresh`;
    const profileDir = join(testConfigDir(name), "profiles", "default");
    mkdirSync(profileDir, { recursive: true });
    writeFileSync(
      join(profileDir, "tokens.json"),
      JSON.stringify({
        accessToken: "old-access-token",
        refreshToken: "stored-refresh-token",
        expiresAt: Date.now() - 60_000,
      })
    );

    await expect(refreshOAuthToken(name)).rejects.toThrow("OAuth credentials not configured");
  });
});
