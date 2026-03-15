// Test focus tracker — tracks test status across runs, only reports changes
// Instead of showing "248 passed, 2 failed" every time, shows:
// "auth.login: FIXED, auth.logout: STILL FAILING, 246 unchanged"

export interface TestStatus {
  name: string;
  status: "pass" | "fail";
  error?: string;
}

export interface TestWatchResult {
  /** Tests that changed status since last run */
  changed: { name: string; from: "pass" | "fail"; to: "pass" | "fail"; error?: string }[];
  /** New tests not seen before */
  newTests: TestStatus[];
  /** Summary counts */
  totalPassed: number;
  totalFailed: number;
  unchangedCount: number;
  /** Whether this is the first run (no previous data) */
  firstRun: boolean;
}

// Per-cwd watchlist
const watchlists = new Map<string, Map<string, TestStatus>>();

/** Extract test names and status from test runner output (any runner) */
function extractTests(output: string): TestStatus[] {
  const tests: TestStatus[] = [];
  const lines = output.split("\n");

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // PASS/FAIL with test name: "PASS src/auth.test.ts" or "✓ login works" or "✗ logout fails"
    const passMatch = line.match(/(?:PASS|✓|✔|✅)\s+(.+)/);
    if (passMatch) {
      tests.push({ name: passMatch[1].trim(), status: "pass" });
      continue;
    }

    const failMatch = line.match(/(?:FAIL|✗|✕|❌|×)\s+(.+)/);
    if (failMatch) {
      // Capture error from next few lines
      const errorLines: string[] = [];
      for (let j = i + 1; j < Math.min(i + 5, lines.length); j++) {
        if (lines[j].match(/(?:PASS|FAIL|✓|✗|✔|✕|Tests:|^\s*$)/)) break;
        errorLines.push(lines[j].trim());
      }
      tests.push({ name: failMatch[1].trim(), status: "fail", error: errorLines.join(" ").slice(0, 200) });
      continue;
    }

    // Jest/vitest style: "  ● test name" for failures
    const jestFail = line.match(/^\s*●\s+(.+)/);
    if (jestFail) {
      tests.push({ name: jestFail[1].trim(), status: "fail" });
      continue;
    }
  }

  return tests;
}

/** Detect if output looks like test runner output */
export function isTestOutput(output: string): boolean {
  // Must have a summary line with counts (not just words "pass"/"fail" in prose)
  const summaryLine = /(?:\d+\s+pass|\d+\s+fail|Tests?:\s+\d+|Ran\s+\d+\s+tests?)/i;
  const testMarkers = /(?:✓|✗|✔|✕|PASS\s+\S+\.test|FAIL\s+\S+\.test|bun test|jest|vitest|pytest)/;
  return summaryLine.test(output) && testMarkers.test(output);
}

/** Track test results and return only changes */
export function trackTests(cwd: string, output: string): TestWatchResult {
  const current = extractTests(output);
  const prev = watchlists.get(cwd);

  // Count totals from raw output (more reliable than extracted tests)
  let totalPassed = 0, totalFailed = 0;
  const summaryMatch = output.match(/(\d+)\s+pass/i);
  const failMatch = output.match(/(\d+)\s+fail/i);
  if (summaryMatch) totalPassed = parseInt(summaryMatch[1]);
  if (failMatch) totalFailed = parseInt(failMatch[1]);
  // Fallback to extracted counts
  if (totalPassed === 0) totalPassed = current.filter(t => t.status === "pass").length;
  if (totalFailed === 0) totalFailed = current.filter(t => t.status === "fail").length;

  // Store current for next comparison
  const currentMap = new Map<string, TestStatus>();
  for (const t of current) currentMap.set(t.name, t);
  watchlists.set(cwd, currentMap);

  // First run — no comparison possible
  if (!prev) {
    return {
      changed: [],
      newTests: current.filter(t => t.status === "fail"), // only show failures on first run
      totalPassed,
      totalFailed,
      unchangedCount: 0,
      firstRun: true,
    };
  }

  // Compare with previous
  const changed: TestWatchResult["changed"] = [];
  const newTests: TestStatus[] = [];
  let unchangedCount = 0;

  for (const [name, test] of currentMap) {
    const prevTest = prev.get(name);
    if (!prevTest) {
      newTests.push(test);
    } else if (prevTest.status !== test.status) {
      changed.push({ name, from: prevTest.status, to: test.status, error: test.error });
    } else {
      unchangedCount++;
    }
  }

  return { changed, newTests, totalPassed, totalFailed, unchangedCount, firstRun: false };
}

/** Format watchlist result for display */
export function formatWatchResult(result: TestWatchResult): string {
  const lines: string[] = [];

  if (result.firstRun) {
    lines.push(`${result.totalPassed} passed, ${result.totalFailed} failed`);
    if (result.newTests.length > 0) {
      for (const t of result.newTests) {
        lines.push(`  ✗ ${t.name}${t.error ? `: ${t.error}` : ""}`);
      }
    }
    return lines.join("\n");
  }

  // Status changes
  for (const c of result.changed) {
    if (c.to === "pass") lines.push(`  ✓ FIXED: ${c.name}`);
    else lines.push(`  ✗ BROKE: ${c.name}${c.error ? ` — ${c.error}` : ""}`);
  }

  // New failures
  for (const t of result.newTests.filter(t => t.status === "fail")) {
    lines.push(`  ✗ NEW FAIL: ${t.name}${t.error ? ` — ${t.error}` : ""}`);
  }

  // Summary
  if (result.changed.length === 0 && result.newTests.filter(t => t.status === "fail").length === 0) {
    lines.push(`✓ ${result.totalPassed} passed, ${result.totalFailed} failed (no changes)`);
  } else {
    lines.push(`${result.totalPassed} passed, ${result.totalFailed} failed, ${result.unchangedCount} unchanged`);
  }

  return lines.join("\n");
}
