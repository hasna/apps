import { describe, expect, test } from "bun:test";
import { parseServerCliArgs, getServerHelpText } from "./index.js";

describe("server CLI flags", () => {
  test("prints help and exits when --help is used", () => {
    const out: string[] = [];
    const parsed = parseServerCliArgs(["--help"], (msg) => out.push(msg));

    expect(parsed.handled).toBe(true);
    expect(out).toHaveLength(1);
    expect(out[0]).toBe(getServerHelpText());
    expect(out[0]).toContain("Usage: omp-serve [options]");
  });

  test("prints version and exits when --version is used", () => {
    const out: string[] = [];
    const parsed = parseServerCliArgs(["--version"], (msg) => out.push(msg));

    expect(parsed.handled).toBe(true);
    expect(out).toEqual(["0.1.3"]);
  });

  test("parses --port value", () => {
    const parsed = parseServerCliArgs(["--port", "8080"]);

    expect(parsed.handled).toBe(false);
    expect(parsed.port).toBe(8080);
  });

  test("parses --port=value", () => {
    const parsed = parseServerCliArgs(["--port=9090"]);

    expect(parsed.handled).toBe(false);
    expect(parsed.port).toBe(9090);
  });

  test("throws on invalid port", () => {
    expect(() => parseServerCliArgs(["--port", "abc"]))
      .toThrow("Invalid port: abc");
  });

  test("throws on missing port value", () => {
    expect(() => parseServerCliArgs(["--port"]))
      .toThrow("Missing value for --port");
  });
});
