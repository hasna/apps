import { describe, expect, test } from "bun:test";
import { getMergeOutputDirectory } from "./data.js";

describe("data merge output directory", () => {
  test("returns parent directory for explicit output path", () => {
    expect(getMergeOutputDirectory("/tmp/brains/out/merged.jsonl")).toBe("/tmp/brains/out");
  });

  test("falls back to dataset directory when output path is empty", () => {
    expect(getMergeOutputDirectory(""))
      .toContain(".hasna/brains/datasets");
  });
});
