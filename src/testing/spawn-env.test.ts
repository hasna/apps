import { describe, expect, test } from "bun:test";
import { API_MODE_ENV_KEYS, testSpawnEnv } from "./spawn-env.js";

const AUTHORITY_ENV_KEYS = API_MODE_ENV_KEYS.filter((key) => (
  key.includes("TODOS") || key.includes("MEMENTOS") || key.includes("CONVERSATIONS")
));

describe("testSpawnEnv authority isolation", () => {
  test("strips inherited authority selectors and preserves explicit fixture overrides", () => {
    const previous = new Map<string, string | undefined>();
    try {
      for (const key of AUTHORITY_ENV_KEYS) {
        previous.set(key, process.env[key]);
        process.env[key] = key.endsWith("API_URL")
          ? "https://authority.example.test"
          : "fixture-value";
      }

      const isolated = testSpawnEnv();
      expect(AUTHORITY_ENV_KEYS).toHaveLength(18);
      expect(AUTHORITY_ENV_KEYS.every((key) => isolated[key] === undefined)).toBe(true);

      const explicit = testSpawnEnv({
        HASNA_TODOS_DB_PATH: "/fixture/todos.db",
      });
      expect(explicit.HASNA_TODOS_DB_PATH).toBe("/fixture/todos.db");
      expect(explicit.HASNA_TODOS_API_URL).toBeUndefined();
    } finally {
      for (const [key, value] of previous) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  });
});
