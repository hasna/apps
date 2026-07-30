import type { Command } from "commander";
import chalk from "chalk";
import { execSync } from "child_process";
import { printErrorLine, printJsonLine, printLine } from "../../lib/stdout.js";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface TmuxSendOptions {
  delayMs?: number;
  retries?: number;
  verify?: boolean;
}

interface TmuxSendResult {
  success: boolean;
  attempts: number;
}

function countLines(message: string): number {
  const matches = message.match(/\r?\n/g);
  return (matches?.length ?? 0) + 1;
}

function getDefaultDelayMs(message: string): number {
  // Keep short messages near-instant while still giving large payloads room to paste.
  const byLength = message.length * 1.5;
  const byLines = countLines(message) * 10;
  return Math.max(25, Math.min(1500, Math.round(byLength + byLines)));
}

function getVerifyPauseMs(message: string): number {
  return message.length <= 120 ? 50 : 100;
}

function getRetryBackoffMs(attempt: number): number {
  return Math.min(500, 100 * attempt);
}

export async function tmuxSend(
  target: string,
  message: string,
  opts: TmuxSendOptions = {},
): Promise<TmuxSendResult> {
  const delay = opts.delayMs ?? getDefaultDelayMs(message);
  const maxRetries = opts.retries ?? 3;
  const verify = opts.verify !== false;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    // 1. Paste message literally
    execSync(`tmux send-keys -t ${JSON.stringify(target)} -l ${JSON.stringify(message)}`);

    // 2. Wait for pane to be idle
    await sleep(delay);

    // 3. Hit Enter to submit
    execSync(`tmux send-keys -t ${JSON.stringify(target)} Enter`);

    // 4. Verify (optional) — capture pane and check input bar is empty
    if (!verify) return { success: true, attempts: attempt };

    await sleep(getVerifyPauseMs(message));
    const pane = execSync(`tmux capture-pane -t ${JSON.stringify(target)} -p`).toString();
    const lastLines = pane.split("\n").slice(-6).join("\n");
    // If the beginning of the message is no longer visible in the prompt area, it was submitted
    const marker = message.slice(0, Math.min(32, message.length));
    if (!lastLines.includes(marker)) {
      return { success: true, attempts: attempt };
    }

    // Not submitted yet — retry
    if (attempt < maxRetries) await sleep(getRetryBackoffMs(attempt));
  }

  return { success: false, attempts: maxRetries };
}

export function registerTmuxCommands(program: Command): void {
  const tmux = program
    .command("tmux")
    .description("Dispatch messages to tmux windows (Claude Code sessions)");

  // ---- tmux send ----
  tmux
    .command("send")
    .description("Send a message to a tmux window with paste+wait+Enter+verify")
    .requiredOption("--target <target>", "Tmux target: session:window or session:window.pane")
    .requiredOption("--message <text>", "Message text to send")
    .option("--delay <ms>", "Wait time (ms) after paste before hitting Enter (default: adaptive 25-1500ms)", parseInt)
    .option("--retries <n>", "Max retry attempts (default: 3)", parseInt)
    .option("--no-verify", "Skip verification after sending")
    .option("-j, --json", "Output result as JSON")
    .action(async (opts) => {
      const target = opts.target.trim();
      const message = opts.message;

      if (!target) {
        printErrorLine(chalk.red("--target is required."));
        process.exit(1);
      }
      if (!message || !message.trim()) {
        printErrorLine(chalk.red("--message cannot be empty."));
        process.exit(1);
      }

      try {
        const result = await tmuxSend(target, message, {
          delayMs: Number.isFinite(opts.delay) ? opts.delay : undefined,
          retries: Number.isFinite(opts.retries) ? opts.retries : undefined,
          verify: opts.verify !== false,
        });

        if (opts.json) {
          printJsonLine({ target, result });
        } else if (result.success) {
          printLine(
            chalk.green(`Sent to ${target}`) +
            chalk.dim(` (attempt ${result.attempts})`),
          );
        } else {
          printErrorLine(
            chalk.red(`Failed to confirm delivery to ${target}`) +
            chalk.dim(` after ${result.attempts} attempt(s)`),
          );
          process.exit(1);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (opts.json) {
          printJsonLine({ target, error: msg });
        } else {
          printErrorLine(chalk.red(`tmux error: ${msg}`));
        }
        process.exit(1);
      }
    });

  // ---- tmux broadcast ----
  tmux
    .command("broadcast")
    .description("Send the same message to multiple tmux windows")
    .requiredOption("--targets <list>", "Comma-separated list of tmux targets")
    .requiredOption("--message <text>", "Message text to send")
    .option("--delay <ms>", "Wait time (ms) after paste before Enter (default: adaptive 25-1500ms)", parseInt)
    .option("--stagger <ms>", "Delay (ms) between each target (default: 500)", parseInt)
    .option("--retries <n>", "Max retry attempts per target (default: 3)", parseInt)
    .option("--no-verify", "Skip verification after sending")
    .option("-j, --json", "Output results as JSON")
    .action(async (opts) => {
      const targets = opts.targets
        .split(",")
        .map((t: string) => t.trim())
        .filter(Boolean) as string[];
      const message = opts.message;
      const stagger = Number.isFinite(opts.stagger) && opts.stagger >= 0 ? opts.stagger : 500;

      if (targets.length === 0) {
        printErrorLine(chalk.red("--targets must be a non-empty comma-separated list."));
        process.exit(1);
      }
      if (!message || !message.trim()) {
        printErrorLine(chalk.red("--message cannot be empty."));
        process.exit(1);
      }

      const results: Array<{ target: string; success: boolean; attempts: number; error?: string }> = new Array(targets.length);

      await Promise.all(targets.map(async (target, i) => {
        if (i > 0 && stagger > 0) await sleep(stagger * i);

        try {
          const result = await tmuxSend(target, message, {
            delayMs: Number.isFinite(opts.delay) ? opts.delay : undefined,
            retries: Number.isFinite(opts.retries) ? opts.retries : undefined,
            verify: opts.verify !== false,
          });
          results[i] = { target, ...result };
          if (!opts.json) {
            if (result.success) {
              printLine(chalk.green(`  ✓ ${target}`) + chalk.dim(` (attempt ${result.attempts})`));
            } else {
              printLine(chalk.red(`  ✗ ${target}`) + chalk.dim(` (failed after ${result.attempts} attempts)`));
            }
          }
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : String(err);
          results[i] = { target, success: false, attempts: 0, error: errMsg };
          if (!opts.json) {
            printLine(chalk.red(`  ✗ ${target}: ${errMsg}`));
          }
        }
      }));

      const succeeded = results.filter((r) => r.success).length;
      const failed = results.length - succeeded;

      if (opts.json) {
        printJsonLine({ results, succeeded, failed, total: results.length });
      } else {
        printLine(chalk.dim(`\nBroadcast complete: ${chalk.green(succeeded)} succeeded, ${failed > 0 ? chalk.red(failed) : chalk.dim(failed)} failed`));
      }

      if (failed > 0) process.exit(1);
    });
}
