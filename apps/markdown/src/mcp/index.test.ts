import { describe, expect, test } from "bun:test";
import { handleMcpCliArgs, getMcpHelpText } from "./index.js";

describe("mcp CLI flags", () => {
  test("prints help and exits when --help is used", () => {
    const out: string[] = [];
    const handled = handleMcpCliArgs(["--help"], (msg) => out.push(msg));

    expect(handled).toBe(true);
    expect(out).toHaveLength(1);
    expect(out[0]).toBe(getMcpHelpText());
    expect(out[0]).toContain("Usage: omp-mcp [options]");
  });

  test("prints version and exits when --version is used", () => {
    const out: string[] = [];
    const handled = handleMcpCliArgs(["--version"], (msg) => out.push(msg));

    expect(handled).toBe(true);
    expect(out).toEqual(["0.1.0"]);
  });

  test("does not handle unrelated args", () => {
    const out: string[] = [];
    const handled = handleMcpCliArgs(["--stdio"], (msg) => out.push(msg));

    expect(handled).toBe(false);
    expect(out).toHaveLength(0);
  });
});
