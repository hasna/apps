import { afterEach, describe, expect, test } from "bun:test";
import { createFinding, getFinding, updateFinding } from "../db/findings.js";
import { createProject } from "../db/projects.js";
import { createRule } from "../db/rules.js";
import { createScan, getScan, updateScanStatus } from "../db/scans.js";
import { getCurrentTestDb, setupTestDb } from "../db/test-helpers.js";
import { sanitizeMessagesForProvider } from "../llm/client.js";
import { reportFindings as reportJson } from "../reporters/json.js";
import { reportFindings as reportSarif } from "../reporters/sarif.js";
import { reportFindings as reportTerminal } from "../reporters/terminal.js";
import { scanFile } from "../scanners/secrets.js";
import { ScanStatus, ScannerType, Severity, type Finding, type Scan } from "../types/index.js";
import { recognizeCredentialText, shannonEntropy } from "./credential-recognition.js";
import {
  containsCredentialLikeText,
  sanitizeFindingForOutput,
  sanitizeFindingForPersistence,
  sanitizeLocationForOutput,
  sanitizeRuleIdForOutput,
  sanitizeScanForOutput,
  sanitizeTextForBoundary,
  sanitizeValueForBoundary,
} from "./finding-safety.js";

function syntheticScannerCorpus(): string[] {
  const github = (kind: string, pairs: number) => `gh${kind}_${"A_".repeat(pairs)}`;
  const values = new Set<string>([
    `AK${"IA"}${"AB12".repeat(4)}`,
    `AS${"IA"}${"CD34".repeat(4)}`,
    `aws_secret_access_key=${"Ab1/".repeat(10)}`,
    github("p", 18),
    github("o", 18),
    github("s", 18),
    github("r", 18),
    `github_${"pat"}_${"B_".repeat(11)}`,
    `sk_${"live"}_${"Ab1C".repeat(6)}`,
    `pk_${"live"}_${"Cd2E".repeat(6)}`,
    `api_key="${"Ab1_".repeat(4)}"`,
    `-----BEGIN ${"OPEN"}SSH PRIVATE KEY-----`,
    `${"eyJ"}${"Ab1Cd2Ef3G"}.${"Hi4Jk5Lm6N"}.${"Op7Qr8St9U"}`,
    `${"xox"}b-${"Ab1-".repeat(6)}Z`,
    `${"xox"}p-${"Cd2-".repeat(6)}Y`,
    `${"xox"}s-${"Ef3-".repeat(6)}X`,
    `${"post"}gresql://synthetic:only@example.invalid/db`,
    `${"my"}sql://synthetic:only@example.invalid/db`,
    `${"mongo"}db+srv://synthetic:only@example.invalid/db`,
    `api_key=${"Q_2r".repeat(4)}`,
    "AbCdEfGhIjKlMnOpQrStUvWxYz0123456789+/",
  ]);

  for (const kind of ["p", "o", "s", "r"]) {
    for (const length of [36, 37, 64]) {
      for (const alphabet of ["A", "a", "0", "_", "Aa0_"]) {
        values.add(`gh${kind}_${alphabet.repeat(Math.ceil(length / alphabet.length)).slice(0, length)}`);
      }
    }
  }
  for (const length of [22, 23, 64]) {
    for (const alphabet of ["B", "b", "1", "_", "Bb1_"]) {
      values.add(`github_${"pat"}_${alphabet.repeat(Math.ceil(length / alphabet.length)).slice(0, length)}`);
    }
  }
  for (const name of ["api_key", "apikey", "API-KEY"]) {
    for (const delimiter of ["=", ":"]) {
      for (const quote of ["'", '"']) {
        values.add(`${name}${delimiter}${quote}${"Aa1_".repeat(4)}${quote}`);
      }
    }
  }
  return [...values];
}

function findingWith(value: string): Finding {
  return {
    id: value,
    scan_id: value,
    rule_id: `rule-${value}`,
    scanner_type: ScannerType.Code,
    severity: Severity.High,
    file: `src/${value}/app.ts`,
    line: 1,
    column: 1,
    end_line: null,
    message: `Adjacent value: ${value}`,
    code_snippet: `const adjacent = ${JSON.stringify(value)}`,
    fingerprint: value,
    suppressed: true,
    suppressed_reason: `Reason ${value}`,
    llm_explanation: `Analysis ${value}`,
    llm_fix: `Fix ${value}`,
    llm_exploitability: 0.5,
    created_at: value,
  };
}

