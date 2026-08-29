import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Database } from "bun:sqlite";
import { codexCacheRate, latestCodexSessionPath } from "../src/providers/codex";
import { opencodeCacheRate } from "../src/providers/opencode";
import { parseClaudeInput } from "../src/providers/claude";
import fixture from "./fixtures/claude-input.json";

describe("parseClaudeInput", () => {
  const ctx = parseClaudeInput(fixture);

  test("cwd", () => expect(ctx.cwd).toBe("/Users/hasna/Workspace/hasna/opensource/statusline"));
  test("model id", () => expect(ctx.model?.id).toBe("claude-fable-5[1m]"));
  test("model display name", () => expect(ctx.model?.displayName).toBe("Fable"));
  test("cost", () => expect(ctx.cost?.totalCostUsd).toBe(1234.5));
  test("duration", () => expect(ctx.cost?.totalDurationMs).toBe(5400000));
  test("lines", () => {
    expect(ctx.cost?.totalLinesAdded).toBe(142);
    expect(ctx.cost?.totalLinesRemoved).toBe(18);
  });
  test("transcript path", () => expect(ctx.transcriptPath).toBe("/tmp/statusline-test-transcript.jsonl"));
  test("version", () => expect(ctx.version).toBe("2.1.39"));
  test("output style", () => expect(ctx.outputStyle).toBe("default"));

  test("empty payload does not throw", () => {
    const c = parseClaudeInput({});
    expect(c.cwd.length).toBeGreaterThan(0);
  });
});

describe("codex provider", () => {
  function tokenCount(input: number, cached: number, write: number): string {
    return JSON.stringify({
      type: "event_msg",
      payload: {
        type: "token_count",
        info: {
          total_token_usage: {
            input_tokens: input,
            cached_input_tokens: cached,
            cache_write_input_tokens: write,
            output_tokens: 100,
            total_tokens: input + 100,
          },
        },
      },
    });
  }

  test("latestCodexSessionPath picks the newest rollout file", () => {
    const home = mkdtempSync(join(tmpdir(), "statusline-codex-home-"));
    const dir = join(home, ".codex", "sessions", "2026", "08", "28");
    mkdirSync(dir, { recursive: true });
    const older = join(dir, "rollout-old.jsonl");
    const newer = join(dir, "rollout-new.jsonl");
    writeFileSync(older, "");
    writeFileSync(newer, "");
    // writes within the same tick can share an mtime — pin distinct ones
    utimesSync(older, new Date(1_000_000), new Date(1_000_000));
    utimesSync(newer, new Date(2_000_000), new Date(2_000_000));
    expect(latestCodexSessionPath(home)).toBe(newer);
  });

  test("latestCodexSessionPath null without sessions tree", () => {
    const home = mkdtempSync(join(tmpdir(), "statusline-codex-empty-"));
    expect(latestCodexSessionPath(home)).toBeNull();
  });

  test("the LAST token_count event wins (cumulative session totals)", () => {
    const path = join(tmpdir(), `statusline-codex-${Date.now()}.jsonl`);
    const lines = [
      JSON.stringify({ type: "session_meta", session_id: "s1" }),
      tokenCount(1000, 450, 0), // 450/1450 = 31%
      tokenCount(1000, 900, 0), // 900/1900 = 47% — but the last event is the live one
    ];
    writeFileSync(path, lines.join("\n") + "\n");
    expect(codexCacheRate(path)).toBeCloseTo(900 / 1900, 10);
  });

  test("skips malformed lines and non-token_count events", () => {
    const path = join(tmpdir(), `statusline-codex-bad-${Date.now()}.jsonl`);
    const lines = [
      tokenCount(1000, 900, 0),
      '{"type":"event_msg","payload": broken',
      JSON.stringify({ type: "event_msg", payload: { type: "session_init" } }),
    ];
    writeFileSync(path, lines.join("\n") + "\n");
    expect(codexCacheRate(path)).toBeCloseTo(900 / 1900, 10);
  });

  test("null when the file is missing", () => {
    expect(codexCacheRate("/tmp/does-not-exist-rollout.jsonl")).toBeNull();
  });

  test("null when the divisor is zero", () => {
    const path = join(tmpdir(), `statusline-codex-zero-${Date.now()}.jsonl`);
    writeFileSync(path, tokenCount(0, 0, 0) + "\n");
    expect(codexCacheRate(path)).toBeNull();
  });
});

describe("opencode provider", () => {
  function makeDb(rows: Array<{ id: string; input: number; read: number; write: number; updated: number }>): string {
    const path = join(tmpdir(), `statusline-opencode-${Date.now()}.db`);
    const db = new Database(path);
    db.run(
      `CREATE TABLE session (
        id TEXT PRIMARY KEY, tokens_input INTEGER, tokens_cache_read INTEGER,
        tokens_cache_write INTEGER, time_updated INTEGER)`,
    );
    for (const r of rows) {
      db.run(
        "INSERT INTO session (id, tokens_input, tokens_cache_read, tokens_cache_write, time_updated) VALUES (?, ?, ?, ?, ?)",
        [r.id, r.input, r.read, r.write, r.updated],
      );
    }
    db.close();
    return path;
  }

  test("reads the newest populated session row", () => {
    const dbPath = makeDb([
      { id: "older", input: 1000, read: 9000, write: 0, updated: 100 },
      { id: "newer", input: 5000, read: 5000, write: 0, updated: 200 },
    ]);
    expect(opencodeCacheRate({ dbPath })).toBeCloseTo(0.5, 10);
  });

  test("an explicit sessionId selects that row, not the newest", () => {
    const dbPath = makeDb([
      { id: "older", input: 1000, read: 9000, write: 0, updated: 100 },
      { id: "newer", input: 5000, read: 5000, write: 0, updated: 200 },
    ]);
    expect(opencodeCacheRate({ dbPath, sessionId: "older" })).toBeCloseTo(0.9, 10);
  });

  test("null for a missing file", () => {
    expect(opencodeCacheRate({ dbPath: "/tmp/does-not-exist-opencode.db" })).toBeNull();
  });

  test("null for an empty / table-less db", () => {
    const path = join(tmpdir(), `statusline-opencode-empty-${Date.now()}.db`);
    const db = new Database(path);
    db.run("CREATE TABLE unrelated (x INTEGER)");
    db.close();
    expect(opencodeCacheRate({ dbPath: path })).toBeNull();
  });

  test("null when the newest row has no token data (divisor 0)", () => {
    const dbPath = makeDb([{ id: "zero", input: 0, read: 0, write: 0, updated: 999 }]);
    expect(opencodeCacheRate({ dbPath })).toBeNull();
  });
});
