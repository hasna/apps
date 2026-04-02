import { describe, expect, it } from "bun:test";
import { parseMcpArgs } from "./args.js";

describe("parseMcpArgs", () => {
  it("returns help text for --help", () => {
    const parsed = parseMcpArgs(["--help"], "0.1.8");
    expect(parsed?.type).toBe("help");
    expect(parsed?.text).toContain("Usage: security-mcp");
  });

  it("returns version text for -V", () => {
    const parsed = parseMcpArgs(["-V"], "0.1.8");
    expect(parsed).toEqual({ type: "version", text: "0.1.8" });
  });

  it("returns null for normal run arguments", () => {
    const parsed = parseMcpArgs([], "0.1.8");
    expect(parsed).toBeNull();
  });
});
