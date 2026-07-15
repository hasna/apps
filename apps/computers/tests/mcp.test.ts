import { describe, expect, test } from "bun:test";
import { SAFE_MCP_TOOLS } from "../src/mcp";

describe("MCP safe surface", () => {
  test("omits destructive, policy, restore, reassignment, and Sandbox mutation tools", () => {
    const names = SAFE_MCP_TOOLS.map((tool) => tool.name).join(" ");
    for (const forbidden of ["delete", "restore", "reassign", "policy", "sandbox"]) expect(names).not.toContain(forbidden);
    expect(names).toContain("computers_exec_request");
    expect(names).toContain("computers_install_plan");
  });
});
