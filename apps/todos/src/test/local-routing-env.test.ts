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
    // The shared-store pointers are REMOVED, not blanked: the @hasna/contracts
    // resolver refuses a declared-but-blank credential or authority loudly
    // instead of reading it as unset (hasna/apps#1720).
    expect("HASNA_TODOS_API_URL" in env).toBe(false);
    expect("HASNA_TODOS_API_KEY" in env).toBe(false);
    expect("TODOS_API_URL" in env).toBe(false);
    expect("TODOS_API_KEY" in env).toBe(false);
    expect("HASNA_PROFILE" in env).toBe(false);
    expect("HASNA_TODOS_API_KEY_OVERRIDE" in env).toBe(false);
    expect("HASNA_TODOS_API_KEY_REF" in env).toBe(false);
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
