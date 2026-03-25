#!/usr/bin/env bun
import { Command } from "commander";
import chalk from "chalk";
import { runTask } from "../agent/loop.js";
import { listSessions, getSession, getActionLogs, deleteSession, getStats } from "../db/index.js";
import { captureScreenshot, saveScreenshotToFile } from "../drivers/mac/screenshot.js";
import type { Provider } from "../types/index.js";

const program = new Command();

program
  .name("computer")
  .description("Open-source computer use for AI agents — control your Mac with AI")
  .version("0.1.0");

// ── run ──────────────────────────────────────────────────────────────
program
  .command("run")
  .description("Run a computer use task")
  .argument("<task>", "Natural language description of the task")
  .option("-p, --provider <provider>", "AI provider (anthropic|openai)", "anthropic")
  .option("-m, --model <model>", "Model to use")
  .option("-s, --max-steps <n>", "Maximum number of steps", "50")
  .option("--save-screenshots", "Save screenshots to disk", false)
  .option("--screenshots-dir <dir>", "Directory to save screenshots")
  .option("--system-prompt <prompt>", "Custom system prompt")
  .option("--max-width <px>", "Max screenshot width for AI model (default: 1280)", "1280")
  .action(async (task: string, opts: any) => {
    console.log(chalk.bold.cyan("computer") + " — starting task");
    console.log(chalk.dim(`Provider: ${opts.provider} | Max steps: ${opts.maxSteps} | Max width: ${opts.maxWidth}px`));
    console.log(chalk.dim(`Task: ${task}`));
    console.log();

    const session = await runTask({
      task,
      provider: opts.provider as Provider,
      model: opts.model,
      maxSteps: parseInt(opts.maxSteps),
      saveScreenshots: opts.saveScreenshots,
      screenshotsDir: opts.screenshotsDir,
      systemPrompt: opts.systemPrompt,
      screenshotMaxWidth: parseInt(opts.maxWidth),
      onStep: (step, response, result) => {
        const status = result.success ? chalk.green("OK") : chalk.red("FAIL");
        const actionDesc = response.action
          ? `${response.action.type}${response.action.type === "click" ? ` (${(response.action as any).point.x},${(response.action as any).point.y})` : ""}`
          : "done";
        console.log(
          chalk.dim(`[${String(step + 1).padStart(3)}]`) +
          ` ${status} ${chalk.yellow(actionDesc)}` +
          chalk.dim(` (${result.duration_ms}ms)`)
        );
        if (response.reasoning) {
          const short = response.reasoning.slice(0, 120).replace(/\n/g, " ");
          console.log(chalk.dim(`      ${short}${response.reasoning.length > 120 ? "..." : ""}`));
        }
      },
      onDone: (session) => {
        console.log();
        if (session.status === "completed" && !session.error) {
          console.log(chalk.green.bold("Task completed successfully."));
        } else if (session.status === "completed" && session.error) {
          console.log(chalk.yellow.bold(`Task finished: ${session.error}`));
        } else {
          console.log(chalk.red.bold(`Task failed: ${session.error}`));
        }
        console.log(
          chalk.dim(
            `Steps: ${session.steps} | Tokens: ${session.total_tokens_in + session.total_tokens_out} | Duration: ${(session.total_duration_ms / 1000).toFixed(1)}s`
          )
        );
        console.log(chalk.dim(`Session: ${session.id}`));
      },
    });
  });

// ── screenshot ───────────────────────────────────────────────────────
program
  .command("screenshot")
  .description("Take a screenshot of the current screen")
  .option("-o, --output <path>", "Save to file path")
  .action(async (opts: any) => {
    const ss = await captureScreenshot();
    if (opts.output) {
      const dir = opts.output.includes("/") ? opts.output.substring(0, opts.output.lastIndexOf("/")) : ".";
      const file = opts.output.includes("/") ? opts.output.substring(opts.output.lastIndexOf("/") + 1) : opts.output;
      const path = await saveScreenshotToFile(ss, dir, file);
      console.log(chalk.green(`Screenshot saved: ${path}`));
    } else {
      console.log(chalk.green(`Screenshot captured: ${ss.size.width}x${ss.size.height}`));
      console.log(chalk.dim(`Base64 length: ${ss.base64.length} chars`));
    }
  });

