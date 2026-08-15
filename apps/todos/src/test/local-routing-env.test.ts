import { describe, expect, test } from "bun:test";
import { localRoutingTestEnv } from "./local-routing-env.fixture.test.js";

describe("localRoutingTestEnv", () => {
  test("overrides inherited live routing credentials with an explicit local baseline", () => {
    const env = localRoutingTestEnv();

    expect("HASNA_TODOS_STORAGE_MODE" in env).toBe(false);
    expect("TODOS_STORAGE_MODE" in env).toBe(false);
    expect("HASNA_TODOS_MODE" in env).toBe(false);
    expect("TODOS_MODE" in env).toBe(false);
    expect(env.HASNA_TODOS_DB_PATH).toBe("");
    expect(env.HASNA_TODOS_API_URL).toBe("");
    expect(env.HASNA_TODOS_API_KEY).toBe("");
    expect(env.TODOS_API_URL).toBe("");
    expect(env.TODOS_API_KEY).toBe("");
  });

  test("applies explicit remote overrides after local defaults", () => {
    const env = localRoutingTestEnv({
      HASNA_TODOS_API_URL: "http://127.0.0.1:3901",
      HASNA_TODOS_API_KEY: "test-key",
    });

    expect(env.HASNA_TODOS_API_URL).toBe("http://127.0.0.1:3901");
    expect(env.HASNA_TODOS_API_KEY).toBe("test-key");
    expect("HASNA_TODOS_STORAGE_MODE" in env).toBe(false);
  });
});
