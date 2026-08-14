import { describe, expect, it } from "bun:test";
import { parseCliCommandNames, REQUIRED_BIN_NAMES } from "../src/release/package-smoke.js";

describe("package smoke script", () => {
  it("declares the three holdings bins", () => {
    expect([...REQUIRED_BIN_NAMES]).toEqual(["holdings", "holdings-mcp", "holdings-serve"]);
  });

  it("parses commander top-level command names from help output", () => {
    const help = [
      "Usage: holdings [options] [command]",
      "",
      "Commands:",
      "  asset            asset operations",
      "  registration     registration operations",
      "  openapi          OpenAPI document operations",
      "  help [command]   display help",
    ].join("\n");
    const names = parseCliCommandNames(help);
    expect(names).toContain("asset");
    expect(names).toContain("registration");
    expect(names).toContain("openapi");
    expect(names).not.toContain("help");
  });
});
