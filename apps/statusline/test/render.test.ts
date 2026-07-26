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

  test("colours segments that ask for one", async () => {
    const ctx = parseClaudeInput({ ...fixture, session_name: "ship it" });
    const line = await renderLine(ctx, { separator: " · ", segments: ["thread-title"], colors: true });
    expect(line).toBe("\u001b[34mship it\u001b[0m");
  });

  test("colours are off when the config disables them", async () => {
    const ctx = parseClaudeInput({ ...fixture, session_name: "ship it" });
    const line = await renderLine(ctx, { separator: " · ", segments: ["thread-title"], colors: false });
    expect(line).toBe("ship it");
  });

  test("NO_COLOR wins over the config", async () => {
    const previous = process.env.NO_COLOR;
    process.env.NO_COLOR = "1";
    try {
      const ctx = parseClaudeInput({ ...fixture, session_name: "ship it" });
      const line = await renderLine(ctx, { separator: " · ", segments: ["thread-title"], colors: true });
      expect(line).toBe("ship it");
    } finally {
      if (previous === undefined) delete process.env.NO_COLOR;
      else process.env.NO_COLOR = previous;
    }
  });

  test("a segment colour may escalate with its value", async () => {
    const hot = parseClaudeInput({ ...fixture, rate_limits: { five_hour: { used_percentage: 95 } } });
    const cool = parseClaudeInput({ ...fixture, rate_limits: { five_hour: { used_percentage: 5 } } });
    const cfg = { separator: " · ", segments: ["five-hour-limit"], colors: true };
    expect(await renderLine(hot, cfg)).toBe("\u001b[31m5h:95%\u001b[0m");
    expect(await renderLine(cool, cfg)).toBe("\u001b[33m5h:5%\u001b[0m");
  });

  test("uncoloured segments are untouched", async () => {
    const ctx = parseClaudeInput(fixture);
    const line = await renderLine(ctx, { separator: " · ", segments: ["cost"], colors: true });
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
