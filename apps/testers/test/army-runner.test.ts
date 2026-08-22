import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildWorkerArgs, getCliPath, resolveCliPath } from "../src/lib/army-runner.js";

// Regression (todos 21969ee6): getCliPath() hardcoded the dev-source entrypoint
// (../cli/index.tsx). In a built package only dist/ ships — build:cli emits
// dist/cli/index.js (the "testers" bin) — so every army worker spawned as
// `bun run <path>` died instantly with "Module not found". With worker
// stdout/stderr ignored, the death was silent and the run finalized "passed"
// having executed nothing. The fix prefers the built artifact when present and
// falls back to the dev source entrypoint otherwise.
//
// The real runtime layouts:
//   built package: the runner's only caller is the MCP server bundle at
//                  <pkg>/dist/mcp/index.js -> sibling CLI artifact
//                  <pkg>/dist/cli/index.js.
//   dev source:    <pkg>/src/mcp runs the runner -> <pkg>/src/cli/index.tsx.

describe("army runner worker CLI resolution", () => {
  test("resolves the built dist/cli/index.js artifact in the built layout", () => {
    const root = mkdtempSync(join(tmpdir(), "army-runner-built-"));
    try {
      const cliDir = join(root, "dist", "cli");
      mkdirSync(cliDir, { recursive: true });
      writeFileSync(join(cliDir, "index.js"), "// built CLI\n");

      // Runner code bundled into <pkg>/dist/mcp/index.js.
      const runnerDir = join(root, "dist", "mcp");
      mkdirSync(runnerDir, { recursive: true });

      const p = resolveCliPath(runnerDir);
      expect(p).toBe(join(root, "dist", "cli", "index.js"));
      expect(existsSync(p)).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("falls back to the dev source src/cli/index.tsx when no build exists", () => {
    const root = mkdtempSync(join(tmpdir(), "army-runner-dev-"));
    try {
      const cliDir = join(root, "src", "cli");
      mkdirSync(cliDir, { recursive: true });
      writeFileSync(join(cliDir, "index.tsx"), "// source CLI\n");

      // Dev run: MCP server runs from <pkg>/src/mcp.
      const runnerDir = join(root, "src", "mcp");
      mkdirSync(runnerDir, { recursive: true });

      const p = resolveCliPath(runnerDir);
      expect(p).toBe(join(root, "src", "cli", "index.tsx"));
      expect(existsSync(p)).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("prefers the built artifact when both layouts exist", () => {
    const root = mkdtempSync(join(tmpdir(), "army-runner-both-"));
    try {
      for (const [dir, file] of [
        ["dist/cli", "index.js"],
        ["src/cli", "index.tsx"],
      ] as const) {
        const cliDir = join(root, dir);
        mkdirSync(cliDir, { recursive: true });
        writeFileSync(join(cliDir, file), "// cli\n");
      }
      const runnerDir = join(root, "dist", "mcp");
      mkdirSync(runnerDir, { recursive: true });

      expect(resolveCliPath(runnerDir)).toBe(join(root, "dist", "cli", "index.js"));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("getCliPath returns an entrypoint that exists on disk in the dev source tree", () => {
    const p = getCliPath();
    expect(p.endsWith("/cli/index.tsx")).toBe(true);
    expect(existsSync(p)).toBe(true);
  });
});

describe("army worker spawn args", () => {
  test("match the CLI run command surface: positional URL, --scenario CSV, --run-id", () => {
    const args = buildWorkerArgs(
      "/pkg/dist/cli/index.js",
      "https://example.com",
      "haiku",
      2,
      "run-123",
      ["scenario-a", "scenario-b"],
    );
    expect(args).toEqual([
      "bun",
      "run",
      "/pkg/dist/cli/index.js",
      "run",
      "https://example.com",
      "--model",
      "haiku",
      "--parallel",
      "2",
      "--run-id",
      "run-123",
      "--scenario",
      "scenario-a,scenario-b",
    ]);
  });

  test("never pass --url/--scenario-ids flags the run command rejects", () => {
    const args = buildWorkerArgs("/pkg/dist/cli/index.js", "https://example.com", "haiku", 2, "run-123", ["a"]);
    expect(args).not.toContain("--url");
    expect(args).not.toContain("--scenario-ids");
    // The URL is the positional argument after the "run" subcommand (the
    // first "run" is the bun verb).
    const cliPathIdx = args.indexOf("/pkg/dist/cli/index.js");
    expect(args[cliPathIdx + 1]).toBe("run");
    expect(args[cliPathIdx + 2]).toBe("https://example.com");
  });

  test("appends --timeout and --persona only when provided", () => {
    const base = buildWorkerArgs("/pkg/dist/cli/index.js", "https://example.com", "haiku", 2, "run-123", ["a"]);
    expect(base).not.toContain("--timeout");
    expect(base).not.toContain("--persona");

    const full = buildWorkerArgs("/pkg/dist/cli/index.js", "https://example.com", "haiku", 2, "run-123", ["a"], {
      timeout: 60000,
      personaId: "persona-1",
    });
    expect(full.slice(-4)).toEqual(["--timeout", "60000", "--persona", "persona-1"]);
  });
});
