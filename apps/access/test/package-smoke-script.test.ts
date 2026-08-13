import { describe, expect, test } from "bun:test";
import packageJson from "../package.json";
import { parseCliCommandNames, REQUIRED_BIN_NAMES } from "../src/release/package-smoke.js";

describe("package smoke script", () => {
  test("tracks every published bin name", () => {
    expect([...REQUIRED_BIN_NAMES].sort()).toEqual(Object.keys(packageJson.bin).sort());
  });

  test("parses installed CLI top-level command help", () => {
    const commands = parseCliCommandNames(`
Usage: access [options] [command]

Commands:
  identity               Manage non-human identities
  credential             Manage credential references
  token                  Issue and verify MCP bearer tokens
  help [command]         display help for command
`);

    expect(commands).toEqual(["credential", "identity", "token"]);
  });
});
