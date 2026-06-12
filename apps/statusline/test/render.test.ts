import { describe, expect, test, beforeEach } from "bun:test";
import { mkdtempSync } from "node:fs";
import { hostname } from "node:os";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { renderLine } from "../src/render";
import { parseClaudeInput } from "../src/providers/claude";
import fixture from "./fixtures/claude-input.json";

beforeEach(() => {
  const dir = mkdtempSync(join(tmpdir(), "statusline-render-"));
  process.env.STATUSLINE_CONFIG = join(dir, "config.json");
});

describe("renderLine", () => {
  test("joins enabled segments with separator, skipping nulls", async () => {
    const ctx = parseClaudeInput(fixture);
    const line = await renderLine(ctx, {
      separator: " · ",
      segments: ["machine", "model-context", "cost", "output-style"],
    });
    const short = hostname().split(".")[0];
    expect(line).toBe(`${short} · fable 5 [1m] · $1,234.50`);
  });

  test("unknown segment ids are ignored", async () => {
    const ctx = parseClaudeInput(fixture);
    const line = await renderLine(ctx, { separator: " · ", segments: ["nope", "cost"] });
    expect(line).toBe("$1,234.50");
  });

  test("never throws on broken context", async () => {
    const ctx = parseClaudeInput({});
    const line = await renderLine(ctx, {
      separator: " · ",
      segments: ["machine", "project", "git-branch", "cost", "context-remaining"],
    });
    expect(typeof line).toBe("string");
  });
});
