import { describe, expect, test } from "bun:test";
import {
  analyzeToolOutput,
  buildHookOutput,
  extractToolOutputText,
  formatWarning,
  MAX_SCAN_BYTES,
  SCAN_TIMEOUT_MS,
  type ScanFn,
  type ScanOutcome,
} from "./hook";

/**
 * A stand-in for `scanInputExposures` from @hasna/secrets.
 *
 * The scanner itself is already exercised both ways in its own repo; what these
 * tests own is the hook's behaviour around it — that a finding is surfaced, that
 * a clean scan is silent, that an unreadable scan is NOT reported as clean, and
 * that nothing the scanner does can stop the session.
 */
function fakeScanner(result: Partial<ReturnType<ScanFn>> = {}): ScanFn {
  return () =>
    ({
      schema: "open-secrets.exposure-scan.v1",
      version: 1,
      source: "input",
      root: "<stdin>",
      redacted: true,
      limits: { findings: 50 },
      stats: { filesScanned: 1, filesSkipped: 0, bytesScanned: 100, errors: [], skipped: [] },
      truncated: false,
      findings: [],
      ...result,
    }) as ReturnType<ScanFn>;
}

const finding = (over: Record<string, unknown> = {}) => ({
  id: "f1",
  source: "input",
  detector: "credential_assignment",
  severity: "medium",
  path: "<stdin>",
  line: 12,
  column: 5,
  preview: "HASNA_TODOS_API_KEY=***REDACTED***",
  evidencePath: "<stdin>:12",
  ...over,
});

describe("hook-scanoutput / extractToolOutputText", () => {
  /**
   * The field name is the whole ballgame. Verified against the Claude Code 2.1.226
   * binary on 2026-08-10: its embedded schema reads
   *   "tool_response": { "success": true }  // PostToolUse only
   * and its implementation builds
   *   hook_event_name:"PostToolUse", tool_name:e, tool_input:r, tool_response:n
   * `tool_response` 21 occurrences, `tool_output` 2 — both of those the telemetry
   * name tengu_dead_probe_hook_updated_mcp_tool_output, neither near PostToolUse.
   *
   * Reading only `tool_output` yields undefined on Claude Code, which this hook
   * would score as an empty input and report clean. These tests lock the field.
   */
  test("reads tool_response, the field Claude Code actually sends", () => {
    expect(extractToolOutputText({ tool_response: "hello" })).toBe("hello");
  });

  test("reads a structured tool_response", () => {
    const text = extractToolOutputText({ tool_response: { stdout: "out-part", stderr: "err-part" } });
    expect(text).toContain("out-part");
    expect(text).toContain("err-part");
  });

  test("still reads tool_output, the older catalog convention", () => {
    expect(extractToolOutputText({ tool_output: "hello" })).toBe("hello");
  });

  test("concatenates the usual structured stdout/stderr fields", () => {
    const text = extractToolOutputText({ tool_output: { stdout: "out-part", stderr: "err-part" } });
    expect(text).toContain("out-part");
    expect(text).toContain("err-part");
  });

  test("prefers tool_response when both are present", () => {
    expect(extractToolOutputText({ tool_response: "from-response", tool_output: "from-output" })).toBe("from-response");
  });

  test("falls back to serialising an unrecognised output shape rather than skipping it", () => {
    // An output shape this hook does not know must not read as 'no output'.
    const text = extractToolOutputText({ tool_response: { unexpectedField: "SOMETHING-IN-HERE" } });
    expect(text).toContain("SOMETHING-IN-HERE");
  });

  test("returns empty string when there is no output at all", () => {
    expect(extractToolOutputText({})).toBe("");
    expect(extractToolOutputText({ tool_output: undefined })).toBe("");
    expect(extractToolOutputText({ tool_response: undefined })).toBe("");
  });
});

