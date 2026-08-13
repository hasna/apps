import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../src/config";
import {
  defaultConfig,
  disableSegments,
  enableSegments,
  listSegments,
  orderSegments,
  previewStatusline,
  renderStatusline,
  requireKnownSegments,
  resetStatuslineConfig,
  sampleClaudeInput,
  saveUpdatedConfig,
  setSeparator,
  statuslineVersion,
} from "../src/index";

describe("SDK exports", () => {
  test("renders an input payload", async () => {
    const line = await renderStatusline(
      {
        cwd: process.cwd(),
        model: { id: "claude-fable-5[1m]", display_name: "Fable" },
        cost: { total_cost_usd: 0.04 },
      },
      { separator: " | ", segments: ["model-context", "cost"] },
    );
    expect(line).toBe("fable 5 [1m] | $0.04");
  });

  test("lists segments with enabled state", () => {
    const rows = listSegments({ separator: " · ", segments: ["machine"] });
    expect(rows.find((row) => row.id === "machine")?.enabled).toBe(true);
    expect(rows.find((row) => row.id === "cost")?.enabled).toBe(false);
  });

  test("updates config without writing", () => {
    const base = defaultConfig();
    const enabled = enableSegments(["duration"], base).config;
    expect(enabled.segments).toContain("duration");
    const disabled = disableSegments(["duration"], enabled).config;
    expect(disabled.segments).not.toContain("duration");
    const ordered = orderSegments(["machine", "cost"], disabled).config;
    expect(ordered.segments).toEqual(["machine", "cost"]);
    expect(setSeparator(" | ", ordered).config.separator).toBe(" | ");
  });

  test("preview and version are importable", async () => {
    expect(statuslineVersion).toMatch(/^\d+\.\d+\.\d+/);
    expect(await previewStatusline({ separator: " · ", segments: ["model-context"] })).toBe("fable 5 [1m]");
  });

  test("requireKnownSegments throws for unknown ids", () => {
    expect(() => requireKnownSegments(["not-a-segment"])).toThrow(/unknown segment\(s\): not-a-segment/);
  });

  test("setSeparator rejects empty string", () => {
    expect(() => setSeparator("")).toThrow(/separator must be a non-empty string/);
  });

  test("orderSegments rejects empty array", () => {
    expect(() => orderSegments([])).toThrow(/at least one segment id is required/);
  });

  test("resetStatuslineConfig returns defaults", () => {
    expect(resetStatuslineConfig()).toEqual(defaultConfig());
  });

  test("saveUpdatedConfig persists to STATUSLINE_CONFIG", () => {
    const dir = mkdtempSync(join(tmpdir(), "statusline-sdk-"));
    const previous = process.env.STATUSLINE_CONFIG;
    process.env.STATUSLINE_CONFIG = join(dir, "config.json");
    try {
      const result = setSeparator(" | ", defaultConfig());
      saveUpdatedConfig(result);
      expect(loadConfig().separator).toBe(" | ");
      expect(JSON.parse(readFileSync(process.env.STATUSLINE_CONFIG, "utf8")).separator).toBe(" | ");
    } finally {
      if (previous === undefined) delete process.env.STATUSLINE_CONFIG;
      else process.env.STATUSLINE_CONFIG = previous;
    }
  });

  test("sampleClaudeInput provides preview payload", () => {
    const input = sampleClaudeInput("/tmp/example");
    expect(input.cwd).toBe("/tmp/example");
    expect(input.model).toEqual({ id: "claude-fable-5[1m]", display_name: "Fable" });
    expect(input.cost).toBeDefined();
  });
});
