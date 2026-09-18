import { describe, expect, test } from "bun:test";
import { CONTACTS_CORE_TOOL_NAMES, CONTACTS_FULL_TOOL_COUNT } from "../mcp/profile.js";

describe("contacts MCP setup output", () => {
  test("reports the actual default/full profiles and hosted list contract", () => {
    const result = Bun.spawnSync({
      cmd: ["bun", "run", "src/cli/index.tsx", "mcp"],
      stdout: "pipe",
      stderr: "pipe",
      env: { ...process.env, NO_COLOR: "1" },
    });
    const stdout = result.stdout.toString();
    expect(result.exitCode, result.stderr.toString()).toBe(0);
    expect(stdout).toContain(`core (${CONTACTS_CORE_TOOL_NAMES.length} tools)`);
    expect(stdout).toContain(`${CONTACTS_FULL_TOOL_COUNT}-tool full inventory`);
    expect(stdout).toContain("display_name asc, then id asc");
    expect(stdout).toContain("company_id, tag_id, status");
    expect(stdout).not.toContain("Available tools (24 total)");
  });
});
