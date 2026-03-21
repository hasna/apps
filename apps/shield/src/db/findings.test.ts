import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { setupTestDb, getCurrentTestDb } from "./test-helpers.js";
import { createProject } from "./projects.js";
import { createScan } from "./scans.js";
import {
  createFinding,
  getFinding,
  listFindings,
  suppressFinding,
  countFindings,
  getSecurityScore,
  updateFinding,
} from "./findings.js";
import { ScannerType, Severity } from "../types/index.js";
import type { FindingInput } from "../types/index.js";

describe("findings", () => {
  let cleanup: () => void;
  let scanId: string;
  let projectId: string;

  function makeInput(overrides: Partial<FindingInput> = {}): FindingInput {
    return {
      rule_id: "test-rule",
      scanner_type: ScannerType.Secrets,
      severity: Severity.High,
      file: "src/app.ts",
      line: 42,
      message: "Test finding message",
      ...overrides,
    };
  }

  beforeEach(() => {
    cleanup = setupTestDb();
    const project = createProject("finding-test", "/tmp/finding-test");
    projectId = project.id;

    // We need to insert a rule first since findings reference rules(id)
    const db = getCurrentTestDb();
    db.prepare(
      `INSERT INTO rules (id, name, description, scanner_type, severity, enabled, builtin, metadata, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 1, 1, '{}', datetime('now'), datetime('now'))`,
    ).run("test-rule", "Test Rule", "A test rule", "secrets", "high");
    db.prepare(
      `INSERT INTO rules (id, name, description, scanner_type, severity, enabled, builtin, metadata, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 1, 1, '{}', datetime('now'), datetime('now'))`,
    ).run("code-rule", "Code Rule", "A code rule", "code", "critical");

    const scan = createScan(projectId, [ScannerType.Secrets]);
    scanId = scan.id;
  });

  afterEach(() => {
    cleanup();
  });

  test("createFinding returns a finding with generated id and fingerprint", () => {
    const finding = createFinding(scanId, makeInput());
    expect(finding.id).toBeDefined();
    expect(finding.fingerprint).toBeDefined();
    expect(finding.fingerprint.length).toBe(16);
    expect(finding.scan_id).toBe(scanId);
    expect(finding.rule_id).toBe("test-rule");
    expect(finding.severity).toBe(Severity.High);
    expect(finding.file).toBe("src/app.ts");
    expect(finding.line).toBe(42);
    expect(finding.suppressed).toBe(false);
    expect(finding.llm_explanation).toBeNull();
    expect(finding.llm_fix).toBeNull();
  });

  test("createFinding generates consistent fingerprints for same input", () => {
    const f1 = createFinding(scanId, makeInput());
    const f2 = createFinding(scanId, makeInput());
    expect(f1.fingerprint).toBe(f2.fingerprint);
    expect(f1.id).not.toBe(f2.id); // Different IDs though
  });

  test("createFinding generates different fingerprints for different inputs", () => {
    const f1 = createFinding(scanId, makeInput({ file: "a.ts" }));
    const f2 = createFinding(scanId, makeInput({ file: "b.ts" }));
    expect(f1.fingerprint).not.toBe(f2.fingerprint);
  });

  test("createFinding stores optional fields (column, end_line, code_snippet)", () => {
    const finding = createFinding(
      scanId,
      makeInput({ column: 10, end_line: 45, code_snippet: "let x = 1;" }),
    );
    expect(finding.column).toBe(10);
    expect(finding.end_line).toBe(45);
    expect(finding.code_snippet).toBe("let x = 1;");
  });

  test("createFinding defaults optional fields to null", () => {
    const finding = createFinding(scanId, makeInput());
    expect(finding.column).toBeNull();
    expect(finding.end_line).toBeNull();
    expect(finding.code_snippet).toBeNull();
  });

  test("getFinding retrieves a finding by id", () => {
    const created = createFinding(scanId, makeInput());
    const fetched = getFinding(created.id);
    expect(fetched).not.toBeNull();
    expect(fetched!.id).toBe(created.id);
    expect(fetched!.suppressed).toBe(false);
  });

  test("getFinding returns null for unknown id", () => {
    expect(getFinding("nonexistent")).toBeNull();
  });

  test("listFindings returns all findings when no filters", () => {
    createFinding(scanId, makeInput());
    createFinding(scanId, makeInput({ file: "other.ts" }));

    const findings = listFindings();
    expect(findings.length).toBe(2);
  });

  test("listFindings filters by scan_id", () => {
    const scan2 = createScan(projectId, [ScannerType.Code]);
    createFinding(scanId, makeInput());
    createFinding(scan2.id, makeInput({ rule_id: "code-rule", scanner_type: ScannerType.Code }));

    const findings = listFindings({ scan_id: scanId });
    expect(findings.length).toBe(1);
    expect(findings[0].scan_id).toBe(scanId);
  });

  test("listFindings filters by severity", () => {
    createFinding(scanId, makeInput({ severity: Severity.High }));
    createFinding(scanId, makeInput({ severity: Severity.Low, file: "low.ts" }));

    const findings = listFindings({ severity: Severity.High });
    expect(findings.length).toBe(1);
    expect(findings[0].severity).toBe(Severity.High);
  });

  test("listFindings filters by scanner_type", () => {
    createFinding(scanId, makeInput({ scanner_type: ScannerType.Secrets }));
    createFinding(scanId, makeInput({
      scanner_type: ScannerType.Code,
      rule_id: "code-rule",
      file: "code.ts",
    }));

    const findings = listFindings({ scanner_type: ScannerType.Secrets });
    expect(findings.length).toBe(1);
  });

  test("listFindings filters by file", () => {
    createFinding(scanId, makeInput({ file: "target.ts" }));
    createFinding(scanId, makeInput({ file: "other.ts" }));

    const findings = listFindings({ file: "target.ts" });
    expect(findings.length).toBe(1);
    expect(findings[0].file).toBe("target.ts");
  });

  test("listFindings filters by suppressed status", () => {
    const f = createFinding(scanId, makeInput());
    createFinding(scanId, makeInput({ file: "unsuppressed.ts" }));
    suppressFinding(f.id, "false positive");

    const suppressed = listFindings({ suppressed: true });
    expect(suppressed.length).toBe(1);

    const unsuppressed = listFindings({ suppressed: false });
    expect(unsuppressed.length).toBe(1);
  });

  test("listFindings respects limit and offset", () => {
    for (let i = 0; i < 5; i++) {
      createFinding(scanId, makeInput({ file: `file-${i}.ts` }));
    }

    const page1 = listFindings({ limit: 2, offset: 0 });
    expect(page1.length).toBe(2);

    const page2 = listFindings({ limit: 2, offset: 2 });
    expect(page2.length).toBe(2);

    const page3 = listFindings({ limit: 2, offset: 4 });
    expect(page3.length).toBe(1);
  });

  test("suppressFinding marks a finding as suppressed with reason", () => {
    const finding = createFinding(scanId, makeInput());
    suppressFinding(finding.id, "Known false positive");

    const updated = getFinding(finding.id);
    expect(updated!.suppressed).toBe(true);
    expect(updated!.suppressed_reason).toBe("Known false positive");
  });

  test("updateFinding updates LLM fields", () => {
    const finding = createFinding(scanId, makeInput());
    updateFinding(finding.id, {
      llm_explanation: "This is a test explanation",
      llm_fix: "Use env vars instead",
      llm_exploitability: 0.8,
    });

    const updated = getFinding(finding.id);
    expect(updated!.llm_explanation).toBe("This is a test explanation");
    expect(updated!.llm_fix).toBe("Use env vars instead");
    expect(updated!.llm_exploitability).toBe(0.8);
  });

  test("countFindings counts all findings", () => {
    createFinding(scanId, makeInput());
    createFinding(scanId, makeInput({ file: "b.ts" }));

    expect(countFindings()).toBe(2);
  });

  test("countFindings filters by scan_id", () => {
    const scan2 = createScan(projectId, [ScannerType.Code]);
    createFinding(scanId, makeInput());
    createFinding(scan2.id, makeInput({ rule_id: "code-rule", scanner_type: ScannerType.Code }));

    expect(countFindings(scanId)).toBe(1);
  });

  test("countFindings filters by severity", () => {
    createFinding(scanId, makeInput({ severity: Severity.High }));
    createFinding(scanId, makeInput({ severity: Severity.Low, file: "low.ts" }));

    expect(countFindings(undefined, Severity.High)).toBe(1);
  });

  test("getSecurityScore calculates correct score with no findings", () => {
    const score = getSecurityScore(scanId);
    expect(score.total_findings).toBe(0);
    expect(score.critical).toBe(0);
    expect(score.high).toBe(0);
    expect(score.medium).toBe(0);
    expect(score.low).toBe(0);
    expect(score.info).toBe(0);
    expect(score.suppressed).toBe(0);
    expect(score.score).toBe(100);
  });

  test("getSecurityScore deducts correctly per severity", () => {
    // 1 critical (-20), 2 high (-20), 1 medium (-5) = 55
    createFinding(scanId, makeInput({
      severity: Severity.Critical,
      rule_id: "code-rule",
      scanner_type: ScannerType.Code,
      file: "a.ts",
    }));
    createFinding(scanId, makeInput({ severity: Severity.High, file: "b.ts" }));
    createFinding(scanId, makeInput({ severity: Severity.High, file: "c.ts" }));
    createFinding(scanId, makeInput({ severity: Severity.Medium, file: "d.ts" }));

    const score = getSecurityScore(scanId);
    expect(score.critical).toBe(1);
    expect(score.high).toBe(2);
    expect(score.medium).toBe(1);
    expect(score.total_findings).toBe(4);
    expect(score.score).toBe(55);
  });

  test("getSecurityScore excludes suppressed findings from score", () => {
    const f = createFinding(scanId, makeInput({ severity: Severity.Critical, file: "a.ts" }));
    createFinding(scanId, makeInput({ severity: Severity.High, file: "b.ts" }));
    suppressFinding(f.id, "false positive");

    const score = getSecurityScore(scanId);
    expect(score.critical).toBe(0); // suppressed
    expect(score.high).toBe(1);
    expect(score.suppressed).toBe(1);
    expect(score.score).toBe(90); // only -10 for the high
  });

  test("getSecurityScore floors at 0", () => {
    // 6 critical findings = -120, should clamp to 0
    for (let i = 0; i < 6; i++) {
      createFinding(scanId, makeInput({
        severity: Severity.Critical,
        rule_id: "code-rule",
        scanner_type: ScannerType.Code,
        file: `critical-${i}.ts`,
      }));
    }

    const score = getSecurityScore(scanId);
    expect(score.score).toBe(0);
  });
});
