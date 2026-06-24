import chalk from "chalk";
import {
  type Finding,
  type SecurityScore,
  Severity,
  SEVERITY_ORDER,
} from "../types/index.js";
import { DEFAULT_COMPACT_LIMIT, truncateText } from "../lib/output.js";

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

export interface TerminalReportOptions {
  limit?: number;
  offset?: number;
  verbose?: boolean;
}

export function reportFindings(findings: Finding[], options: TerminalReportOptions = {}): void {
  if (findings.length === 0) {
    console.log(chalk.green.bold("\n  No security findings detected.\n"));
    return;
  }

  const sorted = [...findings].sort(
    (a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity],
  );

  const limit = options.verbose ? findings.length : (options.limit ?? DEFAULT_COMPACT_LIMIT);
  const visible = sorted.slice(0, limit);
  const hidden = sorted.length - visible.length;

  console.log(chalk.bold(`\n  Security Findings (showing ${visible.length}/${findings.length})\n`));
  console.log(chalk.gray("  " + "─".repeat(70)));

  for (const finding of visible) {
    const badge = SEVERITY_BADGE[finding.severity](
      finding.severity.toUpperCase(),
    );
    const location = chalk.cyan(`${finding.file}:${finding.line}`);
    const message = finding.suppressed
      ? chalk.strikethrough.gray(truncateText(finding.message))
      : truncateText(finding.message);

    console.log(`  ${badge} ${location} — ${message}`);

    if (options.verbose && finding.code_snippet) {
      console.log(chalk.gray(`         ${finding.code_snippet.trim()}`));
    }

    if (options.verbose && finding.llm_explanation) {
      console.log(chalk.dim(`         ${finding.llm_explanation}`));
    }
  }

  if (hidden > 0) {
    const offsetHint = options.offset !== undefined ? ` --offset ${options.offset + visible.length}` : "";
    console.log(chalk.gray(`\n  ${hidden} more finding(s) hidden. Use --verbose, --limit ${findings.length}, or shield findings${offsetHint} for more.`));
  } else if (!options.verbose) {
    console.log(chalk.gray("\n  Use --verbose to include snippets and LLM explanations."));
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
