import { describe, expect, test } from "bun:test";
import { buildServer } from "./server.js";
import { resolveReposMcpProfile } from "./profile.js";

describe("Repos MCP profiles", () => {
  test("defaults to core and validates full", () => {
    expect(resolveReposMcpProfile([], {})).toBe("core");
    expect(resolveReposMcpProfile([], { HASNA_REPOS_MCP_PROFILE: "full" })).toBe("full");
    expect(resolveReposMcpProfile(["--mcp-profile", "full"], {})).toBe("full");
    expect(() => resolveReposMcpProfile(["--mcp-profile=wide"], {})).toThrow(/expected core or full/);
  });

  test("core omits mutation and scan tools while full preserves them", () => {
    const core = Object.keys((buildServer("core") as any)._registeredTools);
    const full = Object.keys((buildServer("full") as any)._registeredTools);
    expect(core).toContain("list_repos");
    expect(core).toContain("get_stats");
    expect(core).not.toContain("scan_repos");
    expect(full).toContain("scan_repos");
    expect(full.length).toBeGreaterThan(core.length);
  });
});
