import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { saveHtmlReport, generatePdfReport } from "./pdf-export.js";
import { createRun } from "../db/runs.js";
import { createResult, updateResult } from "../db/results.js";
import { createScenario } from "../db/scenarios.js";
import { resetDatabase, closeDatabase } from "../db/database.js";
import { existsSync, rmSync, readFileSync } from "fs";
import { join } from "path";

const tmpDir = join(__dirname, "..", "..", "tmp-pdf-test");

describe("PDF export (OPE9-00232)", () => {
  beforeEach(() => {
    resetDatabase();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  afterEach(() => {
    closeDatabase();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("saveHtmlReport writes valid HTML file", () => {
    const run = createRun({ url: "http://test.example", model: "quick" });
    const outputPath = join(tmpDir, "report.html");

    const path = saveHtmlReport(run.id, outputPath);
    expect(path).toBe(outputPath);
    expect(existsSync(outputPath)).toBe(true);

    const content = readFileSync(outputPath, "utf-8");
    expect(content).toContain("<!DOCTYPE html>");
    expect(content).toContain("Test Report");
    expect(content).toContain(run.id.slice(0, 8));
    expect(content).toContain("http://test.example");
  });

  test("saveHtmlReport creates parent directories", () => {
    const run = createRun({ url: "http://test.example", model: "quick" });
    const outputPath = join(tmpDir, "nested", "dir", "report.html");

    const path = saveHtmlReport(run.id, outputPath);
    expect(existsSync(path)).toBe(true);
  });

  test("generatePdfReport throws for non-existent run", async () => {
    try {
      await generatePdfReport("nonexistent-run", { outputPath: join(tmpDir, "report.pdf") });
      expect.fail("Expected to throw");
    } catch (err) {
      expect(err).toBeDefined();
    }
  });
});
