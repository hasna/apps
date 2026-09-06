import { describe, expect, test } from "bun:test";
import {
  HOSTED_API_ENV_KEYS,
  TEST_HASNA_HOME,
  TEST_KEYCHAIN_STATION,
  silenceHostedApiEnv,
  testSpawnEnv,
  withoutUnhostedNotice,
} from "./spawn-env.js";

const AUTHORITY_ENV_KEYS = HOSTED_API_ENV_KEYS.filter((key) => (
  key.includes("TODOS") || key.includes("MEMENTOS") || key.includes("CONVERSATIONS")
));
const PROJECTS_API_ENV_KEYS = HOSTED_API_ENV_KEYS.filter((key) => (
  key.includes("PROJECTS") && !key.endsWith("DB_PATH")
));

function withEnv(seed: Record<string, string>, body: () => void): void {
  const previous = new Map<string, string | undefined>();
  try {
    for (const [key, value] of Object.entries(seed)) {
      previous.set(key, process.env[key]);
      process.env[key] = value;
    }
    body();
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

describe("testSpawnEnv authority isolation", () => {
  test("deletes inherited authority selectors and preserves explicit fixture overrides", () => {
    const seed: Record<string, string> = {};
    for (const key of AUTHORITY_ENV_KEYS) {
      seed[key] = key.endsWith("API_URL") ? "https://authority.example.test" : "fixture-value";
    }

    withEnv(seed, () => {
      const isolated = testSpawnEnv();
      expect(AUTHORITY_ENV_KEYS).toHaveLength(24);
      // DELETED, not blanked: with the shared @hasna/contracts resolver a
      // DEFINED-but-blank API URL is a configuration error the seam refuses,
      // so blanking would turn every local fixture into a hard failure.
      expect(AUTHORITY_ENV_KEYS.every((key) => !(key in isolated))).toBe(true);

      const explicit = testSpawnEnv({ HASNA_TODOS_DB_PATH: "/fixture/todos.db" });
      expect(explicit.HASNA_TODOS_DB_PATH).toBe("/fixture/todos.db");
      expect("HASNA_TODOS_API_URL" in explicit).toBe(false);
    });
  });

  test("silences the Keychain and disk tiers, not only the environment tier", () => {
    withEnv({ HASNA_STATION: "station03", HASNA_HOME: "/Users/someone/.hasna" }, () => {
      const isolated = testSpawnEnv();
      // Tier 3 looks up `hasna.credentials.<app>.api-key` under this account;
      // an account with no items makes the tier absent instead of picking up
      // the developer's real station credential.
      expect(isolated.HASNA_STATION).toBe(TEST_KEYCHAIN_STATION);
      // Tier 4 reads `<HASNA_HOME>/<app>/config/credentials`; this root is
      // never created by the suite.
      expect(isolated.HASNA_HOME).toBe(TEST_HASNA_HOME);
      expect("HASNA_CONFIG_HOME" in isolated).toBe(false);
    });
  });

  test("declares the explicit local opt-in, since the fail-closed ruling left no implicit fallback", () => {
    withEnv({ HASNA_PROJECTS_LOCAL: "" }, () => {
      const isolated = testSpawnEnv();
      expect(isolated.HASNA_PROJECTS_LOCAL).toBe("1");
      // An explicit override (including a deliberate blank that restores the
      // fail-closed case) always wins.
      expect(testSpawnEnv({ HASNA_PROJECTS_LOCAL: "" }).HASNA_PROJECTS_LOCAL).toBe("");
    });
  });

  test("an explicit local Projects database cannot inherit hosted Projects selectors", () => {
    const seed: Record<string, string> = {};
    for (const key of PROJECTS_API_ENV_KEYS) {
      seed[key] = key.endsWith("API_URL") ? "https://projects.example.test" : "fixture-value";
    }

    withEnv(seed, () => {
      const isolated = testSpawnEnv({ HASNA_PROJECTS_DB_PATH: "/fixture/projects.db" });
      expect(isolated.HASNA_PROJECTS_DB_PATH).toBe("/fixture/projects.db");
      expect(PROJECTS_API_ENV_KEYS).toHaveLength(6);
      expect(PROJECTS_API_ENV_KEYS.every((key) => !(key in isolated))).toBe(true);
    });
  });

  test("silenceHostedApiEnv applies the same silencing in-process", () => {
    withEnv({ HASNA_PROJECTS_API_KEY: "inherited", HASNA_STATION: "station03" }, () => {
      silenceHostedApiEnv();
      expect(process.env.HASNA_PROJECTS_API_KEY).toBeUndefined();
      expect(process.env.HASNA_STATION).toBe(TEST_KEYCHAIN_STATION);
      expect(process.env.HASNA_HOME).toBe(TEST_HASNA_HOME);
      expect(process.env.HASNA_PROJECTS_LOCAL).toBe("1");
    });
  });
});

describe("withoutUnhostedNotice", () => {
  test("strips only the one local-mode line", () => {
    const stderr = [
      "projects: local mode — HASNA_PROJECTS_LOCAL is set, so this run reads and writes the on-box SQLite registry (…)",
      "Unknown machine: ghost",
      "",
    ].join("\n");
    expect(withoutUnhostedNotice(stderr)).toBe("Unknown machine: ghost\n");
  });
});
