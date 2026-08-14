import { describe, expect, test } from "bun:test";
import { DEFAULT_CONFIG, DEFAULT_FILE_SCANNERS, ScannerType } from "../types/index.js";
import { getScanner, resolvePublicScannerTypes } from "./index.js";

describe("public scanner source boundary", () => {
  test("library and config defaults contain only registered file scanners", () => {
    expect(DEFAULT_CONFIG.enabled_scanners).toEqual(DEFAULT_FILE_SCANNERS);
    expect(DEFAULT_FILE_SCANNERS).not.toContain(ScannerType.GitHistory);
    expect(DEFAULT_FILE_SCANNERS.every((type) => getScanner(type) !== undefined)).toBe(true);
  });

  test("API and MCP request resolution is file-only by default", () => {
    expect(resolvePublicScannerTypes()).toEqual(DEFAULT_FILE_SCANNERS);
    expect(resolvePublicScannerTypes([])).toEqual(DEFAULT_FILE_SCANNERS);
    expect(resolvePublicScannerTypes()).not.toContain(ScannerType.GitHistory);
  });

  test("git history requires the dedicated opt-in and unknown scanners fail closed", () => {
    expect(resolvePublicScannerTypes([ScannerType.Code, ScannerType.GitHistory])).toEqual([
      ScannerType.Code,
    ]);
    expect(resolvePublicScannerTypes([ScannerType.Code, ScannerType.GitHistory], true)).toEqual([
      ScannerType.Code,
      ScannerType.GitHistory,
    ]);
    expect(() => resolvePublicScannerTypes(["unknown"])).toThrow("Unknown or unavailable");
    expect(() => resolvePublicScannerTypes([ScannerType.CiCd])).toThrow("Unknown or unavailable");
  });
});
