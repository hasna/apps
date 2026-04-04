import type { Result, Scenario } from "../types/index.js";
import { getScenario } from "../db/scenarios.js";

export interface JUnitTestSuite {
  name: string;
  tests: number;
  failures: number;
  errors: number;
  skipped: number;
  time: number;
  timestamp: string;
  testCases: JUnitTestCase[];
}

export interface JUnitTestCase {
  name: string;
  classname: string;
  time: number;
  failure?: string;
  error?: string;
  skipped?: boolean;
}

/**
 * Convert test results to JUnit XML format for CI/CD integration.
 */
export function toJUnitXml(
  runId: string,
  results: Result[],
  baseUrl: string,
): string {
  const testCases = results.map((r) => {
    const scenario = getScenario(r.scenarioId);
    const scenarioName = scenario?.name ?? r.scenarioId;
    const durationSec = r.durationMs ? r.durationMs / 1000 : 0;

    const testCase: JUnitTestCase = {
      name: scenarioName,
      classname: `open-testers.${scenarioName}`,
      time: durationSec,
    };

    if (r.status === "failed") {
      testCase.failure = escapeXml(
        `Scenario: ${scenarioName}\nReason: ${r.reasoning ?? "No reasoning"}\nError: ${r.error ?? "N/A"}`,
      );
    } else if (r.status === "error") {
      testCase.error = escapeXml(
        `Scenario: ${scenarioName}\nError: ${r.error ?? "Unknown error"}`,
      );
    } else if (r.status === "skipped") {
      testCase.skipped = true;
    }

    return testCase;
  });

  const passed = results.filter((r) => r.status === "passed").length;
  const failed = results.filter((r) => r.status === "failed").length;
  const errors = results.filter((r) => r.status === "error").length;
  const skipped = results.filter((r) => r.status === "skipped").length;
  const totalTime = results.reduce((sum, r) => sum + (r.durationMs ?? 0), 0) / 1000;

  const suite: JUnitTestSuite = {
    name: `open-testers (${baseUrl})`,
    tests: results.length,
    failures: failed,
    errors,
    skipped,
    time: totalTime,
    timestamp: new Date().toISOString(),
    testCases,
  };

  return buildJUnitXml(suite, runId);
}

function buildJUnitXml(suite: JUnitTestSuite, runId: string): string {
  let xml = '<?xml version="1.0" encoding="UTF-8"?>\n';
  xml += `<testsuites name="${escapeXml(suite.name)}" tests="${suite.tests}" failures="${suite.failures}" errors="${suite.errors}" skipped="${suite.skipped}" time="${suite.time.toFixed(3)}" timestamp="${suite.timestamp}">\n`;
  xml += `  <testsuite name="${escapeXml(suite.name)}" tests="${suite.tests}" failures="${suite.failures}" errors="${suite.errors}" skipped="${suite.skipped}" time="${suite.time.toFixed(3)}">\n`;

  for (const tc of suite.testCases) {
    xml += `    <testcase name="${escapeXml(tc.name)}" classname="${escapeXml(tc.classname)}" time="${tc.time.toFixed(3)}">`;

    if (tc.skipped) {
      xml += "\n      <skipped/>";
      xml += `\n    </testcase>`;
    } else if (tc.failure) {
      xml += `\n      <failure message="Assertion failed">${tc.failure}</failure>`;
      xml += `\n    </testcase>`;
    } else if (tc.error) {
      xml += `\n      <error message="Runtime error">${tc.error}</error>`;
      xml += `\n    </testcase>`;
    } else {
      xml += `</testcase>`;
    }
    xml += "\n";
  }

  xml += `  </testsuite>\n`;
  xml += `</testsuites>\n`;
  return xml;
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
