import { describe, expect, test } from "bun:test";
import {
  normalizeFolderPathSegments,
  normalizeSafeRelativePath,
  sanitizePathSegment,
} from "./path.js";

describe("SDK-safe file path helpers", () => {
  test("sanitizes file and folder path segments without filesystem access", () => {
    expect(sanitizePathSegment("../bad/name\0with spaces.txt")).toBe(
      "badnamewith_spaces.txt",
    );
    expect(sanitizePathSegment("...", { fallback: "fallback.bin" })).toBe(
      "fallback.bin",
    );
    expect(sanitizePathSegment("x".repeat(250))).toHaveLength(200);
  });

  test("normalizes folder path segments with bounded depth", () => {
    expect(
      normalizeFolderPathSegments(" Reports / Q1\\Invoices ", {
        fallback: "Downloads",
        maxDepth: 6,
      }),
    ).toEqual(["Reports", "Q1", "Invoices"]);
    expect(
      normalizeFolderPathSegments("../", {
        fallback: "Downloads",
        maxDepth: 6,
      }),
    ).toEqual(["folder", "folder"]);
    expect(
      normalizeFolderPathSegments("a/b/c/d/e/f/g", {
        fallback: "Downloads",
        maxDepth: 3,
      }),
    ).toEqual(["a", "b", "c"]);
    expect(normalizeFolderPathSegments("", { fallback: "My Files" })).toEqual([
      "My_Files",
    ]);
  });

  test("normalizes safe relative paths and rejects traversal", () => {
    expect(normalizeSafeRelativePath("src\\index.ts")).toBe("src/index.ts");
    expect(normalizeSafeRelativePath("", { allowEmpty: true })).toBe("");
    expect(() => normalizeSafeRelativePath("/etc/passwd")).toThrow(
      "Absolute paths are not allowed",
    );
    expect(() => normalizeSafeRelativePath("\\etc\\passwd")).toThrow(
      "Absolute paths are not allowed",
    );
    expect(() => normalizeSafeRelativePath("../secret")).toThrow(
      "Path traversal segments not allowed",
    );
    expect(() => normalizeSafeRelativePath("foo\0bar")).toThrow(
      "Path contains null byte",
    );
  });
});
