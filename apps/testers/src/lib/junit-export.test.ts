process.env.TESTERS_DB_PATH = ":memory:";

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { resetDatabase, closeDatabase } from "../db/database.js";
import { toJUnitXml } from "./junit-export.js";
import { createRun } from "../db/runs.js";
import { createScenario } from "../db/scenarios.js";
import { createResult, updateResult, getResult } from "../db/results.js";

describe("JUnit XML export (OPE9-00255)", () => {
  beforeEach(() => {
    resetDatabase();
  });

  afterEach(() => {
    closeDatabase();
  });

  test("generates valid JUnit XML for passing results", () => {
    const run = createRun({ url: "http://test.example", model: "quick" });
    const scenario = createScenario({ name: "Pass Test", description: "Should pass" });
    const result = createResult({ runId: run.id, scenarioId: scenario.id, model: "quick", stepsTotal: 1 });
    updateResult(result.id, { status: "passed", durationMs: 5000, tokensUsed: 1000 });

    const xml = toJUnitXml(run.id, [getResult(result.id)!], "http://test.example");
    expect(xml).toContain('<?xml version="1.0" encoding="UTF-8"?>');
    expect(xml).toContain('tests="1"');
    expect(xml).toContain('failures="0"');
    expect(xml).toContain('errors="0"');
    expect(xml).toContain('name="Pass Test"');
    expect(xml).toContain("open-testers");
    expect(xml).toContain("<testsuites");
    expect(xml).toContain("</testsuites>");
  });

  test("generates JUnit XML with failure details", () => {
    const run = createRun({ url: "http://fail.example", model: "quick" });
    const s1 = createScenario({ name: "Fail Test", description: "Should fail" });
    const r1 = createResult({ runId: run.id, scenarioId: s1.id, model: "quick", stepsTotal: 1 });
    updateResult(r1.id, { status: "failed", reasoning: "Element not found", error: "Could not locate button", durationMs: 3000 });

    const s2 = createScenario({ name: "Pass Test", description: "Should pass" });
    const r2 = createResult({ runId: run.id, scenarioId: s2.id, model: "quick", stepsTotal: 1 });
    updateResult(r2.id, { status: "passed", durationMs: 2000 });

    const s3 = createScenario({ name: "Error Test", description: "Should error" });
    const r3 = createResult({ runId: run.id, scenarioId: s3.id, model: "quick", stepsTotal: 1 });
    updateResult(r3.id, { status: "error", error: "Browser crashed", durationMs: 1000 });

    const xml = toJUnitXml(run.id, [getResult(r1.id)!, getResult(r2.id)!, getResult(r3.id)!], "http://fail.example");
    expect(xml).toContain('tests="3"');
    expect(xml).toContain('failures="1"');
    expect(xml).toContain('errors="1"');
    expect(xml).toContain("<failure");
    expect(xml).toContain("<error");
  });

  test("generates JUnit XML with skipped results", () => {
    const run = createRun({ url: "http://skip.example", model: "quick" });
    const scenario = createScenario({ name: "Skipped Test", description: "Dependency failed" });
    const result = createResult({ runId: run.id, scenarioId: scenario.id, model: "quick", stepsTotal: 0 });
    // Already skipped by default
    const xml = toJUnitXml(run.id, [getResult(result.id)!], "http://skip.example");
    expect(xml).toContain('skipped="1"');
    expect(xml).toContain("<skipped/>");
  });

  test("escapes XML special characters in error messages", () => {
    const run = createRun({ url: "http://escape.example", model: "quick" });
    const scenario = createScenario({ name: "Escape <Test> & \"Quotes\"", description: "Test escaping" });
    const result = createResult({ runId: run.id, scenarioId: scenario.id, model: "quick", stepsTotal: 1 });
    updateResult(result.id, {
      status: "failed",
      error: 'Selector "<div>" not found & "stuff" broke',
      reasoning: "It's a <test>",
      durationMs: 1000,
    });

    const xml = toJUnitXml(run.id, [getResult(result.id)!], "http://escape.example");
    expect(xml).not.toContain("<div>");
    expect(xml).toContain("&lt;div&gt;");
    expect(xml).toContain("&amp;");
    expect(xml).toContain("&quot;");
    expect(xml).toContain("&apos;");
  });

  test("handles empty results", () => {
    const xml = toJUnitXml("run-empty", [], "http://empty.example");
    expect(xml).toContain('tests="0"');
    expect(xml).toContain("<testsuites");
  });
});
