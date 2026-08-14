process.env.TESTERS_DB_PATH = ":memory:";

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { resetDatabase, closeDatabase } from "./database.js";
import { createScreenshot, getScreenshot, listScreenshots, getScreenshotsByResult } from "./screenshots.js";
import { createRun } from "./runs.js";
import { createScenario } from "./scenarios.js";
import { createResult } from "./results.js";

function createTestResult() {
  const scenario = createScenario({ name: "Test", description: "Desc", steps: ["step1"] });
  const run = createRun({ url: "http://localhost:3000", model: "model" });
  const result = createResult({ runId: run.id, scenarioId: scenario.id, model: "model", stepsTotal: 1 });
  return result;
}

describe("screenshots", () => {
  beforeEach(() => {
    resetDatabase();
  });

  afterEach(() => {
    closeDatabase();
  });

  describe("createScreenshot", () => {
    test("creates a screenshot with correct fields", () => {
      const result = createTestResult();
      const screenshot = createScreenshot({
        resultId: result.id,
        stepNumber: 1,
        action: "click #submit",
        filePath: "/tmp/screenshots/step-1.png",
        width: 1920,
        height: 1080,
      });

      expect(screenshot.id).toBeDefined();
      expect(screenshot.resultId).toBe(result.id);
      expect(screenshot.stepNumber).toBe(1);
      expect(screenshot.action).toBe("click #submit");
      expect(screenshot.filePath).toBe("/tmp/screenshots/step-1.png");
      expect(screenshot.width).toBe(1920);
      expect(screenshot.height).toBe(1080);
      expect(screenshot.timestamp).toBeDefined();
    });

    test("creates multiple screenshots for the same result", () => {
      const result = createTestResult();

      const s1 = createScreenshot({
        resultId: result.id,
        stepNumber: 1,
        action: "navigate to /login",
        filePath: "/tmp/s1.png",
        width: 1920,
        height: 1080,
      });
      const s2 = createScreenshot({
        resultId: result.id,
        stepNumber: 2,
        action: "fill email",
        filePath: "/tmp/s2.png",
        width: 1920,
        height: 1080,
      });

      expect(s1.id).not.toBe(s2.id);
      expect(s1.stepNumber).toBe(1);
      expect(s2.stepNumber).toBe(2);
    });
  });

  describe("getScreenshot", () => {
    test("gets a screenshot by ID", () => {
      const result = createTestResult();
      const created = createScreenshot({
        resultId: result.id,
        stepNumber: 1,
        action: "click",
        filePath: "/tmp/s.png",
        width: 800,
        height: 600,
      });

      const found = getScreenshot(created.id);
      expect(found).not.toBeNull();
      expect(found!.id).toBe(created.id);
      expect(found!.action).toBe("click");
    });

    test("returns null for non-existent screenshot", () => {
      const found = getScreenshot("nonexistent");
      expect(found).toBeNull();
    });
  });

  describe("listScreenshots", () => {
    test("lists screenshots for a result ordered by step number", () => {
      const result = createTestResult();

      createScreenshot({ resultId: result.id, stepNumber: 3, action: "submit", filePath: "/tmp/s3.png", width: 800, height: 600 });
      createScreenshot({ resultId: result.id, stepNumber: 1, action: "navigate", filePath: "/tmp/s1.png", width: 800, height: 600 });
      createScreenshot({ resultId: result.id, stepNumber: 2, action: "fill", filePath: "/tmp/s2.png", width: 800, height: 600 });

      const screenshots = listScreenshots(result.id);
      expect(screenshots.length).toBe(3);
      expect(screenshots[0]!.stepNumber).toBe(1);
      expect(screenshots[1]!.stepNumber).toBe(2);
      expect(screenshots[2]!.stepNumber).toBe(3);
    });

    test("returns empty array for result with no screenshots", () => {
      const result = createTestResult();
      const screenshots = listScreenshots(result.id);
      expect(screenshots).toEqual([]);
    });

    test("does not return screenshots from other results", () => {
      const result1 = createTestResult();
      const scenario2 = createScenario({ name: "Test 2", description: "D2" });
      const run2 = createRun({ url: "http://localhost:3001", model: "model" });
      const result2 = createResult({ runId: run2.id, scenarioId: scenario2.id, model: "model", stepsTotal: 1 });

      createScreenshot({ resultId: result1.id, stepNumber: 1, action: "a1", filePath: "/tmp/r1.png", width: 800, height: 600 });
      createScreenshot({ resultId: result2.id, stepNumber: 1, action: "a2", filePath: "/tmp/r2.png", width: 800, height: 600 });

      const s1 = listScreenshots(result1.id);
      expect(s1.length).toBe(1);
      expect(s1[0]!.action).toBe("a1");
    });
  });

  describe("getScreenshotsByResult", () => {
    test("returns same results as listScreenshots", () => {
      const result = createTestResult();
      createScreenshot({ resultId: result.id, stepNumber: 1, action: "click", filePath: "/tmp/s.png", width: 800, height: 600 });

      const fromList = listScreenshots(result.id);
      const fromGetBy = getScreenshotsByResult(result.id);

      expect(fromList.length).toBe(fromGetBy.length);
      expect(fromList[0]!.id).toBe(fromGetBy[0]!.id);
    });

    test("returns empty array when no screenshots exist", () => {
      const screenshots = getScreenshotsByResult("nonexistent-result-id");
      expect(screenshots).toEqual([]);
    });
  });
});
