import { describe, expect, test } from "bun:test";
import { localRoutingTestEnv } from "./local-routing-env.js";

describe("localRoutingTestEnv", () => {
  test("overrides inherited live routing credentials with an explicit local baseline", () => {
    const env = localRoutingTestEnv();

    expect(env.HASNA_TODOS_STORAGE_MODE).toBe("local");
    expect(env.TODOS_STORAGE_MODE).toBe("local");
    expect(env.HASNA_TODOS_DB_PATH).toBe("");
    expect(env.HASNA_TODOS_API_URL).toBe("");
    expect(env.HASNA_TODOS_API_KEY).toBe("");
    expect(env.TODOS_API_URL).toBe("");
    expect(env.TODOS_API_KEY).toBe("");
  });

  test("applies explicit remote and hybrid test overrides after local defaults", () => {
    const env = localRoutingTestEnv({
      HASNA_TODOS_STORAGE_MODE: "hybrid",
      HASNA_TODOS_API_URL: "http://127.0.0.1:3901",
      HASNA_TODOS_API_KEY: "test-key",
    });

    expect(env.HASNA_TODOS_STORAGE_MODE).toBe("hybrid");
    expect(env.HASNA_TODOS_API_URL).toBe("http://127.0.0.1:3901");
    expect(env.HASNA_TODOS_API_KEY).toBe("test-key");
  });

  test("inherits only runtime launch variables from a poisoned ambient environment", () => {
    const env = localRoutingTestEnv({}, {
      PATH: "/safe/test-bin",
      HOME: "/outside/live-home",
      BASH_ENV: "/outside/bash-init",
      ENV: "/outside/sh-init",
      HASNA_TODOS_API_URL: "https://todos.example.invalid",
      TODOS_API_URL: "https://legacy.example.invalid",
      DOTENV_CONFIG_PATH: "/outside/live.env",
      HTTPS_PROXY: "http://proxy.example.invalid:8080",
      AWS_PROFILE: "production",
    });

    expect(env.PATH).toBe("/safe/test-bin");
    expect(env).not.toHaveProperty("HOME");
    expect(env).not.toHaveProperty("BASH_ENV");
    expect(env).not.toHaveProperty("ENV");
    expect(env).not.toHaveProperty("DOTENV_CONFIG_PATH");
    expect(env).not.toHaveProperty("HTTPS_PROXY");
    expect(env).not.toHaveProperty("AWS_PROFILE");
    expect(env.HASNA_TODOS_API_URL).toBe("");
    expect(env.TODOS_API_URL).toBe("");
  });
});
