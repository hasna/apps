/**
 * `skills feedback` records feedback to ONE on-box store in every transport.
 *
 * The storage-mode axis is retired (owner directive 2026-08-15): an entry is
 * written to the SQLite feedback database whether or not a Skills credential
 * resolves, and no separate "api mode" JSONL file exists. These tests pin the
 * transport-agnostic behavior and refuse the legacy split if it ever returns.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { saveFeedback } from "./feedback.js";
import { useDefaultTestTimeout } from "../test-preload.js";

useDefaultTestTimeout();

const ENV_KEYS = ["HASNA_SKILLS_DIR", "HASNA_HOME", "SKILLS_API_URL", "HASNA_SKILLS_API_URL", "SKILLS_API_KEY", "HASNA_SKILLS_API_KEY"] as const;
let saved: Record<string, string | undefined> = {};
let dataDir = "";

beforeEach(() => {
  saved = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
  dataDir = mkdtempSync(join(tmpdir(), "skills-feedback-"));
  process.env.HASNA_SKILLS_DIR = dataDir;
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
  rmSync(dataDir, { recursive: true, force: true });
});

describe("saveFeedback records to the SQLite store in every transport", () => {
  test("unconfigured install records to the SQLite database", () => {
    const result = saveFeedback({ message: "  the pull command is great  ", category: "feature", agent: "station03" });
    expect(result.saved).toBe(true);
    expect(result.path).toBe(join(dataDir, "skills.db"));
    expect(readdirSync(dataDir).filter((name) => name.endsWith(".db"))).toEqual(["skills.db"]);
  });

  test("a configured hosted credential still records to the SQLite database", () => {
    process.env.HASNA_SKILLS_API_URL = "https://skills.example.test";
    process.env.HASNA_SKILLS_API_KEY = "sk_feedback_test_only";
    saveFeedback({ message: "second" });
    saveFeedback({ message: "third" });
    expect(readdirSync(dataDir).filter((name) => name.endsWith(".db"))).toEqual(["skills.db"]);
    // The retired api-mode JSONL path must not reappear.
    expect(readdirSync(dataDir).filter((name) => name.endsWith(".jsonl"))).toEqual([]);
  });

  test("a credential written by `skills auth login` still records to the SQLite database", () => {
    delete process.env.HASNA_SKILLS_API_URL;
    delete process.env.HASNA_SKILLS_API_KEY;
    const home = mkdtempSync(join(tmpdir(), "skills-feedback-home-"));
    const previousHome = process.env.HASNA_HOME;
    try {
      process.env.HASNA_HOME = home;
      mkdirSync(join(home, "skills", "config"), { recursive: true });
      // Matches the auth-store writer's shape (URL + key).
      writeFileSync(join(home, "skills", "config", "credentials"), "HASNA_SKILLS_API_URL=https://skills.example.test\nHASNA_SKILLS_API_KEY=sk_feedback_test_only\n", { mode: 0o600 });
      const result = saveFeedback({ message: "from a keyed station" });
      expect(result.path).toBe(join(dataDir, "skills.db"));
      expect(readdirSync(dataDir).filter((name) => name.endsWith(".db"))).toEqual(["skills.db"]);
    } finally {
      if (previousHome === undefined) delete process.env.HASNA_HOME;
      else process.env.HASNA_HOME = previousHome;
      rmSync(home, { recursive: true, force: true });
    }
  });
});