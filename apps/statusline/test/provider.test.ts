import { describe, expect, test } from "bun:test";
import { parseClaudeInput } from "../src/providers/claude";
import fixture from "./fixtures/claude-input.json";

describe("parseClaudeInput", () => {
  const ctx = parseClaudeInput(fixture);

  test("cwd", () => expect(ctx.cwd).toBe("/Users/hasna/Workspace/hasna/opensource/open-statusline"));
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
