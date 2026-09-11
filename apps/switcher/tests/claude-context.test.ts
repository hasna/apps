import { expect, test } from "bun:test";
import { claudeContextEnvironment } from "../src/claude-context";

test("DeepSeek Messages endpoints get the documented Claude compaction headroom", () => {
  for (const url of ["https://api.deepseek.com/anthropic", "https://api.deepseek.com/anthropic/v1", "https://api.deepseek.com/anthropic/v1/"])
    expect(claudeContextEnvironment(url, {})).toEqual({ CLAUDE_CODE_AUTO_COMPACT_WINDOW: "786432" });
});

test("Claude preserves explicit compaction settings and does not infer providers from lookalike hosts", () => {
  for (const value of ["400000", "0", ""]) {
    for (const url of ["https://api.deepseek.com/anthropic/v1", "https://api.anthropic.com/v1"])
      expect(claudeContextEnvironment(url, { CLAUDE_CODE_AUTO_COMPACT_WINDOW: value })).toEqual({ CLAUDE_CODE_AUTO_COMPACT_WINDOW: value });
  }
  for (const url of ["https://api.anthropic.com/v1", "http://127.0.0.1:4321/v1", "https://api.deepseek.com.evil.example/anthropic/v1", "https://api.deepseek.com/v1", "https://api.deepseek.com:8443/anthropic/v1"])
    expect(claudeContextEnvironment(url, {})).toEqual({});
});
