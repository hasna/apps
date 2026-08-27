import { describe, test, expect } from "bun:test";
import { buildEnvWithCredentials } from "./runner.js";
import { getAuthStatus } from "../server/auth.js";

describe("buildEnvWithCredentials oauth coverage", () => {
  test("does not inject oauth env vars for apikey connectors", () => {
    const env = buildEnvWithCredentials("anthropic", {});
    expect(env.ANTHROPIC_API_KEY).toBeUndefined();
    expect(env.ANTHROPIC_CLIENT_ID).toBeUndefined();
  });

  test("maps alternative api key env patterns for bearer connectors", () => {
    const env = buildEnvWithCredentials("anthropic", {
      ANTHROPIC_TOKEN: "token-from-alt-env",
    });
    expect(env.ANTHROPIC_API_KEY).toBe("token-from-alt-env");
  });
});

describe("getAuthStatus apikey connectors", () => {
  test("marks bearer connector configured when profile key exists", async () => {
    const { saveApiKey } = await import("../server/auth.js");
    const { join } = await import("path");
    const { rmSync, existsSync, readFileSync, writeFileSync } = await import("fs");
    const { connectorsHome } = await import("./paths.js");

    const credsFile = join(connectorsHome(), "connect-anthropic", "profiles", "default", "config.json");
    const hadConfig = existsSync(credsFile);
    const previous = hadConfig ? readFileSync(credsFile, "utf-8") : null;

    try {
      await saveApiKey("anthropic", "profile-key-value");
      const status = getAuthStatus("anthropic");
      expect(status.type).toBe("bearer");
      expect(status.configured).toBe(true);
    } finally {
      if (previous !== null) writeFileSync(credsFile, previous);
      else {
        const dir = join(connectorsHome(), "connect-anthropic");
        if (existsSync(dir)) rmSync(dir, { recursive: true });
      }
    }
  });
});
