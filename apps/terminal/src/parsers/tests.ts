// Parser for test runner output (jest, vitest, bun test, pytest, go test)

import type { Parser, TestResult } from "./base.js";

export const testParser: Parser<TestResult> = {
  name: "test",

  detect(command: string, output: string): boolean {
    if (/\b(jest|vitest|bun\s+test|pytest|go\s+test|mocha|ava|tap)\b/.test(command)) return true;
    if (/\b(npm|bun|pnpm|yarn)\s+(run\s+)?test\b/.test(command)) return true;
    // Detect by output patterns
    return /Tests:\s+\d+/.test(output) || /\d+\s+(passing|passed|failed)/.test(output) || /PASS|FAIL/.test(output);
  },

  parse(_command: string, output: string): TestResult {
    const failures: { test: string; error: string }[] = [];
    let passed = 0, failed = 0, skipped = 0, duration: string | undefined;

    // Jest/Vitest style: Tests: 5 passed, 2 failed, 7 total
    const jestMatch = output.match(/Tests:\s+(?:(\d+)\s+passed)?[,\s]*(?:(\d+)\s+failed)?[,\s]*(?:(\d+)\s+skipped)?[,\s]*(\d+)\s+total/);
    if (jestMatch) {
      passed = parseInt(jestMatch[1] ?? "0");
      failed = parseInt(jestMatch[2] ?? "0");
      skipped = parseInt(jestMatch[3] ?? "0");
    }

    // Bun test style: 5 pass, 2 fail
    const bunMatch = output.match(/(\d+)\s+pass.*?(\d+)\s+fail/);
    if (!jestMatch && bunMatch) {
      passed = parseInt(bunMatch[1]);
      failed = parseInt(bunMatch[2]);
    }

    // Pytest style: 5 passed, 2 failed
    const pytestMatch = output.match(/(\d+)\s+passed(?:.*?(\d+)\s+failed)?/);
    if (!jestMatch && !bunMatch && pytestMatch) {
      passed = parseInt(pytestMatch[1]);
      failed = parseInt(pytestMatch[2] ?? "0");
    }

    // Go test: ok/FAIL + count
    const goPassMatch = output.match(/ok\s+\S+\s+([\d.]+s)/);
    const goFailMatch = output.match(/FAIL\s+\S+/);
    if (!jestMatch && !bunMatch && !pytestMatch && (goPassMatch || goFailMatch)) {
      const passLines = (output.match(/--- PASS/g) || []).length;
      const failLines = (output.match(/--- FAIL/g) || []).length;
      passed = passLines;
      failed = failLines;
      if (goPassMatch) duration = goPassMatch[1];
    }

    // Duration
    const timeMatch = output.match(/Time:\s+([\d.]+\s*(?:s|ms|m))/i) || output.match(/in\s+([\d.]+\s*(?:s|ms|m))/i);
    if (timeMatch) duration = timeMatch[1];

    // Extract failure details: lines starting with FAIL or ✗ or ×
    const lines = output.split("\n");
    let capturingFailure = false;
    let currentTest = "";
    let currentError: string[] = [];

    for (const line of lines) {
      const failMatch = line.match(/(?:FAIL|✗|×|✕)\s+(.+)/);
      if (failMatch) {
        if (capturingFailure && currentTest) {
          failures.push({ test: currentTest, error: currentError.join("\n").trim() });
        }
        currentTest = failMatch[1].trim();
        currentError = [];
        capturingFailure = true;
        continue;
      }

      if (capturingFailure) {
        if (line.match(/^(PASS|✓|✔|FAIL|✗|×|✕)\s/) || line.match(/^Tests:|^\d+ pass/)) {
          failures.push({ test: currentTest, error: currentError.join("\n").trim() });
          capturingFailure = false;
          currentTest = "";
          currentError = [];
        } else {
          currentError.push(line);
        }
      }
    }
    if (capturingFailure && currentTest) {
      failures.push({ test: currentTest, error: currentError.join("\n").trim() });
    }

    return {
      passed,
      failed,
      skipped,
      total: passed + failed + skipped,
      duration,
      failures,
    };
  },
};
