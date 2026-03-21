import type { Finding, Scan } from "../types/index.js";
import { Severity } from "../types/index.js";

const SEVERITY_TO_LEVEL: Record<Severity, string> = {
  [Severity.Critical]: "error",
  [Severity.High]: "error",
  [Severity.Medium]: "warning",
  [Severity.Low]: "note",
  [Severity.Info]: "none",
};

interface SarifRule {
  id: string;
  shortDescription: { text: string };
  defaultConfiguration: { level: string };
}

interface SarifResult {
  ruleId: string;
  level: string;
  message: { text: string };
  locations: Array<{
    physicalLocation: {
      artifactLocation: { uri: string };
      region: {
        startLine: number;
        startColumn?: number;
        endLine?: number;
      };
    };
  }>;
  fingerprints?: { "open-security/fingerprint": string };
}

export function reportFindings(findings: Finding[], scan?: Scan): string {
  const rulesMap = new Map<string, SarifRule>();
  const results: SarifResult[] = [];

  for (const finding of findings) {
    if (!rulesMap.has(finding.rule_id)) {
      rulesMap.set(finding.rule_id, {
        id: finding.rule_id,
        shortDescription: { text: finding.message },
        defaultConfiguration: {
          level: SEVERITY_TO_LEVEL[finding.severity],
        },
      });
    }

    const result: SarifResult = {
      ruleId: finding.rule_id,
      level: SEVERITY_TO_LEVEL[finding.severity],
      message: { text: finding.message },
      locations: [
        {
          physicalLocation: {
            artifactLocation: { uri: finding.file },
            region: {
              startLine: finding.line,
              ...(finding.column != null && { startColumn: finding.column }),
              ...(finding.end_line != null && { endLine: finding.end_line }),
            },
          },
        },
      ],
      fingerprints: {
        "open-security/fingerprint": finding.fingerprint,
      },
    };

    results.push(result);
  }

  const sarif = {
    $schema:
      "https://raw.githubusercontent.com/oasis-tcs/sarif-spec/main/sarif-2.1/schema/sarif-schema-2.1.0.json",
    version: "2.1.0" as const,
    runs: [
      {
        tool: {
          driver: {
            name: "open-security",
            version: "0.1.0",
            informationUri: "https://github.com/hasnaxyz/open-security",
            rules: Array.from(rulesMap.values()),
          },
        },
        results,
        ...(scan && {
          invocations: [
            {
              executionSuccessful: scan.status === "completed",
              startTimeUtc: scan.started_at,
              endTimeUtc: scan.completed_at ?? undefined,
            },
          ],
        }),
      },
    ],
  };

  return JSON.stringify(sarif, null, 2);
}
