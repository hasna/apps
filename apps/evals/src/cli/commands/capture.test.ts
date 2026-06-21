import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  appendCapturedEvalCase,
  buildCapturedEvalCase,
} from "./capture.js";

describe("capture helpers", () => {
  test("builds a reviewable eval case from OpenAI-style chat traffic", () => {
    const evalCase = buildCapturedEvalCase(
      JSON.stringify({
        messages: [
          { role: "user", content: "first" },
          { role: "user", content: "latest prompt" },
        ],
      }),
      JSON.stringify({
        choices: [{ message: { content: "assistant response" } }],
      }),
      {
        now: new Date("2026-01-02T03:04:05.000Z"),
        random: () => 0.12345,
      }
    );

    expect(evalCase).not.toBeNull();
    expect(evalCase!.id).toBe("captured-1767323045000-4fzol");
    expect(evalCase!.input).toBe("latest prompt");
    expect(evalCase!.tags).toEqual(["captured", "needs-review"]);
    expect(evalCase!.metadata).toMatchObject({
      capturedAt: "2026-01-02T03:04:05.000Z",
      responsePreview: "assistant response",
    });
  });

  test("returns null for non-JSON exchanges", () => {
    expect(buildCapturedEvalCase("not json", "{}")).toBeNull();
    expect(buildCapturedEvalCase("{}", "not json")).toBeNull();
  });

  test("appends captured cases to the configured output path", () => {
    const dir = mkdtempSync(join(tmpdir(), "evals-capture-test-"));
    const outputPath = join(dir, "captured.jsonl");
    const evalCase = buildCapturedEvalCase(
      JSON.stringify({ input: "prompt" }),
      JSON.stringify({ content: "response text that must not become a file path" }),
      {
        now: new Date("2026-01-02T03:04:05.000Z"),
        random: () => 0.6789,
      }
    );

    appendCapturedEvalCase(outputPath, evalCase!);

    const lines = readFileSync(outputPath, "utf8").trim().split("\n");
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0]!) as Record<string, unknown>).toMatchObject({
      input: "prompt",
      metadata: {
        responsePreview: "response text that must not become a file path",
      },
    });
  });
});
