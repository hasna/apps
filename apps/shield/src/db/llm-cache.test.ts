import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { getCurrentTestDb, setupTestDb } from "./test-helpers.js";
import { cacheAnalysis, getCachedAnalysis } from "./llm-cache.js";

describe("LLM cache boundary", () => {
  let cleanup: () => void;

  beforeEach(() => {
    cleanup = setupTestDb();
  });

  afterEach(() => cleanup());

  test("sanitizes nested result, identifiers, and model before SQLite", () => {
    const syntheticSecret = "ghp_" + "SYNTHETICONLYABCDEFGHIJKLMNOPQRSTUVWXYZ12";
    cacheAnalysis(
      syntheticSecret,
      `analysis-${syntheticSecret}`,
      { explanation: `Adjacent ${syntheticSecret}`, nested: { value: syntheticSecret } },
      `model-${syntheticSecret}`,
      1,
    );
    const raw = getCurrentTestDb().prepare("SELECT * FROM llm_cache").get();
    expect(JSON.stringify(raw)).not.toContain(syntheticSecret);
    expect(JSON.stringify(getCachedAnalysis(syntheticSecret, `analysis-${syntheticSecret}`))).not.toContain(syntheticSecret);
  });

  test("sanitizes and rewrites legacy cache results on read", () => {
    const syntheticSecret = "sk_test_" + "SYNTHETICONLY0123456789";
    const db = getCurrentTestDb();
    db.prepare(
      `INSERT INTO llm_cache (id, finding_fingerprint, analysis_type, result, model, tokens_used, created_at)
       VALUES ('legacy', 'safe-fingerprint', 'explain', ?, 'synthetic-model', 1, datetime('now'))`,
    ).run(JSON.stringify({ text: `Adjacent ${syntheticSecret}` }));
    expect(JSON.stringify(getCachedAnalysis("safe-fingerprint", "explain"))).not.toContain(syntheticSecret);
    expect(JSON.stringify(db.prepare("SELECT result FROM llm_cache WHERE id = 'legacy'").get())).not.toContain(syntheticSecret);
  });
});
