import { describe, expect, it } from "bun:test";
import { parseServerArgs } from "./args.js";

describe("parseServerArgs", () => {
  it("returns help text for --help", () => {
    const parsed = parseServerArgs(["--help"], "0.1.8");
    expect(parsed?.type).toBe("help");
    expect(parsed?.text).toContain("Usage: security-serve");
  });

  it("returns version text for --version", () => {
    const parsed = parseServerArgs(["--version"], "0.1.8");
    expect(parsed).toEqual({ type: "version", text: "0.1.8" });
  });

  it("returns null when no control flag is passed", () => {
    const parsed = parseServerArgs(["--port", "19428"], "0.1.8");
    expect(parsed).toBeNull();
  });
});
