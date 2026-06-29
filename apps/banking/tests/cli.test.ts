import { describe, expect, test } from "bun:test";
import { runCli } from "../src/cli/index.ts";

describe("banking CLI scaffold", () => {
  test("help exits successfully", () => {
    expect(runCli(["--help"])).toBe(0);
  });

  test("provider list exits successfully", () => {
    expect(runCli(["providers", "list", "--json"])).toBe(0);
  });

  test("unknown command fails closed", () => {
    expect(runCli(["pay", "now"])).toBe(1);
  });
});
