/**
 * `skills feedback` on a keyed station never opens a local database (hasna/apps#1613,
 * #1632): with a Skills API URL configured the entry is appended to feedback.jsonl in the
 * data directory and no SQLite file appears.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { saveFeedback } from "./feedback.js";
import { useDefaultTestTimeout } from "../test-preload.js";

useDefaultTestTimeout();

const ENV_KEYS = ["HASNA_SKILLS_DIR", "SKILLS_API_URL", "HASNA_SKILLS_API_URL"] as const;
let saved: Record<string, string | undefined> = {};
let dataDir = "";

beforeEach(() => {
  saved = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
  dataDir = mkdtempSync(join(tmpdir(), "skills-feedback-api-"));
  process.env.HASNA_SKILLS_DIR = dataDir;
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
  rmSync(dataDir, { recursive: true, force: true });
});

describe("saveFeedback in api mode", () => {
  test("appends JSONL and opens no SQLite database", () => {
    process.env.SKILLS_API_URL = "https://skills.example.test";
    delete process.env.HASNA_SKILLS_API_URL;
    const result = saveFeedback({ message: "  the pull command is great  ", category: "feature", agent: "station03" });
    expect(result.saved).toBe(true);
    expect(result.path).toBe(join(dataDir, "feedback.jsonl"));
    const lines = readFileSync(result.path, "utf-8").trim().split("\n");
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0]!)).toMatchObject({ message: "the pull command is great", category: "feature", agent: "station03", email: null });
    expect(readdirSync(dataDir).filter((name) => name.endsWith(".db"))).toEqual([]);
    expect(existsSync(join(dataDir, "feedback.db"))).toBe(false);
  });

  test("the HASNA_-prefixed URL alone selects api mode too", () => {
    delete process.env.SKILLS_API_URL;
    process.env.HASNA_SKILLS_API_URL = "https://skills.example.test";
    saveFeedback({ message: "second" });
    saveFeedback({ message: "third" });
    expect(readFileSync(join(dataDir, "feedback.jsonl"), "utf-8").trim().split("\n")).toHaveLength(2);
    expect(readdirSync(dataDir).filter((name) => name.endsWith(".db"))).toEqual([]);
  });
});
