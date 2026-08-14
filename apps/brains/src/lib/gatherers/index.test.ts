import { describe, expect, test } from "bun:test";
import { mergeAndWriteJSONL } from "./index.js";
import type { GatherResult } from "./types.js";
import { mkdirSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

const testDir = join(tmpdir(), `brains-gatherer-test-${Date.now()}`);
mkdirSync(testDir, { recursive: true });

const makeResult = (source: string, count: number): GatherResult => ({
  source: source as GatherResult["source"],
  count,
  examples: Array.from({ length: count }, (_, i) => ({
    messages: [
      { role: "system" as const, content: "sys" },
      { role: "user" as const, content: `user ${source} ${i}` },
      { role: "assistant" as const, content: `assistant ${source} ${i}` },
    ],
  })),
});

describe("mergeAndWriteJSONL", () => {
  test("merges examples from multiple sources", async () => {
    const results = [makeResult("todos", 3), makeResult("mementos", 2)];
    const out = join(testDir, "merged1.jsonl");
    const { totalExamples, duplicatesRemoved } = await mergeAndWriteJSONL(results, out);
    expect(totalExamples).toBe(5);
    expect(duplicatesRemoved).toBe(0);
  });

  test("deduplicates identical examples", async () => {
    const example = {
      messages: [
        { role: "system" as const, content: "sys" },
        { role: "user" as const, content: "same" },
        { role: "assistant" as const, content: "same" },
      ],
    };
    const results: GatherResult[] = [
      { source: "todos", count: 2, examples: [example, example] },
    ];
    const out = join(testDir, "deduped.jsonl");
    const { totalExamples, duplicatesRemoved } = await mergeAndWriteJSONL(results, out);
    expect(totalExamples).toBe(1);
    expect(duplicatesRemoved).toBe(1);
  });

  test("writes valid JSONL to disk", async () => {
    const results = [makeResult("sessions", 2)];
    const out = join(testDir, "output.jsonl");
    await mergeAndWriteJSONL(results, out);
    const content = await Bun.file(out).text();
    const lines = content.trim().split("\n").filter(Boolean);
    expect(lines.length).toBe(2);
    for (const line of lines) {
      const parsed = JSON.parse(line) as { messages: unknown[] };
      expect(parsed.messages).toBeArray();
    }
  });

  test("returns 0 duplicates when no overlap", async () => {
    const results = [makeResult("todos", 2), makeResult("conversations", 2)];
    const out = join(testDir, "no-dupes.jsonl");
    const { duplicatesRemoved } = await mergeAndWriteJSONL(results, out);
    expect(duplicatesRemoved).toBe(0);
  });
});
