process.env.TESTERS_DB_PATH = ":memory:";

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { generateHtmlReport, generateLatestReport, imageToBase64 } from "./report.js";
import { createRun, updateRun } from "../db/runs.js";
import { createResult, updateResult, getResult } from "../db/results.js";
import { createScenario } from "../db/scenarios.js";
import { createScreenshot } from "../db/screenshots.js";
import { resetDatabase, closeDatabase } from "../db/database.js";
import { existsSync, mkdirSync, writeFileSync, rmSync } from "fs";
import { join } from "path";

const tmpDir = join(__dirname, "..", "..", "tmp-report-test");

describe("HTML report export (OPE9-00259)", () => {
  beforeEach(() => {
    resetDatabase();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  afterEach(() => {
    closeDatabase();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("generates HTML report for a run", () => {
    const run = createRun({ url: "http://test.example", model: "quick" });
    const scenario = createScenario({ name: "Test Scenario", description: "Should work" });
    const result = createResult({ runId: run.id, scenarioId: scenario.id, model: "quick", stepsTotal: 1 });
    updateResult(result.id, { status: "passed", durationMs: 5000 });
    updateRun(run.id, { status: "passed" });

    const html = generateHtmlReport(run.id);
    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain("Test Report");
    expect(html).toContain(run.id.slice(0, 8));
    expect(html).toContain("http://test.example");
    expect(html).toContain("Test Scenario");
    expect(html).toContain("PASSED");
  });

  test("generates report with failed scenarios", () => {
    const run = createRun({ url: "http://fail.example", model: "quick" });
    const scenario = createScenario({ name: "Failing Test", description: "Should fail" });
    const result = createResult({ runId: run.id, scenarioId: scenario.id, model: "quick", stepsTotal: 1 });
    updateResult(result.id, { status: "failed", reasoning: "Element not found", error: "Could not locate button" });
    updateRun(run.id, { status: "failed" });

    const html = generateHtmlReport(run.id);
    expect(html).toContain("Failing Test");
    expect(html).toContain("FAILED");
    expect(html).toContain("Element not found");
    expect(html).toContain("Could not locate button");
  });

  test("generates report with summary counts", () => {
    const run = createRun({ url: "http://multi.example", model: "quick" });

    const s1 = createScenario({ name: "Pass 1", description: "Pass" });
    const r1 = createResult({ runId: run.id, scenarioId: s1.id, model: "quick", stepsTotal: 1 });
    updateResult(r1.id, { status: "passed", durationMs: 1000 });

    const s2 = createScenario({ name: "Pass 2", description: "Pass" });
    const r2 = createResult({ runId: run.id, scenarioId: s2.id, model: "quick", stepsTotal: 1 });
    updateResult(r2.id, { status: "passed", durationMs: 2000 });

    const s3 = createScenario({ name: "Fail 1", description: "Fail" });
    const r3 = createResult({ runId: run.id, scenarioId: s3.id, model: "quick", stepsTotal: 1 });
    updateResult(r3.id, { status: "failed", reasoning: "timeout" });

    updateRun(run.id, { status: "failed" });

    const html = generateHtmlReport(run.id);
    expect(html).toContain("3"); // total
    expect(html).toContain("2"); // passed count
    expect(html).toContain("1"); // failed count
  });

  test("generates report for latest run", () => {
    const run = createRun({ url: "http://latest.example", model: "quick" });
    updateRun(run.id, { status: "passed" });

    const html = generateLatestReport();
    expect(html).toContain("Test Report");
    expect(html).toContain("latest.example");
  });

  test("imageToBase64 returns data URI for existing files", () => {
    mkdirSync(tmpDir, { recursive: true });
    const imgPath = join(tmpDir, "test.png");
    // Minimal 1x1 PNG
    const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==", "base64");
    writeFileSync(imgPath, png);

    const result = imageToBase64(imgPath);
    expect(result).toContain("data:image/png;base64,");
  });

  test("imageToBase64 returns empty string for missing files", () => {
    const result = imageToBase64("/nonexistent/file.png");
    expect(result).toBe("");
  });

  test("includes token and cost summary in footer", () => {
    const run = createRun({ url: "http://cost.example", model: "quick" });
    const scenario = createScenario({ name: "Costly Test", description: "Expensive" });
    const result = createResult({ runId: run.id, scenarioId: scenario.id, model: "quick", stepsTotal: 1 });
    updateResult(result.id, { status: "passed", durationMs: 1000, tokensUsed: 5000 });
    updateRun(run.id, { status: "passed" });

    const html = generateHtmlReport(run.id);
    expect(html).toContain("Total tokens:");
    expect(html).toContain("5,000");
    expect(html).toContain("Total cost:");
  });
});
