import { watch } from "fs";
import { resolve } from "path";
import chalk from "chalk";
import { runByFilter } from "./runner.js";
import { formatTerminal, getExitCode } from "./reporter.js";
import type { RunOptions } from "./runner.js";

export interface WatchOptions extends RunOptions {
  dir: string;
  debounceMs?: number;
  tags?: string[];
  priority?: string;
}

export async function startWatcher(options: WatchOptions): Promise<void> {
  const {
    dir,
    url,
    debounceMs = 2000,
    tags,
    priority,
    ...runOpts
  } = options;

  const watchDir = resolve(dir);
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  let isRunning = false;
  let lastChange: string | null = null;

  console.log("");
  console.log(chalk.bold("  Testers Watch Mode"));
  console.log(chalk.dim(`  Watching: ${watchDir}`));
  console.log(chalk.dim(`  Target:   ${url}`));
  console.log(chalk.dim(`  Debounce: ${debounceMs}ms`));
  console.log("");
  console.log(chalk.dim("  Waiting for file changes... (Ctrl+C to stop)"));
  console.log("");

  const runTests = async () => {
    if (isRunning) return;
    isRunning = true;

    console.log(chalk.blue(`  [running] Testing against ${url}...`));
    if (lastChange) {
      console.log(chalk.dim(`            Triggered by: ${lastChange}`));
    }
    console.log("");

    try {
      const { run, results } = await runByFilter({
        url,
        tags,
        priority,
        ...runOpts,
      });

      console.log(formatTerminal(run, results));

      const exitCode = getExitCode(run);
      if (exitCode === 0) {
        console.log(chalk.green("  All tests passed!"));
      } else {
        console.log(chalk.red(`  ${run.failed} test(s) failed.`));
      }
    } catch (error) {
      console.error(chalk.red(`  Error: ${error instanceof Error ? error.message : String(error)}`));
    } finally {
      isRunning = false;
      console.log("");
      console.log(chalk.dim("  Waiting for file changes..."));
      console.log("");
    }
  };

  const watcher = watch(watchDir, { recursive: true }, (_event, filename) => {
    if (!filename) return;

    // Ignore hidden files, node_modules, dist, .testers
    const ignored = [
      "node_modules",
      ".git",
      "dist",
      ".testers",
      ".next",
      ".nuxt",
      ".svelte-kit",
    ];
    if (ignored.some((dir) => filename.includes(dir))) return;

    // Only watch source files
    const extensions = [".ts", ".tsx", ".js", ".jsx", ".vue", ".svelte", ".css", ".html"];
    if (!extensions.some((ext) => filename.endsWith(ext))) return;

    lastChange = filename;
    console.log(chalk.yellow(`  [change] ${filename}`));

    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      runTests();
    }, debounceMs);
  });

  // Handle graceful shutdown
  const cleanup = () => {
    watcher.close();
    if (debounceTimer) clearTimeout(debounceTimer);
    console.log("");
    console.log(chalk.dim("  Watch mode stopped."));
    process.exit(0);
  };

  process.on("SIGINT", cleanup);
  process.on("SIGTERM", cleanup);

  // Keep process alive
  await new Promise(() => {}); // Never resolves — keeps running until signal
}
