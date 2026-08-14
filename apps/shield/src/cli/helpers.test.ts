import { describe, expect, it } from "bun:test";
import { DEFAULT_CONFIG, ReportFormat, ScannerType, Severity } from "../types/index.js";
import { parseFormat, parseScannerType, parseSeverity, resolveScannerTypes } from "./helpers.js";

describe("parseSeverity", () => {
  it("parses valid severities case-insensitively", () => {
    expect(parseSeverity("critical")).toBe(Severity.Critical);
    expect(parseSeverity("HIGH")).toBe(Severity.High);
  });

  it("throws on invalid severities", () => {
    expect(() => parseSeverity("urgent")).toThrow("Invalid severity");
  });
});

describe("parseFormat", () => {
  it("parses valid formats case-insensitively", () => {
    expect(parseFormat("json")).toBe(ReportFormat.Json);
    expect(parseFormat("SARIF")).toBe(ReportFormat.Sarif);
  });

  it("throws on invalid formats", () => {
    expect(() => parseFormat("xml")).toThrow("Invalid format");
  });
});

describe("parseScannerType", () => {
  it("parses valid scanner names case-insensitively", () => {
    expect(parseScannerType("secrets")).toBe(ScannerType.Secrets);
    expect(parseScannerType("DEPENDENCIES")).toBe(ScannerType.Dependencies);
  });

  it("throws on invalid scanner names", () => {
    expect(() => parseScannerType("foo")).toThrow("Invalid scanner");
  });
});

describe("resolveScannerTypes source boundary", () => {
  it("filters legacy config git history unless the current invocation opts in", () => {
    const legacyConfig = {
      ...DEFAULT_CONFIG,
      enabled_scanners: [...DEFAULT_CONFIG.enabled_scanners, ScannerType.GitHistory],
    };
    expect(resolveScannerTypes(undefined, false, legacyConfig)).not.toContain(ScannerType.GitHistory);
    expect(resolveScannerTypes(undefined, false, legacyConfig, true)).toContain(ScannerType.GitHistory);
  });

  it("treats naming git-history with --scanner as an explicit opt-in", () => {
    expect(resolveScannerTypes("git-history", false, DEFAULT_CONFIG)).toEqual([ScannerType.GitHistory]);
  });

  it("honors an explicit history opt-in alongside quick or named scanners", () => {
    expect(resolveScannerTypes(undefined, true, DEFAULT_CONFIG, true)).toContain(ScannerType.GitHistory);
    expect(resolveScannerTypes("code", false, DEFAULT_CONFIG, true)).toEqual([
      ScannerType.Code,
      ScannerType.GitHistory,
    ]);
  });
});
