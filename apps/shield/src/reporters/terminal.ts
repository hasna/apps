import chalk from "chalk";
import {
  type Finding,
  type SecurityScore,
  Severity,
  SEVERITY_ORDER,
} from "../types/index.js";

const SEVERITY_BADGE: Record<Severity, (text: string) => string> = {
  [Severity.Critical]: (t) => chalk.bgRed.white.bold(` ${t} `),
  [Severity.High]: (t) => chalk.bgMagenta.white.bold(` ${t} `),
  [Severity.Medium]: (t) => chalk.bgYellow.black.bold(` ${t} `),
  [Severity.Low]: (t) => chalk.bgBlue.white.bold(` ${t} `),
  [Severity.Info]: (t) => chalk.bgGray.white(` ${t} `),
};

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

  // Score: deduct points by severity weight
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

export function reportFindings(findings: Finding[]): void {
  if (findings.length === 0) {
    console.log(chalk.green.bold("\n  No security findings detected.\n"));
    return;
  }

  const sorted = [...findings].sort(
    (a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity],
  );

  console.log(
    chalk.bold(`\n  Security Findings (${findings.length} total)\n`),
  );
  console.log(chalk.gray("  " + "─".repeat(70)));

  for (const finding of sorted) {
    const badge = SEVERITY_BADGE[finding.severity](
      finding.severity.toUpperCase(),
    );
    const location = chalk.cyan(`${finding.file}:${finding.line}`);
    const message = finding.suppressed
      ? chalk.strikethrough.gray(finding.message)
      : finding.message;

    console.log(`  ${badge} ${location} — ${message}`);

    if (finding.code_snippet) {
      console.log(chalk.gray(`         ${finding.code_snippet.trim()}`));
    }

    if (finding.llm_explanation) {
      console.log(chalk.dim(`         ${finding.llm_explanation}`));
    }
  }

  // Summary table
  const score = computeScore(findings);
  console.log(chalk.gray("\n  " + "─".repeat(70)));
  console.log(chalk.bold("\n  Summary"));
  console.log(
    `  ${chalk.red(`Critical: ${score.critical}`)}  ${chalk.magenta(`High: ${score.high}`)}  ${chalk.yellow(`Medium: ${score.medium}`)}  ${chalk.blue(`Low: ${score.low}`)}  ${chalk.gray(`Info: ${score.info}`)}`,
  );
  if (score.suppressed > 0) {
    console.log(chalk.gray(`  Suppressed: ${score.suppressed}`));
  }
  console.log(
    `  ${chalk.bold("Score:")} ${score.score >= 80 ? chalk.green(score.score) : score.score >= 50 ? chalk.yellow(score.score) : chalk.red(score.score)}/100\n`,
  );
}
