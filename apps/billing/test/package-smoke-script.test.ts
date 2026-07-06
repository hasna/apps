import { describe, expect, test } from "bun:test";
import packageJson from "../package.json";
import { parseCliCommandNames, REQUIRED_BIN_NAMES } from "../src/release/package-smoke.js";

describe("package smoke script", () => {
  test("tracks every published bin name", () => {
    expect([...REQUIRED_BIN_NAMES].sort()).toEqual(Object.keys(packageJson.bin).sort());
  });

  test("bins match the three-bin triad", () => {
    expect([...REQUIRED_BIN_NAMES].sort()).toEqual(["billing", "billing-mcp", "billing-serve"]);
  });

  test("parses installed CLI top-level command help", () => {
    const commands = parseCliCommandNames(`
Usage: billing [options] [command]

Commands:
  customers              customers operations
  dunning-policies       dunning_policies operations
  help [command]         display help for command
`);
    expect(commands).toEqual(["customers", "dunning-policies"]);
  });
});