// ── sessions ─────────────────────────────────────────────────────────
program
  .command("sessions")
  .description("List computer use sessions")
  .option("-n, --limit <n>", "Number of sessions to show", "20")
  .option("--status <status>", "Filter by status")
  .action(async (opts: any) => {
    const sessions = listSessions({
      limit: parseInt(opts.limit),
      status: opts.status,
    });

    if (sessions.length === 0) {
      console.log(chalk.dim("No sessions found."));
      return;
    }

    for (const s of sessions) {
      const statusColor =
        s.status === "completed" ? chalk.green :
        s.status === "failed" ? chalk.red :
        s.status === "running" ? chalk.yellow : chalk.dim;

      console.log(
        `${chalk.dim(s.id.slice(0, 8))} ${statusColor(s.status.padEnd(10))} ${chalk.cyan(s.provider.padEnd(10))} ${s.steps} steps  ${chalk.dim(s.created_at)}`
      );
      console.log(chalk.dim(`  ${s.task.slice(0, 100)}`));
    }
  });

// ── session ──────────────────────────────────────────────────────────
program
  .command("session")
  .description("Show details of a session")
  .argument("<id>", "Session ID (or prefix)")
  .action(async (id: string) => {
    // Support prefix matching
    const sessions = listSessions({ limit: 100 });
    const session = sessions.find((s) => s.id.startsWith(id));

    if (!session) {
      console.log(chalk.red(`Session not found: ${id}`));
      process.exit(1);
    }

    console.log(chalk.bold("Session: ") + session.id);
    console.log(chalk.bold("Task: ") + session.task);
    console.log(chalk.bold("Provider: ") + session.provider + " / " + session.model);
    console.log(chalk.bold("Status: ") + session.status);
    console.log(chalk.bold("Steps: ") + session.steps);
    console.log(chalk.bold("Tokens: ") + `${session.total_tokens_in} in / ${session.total_tokens_out} out`);
    console.log(chalk.bold("Duration: ") + `${(session.total_duration_ms / 1000).toFixed(1)}s`);
    if (session.error) console.log(chalk.bold("Error: ") + chalk.red(session.error));
    console.log(chalk.bold("Created: ") + session.created_at);
    if (session.completed_at) console.log(chalk.bold("Completed: ") + session.completed_at);

    console.log();
    console.log(chalk.bold("Action Log:"));
    const logs = getActionLogs(session.id);
    for (const log of logs) {
      const status = log.success ? chalk.green("OK") : chalk.red("FAIL");
      console.log(`  [${String(log.step + 1).padStart(3)}] ${status} ${chalk.yellow(log.action.type)} ${chalk.dim(`${log.duration_ms}ms`)}`);
      if (log.reasoning) {
        const short = log.reasoning.slice(0, 100).replace(/\n/g, " ");
        console.log(chalk.dim(`        ${short}`));
      }
      if (log.error) console.log(chalk.red(`        Error: ${log.error}`));
    }
  });

// ── delete ───────────────────────────────────────────────────────────
program
  .command("delete")
  .description("Delete a session")
  .argument("<id>", "Session ID (or prefix)")
  .action(async (id: string) => {
    const sessions = listSessions({ limit: 1000 });
    const session = sessions.find((s) => s.id.startsWith(id));
    if (!session) {
      console.log(chalk.red(`Session not found: ${id}`));
      process.exit(1);
    }
    deleteSession(session.id);
    console.log(chalk.green(`Deleted session: ${session.id}`));
  });

// ── stats ────────────────────────────────────────────────────────────
program
  .command("stats")
  .description("Show usage statistics")
  .action(async () => {
    const stats = getStats();
    console.log(chalk.bold("Computer Use Stats"));
    console.log(`  Sessions:  ${stats.total_sessions} (${chalk.green(stats.completed + " completed")}, ${chalk.red(stats.failed + " failed")})`);
    console.log(`  Steps:     ${stats.total_steps}`);
    console.log(`  Tokens:    ${stats.total_tokens.toLocaleString()}`);
  });

program.parse();
