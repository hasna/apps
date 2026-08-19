import { describe, test, expect, beforeAll } from "bun:test";
import { mkdirSync, writeFileSync, readFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { Command } from "commander";
import { mcpCommand } from "./mcp.js";

// Sol-guided coverage (tests-coverage-sol workflow, evals lane):
//   "Cover Claude/Codex/Gemini defaults and start spawn with a stub child."
//
// `evals mcp start` spawns the current runtime (process.execPath) with the MCP
// server entry path. mock.module cannot intercept the builtin child_process
// module and bun cannot exec a shell script as the child (measured 2026-08-19),
// so the child is a bun --compile stub binary: process.execPath is pointed at a
// freshly compiled binary that records its argv to a fixed path, and the test
// asserts the spawned entry path targets the MCP server bundle.

let stubDir: string;
let stubBin: string;
let stubOut: string;

beforeAll(() => {
  stubDir = join(tmpdir(), "evals-mcp-start-" + Date.now());
  mkdirSync(stubDir, { recursive: true });
  stubOut = join(stubDir, "spawned-argv.txt");
  const stubSrc = join(stubDir, "stub.ts");
  // The output path is embedded as a literal — this is generated test
  // scaffolding in a temp dir, never a committed brittle path.
  writeFileSync(stubSrc, `import { writeFileSync } from "fs";\nwriteFileSync(${JSON.stringify(stubOut)}, process.argv.slice(2).join(" ") + "\\n");\n`);
  stubBin = join(stubDir, "stub-mcp-child");
  const built = Bun.spawnSync(["bun", "build", stubSrc, "--compile", "--outfile", stubBin], {
    stdout: "pipe",
    stderr: "pipe",
  });
  expect(built.exitCode).toBe(0);
});

describe("evals mcp start", () => {
  test("spawns the stub child with the MCP server entry path", async () => {
    const origExecPath = process.execPath;

    Object.defineProperty(process, "execPath", { value: stubBin, configurable: true });
    const program = new Command("evals").version("0.0.0");
    program.addCommand(mcpCommand().exitOverride());
    program.exitOverride();
    try {
      await program.parseAsync(["mcp", "start"], { from: "user" });
    } finally {
      Object.defineProperty(process, "execPath", { value: origExecPath, configurable: true });
    }

    const recorded = readFileSync(stubOut, "utf8").trim();
    // The spawned child was asked to run the MCP server entry, not something else.
    expect(recorded).toContain("mcp/index.js");
  });
});
