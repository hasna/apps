import { describe, expect, test } from "bun:test";
import { handleServerCliArgs, getServerHelpText } from "./index.js";

describe("server CLI flags", () => {
  test("prints help and exits when --help is used", () => {
    const out: string[] = [];
    const handled = handleServerCliArgs(["--help"], (msg) => out.push(msg));

    expect(handled).toBe(true);
    expect(out).toHaveLength(1);
    expect(out[0]).toBe(getServerHelpText());
    expect(out[0]).toContain("Usage: omp-serve [options]");
  });

  test("prints version and exits when --version is used", () => {
    const out: string[] = [];
    const handled = handleServerCliArgs(["--version"], (msg) => out.push(msg));

    expect(handled).toBe(true);
    expect(out).toEqual(["0.1.0"]);
  });

  test("does not handle unrelated args", () => {
    const out: string[] = [];
    const handled = handleServerCliArgs(["--port", "8080"], (msg) => out.push(msg));

    expect(handled).toBe(false);
    expect(out).toHaveLength(0);
  });
});