describe("hook-scanoutput / analyzeToolOutput", () => {
  test("FIRES: a finding in tool output is surfaced with its detector", () => {
    const outcome = analyzeToolOutput("anything", fakeScanner({ findings: [finding()] as never }));
    expect(outcome.status).toBe("found");
    expect(outcome.findingCount).toBe(1);
    expect(outcome.detectors).toEqual(["credential_assignment"]);
  });

  test("SILENT: ordinary output produces no warning", () => {
    const outcome = analyzeToolOutput("ordinary tool output", fakeScanner());
    expect(outcome.status).toBe("clean");
    expect(outcome.findingCount).toBe(0);
    expect(formatWarning(outcome)).toBe("");
  });

  test("a clean verdict requires bytes to have actually been read", () => {
    // Zero bytes scanned is not a clean scan; it is a scan that did not happen.
    const outcome = analyzeToolOutput(
      "x",
      fakeScanner({ stats: { filesScanned: 1, filesSkipped: 0, bytesScanned: 0, errors: [], skipped: [] } as never }),
    );
    expect(outcome.status).toBe("unscanned");
    expect(formatWarning(outcome)).toContain("UNSCANNED");
  });

  test("a truncated scan is reported as unscanned, never as clean", () => {
    const outcome = analyzeToolOutput("x", fakeScanner({ truncated: true, truncatedReason: "max_bytes" } as never));
    expect(outcome.status).toBe("unscanned");
  });

  test("a skipped input is reported as unscanned, never as clean", () => {
    const outcome = analyzeToolOutput(
      "x",
      fakeScanner({
        stats: {
          filesScanned: 0,
          filesSkipped: 1,
          bytesScanned: 0,
          errors: [],
          skipped: [{ path: "<stdin>", reason: "max_file_bytes", bytes: 9_000_000 }],
        } as never,
      }),
    );
    expect(outcome.status).toBe("unscanned");
  });

  test("empty tool output is skipped outright and is not called clean", () => {
    const outcome = analyzeToolOutput("", fakeScanner());
    expect(outcome.status).toBe("empty");
    expect(formatWarning(outcome)).toBe("");
  });

  test("bounds the scan explicitly, because it sits on a tool call's critical path", () => {
    // The Claude installer target writes no `timeout` into settings.json, so the
    // wiring supplies no outer bound and the scanner's own default is 10s.
    let seen: { maxBytes?: number; timeoutMs?: number } | undefined;
    const spy: ScanFn = (opts) => {
      seen = opts;
      return fakeScanner()(opts);
    };
    analyzeToolOutput("x", spy);
    expect(seen?.maxBytes).toBe(MAX_SCAN_BYTES);
    expect(seen?.timeoutMs).toBe(SCAN_TIMEOUT_MS);
    expect(SCAN_TIMEOUT_MS).toBeLessThan(10_000);
  });

  test("FAIL-OPEN: a scanner that throws degrades to a reported error, never a crash", () => {
    const outcome = analyzeToolOutput("x", (() => {
      throw new Error("scanner exploded");
    }) as ScanFn);
    expect(outcome.status).toBe("error");
    expect(outcome.error).toContain("scanner exploded");
    expect(formatWarning(outcome)).toContain("could not scan");
  });

  test("reports every severity, because high-only would miss the measured leak class", () => {
    // Measured on 2026-08-10: 25 real fleet API keys in a bash -x trace were ALL
    // detector=credential_assignment severity=medium. A high-only filter sees none of them.
    const outcome = analyzeToolOutput(
      "x",
      fakeScanner({ findings: [finding(), finding({ id: "f2", severity: "high", detector: "aws_access_key_id" })] as never }),
    );
    expect(outcome.findingCount).toBe(2);
    expect(outcome.detectors).toContain("credential_assignment");
    expect(outcome.detectors).toContain("aws_access_key_id");
  });
});

describe("hook-scanoutput / formatWarning", () => {
  test("names the detector and location but never claims prevention", () => {
    const outcome = analyzeToolOutput("x", fakeScanner({ findings: [finding()] as never }));
    const warning = formatWarning(outcome);
    expect(warning).toContain("credential_assignment");
    expect(warning).toContain("<stdin>:12");
    // This guard reports an exposure that has ALREADY been persisted. Wording that
    // implies it stopped anything would retire the worry without retiring the risk.
    expect(warning.toLowerCase()).not.toContain("blocked");
    expect(warning.toLowerCase()).not.toContain("prevented");
    expect(warning.toLowerCase()).toContain("already");
  });

  test("carries only the scanner's redacted preview, never a raw value", () => {
    const outcome = analyzeToolOutput(
      "x",
      fakeScanner({ findings: [finding({ preview: "KEY=***REDACTED***" })] as never }),
    );
    expect(formatWarning(outcome)).toContain("***REDACTED***");
  });
});

describe("hook-scanoutput / buildHookOutput", () => {
  test("ALWAYS continues, on every outcome, including a scanner error", () => {
    const outcomes: ScanOutcome["status"][] = ["clean", "found", "unscanned", "empty", "error"];
    for (const status of outcomes) {
      expect(buildHookOutput({ status, findingCount: 0, detectors: [], previews: [] }).continue).toBe(true);
    }
  });
});
