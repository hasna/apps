import { describe, expect, it } from "bun:test";
import { REQUIRED_BIN_NAMES, parseCliCommandNames } from "../src/release/package-smoke.ts";

// Unit-level guardrails for the package smoke script. The full pack+install
// smoke is run via `bun run smoke:package` (network/npm), not in the unit suite.
describe("package smoke script", () => {
  it("declares the three canonical bins", () => {
    expect([...REQUIRED_BIN_NAMES]).toEqual(["workforce", "workforce-mcp", "workforce-serve"]);
  });

  it("parses top-level command names from CLI help output", () => {
    const help = [
      "Usage: workforce [options] [command]",
      "",
      "Commands:",
      "  member          Roster member operations",
      "  assignment      Member-to-entity/project assignments",
      "  help [command]  display help for command",
    ].join("\n");
    const names = parseCliCommandNames(help);
    expect(names).toContain("member");
    expect(names).toContain("assignment");
    expect(names).not.toContain("help");
  });
});
