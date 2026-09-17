import { describe, expect, test } from "bun:test";
import { resolveFilesMcpProfile, shouldRegisterFilesMcpTool } from "./profiles.js";

describe("Files MCP profiles", () => {
  test("defaults to standard and lets --profile override both env names", () => {
    expect(resolveFilesMcpProfile({})).toBe("standard");
    expect(resolveFilesMcpProfile({ HASNA_FILES_MCP_PROFILE: "minimal" })).toBe("minimal");
    expect(resolveFilesMcpProfile({ HASNA_FILES_MCP_PROFILE: "minimal" }, ["--profile", "full"])).toBe("full");
    expect(resolveFilesMcpProfile({}, ["--profile=minimal"])).toBe("minimal");
  });

  test("rejects invalid profiles before a server can bind", () => {
    expect(() => resolveFilesMcpProfile({}, ["--profile", "wide"])).toThrow(/expected minimal, standard, or full/);
    expect(() => resolveFilesMcpProfile({}, ["--profile"])).toThrow(/requires/);
    expect(() => resolveFilesMcpProfile({}, ["--profile", "minimal", "--profile=full"])).toThrow(/only once/);
    expect(() => resolveFilesMcpProfile({}, ["--profile", "--http"])).toThrow(/requires/);
  });

  test("reduced profiles omit capability-unavailable tools while full preserves discovery", () => {
    expect(shouldRegisterFilesMcpTool({ name: "download_file", profile: "standard", capabilityAvailable: false, transport: "local" })).toBe(false);
    expect(shouldRegisterFilesMcpTool({ name: "download_file", profile: "standard", capabilityAvailable: true, transport: "local" })).toBe(true);
    expect(shouldRegisterFilesMcpTool({ name: "add_source", profile: "standard", capabilityAvailable: true, transport: "local" })).toBe(false);
    expect(shouldRegisterFilesMcpTool({ name: "add_source", profile: "full", capabilityAvailable: false, transport: "api" })).toBe(true);
    expect(shouldRegisterFilesMcpTool({ name: "build_context_pack", profile: "standard", capabilityAvailable: true, transport: "api" })).toBe(false);
    expect(shouldRegisterFilesMcpTool({ name: "build_context_pack", profile: "standard", capabilityAvailable: true, transport: "local" })).toBe(true);
  });
});
