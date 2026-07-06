import { describe, expect, test } from "bun:test";
import packageJson from "../package.json";
import { parseCliCommandNames, REQUIRED_BIN_NAMES } from "../src/release/package-smoke.js";

describe("package smoke script", () => {
  test("tracks every published bin name", () => {
    expect([...REQUIRED_BIN_NAMES].sort()).toEqual(Object.keys(packageJson.bin).sort());
  });

  test("parses installed CLI top-level command help", () => {
    const commands = parseCliCommandNames(`
Usage: consolidations [options] [command]

Commands:
  runs                   runs operations
  fx-rates               fx-rates operations
  openapi                OpenAPI document tooling
  help [command]         display help for command
`);
    expect(commands).toEqual(["fx-rates", "openapi", "runs"]);
  });
});
