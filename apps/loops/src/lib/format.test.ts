import { describe, expect, test } from "bun:test";
import { textOutputBlocks } from "./format.js";

describe("textOutputBlocks", () => {
  test("renders stdout and stderr blocks for human --show-output mode", () => {
    expect(textOutputBlocks({ stdout: "hello\n", stderr: "warn\n" }, { indent: "  " })).toEqual([
      "  stdout:",
      "    hello",
      "  stderr:",
      "    warn",
    ]);
  });

  test("omits empty output streams", () => {
    expect(textOutputBlocks({ stdout: "", stderr: undefined }, { indent: "  " })).toEqual([]);
  });
});
