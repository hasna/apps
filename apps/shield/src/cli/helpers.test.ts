import { describe, expect, it } from "bun:test";
import { ReportFormat, ScannerType, Severity } from "../types/index.js";
import { parseFormat, parseScannerType, parseSeverity } from "./helpers.js";

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
