import { describe, expect, test } from "bun:test";
import {
  defaultConfig,
  disableSegments,
  enableSegments,
  listSegments,
  orderSegments,
  previewStatusline,
  renderStatusline,
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
});
