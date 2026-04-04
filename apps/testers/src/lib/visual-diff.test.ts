process.env.TESTERS_DB_PATH = ":memory:";

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { compareImages, formatVisualDiffTerminal } from "./visual-diff.js";
import { resetDatabase, closeDatabase } from "../db/database.js";
import { createRun, updateRun } from "../db/runs.js";
import { createResult, updateResult, getResult } from "../db/results.js";
import { createScenario } from "../db/scenarios.js";
import { createScreenshot } from "../db/screenshots.js";
import { compareRunScreenshots, setBaseline, getBaseline } from "./visual-diff.js";
import { existsSync, mkdirSync, writeFileSync, rmSync } from "fs";
import { join } from "path";

const tmpDir = join(__dirname, "..", "..", "tmp-visual-test");

function createTestPng(path: string, color: string): void {
  // Minimal 1x1 PNG
  const redPng = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==",
    "base64",
  );
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, redPng);
}

function dirname(p: string): string {
  return p.split("/").slice(0, -1).join("/") || ".";
}

describe("visual regression (OPE9-00256)", () => {
  beforeEach(() => {
    resetDatabase();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  afterEach(() => {
    closeDatabase();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  describe("setBaseline/getBaseline", () => {
    test("sets and retrieves baseline", () => {
      const run = createRun({ url: "http://test.example", model: "quick" });
      setBaseline(run.id);
      const baseline = getBaseline();
      expect(baseline).not.toBeNull();
      expect(baseline!.id).toBe(run.id);
    });

    test("replaces previous baseline", () => {
      const run1 = createRun({ url: "http://test.example", model: "quick" });
      setBaseline(run1.id);

      const run2 = createRun({ url: "http://test.example", model: "quick" });
      setBaseline(run2.id);

      const baseline = getBaseline();
      expect(baseline!.id).toBe(run2.id);
    });

    test("returns null when no baseline set", () => {
      expect(getBaseline()).toBeNull();
    });
  });

  describe("compareImages", () => {
    test("returns 0% diff for identical images", () => {
      const path = join(tmpDir, "same.png");
      createTestPng(path, "red");
      const result = compareImages(path, path);
      expect(result.diffPercent).toBe(0);
      expect(result.diffPixels).toBe(0);
    });

    test("throws if baseline image not found", () => {
      const path = join(tmpDir, "missing.png");
      const current = join(tmpDir, "exists.png");
      createTestPng(current, "red");
      expect(() => compareImages(path, current)).toThrow("Baseline image not found");
    });

    test("throws if current image not found", () => {
      const baseline = join(tmpDir, "exists.png");
      createTestPng(baseline, "red");
      const current = join(tmpDir, "missing.png");
      expect(() => compareImages(baseline, current)).toThrow("Current image not found");
    });
  });

  describe("compareRunScreenshots", () => {
    test("returns empty array when no screenshots", () => {
      const run = createRun({ url: "http://test.example", model: "quick" });
      const results = compareRunScreenshots(run.id, run.id);
      expect(results).toHaveLength(0);
    });

    test("compares matching screenshots between runs", () => {
      const baselineRun = createRun({ url: "http://test.example", model: "quick" });
      const currentRun = createRun({ url: "http://test.example", model: "quick" });

      const scenario = createScenario({ name: "Visual Test", description: "Test visual" });
      const baselineResult = createResult({ runId: baselineRun.id, scenarioId: scenario.id, model: "quick", stepsTotal: 1 });
      const currentResult = createResult({ runId: currentRun.id, scenarioId: scenario.id, model: "quick", stepsTotal: 1 });

      // Same image for both runs
      const imgPath = join(tmpDir, "test.png");
      createTestPng(imgPath, "red");

      createScreenshot({ resultId: baselineResult.id, stepNumber: 1, action: "check", filePath: imgPath, width: 1280, height: 720 });
      createScreenshot({ resultId: currentResult.id, stepNumber: 1, action: "check", filePath: imgPath, width: 1280, height: 720 });

      const results = compareRunScreenshots(currentRun.id, baselineRun.id);
      expect(results).toHaveLength(1);
      expect(results[0].diffPercent).toBe(0);
      expect(results[0].isRegression).toBe(false);
    });

    test("throws for invalid run ID", () => {
      expect(() => compareRunScreenshots("nonexistent", "also-nonexistent")).toThrow("Run not found");
    });
  });

  describe("formatVisualDiffTerminal", () => {
    test("formats empty results", () => {
      const output = formatVisualDiffTerminal([]);
      expect(output).toContain("No screenshot comparisons");
    });

    test("formats passing results", () => {
      const scenario = createScenario({ name: "Pass Test", description: "Visual pass" });
      const results = [{
        scenarioId: scenario.id,
        stepNumber: 1,
        action: "check",
        baselinePath: "/tmp/baseline.png",
        currentPath: "/tmp/current.png",
        diffPercent: 0.01,
        isRegression: false,
      }];
      const output = formatVisualDiffTerminal(results);
      expect(output).toContain("Passed");
      expect(output).toContain("0.01%");
    });

    test("formats regression results", () => {
      const scenario = createScenario({ name: "Fail Test", description: "Visual fail" });
      const results = [{
        scenarioId: scenario.id,
        stepNumber: 1,
        action: "check",
        baselinePath: "/tmp/baseline.png",
        currentPath: "/tmp/current.png",
        diffPercent: 5.5,
        isRegression: true,
      }];
      const output = formatVisualDiffTerminal(results);
      expect(output).toContain("Regressions");
      expect(output).toContain("5.50%");
    });
  });
});
