import { describe, expect, test } from "bun:test";
import { analyzePrompt } from "../src/analysis";

describe("prompt analysis", () => {
  test("classifies coding requests with explicit hints", () => {
    const analysis = analyzePrompt({
      messages: [{ role: "user", content: "Implement a TypeScript retry helper with tests." }],
      hints: { task: "coding" },
    });
    expect(analysis.primaryTask).toBe("coding");
    expect(analysis.taskTypes).toContain("coding");
  });

  test("infers reasoning and long-context", () => {
    const analysis = analyzePrompt({
      messages: [{ role: "user", content: "Analyze this constraint system and prove why it terminates." }],
      hints: { minContextTokens: 128000 },
    });
    expect(analysis.taskTypes).toContain("reasoning");
    expect(analysis.taskTypes).toContain("long-context");
  });

  test("infers vision, json, and tool-use capabilities", () => {
    const analysis = analyzePrompt({
      messages: [
        {
          role: "user",
          content: [{ type: "image_url", image_url: { url: "https://example.test/image.png" } }],
        },
      ],
      tools: [{ type: "function" }],
      response_format: { type: "json_object" },
    });
    expect(analysis.taskTypes).toContain("vision");
    expect(analysis.requiredCapabilities).toContain("vision");
    expect(analysis.requiredCapabilities).toContain("tools");
    expect(analysis.requiredCapabilities).toContain("json");
  });

  test("infers summarization", () => {
    const analysis = analyzePrompt({
      messages: [{ role: "user", content: "Summarize this incident report and produce a short recap." }],
    });
    expect(analysis.taskTypes).toContain("summarization");
  });

  test("infers bulk cheap work", () => {
    const analysis = analyzePrompt({
      messages: [{ role: "user", content: "Classify each row in this batch as cheaply as possible." }],
    });
    expect(analysis.taskTypes).toContain("bulk-cheap");
  });

  test("infers low-latency chat", () => {
    const analysis = analyzePrompt({
      messages: [{ role: "user", content: "Hi" }],
      hints: { priority: "latency" },
    });
    expect(analysis.taskTypes).toContain("low-latency-chat");
  });
});
