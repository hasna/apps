import { describe, expect, test } from "bun:test";
import { createReleaseCompatibilityReport, renderReleaseCompatibilityMarkdown } from "./release-compatibility.js";

describe("release compatibility checks", () => {
  test("builds a local-only compatibility report for the current package", () => {
    const report = createReleaseCompatibilityReport({
      root: process.cwd(),
      generated_at: "2026-01-02T03:04:05.000Z",
      simulated_levels: [0, 1],
    });

    expect(report).toMatchObject({
      schema_version: 1,
      local_only: true,
      no_network: true,
      generated_at: "2026-01-02T03:04:05.000Z",
      package: {
        name: "@hasna/todos",
        repository: "https://github.com/hasna/todos.git",
        public: true,
      },
      install_plan: {
        package: "@hasna/todos",
        manager: "bun",
      },
      changelog: {
        command: "todos release-notes --format markdown",
        mcp_tool: "generate_release_notes",
        json_contract: "release_notes",
      },
    });
    expect(report.ok).toBe(true);
    expect(report.issues).toEqual([]);
    expect(report.exports.actual).toEqual(expect.arrayContaining([".", "./contracts", "./mcp", "./sdk", "./storage"]));
    expect(report.bins.actual).toEqual(expect.arrayContaining(["todos", "todos-mcp", "todos-serve"]));
    expect(report.install_plan.commands.every((command) => command.startsWith("bun ") || command.startsWith("todos"))).toBe(true);
    expect(JSON.stringify(report.install_plan)).not.toContain("bun add");
  });

  test("simulates recent migration levels into the current schema", () => {
    const report = createReleaseCompatibilityReport({
      root: process.cwd(),
      simulated_levels: [0, 1, 50],
    });

    expect(report.migrations.current_level).toBeGreaterThanOrEqual(50);
    expect(report.checks.filter((check) => check.id.startsWith("migration-level-"))).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "migration-level-0", status: "passed" }),
        expect.objectContaining({ id: "migration-level-1", status: "passed" }),
        expect.objectContaining({ id: "migration-level-50", status: "passed" }),
      ]),
    );
  });

  test("renders operator-friendly install and rollback guidance", () => {
    const report = createReleaseCompatibilityReport({
      root: process.cwd(),
      generated_at: "2026-01-02T03:04:05.000Z",
      simulated_levels: [0],
    });
    const markdown = renderReleaseCompatibilityMarkdown(report);

    expect(markdown).toContain("# Release Compatibility");
    expect(markdown).toContain("Status: passed");
    expect(markdown).toContain("bun install -g @hasna/todos@latest");
    expect(markdown).toContain("bun install -g @hasna/todos@<previous-version>");
  });
});
