import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { getCurrentTestDb, setupTestDb } from "./test-helpers.js";
import { cacheAnalysis, getCachedAnalysis } from "./llm-cache.js";
import {
  sanitizeFingerprintForOutput,
  sanitizeTextForBoundary,
} from "../lib/finding-safety.js";

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

  test("durably scrubs every production cache string on legacy read", () => {
    const marker = `gh${"o"}_${"CacheLegacyMarker_".repeat(3)}`;
    const db = getCurrentTestDb();
    db.prepare(
      `INSERT INTO llm_cache
        (id, finding_fingerprint, analysis_type, result, model, tokens_used, created_at)
       VALUES (?, ?, ?, ?, ?, 1, ?)`,
    ).run(
      marker,
      marker,
      `analysis-${marker}`,
      JSON.stringify({ text: marker, nested: { marker } }),
      `model-${marker}`,
      marker,
    );

    expect(JSON.stringify(getCachedAnalysis(marker, `analysis-${marker}`))).not.toContain(marker);
    expect(JSON.stringify(db.prepare("SELECT * FROM llm_cache").all())).not.toContain(marker);
  });

  test("converts invalid legacy result text to a deterministic safe JSON object", () => {
    const marker = `gh${"s"}_${"InvalidCacheResult_".repeat(3)}`;
    const db = getCurrentTestDb();
    db.prepare(
      `INSERT INTO llm_cache
        (id, finding_fingerprint, analysis_type, result, model, tokens_used, created_at)
       VALUES ('invalid-result', 'safe-fingerprint', 'explain', ?, 'safe-model', 1, 'now')`,
    ).run(`not-json:${marker}`);

    const result = getCachedAnalysis("safe-fingerprint", "explain");
    expect(result).toEqual({
      legacy_cache_value: expect.stringContaining("[REDACTED]"),
    });
    const raw = db.prepare("SELECT result FROM llm_cache WHERE id = 'invalid-result'").get() as {
      result: string;
    };
    expect(() => JSON.parse(raw.result)).not.toThrow();
    expect(raw.result).not.toContain(marker);
  });

  test("repairs invalid non-credential cache result text on the selected row", () => {
    const db = getCurrentTestDb();
    db.prepare(
      `INSERT INTO llm_cache
        (id, finding_fingerprint, analysis_type, result, model, tokens_used, created_at)
       VALUES ('invalid-safe-result', 'safe-fingerprint', 'triage', 'not valid json', 'safe', 0, 'now')`,
    ).run();

    expect(getCachedAnalysis("safe-fingerprint", "triage")).toEqual({
      legacy_cache_value: "not valid json",
    });
    const raw = db.prepare("SELECT result FROM llm_cache WHERE id = 'invalid-safe-result'").get() as {
      result: string;
    };
    expect(JSON.parse(raw.result)).toEqual({ legacy_cache_value: "not valid json" });
  });

  test("does not run the global scrub for an already-safe cache hit", () => {
    const marker = `gh${"r"}_${"UnrelatedBaseline_".repeat(3)}`;
    const db = getCurrentTestDb();
    db.prepare(
      `INSERT INTO baselines (id, finding_fingerprint, reason, created_by, created_at)
       VALUES ('unsafe-unrelated', 'safe-fingerprint', ?, 'safe', 'now')`,
    ).run(marker);
    db.prepare(
      `INSERT INTO llm_cache
        (id, finding_fingerprint, analysis_type, result, model, tokens_used, created_at)
       VALUES ('safe-cache', 'safe-fingerprint', 'explain', '{"ok":true}', 'safe', 0, 'now')`,
    ).run();

    expect(getCachedAnalysis("safe-fingerprint", "explain")).toEqual({ ok: true });
    expect(JSON.stringify(db.prepare("SELECT * FROM baselines").all())).toContain(marker);
  });

  test("scrubs an exact raw legacy key even when its safe key already exists", () => {
    const marker = `gh${"p"}_${"CacheLookupCollision_".repeat(3)}`;
    const analysisType = `analysis-${marker}`;
    const safeFingerprint = sanitizeFingerprintForOutput(marker);
    const safeAnalysisType = sanitizeTextForBoundary(analysisType, 128);
    const db = getCurrentTestDb();
    db.prepare(
      `INSERT INTO llm_cache
        (id, finding_fingerprint, analysis_type, result, model, tokens_used, created_at)
       VALUES ('canonical', ?, ?, '{"owner":"canonical"}', 'safe', 0, 'now')`,
    ).run(safeFingerprint, safeAnalysisType);
    db.prepare(
      `INSERT INTO llm_cache
        (id, finding_fingerprint, analysis_type, result, model, tokens_used, created_at)
       VALUES ('raw-legacy', ?, ?, '{"owner":"legacy"}', 'safe', 0, 'now')`,
    ).run(marker, analysisType);

    expect(getCachedAnalysis(marker, analysisType)).toEqual({ owner: "canonical" });
    const rows = db.prepare("SELECT * FROM llm_cache").all();
    expect(rows).toHaveLength(2);
    expect(JSON.stringify(rows)).not.toContain(marker);
  });
});
