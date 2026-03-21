import type { Finding, Scan, SecurityScore } from "../types/index.js";
import { Severity } from "../types/index.js";

function computeScore(findings: Finding[]): SecurityScore {
  const active = findings.filter((f) => !f.suppressed);
  const score: SecurityScore = {
    total_findings: findings.length,
    critical: 0,
    high: 0,
    medium: 0,
    low: 0,
    info: 0,
    suppressed: findings.filter((f) => f.suppressed).length,
    score: 100,
  };

  for (const f of active) {
    switch (f.severity) {
      case Severity.Critical:
        score.critical++;
        break;
      case Severity.High:
        score.high++;
        break;
      case Severity.Medium:
        score.medium++;
        break;
      case Severity.Low:
        score.low++;
        break;
      case Severity.Info:
        score.info++;
        break;
    }
  }

  score.score = Math.max(
    0,
    100 -
      score.critical * 20 -
      score.high * 10 -
      score.medium * 5 -
      score.low * 2 -
      score.info * 0,
  );

  return score;
}

export function reportFindings(findings: Finding[], scan?: Scan): string {
  const summary = computeScore(findings);
  const report = {
    scan: scan ?? null,
    findings,
    summary,
  };
  return JSON.stringify(report, null, 2);
}
