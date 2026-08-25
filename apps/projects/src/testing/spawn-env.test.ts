import { describe, expect, test } from "bun:test";
import { HOSTED_API_ENV_KEYS, testSpawnEnv } from "./spawn-env.js";

const AUTHORITY_ENV_KEYS = HOSTED_API_ENV_KEYS.filter((key) => (
  key.includes("TODOS") || key.includes("MEMENTOS") || key.includes("CONVERSATIONS")
));
const PROJECTS_API_ENV_KEYS = HOSTED_API_ENV_KEYS.filter((key) => (
  key.includes("PROJECTS") && !key.endsWith("DB_PATH")
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
      // Blanked, not deleted: the shared @hasna/contracts seam reads fleet
      // app-config files on disk when the environment is silent, and an
      // explicitly DEFINED-but-blank URL is the seam's "select the local
      // store" escape hatch that beats any disk pointer.
      expect(AUTHORITY_ENV_KEYS.every((key) => isolated[key] === "")).toBe(true);

      const explicit = testSpawnEnv({
        HASNA_TODOS_DB_PATH: "/fixture/todos.db",
      });
      expect(explicit.HASNA_TODOS_DB_PATH).toBe("/fixture/todos.db");
      expect(explicit.HASNA_TODOS_API_URL).toBe("");
    } finally {
      for (const [key, value] of previous) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  });

  test("an explicit local Projects database cannot inherit hosted Projects selectors", () => {
    const previous = new Map<string, string | undefined>();
    try {
      for (const key of PROJECTS_API_ENV_KEYS) {
        previous.set(key, process.env[key]);
        process.env[key] = key.endsWith("API_URL")
          ? "https://projects.example.test"
          : "fixture-value";
      }

      const isolated = testSpawnEnv({
        HASNA_PROJECTS_DB_PATH: "/fixture/projects.db",
      });
      expect(isolated.HASNA_PROJECTS_DB_PATH).toBe("/fixture/projects.db");
      expect(PROJECTS_API_ENV_KEYS).toHaveLength(4);
      expect(PROJECTS_API_ENV_KEYS.every((key) => isolated[key] === "")).toBe(true);
    } finally {
      for (const [key, value] of previous) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  });
});
