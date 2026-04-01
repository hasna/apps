import type { Command } from "commander";
import chalk from "chalk";
import {
  getDb, listScans, listFindings, suppressFinding, createBaseline, getSecurityScore,
} from "../../db/index.js";
import { initProject } from "../../lib/index.js";

export function registerManageCommands(program: Command): void {
  // init
  program
    .command("init")
    .description("Initialize security for this repository")
    .action(async () => {
      const cwd = process.cwd();
      initProject(cwd);
      console.log(chalk.green(`\n  Initialized security in ${chalk.cyan(cwd)}`));
      console.log(chalk.gray("  Created .security/config.json"));
      console.log(chalk.gray("  Run `security scan` to start scanning.\n"));
    });

  // baseline
  program
    .command("baseline")
    .description("Mark current findings as baseline (suppress)")
    .action(async () => {
      getDb();
      const scans = listScans(undefined, 1);
      if (scans.length === 0) {
        console.log(chalk.yellow("\n  No scans found. Run `security scan` first.\n"));
        return;
      }

      const latestScan = scans[0];
      const findings = listFindings({ scan_id: latestScan.id, suppressed: false });

      if (findings.length === 0) {
        console.log(chalk.green("\n  No active findings to baseline.\n"));
        return;
      }

      let count = 0;
      for (const finding of findings) {
        createBaseline(finding.fingerprint, "Baselined via CLI");
        suppressFinding(finding.id, "Baselined");
        count++;
      }

      console.log(chalk.green(`\n  Baselined ${chalk.bold(count.toString())} findings.`));
      console.log(chalk.gray("  These findings will be suppressed in future scans.\n"));
    });

  // score
  program
    .command("score")
    .description("Show security score for the project")
    .action(async () => {
      getDb();
      const scans = listScans(undefined, 1);
      if (scans.length === 0) {
        console.log(chalk.yellow("\n  No scans found. Run `security scan` first.\n"));
        return;
      }

      const latestScan = scans[0];
      const score = getSecurityScore(latestScan.id);

      console.log(chalk.bold("\n  Security Score\n"));
      console.log(chalk.gray("  " + "\u2500".repeat(40)));

      const scoreColor = score.score >= 80 ? chalk.green : score.score >= 50 ? chalk.yellow : chalk.red;
      console.log(`\n  ${chalk.bold("Score:")} ${scoreColor.bold(score.score.toString())}/100\n`);

      if (score.critical > 0) console.log(chalk.red(`    Critical:  ${score.critical}`));
      if (score.high > 0) console.log(chalk.magenta(`    High:      ${score.high}`));
      if (score.medium > 0) console.log(chalk.yellow(`    Medium:    ${score.medium}`));
      if (score.low > 0) console.log(chalk.blue(`    Low:       ${score.low}`));
      if (score.info > 0) console.log(chalk.gray(`    Info:      ${score.info}`));

      console.log(chalk.gray(`\n    Total:     ${score.total_findings}`));
      if (score.suppressed > 0) console.log(chalk.gray(`    Suppressed: ${score.suppressed}`));
      console.log(chalk.gray(`\n    Scan: ${latestScan.id}`));
      console.log();
    });
}
