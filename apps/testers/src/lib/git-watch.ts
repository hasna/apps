import { execSync } from "child_process";
import chalk from "chalk";
import { listScenarios } from "../db/scenarios.js";
import { matchFilesToScenarios } from "./affected.js";
import { runBatch } from "./runner.js";
import { formatTerminal } from "./reporter.js";
import { notifyFailureToConversations } from "./failure-pipeline.js";
import type { FileMapping } from "./affected.js";
import type { RunOptions } from "./runner.js";

export interface GitWatchOptions extends Omit<RunOptions, "url"> {
  url: string;
  dir?: string;
  pollIntervalMs?: number;
  mappings?: FileMapping[];
  projectId?: string;
  tags?: string[];
}

function getLatestCommitHash(dir: string): string | null {
  try {
    return execSync("git rev-parse HEAD", { cwd: dir, stdio: ["pipe", "pipe", "pipe"] })
      .toString()
      .trim();
  } catch {
    return null;
  }
}

function getChangedFiles(fromHash: string, toHash: string, dir: string): string[] {
  try {
    const out = execSync(`git diff --name-only ${fromHash} ${toHash}`, {
      cwd: dir,
      stdio: ["pipe", "pipe", "pipe"],
    }).toString();
    return out.split("\n").filter(Boolean);
  } catch {
    return [];
  }
}

/**
 * Poll git for new commits and run affected scenarios when changes land.
 * Designed for use in CI or as a long-running watcher.
 */
export async function startGitWatcher(options: GitWatchOptions): Promise<void> {
  const {
    url,
    dir = process.cwd(),
    pollIntervalMs = 10000,
    mappings = [],
    projectId,
    tags,
    ...runOpts
  } = options;

  let lastHash = getLatestCommitHash(dir);
  if (!lastHash) {
    console.error(chalk.red("  [git-watch] Not a git repository or git not available."));
    process.exit(1);
  }

  console.log("");
  console.log(chalk.bold("  Testers Git Watch"));
  console.log(chalk.dim(`  Directory:  ${dir}`));
  console.log(chalk.dim(`  Target URL: ${url}`));
  console.log(chalk.dim(`  Poll every: ${pollIntervalMs / 1000}s`));
  console.log(chalk.dim(`  Last commit: ${lastHash.slice(0, 8)}`));
  console.log("");
  console.log(chalk.dim("  Watching for new commits... (Ctrl+C to stop)"));
  console.log("");

  const cleanup = () => {
    console.log("");
    console.log(chalk.dim("  Git watch stopped."));
    process.exit(0);
  };
  process.on("SIGINT", cleanup);
  process.on("SIGTERM", cleanup);

  while (true) {
    await new Promise((r) => setTimeout(r, pollIntervalMs));

    const currentHash = getLatestCommitHash(dir);
    if (!currentHash || currentHash === lastHash) continue;

    const changedFiles = getChangedFiles(lastHash, currentHash, dir);
    lastHash = currentHash;

    console.log(chalk.yellow(`  [commit] ${currentHash.slice(0, 8)} — ${changedFiles.length} file(s) changed`));
    for (const f of changedFiles.slice(0, 10)) {
      console.log(chalk.dim(`    ${f}`));
    }
    if (changedFiles.length > 10) {
      console.log(chalk.dim(`    … and ${changedFiles.length - 10} more`));
    }

    // Match changed files to scenarios
    const allScenarios = listScenarios({ projectId, tags });
    const matched = matchFilesToScenarios(changedFiles, allScenarios, mappings);

    if (matched.length === 0) {
      console.log(chalk.dim("  No matching scenarios — skipping run."));
      console.log("");
      continue;
    }

    console.log(chalk.blue(`  [running] ${matched.length} affected scenario(s) against ${url}...`));
    console.log("");

    try {
      const { run, results } = await runBatch(matched, { url, projectId, ...runOpts });
      console.log(formatTerminal(run, results));

      // Notify conversations on failure
      if (run.status === "failed") {
        const failedResults = results.filter((r) => r.status === "failed" || r.status === "error");
        notifyFailureToConversations(run, failedResults, matched).catch(() => {});
      }
    } catch (error) {
      console.error(chalk.red(`  Error: ${error instanceof Error ? error.message : String(error)}`));
    }

    console.log(chalk.dim("  Watching for new commits..."));
    console.log("");
  }
}