const originalLog = console.log;
let cleanupDb: (() => void) | undefined;

afterEach(() => {
  console.log = originalLog;
  cleanupDb?.();
  cleanupDb = undefined;
});

describe("scanner-to-boundary credential invariant", () => {
  test("every synthetic scanner recognition is absent from every shared boundary", () => {
    for (const value of syntheticScannerCorpus()) {
      expect(scanFile(".env", value).length, value).toBeGreaterThan(0);
      expect(recognizeCredentialText(value, { envLike: true }).length, value).toBeGreaterThan(0);
      expect(containsCredentialLikeText(value), value).toBe(true);

      const finding = findingWith(value);
      const scan: Scan = {
        id: value,
        project_id: value,
        status: value as ScanStatus,
        scanner_types: [value as ScannerType],
        findings_count: 1,
        started_at: value,
        completed_at: value,
        duration_ms: 1,
        error: value,
        created_at: value,
      };
      const rendered: string[] = [];
      console.log = (...args: unknown[]) => rendered.push(args.map(String).join(" "));
      reportTerminal([finding]);

      const boundaryOutputs = [
        sanitizeTextForBoundary(`prefix ${value} suffix`, 12_000),
        sanitizeLocationForOutput(`/tmp/${value}/target`),
        sanitizeRuleIdForOutput(`rule-${value}`),
        JSON.stringify(sanitizeValueForBoundary({ [value]: { nested: value } })),
        JSON.stringify(sanitizeFindingForPersistence(finding)),
        JSON.stringify(sanitizeFindingForOutput(finding)),
        JSON.stringify(sanitizeScanForOutput(scan)),
        reportJson([finding], scan),
        reportSarif([finding], scan),
        rendered.join("\n"),
        JSON.stringify(sanitizeMessagesForProvider([{ role: "user", content: value }])),
      ];

      for (const output of boundaryOutputs) {
        expect(output, value).not.toContain(value);
        expect(output, value).toContain("REDACTED");
      }
    }
  });

  test("every synthetic scanner recognition is absent from create, update, legacy read, and raw SQLite", () => {
    cleanupDb = setupTestDb();
    const rule = createRule({
      name: "synthetic-boundary-rule",
      description: "Synthetic invariant fixture",
      scanner_type: ScannerType.Code,
      severity: Severity.High,
      pattern: null,
      enabled: true,
      builtin: false,
      metadata: {},
    });
    const db = getCurrentTestDb();

    for (const [index, value] of syntheticScannerCorpus().entries()) {
      const project = createProject(`project ${value}`, `/tmp/${value}/project`);
      const scan = createScan(project.id, [ScannerType.Code]);
      const created = createFinding(scan.id, {
        rule_id: rule.id,
        scanner_type: ScannerType.Code,
        severity: Severity.High,
        file: `src/${value}/app.ts`,
        line: 1,
        message: `Adjacent ${value}`,
        code_snippet: value,
      });
      updateFinding(created.id, {
        suppressed: true,
        suppressed_reason: value,
        llm_explanation: value,
        llm_fix: value,
      });
      updateScanStatus(scan.id, ScanStatus.Failed, undefined, value);

      const rawCreated = JSON.stringify(db.prepare(
        "SELECT rule_id, file, message, code_snippet, suppressed_reason, llm_explanation, llm_fix FROM findings WHERE id = ?",
      ).get(created.id));
      const rawProject = JSON.stringify(db.prepare(
        "SELECT name, path FROM projects WHERE id = ?",
      ).get(project.id));
      const rawScan = JSON.stringify(db.prepare(
        "SELECT error FROM scans WHERE id = ?",
      ).get(scan.id));
      expect(rawCreated, value).not.toContain(value);
      expect(rawProject, value).not.toContain(value);
      expect(rawScan, value).not.toContain(value);
      expect(JSON.stringify(getScan(scan.id)), value).not.toContain(value);
      expect(JSON.stringify(getFinding(created.id)), value).not.toContain(value);

      const legacyId = `legacy-${index}`;
      db.prepare(
        `INSERT INTO findings
          (id, scan_id, rule_id, scanner_type, severity, file, line, message, code_snippet, fingerprint, suppressed, suppressed_reason, llm_explanation, llm_fix, created_at)
         VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?, 1, ?, ?, ?, ?)`,
      ).run(
        legacyId,
        scan.id,
        rule.id,
        ScannerType.Code,
        Severity.High,
        value,
        value,
        value,
        value,
        value,
        value,
        value,
        value,
      );
      expect(JSON.stringify(getFinding(legacyId)), value).not.toContain(value);
      expect(JSON.stringify(db.prepare(
        "SELECT file, message, code_snippet, fingerprint, suppressed_reason, llm_explanation, llm_fix, created_at FROM findings WHERE id = ?",
      ).get(legacyId)), value).not.toContain(value);
    }
  });

  test("safe noncredentials remain unchanged", () => {
    const safeValues = [
      "src/app.ts",
      "rule.api-v2",
      "ordinary config issue",
      "api_key=short",
      "github_issue_123",
      "A".repeat(64),
      "database migration documentation",
    ];
    for (const value of safeValues) {
      expect(scanFile("safe.txt", value), value).toEqual([]);
      expect(recognizeCredentialText(value, { boundary: true }), value).toEqual([]);
      expect(sanitizeTextForBoundary(value, 12_000), value).toBe(value);
      expect(sanitizeLocationForOutput(value), value).toBe(value);
    }
  });

  test("high-entropy hexadecimal recognition has a reachable normalized boundary", () => {
    const balancedHex = "0123456789abcdef".repeat(8);
    expect(shannonEntropy(balancedHex)).toBeCloseTo(4, 10);
    expect(
      recognizeCredentialText(balancedHex).some(({ rule }) => rule.id === "high-entropy-hex"),
    ).toBe(true);
    expect(containsCredentialLikeText(balancedHex)).toBe(true);
    expect(sanitizeTextForBoundary(balancedHex)).not.toContain(balancedHex);
  });

  test("high-entropy hexadecimal recognition rejects short and structured low-entropy controls", () => {
    const safeHexValues = [
      "0123456789abcdef",
      "a".repeat(128),
      "deadbeef".repeat(16),
      "00112233".repeat(16),
    ];
    for (const value of safeHexValues) {
      expect(
        recognizeCredentialText(value).some(({ rule }) => rule.id === "high-entropy-hex"),
        value.length.toString(),
      ).toBe(false);
    }
  });

  test("only exempts 40-character hex in pinned GitHub Action syntax", () => {
    const revision = "0123456789abcdef".repeat(3).slice(0, 40);
    expect(
      recognizeCredentialText(revision).some(({ rule }) => rule.id === "high-entropy-hex"),
    ).toBe(true);
    const actionPin = `- uses: synthetic/action@${revision}`;
    expect(scanFile(".github/workflows/ci.yml", actionPin)).toEqual([]);
    expect(recognizeCredentialText(actionPin)).toEqual([]);
    expect(sanitizeTextForBoundary(actionPin, 12_000)).toBe(actionPin);
  });

  test("high-entropy hexadecimal property corpus keeps positives and false positives separated", () => {
    const alphabet = "0123456789abcdef";
    for (let offset = 0; offset < alphabet.length; offset++) {
      const rotated = `${alphabet.slice(offset)}${alphabet.slice(0, offset)}`.repeat(4);
      expect(
        recognizeCredentialText(rotated).some(({ rule }) => rule.id === "high-entropy-hex"),
      ).toBe(true);
    }
    for (let index = 0; index < 256; index++) {
      const left = (index % 16).toString(16);
      const right = ((index + 1) % 16).toString(16);
      const structured = `${left.repeat(32)}${right.repeat(32)}`;
      expect(
        recognizeCredentialText(structured).some(({ rule }) => rule.id === "high-entropy-hex"),
      ).toBe(false);
    }
  });
});
